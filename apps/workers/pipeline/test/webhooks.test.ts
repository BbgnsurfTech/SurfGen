import { createHmac } from 'node:crypto';
import { describe, expect, test, vi } from 'vitest';
import type { EventEnvelope } from '@surfgen/core';
import {
  createWebhookDispatcher,
  signWebhookPayload,
  type DispatcherPrisma,
  type WebhookRecord,
} from '../src/webhooks.js';

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as never;

function envelope(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    id: 'evt_1',
    name: 'video.ready',
    occurredAt: '2026-07-03T00:00:00.000Z',
    organizationId: 'org_1',
    payload: { videoId: 'vid_1' },
    version: 1,
    ...overrides,
  };
}

function hook(overrides: Partial<WebhookRecord> = {}): WebhookRecord {
  return {
    id: 'wh_1',
    url: 'https://example.com/hooks/surfgen',
    events: ['video.*'],
    secretRef: 'env:TEST_WEBHOOK_SECRET',
    ...overrides,
  };
}

interface Harness {
  prisma: DispatcherPrisma;
  created: unknown[];
  updated: { where: unknown; data: Record<string, unknown> }[];
}

function makePrisma(hooks: WebhookRecord[], options: { duplicate?: boolean } = {}): Harness {
  const created: unknown[] = [];
  const updated: { where: unknown; data: Record<string, unknown> }[] = [];
  const prisma: DispatcherPrisma = {
    webhook: {
      findMany: async () => hooks,
    },
    webhookDelivery: {
      create: async (args) => {
        if (options.duplicate) {
          throw Object.assign(new Error('unique constraint'), { code: 'P2002' });
        }
        created.push(args);
        return { id: 'del_1' };
      },
      update: async (args) => {
        updated.push(args as never);
        return { id: 'del_1' };
      },
    },
  };
  return { prisma, created, updated };
}

describe('signWebhookPayload', () => {
  test('produces a t=..,v1=<hmac(secret, "t.body")> header value', () => {
    const signature = signWebhookPayload('shhh', 1_751_500_800, '{"a":1}');
    const expected = createHmac('sha256', 'shhh').update('1751500800.{"a":1}').digest('hex');
    expect(signature).toBe(`t=1751500800,v1=${expected}`);
  });
});

describe('webhook dispatcher', () => {
  test('delivers a matching event with a verifiable signature', async () => {
    process.env.TEST_WEBHOOK_SECRET = 'topsecret';
    const { prisma, created, updated } = makePrisma([hook()]);
    const fetchImpl = vi.fn(async () => ({ status: 200, ok: true, bodyText: '' }));
    const dispatcher = createWebhookDispatcher({ prisma, logger: noopLogger, fetchImpl });

    await dispatcher.handleEvent(envelope());

    expect(created).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string>; body: string },
    ];
    expect(url).toBe('https://example.com/hooks/surfgen');
    expect(init.headers['x-surfgen-event']).toBe('video.ready');
    // Signature must verify against the exact body bytes that were sent.
    const [tPart, v1Part] = init.headers['x-surfgen-signature']!.split(',');
    const timestamp = tPart!.slice(2);
    const expected = createHmac('sha256', 'topsecret')
      .update(`${timestamp}.${init.body}`)
      .digest('hex');
    expect(v1Part).toBe(`v1=${expected}`);
    expect(updated.at(-1)?.data).toMatchObject({ status: 'delivered', responseCode: 200 });
  });

  test('ignores events without an organization scope', async () => {
    const { prisma, created } = makePrisma([hook()]);
    const fetchImpl = vi.fn(async () => ({ status: 200, ok: true, bodyText: '' }));
    const dispatcher = createWebhookDispatcher({ prisma, logger: noopLogger, fetchImpl });

    const event = envelope();
    await dispatcher.handleEvent({ ...event, organizationId: undefined } as never);

    expect(created).toHaveLength(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('skips webhooks whose patterns do not match the event name', async () => {
    process.env.TEST_WEBHOOK_SECRET = 'topsecret';
    const { prisma, created } = makePrisma([hook({ events: ['video.failed'] })]);
    const fetchImpl = vi.fn(async () => ({ status: 200, ok: true, bodyText: '' }));
    const dispatcher = createWebhookDispatcher({ prisma, logger: noopLogger, fetchImpl });

    await dispatcher.handleEvent(envelope({ name: 'video.ready' }));

    expect(created).toHaveLength(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('is idempotent — a duplicate (webhookId, eventId) never re-sends', async () => {
    process.env.TEST_WEBHOOK_SECRET = 'topsecret';
    const { prisma } = makePrisma([hook()], { duplicate: true });
    const fetchImpl = vi.fn(async () => ({ status: 200, ok: true, bodyText: '' }));
    const dispatcher = createWebhookDispatcher({ prisma, logger: noopLogger, fetchImpl });

    await dispatcher.handleEvent(envelope());

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('retries then marks the delivery failed after exhausting attempts', async () => {
    process.env.TEST_WEBHOOK_SECRET = 'topsecret';
    const { prisma, updated } = makePrisma([hook()]);
    const fetchImpl = vi.fn(async () => ({ status: 500, ok: false, bodyText: '' }));
    const dispatcher = createWebhookDispatcher({
      prisma,
      logger: noopLogger,
      fetchImpl,
      delayFn: async () => {},
    });

    await dispatcher.handleEvent(envelope());

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(updated.at(-1)?.data).toMatchObject({ status: 'failed', responseCode: 500, attempts: 3 });
  });

  test('marks the delivery failed when the secret ref cannot be resolved', async () => {
    const { prisma, updated } = makePrisma([hook({ secretRef: 'env:SURFGEN_MISSING_SECRET' })]);
    const fetchImpl = vi.fn(async () => ({ status: 200, ok: true, bodyText: '' }));
    const dispatcher = createWebhookDispatcher({ prisma, logger: noopLogger, fetchImpl });

    await dispatcher.handleEvent(envelope());

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(updated.at(-1)?.data).toMatchObject({ status: 'failed' });
  });
});
