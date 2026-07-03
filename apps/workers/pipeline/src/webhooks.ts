import { createHmac } from 'node:crypto';
import type { EventEnvelope, EventSubscriberPort } from '@surfgen/core';
import { matchTopic } from '@surfgen/events';
import { resolveSecretRef } from '@surfgen/plugin-sdk';
import { safeFetch, type SafeFetchResult } from '@surfgen/safe-net';
import type { Logger } from '@surfgen/telemetry';

/** Durable queue — deliveries survive dispatcher restarts. */
const QUEUE_NAME = 'surfgen.webhooks';
const SUBSCRIBE_PATTERNS = ['video.#', 'pipeline.#'] as const;
const DELIVERY_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [500, 2_000] as const;

export interface WebhookRecord {
  readonly id: string;
  readonly url: string;
  readonly events: readonly string[];
  readonly secretRef: string;
}

/** Structural subset of the Prisma client the dispatcher touches. */
export interface DispatcherPrisma {
  webhook: {
    findMany(args: {
      where: { organizationId: string; enabled: boolean };
    }): Promise<WebhookRecord[]>;
  };
  webhookDelivery: {
    create(args: {
      data: {
        webhookId: string;
        eventId: string;
        eventName: string;
        payload: never;
      };
    }): Promise<{ id: string }>;
    update(args: {
      where: { id: string };
      data: {
        status: string;
        attempts: number;
        responseCode?: number;
        deliveredAt?: Date;
      };
    }): Promise<unknown>;
  };
}

export interface WebhookDispatcherOptions {
  readonly prisma: DispatcherPrisma;
  readonly logger: Logger;
  /** Injectable for tests — defaults to the SSRF-hardened safeFetch. */
  readonly fetchImpl?: (
    url: string,
    init: { method: string; headers: Record<string, string>; body: string; timeoutMs: number },
  ) => Promise<Pick<SafeFetchResult, 'status' | 'ok'>>;
  readonly delayFn?: (ms: number) => Promise<void>;
}

/**
 * Stripe-style signature: `t=<unix seconds>,v1=<hex hmac-sha256>` over
 * `${t}.${body}`. Including the timestamp in the signed string lets
 * receivers reject replayed deliveries.
 */
export function signWebhookPayload(secret: string, timestampSeconds: number, body: string): string {
  const mac = createHmac('sha256', secret).update(`${timestampSeconds}.${body}`).digest('hex');
  return `t=${timestampSeconds},v1=${mac}`;
}

const defaultDelay = (ms: number): Promise<void> =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, ms).unref());

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error) && (error as { code?: string }).code === 'P2002';
}

/**
 * Delivers org-scoped domain events to registered webhooks. Idempotency is
 * the DB unique key (webhookId, eventId): redelivered bus messages create a
 * duplicate row and are skipped. Per-hook failures never affect other hooks
 * or nack the bus message — the delivery row is the source of truth.
 */
export function createWebhookDispatcher(options: WebhookDispatcherOptions) {
  const { prisma, logger } = options;
  const fetchImpl =
    options.fetchImpl ??
    ((url, init) => safeFetch(url, init));
  const delay = options.delayFn ?? defaultDelay;

  async function deliverToHook(hook: WebhookRecord, event: EventEnvelope): Promise<void> {
    let delivery: { id: string };
    try {
      delivery = await prisma.webhookDelivery.create({
        data: {
          webhookId: hook.id,
          eventId: event.id,
          eventName: event.name,
          payload: (event.payload ?? {}) as never,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) return; // already handled (bus redelivery)
      throw error;
    }

    let secret: string;
    try {
      secret = resolveSecretRef(hook.secretRef);
    } catch (error) {
      logger.error({ webhookId: hook.id, error: String(error) }, 'webhook secret unresolvable');
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: { status: 'failed', attempts: 0 },
      });
      return;
    }

    const body = JSON.stringify({
      id: event.id,
      name: event.name,
      occurredAt: event.occurredAt,
      payload: event.payload,
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const headers = {
      'content-type': 'application/json',
      'user-agent': 'SurfGen-Webhooks/1.0',
      'x-surfgen-event': event.name,
      'x-surfgen-delivery': delivery.id,
      'x-surfgen-signature': signWebhookPayload(secret, timestamp, body),
    };

    let lastStatus: number | undefined;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const response = await fetchImpl(hook.url, {
          method: 'POST',
          headers,
          body,
          timeoutMs: DELIVERY_TIMEOUT_MS,
        });
        lastStatus = response.status;
        if (response.ok) {
          await prisma.webhookDelivery.update({
            where: { id: delivery.id },
            data: {
              status: 'delivered',
              attempts: attempt,
              responseCode: response.status,
              deliveredAt: new Date(),
            },
          });
          return;
        }
      } catch (error) {
        logger.warn(
          { webhookId: hook.id, attempt, error: String(error) },
          'webhook delivery attempt failed',
        );
      }
      const retryDelay = RETRY_DELAYS_MS[attempt - 1];
      if (retryDelay !== undefined) await delay(retryDelay);
    }

    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: 'failed',
        attempts: MAX_ATTEMPTS,
        ...(lastStatus !== undefined && { responseCode: lastStatus }),
      },
    });
    logger.error({ webhookId: hook.id, event: event.name }, 'webhook delivery exhausted retries');
  }

  async function handleEvent(event: EventEnvelope): Promise<void> {
    if (!event.organizationId) return; // only org-scoped events reach subscribers
    const hooks = await prisma.webhook.findMany({
      where: { organizationId: event.organizationId, enabled: true },
    });
    const matching = hooks.filter((hook) =>
      hook.events.some((pattern) => matchTopic(pattern, event.name)),
    );
    // Per-hook isolation: one dead endpoint must not block the others.
    await Promise.all(
      matching.map((hook) =>
        deliverToHook(hook, event).catch((error) =>
          logger.error({ webhookId: hook.id, error: String(error) }, 'webhook delivery errored'),
        ),
      ),
    );
  }

  return {
    handleEvent,
    start: (subscriber: EventSubscriberPort) =>
      subscriber.subscribe(SUBSCRIBE_PATTERNS, handleEvent, { queueName: QUEUE_NAME, prefetch: 5 }),
  };
}
