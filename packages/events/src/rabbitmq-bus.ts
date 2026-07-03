import { connect, type ChannelModel, type ConfirmChannel, type ConsumeMessage } from 'amqplib';
import type { EventEnvelope, EventPublisherPort, EventSubscriberPort } from '@surfgen/core';
import type { Logger } from '@surfgen/telemetry';
import { parseEnvelope } from './envelope.js';

export interface RabbitMqBusOptions {
  readonly url: string;
  readonly exchange?: string;
  readonly logger: Logger;
  /** Injectable for tests. */
  readonly connectImpl?: typeof connect;
  readonly reconnect?: {
    readonly maxAttempts?: number;
    readonly baseDelayMs?: number;
    readonly maxDelayMs?: number;
  };
}

interface SubscriptionSpec {
  readonly patterns: readonly string[];
  readonly handler: (event: EventEnvelope) => Promise<void>;
  readonly queueName?: string;
  readonly prefetch: number;
  active: boolean;
}

const DEFAULT_EXCHANGE = 'surfgen.events';
const DLX_SUFFIX = '.dlx';
const DEAD_QUEUE_SUFFIX = '.dead';
const DEFAULT_RECONNECT = { maxAttempts: 10, baseDelayMs: 500, maxDelayMs: 30_000 };

/**
 * RabbitMQ adapter for the event ports. Topic exchange, durable + persistent,
 * publisher confirms, manual ack with dead-lettering, and automatic
 * reconnection that re-establishes all subscriptions.
 */
export class RabbitMqEventBus implements EventPublisherPort, EventSubscriberPort {
  private connection: ChannelModel | null = null;
  private publishChannel: ConfirmChannel | null = null;
  private readonly subscriptions = new Set<SubscriptionSpec>();
  private readonly exchange: string;
  private readonly connectImpl: typeof connect;
  private readonly reconnectPolicy: Required<NonNullable<RabbitMqBusOptions['reconnect']>>;
  private closing = false;

  constructor(private readonly options: RabbitMqBusOptions) {
    this.exchange = options.exchange ?? DEFAULT_EXCHANGE;
    this.connectImpl = options.connectImpl ?? connect;
    this.reconnectPolicy = { ...DEFAULT_RECONNECT, ...options.reconnect };
  }

  async connect(): Promise<void> {
    this.connection = await this.connectImpl(this.options.url);
    this.connection.on('close', () => {
      this.publishChannel = null;
      if (!this.closing) void this.reconnect();
    });
    this.connection.on('error', (error: unknown) =>
      this.options.logger.error({ error: String(error) }, 'rabbitmq connection error'),
    );

    const channel = await this.connection.createConfirmChannel();
    await channel.assertExchange(this.exchange, 'topic', { durable: true });
    // Dead-letter topology: rejected messages route to <exchange>.dlx → durable dead queue.
    await channel.assertExchange(this.exchange + DLX_SUFFIX, 'topic', { durable: true });
    await channel.assertQueue(this.exchange + DEAD_QUEUE_SUFFIX, { durable: true });
    await channel.bindQueue(this.exchange + DEAD_QUEUE_SUFFIX, this.exchange + DLX_SUFFIX, '#');
    this.publishChannel = channel;

    for (const spec of this.subscriptions) {
      await this.startConsumer(spec);
    }
  }

  private async reconnect(attempt = 1): Promise<void> {
    const { maxAttempts, baseDelayMs, maxDelayMs } = this.reconnectPolicy;
    if (attempt > maxAttempts) {
      this.options.logger.error({ attempt }, 'rabbitmq reconnect attempts exhausted');
      return;
    }
    const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
    this.options.logger.warn({ attempt, delay }, 'rabbitmq reconnecting');
    await new Promise((resolveDelay) => setTimeout(resolveDelay, delay).unref());
    try {
      await this.connect();
      this.options.logger.info({ attempt }, 'rabbitmq reconnected');
    } catch (error) {
      this.options.logger.warn({ attempt, error: String(error) }, 'rabbitmq reconnect failed');
      await this.reconnect(attempt + 1);
    }
  }

  private requireChannel(): ConfirmChannel {
    if (!this.publishChannel) {
      throw new Error('RabbitMqEventBus is not connected — call connect() first');
    }
    return this.publishChannel;
  }

  async publish<T>(event: EventEnvelope<T>): Promise<void> {
    const channel = this.requireChannel();
    channel.publish(this.exchange, event.name, Buffer.from(JSON.stringify(event)), {
      persistent: true,
      contentType: 'application/json',
      messageId: event.id,
      timestamp: Math.floor(Date.parse(event.occurredAt) / 1000),
    });
    await channel.waitForConfirms();
  }

  async publishMany(events: readonly EventEnvelope[]): Promise<void> {
    const channel = this.requireChannel();
    for (const event of events) {
      channel.publish(this.exchange, event.name, Buffer.from(JSON.stringify(event)), {
        persistent: true,
        contentType: 'application/json',
        messageId: event.id,
      });
    }
    await channel.waitForConfirms();
  }

  async subscribe(
    patterns: readonly string[],
    handler: (event: EventEnvelope) => Promise<void>,
    options: { queueName?: string; prefetch?: number } = {},
  ): Promise<{ unsubscribe: () => Promise<void> }> {
    const spec: SubscriptionSpec = {
      patterns,
      handler,
      ...(options.queueName !== undefined && { queueName: options.queueName }),
      prefetch: options.prefetch ?? 10,
      active: true,
    };
    this.subscriptions.add(spec);
    if (this.connection) await this.startConsumer(spec);
    return {
      unsubscribe: async () => {
        spec.active = false;
        this.subscriptions.delete(spec);
      },
    };
  }

  private async startConsumer(spec: SubscriptionSpec): Promise<void> {
    if (!this.connection) return;
    const channel = await this.connection.createChannel();
    await channel.prefetch(spec.prefetch);
    const { queue } = await channel.assertQueue(spec.queueName ?? '', {
      durable: Boolean(spec.queueName),
      exclusive: !spec.queueName,
      arguments: { 'x-dead-letter-exchange': this.exchange + DLX_SUFFIX },
    });
    for (const pattern of spec.patterns) {
      await channel.bindQueue(queue, this.exchange, pattern);
    }

    await channel.consume(queue, (message: ConsumeMessage | null) => {
      if (!message) return;
      if (!spec.active) {
        channel.nack(message, false, true);
        return;
      }
      const parsed = parseEnvelope(safeJsonParse(message.content));
      if (!parsed.ok) {
        this.options.logger.warn(
          { routingKey: message.fields.routingKey },
          'invalid event envelope — dead-lettering',
        );
        channel.nack(message, false, false);
        return;
      }
      void spec
        .handler(parsed.value)
        .then(() => channel.ack(message))
        .catch((error) => {
          this.options.logger.error(
            { event: parsed.value.name, id: parsed.value.id, error: String(error) },
            'event handler failed — dead-lettering',
          );
          channel.nack(message, false, false);
        });
    });
  }

  async close(): Promise<void> {
    this.closing = true;
    await this.connection?.close().catch(() => {});
    this.connection = null;
    this.publishChannel = null;
  }
}

function safeJsonParse(buffer: Buffer): unknown {
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch {
    return null;
  }
}
