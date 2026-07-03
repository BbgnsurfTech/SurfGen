import { describe, expect, test } from 'vitest';
import { createEnvelope, parseEnvelope } from '../src/envelope.js';
import { InMemoryEventBus, matchTopic } from '../src/in-memory-bus.js';
import { InMemoryOutboxStore, OutboxRelay, type OutboxRecord } from '../src/outbox.js';
import { isErr, unwrap } from '@surfgen/core';
import { createLogger } from '@surfgen/telemetry';
import { Writable } from 'node:stream';

const silentLogger = createLogger({
  service: 'test',
  destination: new Writable({ write: (_c, _e, cb) => cb() }),
});

describe('matchTopic (AMQP semantics)', () => {
  test.each([
    // pattern, key, expected
    ['video.*', 'video.created', true],
    ['video.*', 'video.stage.completed', false],
    ['video.#', 'video.created', true],
    ['video.#', 'video.stage.completed', true],
    ['video.#', 'video', true], // '#' matches zero words
    ['#', 'anything.at.all', true],
    ['#', 'single', true],
    ['*.created', 'video.created', true],
    ['*.created', 'avatar.created', true],
    ['*.created', 'video.stage.created', false],
    ['video.created', 'video.created', true],
    ['video.created', 'video.failed', false],
    ['video.*.completed', 'video.stage.completed', true],
    ['video.#.completed', 'video.a.b.completed', true],
    ['#.completed', 'completed', true],
  ])('pattern %s vs key %s → %s', (pattern, key, expected) => {
    expect(matchTopic(pattern, key)).toBe(expected);
  });
});

describe('envelope', () => {
  test('create + parse round-trip', () => {
    const envelope = createEnvelope({
      name: 'video.created',
      payload: { videoId: 'vid_1' },
      organizationId: 'org_1',
      correlationId: 'run_1',
    });
    expect(envelope.id).toMatch(/^evt_/);
    expect(envelope.version).toBe(1);
    const parsed = unwrap(parseEnvelope(JSON.parse(JSON.stringify(envelope))));
    expect(parsed).toEqual(envelope);
  });

  test('rejects malformed envelopes', () => {
    expect(isErr(parseEnvelope(null))).toBe(true);
    expect(isErr(parseEnvelope({ id: 'x' }))).toBe(true);
    expect(
      isErr(
        parseEnvelope({
          id: 'e',
          name: 'NotDotted',
          occurredAt: new Date().toISOString(),
          payload: {},
          version: 1,
        }),
      ),
    ).toBe(true);
  });
});

describe('InMemoryEventBus', () => {
  test('delivers by pattern; failed handlers go to dead letters', async () => {
    const bus = new InMemoryEventBus();
    const seen: string[] = [];
    await bus.subscribe(['video.*'], async (event) => {
      seen.push(event.name);
    });
    await bus.subscribe(['pipeline.#'], async () => {
      throw new Error('handler boom');
    });

    await bus.publish(createEnvelope({ name: 'video.created', payload: {} }));
    await bus.publish(createEnvelope({ name: 'pipeline.stage.failed', payload: {} }));
    await bus.publish(createEnvelope({ name: 'billing.usage_recorded', payload: {} }));

    expect(seen).toEqual(['video.created']);
    expect(bus.deadLetters).toHaveLength(1);
    expect(bus.deadLetters[0]?.event.name).toBe('pipeline.stage.failed');
  });

  test('unsubscribe stops delivery', async () => {
    const bus = new InMemoryEventBus();
    const seen: string[] = [];
    const sub = await bus.subscribe(['#'], async (e) => {
      seen.push(e.name);
    });
    await bus.publish(createEnvelope({ name: 'a.b', payload: {} }));
    await sub.unsubscribe();
    await bus.publish(createEnvelope({ name: 'c.d', payload: {} }));
    expect(seen).toEqual(['a.b']);
  });
});

describe('OutboxRelay', () => {
  const record = (id: string, name = 'video.created'): OutboxRecord => ({
    id,
    envelope: createEnvelope({ name, payload: { id } }),
    createdAt: new Date(),
    publishedAt: null,
    attempts: 0,
  });

  test('publishes pending records and marks them', async () => {
    const store = new InMemoryOutboxStore();
    const bus = new InMemoryEventBus();
    const seen: string[] = [];
    await bus.subscribe(['#'], async (e) => {
      seen.push(e.id);
    });
    await store.save([record('r1'), record('r2')]);

    const relay = new OutboxRelay({ store, publisher: bus, logger: silentLogger });
    await relay.tick();

    expect(seen).toHaveLength(2);
    expect(store.get('r1')?.publishedAt).not.toBeNull();
    expect(await store.fetchUnpublished(10, 10)).toHaveLength(0);
  });

  test('failed publish increments attempts; maxAttempts stops retries', async () => {
    const store = new InMemoryOutboxStore();
    await store.save([record('r1')]);
    const failingPublisher = {
      publish: async () => {
        throw new Error('broker down');
      },
      publishMany: async () => {
        throw new Error('broker down');
      },
    };
    const relay = new OutboxRelay({
      store,
      publisher: failingPublisher,
      logger: silentLogger,
      maxAttempts: 2,
    });

    await relay.tick();
    expect(store.get('r1')?.attempts).toBe(1);
    await relay.tick();
    expect(store.get('r1')?.attempts).toBe(2);
    await relay.tick(); // exceeded maxAttempts — no longer fetched
    expect(store.get('r1')?.attempts).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// RabbitMqEventBus against a stubbed amqplib
// ---------------------------------------------------------------------------
import { RabbitMqEventBus } from '../src/rabbitmq-bus.js';

interface PublishedMessage {
  exchange: string;
  routingKey: string;
  content: Buffer;
  options: Record<string, unknown>;
}

function makeAmqpStub() {
  const state = {
    published: [] as PublishedMessage[],
    assertedExchanges: [] as string[],
    assertedQueues: [] as { name: string; options: Record<string, unknown> }[],
    bindings: [] as { queue: string; exchange: string; pattern: string }[],
    consumers: new Map<string, (msg: unknown) => void>(),
    acked: [] as unknown[],
    nacked: [] as { message: unknown; requeue: boolean }[],
  };

  const channel = {
    assertExchange: async (name: string) => {
      state.assertedExchanges.push(name);
    },
    assertQueue: async (name: string, options: Record<string, unknown>) => {
      const queue = name || 'amq.gen-random';
      state.assertedQueues.push({ name: queue, options });
      return { queue };
    },
    bindQueue: async (queue: string, exchange: string, pattern: string) => {
      state.bindings.push({ queue, exchange, pattern });
    },
    publish: (exchange: string, routingKey: string, content: Buffer, options: Record<string, unknown>) => {
      state.published.push({ exchange, routingKey, content, options });
      return true;
    },
    waitForConfirms: async () => {},
    prefetch: async () => {},
    consume: async (queue: string, onMessage: (msg: unknown) => void) => {
      state.consumers.set(queue, onMessage);
      return { consumerTag: 'tag' };
    },
    ack: (message: unknown) => state.acked.push(message),
    nack: (message: unknown, _allUpTo: boolean, requeue: boolean) =>
      state.nacked.push({ message, requeue }),
  };

  const connection = {
    on: () => connection,
    createConfirmChannel: async () => channel,
    createChannel: async () => channel,
    close: async () => {},
  };

  return { state, connectImpl: (async () => connection) as never };
}

describe('RabbitMqEventBus (stubbed amqplib)', () => {
  test('connect asserts exchange + DLX topology; publish uses routing key + persistence', async () => {
    const { state, connectImpl } = makeAmqpStub();
    const bus = new RabbitMqEventBus({ url: 'amqp://test', logger: silentLogger, connectImpl });
    await bus.connect();

    expect(state.assertedExchanges).toEqual(
      expect.arrayContaining(['surfgen.events', 'surfgen.events.dlx']),
    );
    expect(state.assertedQueues.map((q) => q.name)).toContain('surfgen.events.dead');

    const envelope = createEnvelope({ name: 'video.ready', payload: { videoId: 'v1' } });
    await bus.publish(envelope);
    expect(state.published).toHaveLength(1);
    expect(state.published[0]).toMatchObject({
      exchange: 'surfgen.events',
      routingKey: 'video.ready',
    });
    expect(state.published[0]?.options.persistent).toBe(true);
    await bus.close();
  });

  test('consumer acks valid events, dead-letters invalid and failing ones', async () => {
    const { state, connectImpl } = makeAmqpStub();
    const bus = new RabbitMqEventBus({ url: 'amqp://test', logger: silentLogger, connectImpl });
    await bus.connect();

    const handled: string[] = [];
    await bus.subscribe(
      ['video.*'],
      async (event) => {
        handled.push(event.name);
        if (event.name === 'video.failed') throw new Error('handler explode');
      },
      { queueName: 'video-consumer' },
    );

    const queueOptions = state.assertedQueues.find((q) => q.name === 'video-consumer')?.options;
    expect((queueOptions?.arguments as Record<string, unknown>)['x-dead-letter-exchange']).toBe(
      'surfgen.events.dlx',
    );
    expect(state.bindings).toContainEqual({
      queue: 'video-consumer',
      exchange: 'surfgen.events',
      pattern: 'video.*',
    });

    const deliver = state.consumers.get('video-consumer')!;
    const wrap = (envelope: unknown, key: string) => ({
      content: Buffer.from(JSON.stringify(envelope)),
      fields: { routingKey: key },
      properties: {},
    });

    deliver(wrap(createEnvelope({ name: 'video.created', payload: {} }), 'video.created'));
    deliver(wrap({ garbage: true }, 'video.created'));
    deliver(wrap(createEnvelope({ name: 'video.failed', payload: {} }), 'video.failed'));
    await new Promise((r) => setTimeout(r, 20)); // let async handlers settle

    expect(handled).toEqual(['video.created', 'video.failed']);
    expect(state.acked).toHaveLength(1);
    expect(state.nacked).toHaveLength(2);
    expect(state.nacked.every((n) => n.requeue === false)).toBe(true);
    await bus.close();
  });
});
