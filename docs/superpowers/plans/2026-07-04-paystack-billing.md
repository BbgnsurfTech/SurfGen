# Paystack Billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Paystack as SurfGen's first payment gateway — admin-configurable (keys included) from a `/payments` studio page — powering subscription-plan billing end to end.

**Architecture:** A new `billing` NestJS module in `apps/api` (hand-rolled Paystack REST client, no SDK), two new Prisma models (`PaymentGatewaySetting`, `Plan`), reuse of existing `BillingAccount`/`Subscription`/`Invoice`. Secret key AES-256-GCM encrypted at rest. Web: super-admin `/payments` page, user `/billing` + `/billing/callback` pages.

**Tech Stack:** NestJS 11 (Fastify adapter), Prisma 6, Zod, vitest, Next.js App Router + TanStack Query, Tailwind. Node built-ins only (`node:crypto`, global `fetch`) — **no new dependencies**.

**Spec:** `docs/superpowers/specs/2026-07-04-paystack-billing-design.md`

## Global Constraints

- Package manager: `pnpm` (workspace). Run API tests with `pnpm --filter @surfgen/api test`.
- TDD: every task writes the failing test first, sees it fail, then implements.
- Commits: conventional format (`feat:`, `test:`, `docs:`); never use `--no-verify`.
- Domain errors only from `@surfgen/core` (`ConfigurationError`, `ProviderError`, `NotFoundError`, `ValidationError`, `UnauthorizedError`, `ConflictError`) — no ad-hoc `HttpException`s. The `DomainExceptionFilter` + `EnvelopeInterceptor` handle transport.
- API responses are auto-wrapped in `{ success, data, error, meta }` — controllers return plain objects.
- The plaintext Paystack secret key must NEVER appear in an API response, log line, or client bundle.
- Currency values allowed: `NGN`, `USD`, `GHS`, `ZAR`, `KES`. Plan intervals: `monthly`, `annually` (Paystack's exact interval names).
- Paystack amounts are integer subunits (kobo/cents) — `amountCents` maps 1:1, no conversion.
- Frontend: follow existing studio page idioms (`'use client'`, `useToast`, `LoadingState`/`EmptyState`, `rounded-2xl border border-line bg-card` cards, TanStack Query hooks in `apps/web/lib/api/hooks.ts`).
- Files stay under 800 lines; split components when a page grows.

---

### Task 1: Prisma models — `PaymentGatewaySetting` + `Plan`

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (append after the `Invoice` model, before the "Audit" section)
- Modify: `.env.example` (add `SURFGEN_ENCRYPTION_KEY`, `PUBLIC_WEB_URL`)

**Interfaces:**
- Produces: Prisma client types `PaymentGatewaySetting` (`gateway` unique string, `enabled`, `publicKey?`, `secretKeyEncrypted?`, `currency`) and `Plan` (`code` unique, `amountCents`, `interval`, `paystackPlanCode?`, `features Json`, `active`, `sortOrder`) used by all API tasks.

- [ ] **Step 1: Add the models to the schema**

Append to `packages/db/prisma/schema.prisma` directly after the `Invoice` model:

```prisma
model PaymentGatewaySetting {
  id                 String   @id @default(cuid())
  gateway            String   @unique // "paystack"
  enabled            Boolean  @default(false)
  publicKey          String?
  /// AES-256-GCM sealed: "v1:<iv b64>:<tag b64>:<ciphertext b64>" — see apps/api secret-box.
  secretKeyEncrypted String?
  currency           String   @default("NGN") // NGN | USD | GHS | ZAR | KES
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
}

model Plan {
  id               String   @id @default(cuid())
  code             String   @unique // e.g. "pro-monthly"
  name             String
  description      String?
  /// Price in the currency's subunit (kobo/cents) — Paystack's native unit.
  amountCents      Int
  currency         String   @default("NGN")
  interval         String // monthly | annually (Paystack interval names)
  /// PLN_xxx once synced to Paystack; null until first sync.
  paystackPlanCode String?
  features         Json     @default("[]")
  active           Boolean  @default(true)
  sortOrder        Int      @default(0)
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
}
```

- [ ] **Step 2: Add env vars to `.env.example`**

Add under the JWT/auth section:

```bash
# Billing — 32-byte key (base64 or hex) that seals the Paystack secret key at rest.
# Generate: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# SURFGEN_ENCRYPTION_KEY=
# Absolute origin of the web app — used for Paystack checkout callback redirects.
# PUBLIC_WEB_URL=http://localhost:3000
```

- [ ] **Step 3: Regenerate the Prisma client and verify**

Run: `pnpm --filter @surfgen/db generate`
Expected: `✔ Generated Prisma Client` with no schema validation errors.

Run: `pnpm --filter @surfgen/db exec prisma migrate dev --name paystack-billing` **only if** `DATABASE_URL` points at a running Postgres; otherwise skip (repo has no committed migrations dir — deployments push schema when Docker is up) and note it in the commit body.

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/schema.prisma .env.example
git commit -m "feat(db): PaymentGatewaySetting + Plan models for Paystack billing"
```

---

### Task 2: `secret-box` — AES-256-GCM sealing for the gateway secret

**Files:**
- Create: `apps/api/src/common/secret-box.ts`
- Test: `apps/api/test/secret-box.test.ts`

**Interfaces:**
- Produces: `sealSecret(plaintext: string): string`, `openSecret(sealed: string): string`, `maskSecret(plaintext: string): string` (→ `"••••" + last 4`). Master key read from `process.env.SURFGEN_ENCRYPTION_KEY` (base64 or hex, 32 bytes). Missing/malformed key → `ConfigurationError`. Tampered payload → `ConfigurationError`.

- [ ] **Step 1: Write the failing test**

`apps/api/test/secret-box.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { ConfigurationError } from '@surfgen/core';
import { maskSecret, openSecret, sealSecret } from '../src/common/secret-box';

const KEY = Buffer.alloc(32, 7).toString('base64');

beforeEach(() => {
  process.env.SURFGEN_ENCRYPTION_KEY = KEY;
});

afterEach(() => {
  delete process.env.SURFGEN_ENCRYPTION_KEY;
});

describe('secret-box', () => {
  test('seals and opens a secret round-trip', () => {
    const sealed = sealSecret('sk_test_abcdef123456');
    expect(sealed.startsWith('v1:')).toBe(true);
    expect(sealed).not.toContain('sk_test');
    expect(openSecret(sealed)).toBe('sk_test_abcdef123456');
  });

  test('two seals of the same value differ (fresh IV each time)', () => {
    expect(sealSecret('same')).not.toBe(sealSecret('same'));
  });

  test('rejects a tampered ciphertext', () => {
    const sealed = sealSecret('sk_test_abcdef123456');
    const parts = sealed.split(':');
    const flipped = Buffer.from(parts[3], 'base64');
    flipped[0] ^= 0xff;
    parts[3] = flipped.toString('base64');
    expect(() => openSecret(parts.join(':'))).toThrow(ConfigurationError);
  });

  test('throws ConfigurationError when the master key is missing', () => {
    delete process.env.SURFGEN_ENCRYPTION_KEY;
    expect(() => sealSecret('x')).toThrow(ConfigurationError);
  });

  test('masks a secret to its last 4 characters', () => {
    expect(maskSecret('sk_live_abcdef7890')).toBe('••••7890');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @surfgen/api test -- secret-box`
Expected: FAIL — cannot resolve `../src/common/secret-box`.

- [ ] **Step 3: Implement**

`apps/api/src/common/secret-box.ts`:

```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { ConfigurationError } from '@surfgen/core';

/**
 * Seals small secrets (payment gateway keys) for at-rest storage in Postgres.
 * AES-256-GCM with a master key from SURFGEN_ENCRYPTION_KEY (32 bytes,
 * base64 or hex). Sealed format: "v1:<iv b64>:<tag b64>:<ciphertext b64>".
 */

const VERSION = 'v1';
const IV_BYTES = 12;

function masterKey(): Buffer {
  const raw = process.env.SURFGEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new ConfigurationError(
      'SURFGEN_ENCRYPTION_KEY is not set — required to store payment gateway secrets',
    );
  }
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new ConfigurationError('SURFGEN_ENCRYPTION_KEY must decode to exactly 32 bytes');
  }
  return key;
}

export function sealSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', masterKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':');
}

export function openSecret(sealed: string): string {
  const [version, ivB64, tagB64, dataB64] = sealed.split(':');
  if (version !== VERSION || !ivB64 || !tagB64 || !dataB64) {
    throw new ConfigurationError('Sealed secret has an unrecognized format');
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  } catch (error) {
    if (error instanceof ConfigurationError) throw error;
    throw new ConfigurationError('Sealed secret failed to decrypt (wrong key or tampered data)', {
      cause: error,
    });
  }
}

/** Display-safe fingerprint — enough for an admin to recognize the stored key. */
export function maskSecret(plaintext: string): string {
  return `••••${plaintext.slice(-4)}`;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @surfgen/api test -- secret-box`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/common/secret-box.ts apps/api/test/secret-box.test.ts
git commit -m "feat(api): AES-256-GCM secret-box for at-rest gateway secrets"
```

---

### Task 3: Paystack REST client

**Files:**
- Create: `apps/api/src/billing/paystack.client.ts`
- Test: `apps/api/test/paystack-client.test.ts`

**Interfaces:**
- Produces: `class PaystackClient { constructor(secretKey: string) }` with:
  - `initializeTransaction(input: { email: string; amount: number; currency: string; reference: string; callbackUrl: string; planCode?: string; metadata?: Record<string, unknown> }): Promise<{ authorizationUrl: string; accessCode: string; reference: string }>`
  - `verifyTransaction(reference: string): Promise<{ status: string; amount: number; currency: string; metadata: Record<string, unknown> | null; customerCode: string | null }>`
  - `createPlan(input: { name: string; amount: number; interval: string; currency: string }): Promise<{ planCode: string }>`
  - `ping(): Promise<void>` (throws `ProviderError` on bad key)
- All failures throw `ProviderError('paystack', message)`.

- [ ] **Step 1: Write the failing test**

`apps/api/test/paystack-client.test.ts`:

```ts
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ProviderError } from '@surfgen/core';
import { PaystackClient } from '../src/billing/paystack.client';

function mockFetchOnce(status: number, body: unknown) {
  const impl = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', impl);
  return impl;
}

afterEach(() => vi.unstubAllGlobals());

describe('PaystackClient', () => {
  test('initializeTransaction posts amount/reference and returns the authorization URL', async () => {
    const impl = mockFetchOnce(200, {
      status: true,
      data: { authorization_url: 'https://checkout.paystack.com/abc', access_code: 'ac_1', reference: 'sg_ref1' },
    });
    const client = new PaystackClient('sk_test_x');

    const session = await client.initializeTransaction({
      email: 'ada@example.com',
      amount: 500000,
      currency: 'NGN',
      reference: 'sg_ref1',
      callbackUrl: 'http://localhost:3000/billing/callback',
      planCode: 'PLN_1',
      metadata: { planId: 'plan_1' },
    });

    expect(session.authorizationUrl).toBe('https://checkout.paystack.com/abc');
    const [url, init] = impl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.paystack.co/transaction/initialize');
    expect(init.headers).toMatchObject({ authorization: 'Bearer sk_test_x' });
    expect(JSON.parse(init.body as string)).toMatchObject({
      email: 'ada@example.com',
      amount: 500000,
      reference: 'sg_ref1',
      plan: 'PLN_1',
    });
  });

  test('verifyTransaction unwraps status, amount and customer code', async () => {
    mockFetchOnce(200, {
      status: true,
      data: {
        status: 'success',
        amount: 500000,
        currency: 'NGN',
        metadata: { planId: 'plan_1' },
        customer: { customer_code: 'CUS_9' },
      },
    });
    const result = await new PaystackClient('sk_test_x').verifyTransaction('sg_ref1');
    expect(result).toEqual({
      status: 'success',
      amount: 500000,
      currency: 'NGN',
      metadata: { planId: 'plan_1' },
      customerCode: 'CUS_9',
    });
  });

  test('createPlan returns the PLN code', async () => {
    mockFetchOnce(200, { status: true, data: { plan_code: 'PLN_77' } });
    const result = await new PaystackClient('sk_test_x').createPlan({
      name: 'Pro',
      amount: 500000,
      interval: 'monthly',
      currency: 'NGN',
    });
    expect(result.planCode).toBe('PLN_77');
  });

  test('non-2xx or status:false becomes ProviderError', async () => {
    mockFetchOnce(401, { status: false, message: 'Invalid key' });
    await expect(new PaystackClient('sk_bad').ping()).rejects.toBeInstanceOf(ProviderError);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @surfgen/api test -- paystack-client`
Expected: FAIL — cannot resolve `../src/billing/paystack.client`.

- [ ] **Step 3: Implement**

`apps/api/src/billing/paystack.client.ts`:

```ts
import { ProviderError } from '@surfgen/core';

const BASE_URL = 'https://api.paystack.co';

interface PaystackEnvelope<T> {
  status: boolean;
  message?: string;
  data: T;
}

export interface InitializeTransactionInput {
  email: string;
  /** Integer subunit amount (kobo/cents). */
  amount: number;
  currency: string;
  reference: string;
  callbackUrl: string;
  planCode?: string;
  metadata?: Record<string, unknown>;
}

export interface CheckoutSession {
  authorizationUrl: string;
  accessCode: string;
  reference: string;
}

export interface VerifiedTransaction {
  status: string;
  amount: number;
  currency: string;
  metadata: Record<string, unknown> | null;
  customerCode: string | null;
}

/**
 * Minimal Paystack REST client — only the calls SurfGen needs. Deliberately
 * SDK-free: the API is plain JSON over HTTPS and the official SDKs lag it.
 */
export class PaystackClient {
  constructor(private readonly secretKey: string) {}

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.secretKey}`,
          'content-type': 'application/json',
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      });
    } catch (error) {
      throw new ProviderError('paystack', 'Paystack is unreachable', { cause: error });
    }

    let envelope: PaystackEnvelope<T>;
    try {
      envelope = (await response.json()) as PaystackEnvelope<T>;
    } catch {
      throw new ProviderError('paystack', `Non-JSON response (HTTP ${response.status})`);
    }
    if (!response.ok || !envelope.status) {
      throw new ProviderError('paystack', envelope.message ?? `HTTP ${response.status}`, {
        retryable: response.status >= 500,
      });
    }
    return envelope.data;
  }

  async initializeTransaction(input: InitializeTransactionInput): Promise<CheckoutSession> {
    const data = await this.request<{ authorization_url: string; access_code: string; reference: string }>(
      'POST',
      '/transaction/initialize',
      {
        email: input.email,
        amount: input.amount,
        currency: input.currency,
        reference: input.reference,
        callback_url: input.callbackUrl,
        ...(input.planCode && { plan: input.planCode }),
        ...(input.metadata && { metadata: input.metadata }),
      },
    );
    return { authorizationUrl: data.authorization_url, accessCode: data.access_code, reference: data.reference };
  }

  async verifyTransaction(reference: string): Promise<VerifiedTransaction> {
    const data = await this.request<{
      status: string;
      amount: number;
      currency: string;
      metadata?: Record<string, unknown> | null;
      customer?: { customer_code?: string } | null;
    }>('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
    return {
      status: data.status,
      amount: data.amount,
      currency: data.currency,
      metadata: data.metadata ?? null,
      customerCode: data.customer?.customer_code ?? null,
    };
  }

  async createPlan(input: { name: string; amount: number; interval: string; currency: string }): Promise<{ planCode: string }> {
    const data = await this.request<{ plan_code: string }>('POST', '/plan', input);
    return { planCode: data.plan_code };
  }

  /** Cheapest authenticated call — proves the secret key works. */
  async ping(): Promise<void> {
    await this.request('GET', '/transaction?perPage=1');
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @surfgen/api test -- paystack-client`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/billing/paystack.client.ts apps/api/test/paystack-client.test.ts
git commit -m "feat(api): minimal Paystack REST client"
```

---

### Task 4: BillingService — settings, plans, checkout, verify, webhook

**Files:**
- Create: `apps/api/src/billing/billing.service.ts`
- Test: `apps/api/test/billing.test.ts`

**Interfaces:**
- Consumes: `sealSecret/openSecret/maskSecret` (Task 2), `PaystackClient` (Task 3), `PrismaService`.
- Produces (used by Task 5 controllers):
  - `getGatewaySettings(): Promise<{ gateway: 'paystack'; enabled: boolean; publicKey: string | null; secretKeyMasked: string | null; currency: string }>`
  - `updateGatewaySettings(input: { enabled: boolean; publicKey?: string | null; secretKey?: string; currency: string }): Promise<same as get>`
  - `testGateway(): Promise<{ ok: true }>`
  - `listPlansAdmin(): Promise<Plan[]>` / `listActivePlans(): Promise<PublicPlan[]>`
  - `createPlan(input) / updatePlan(id, input)`
  - `getSubscription(orgId): Promise<{ plan: string | null; status: string | null; currentPeriodEnd: Date | null; gateway: { enabled, currency, publicKey } }>`
  - `checkout(orgId: string, email: string, planId: string): Promise<{ authorizationUrl: string; reference: string }>`
  - `verifyCheckout(orgId: string, reference: string): Promise<{ status: 'paid' | 'pending' | 'failed' }>`
  - `handleWebhook(rawBody: Buffer, signature: string | undefined): Promise<void>` — throws `UnauthorizedError` on bad signature.
  - Public field `clientFactory: (secretKey: string) => PaystackClient` — tests override it.

Behavioral rules the tests pin down:
1. `updateGatewaySettings` seals `secretKey` when provided, keeps the stored one when omitted.
2. `checkout` refuses when the gateway is disabled (`ConfigurationError`), lazily syncs `paystackPlanCode`, creates an `open` Invoice with `externalId = reference` and passes `metadata: { planId, organizationId }` to Paystack.
3. Webhook: HMAC-SHA512(rawBody, secretKey) hex must equal `x-paystack-signature` (timing-safe) → else `UnauthorizedError`.
4. `charge.success` marks the invoice paid + activates the subscription — **only** when amount AND currency match; already-paid invoices are a no-op (idempotent).
5. `subscription.create` attaches `externalId`/`currentPeriodEnd` via `externalCustomerId`; `subscription.disable` cancels by `externalId`.

- [ ] **Step 1: Write the failing tests**

`apps/api/test/billing.test.ts` (mocked-prisma style copied from `google-sso.test.ts`):

```ts
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ConfigurationError, UnauthorizedError } from '@surfgen/core';
import { BillingService } from '../src/billing/billing.service';
import { sealSecret } from '../src/common/secret-box';

const KEY = Buffer.alloc(32, 7).toString('base64');

const plan = {
  id: 'plan_1',
  code: 'pro-monthly',
  name: 'Pro',
  description: null,
  amountCents: 500000,
  currency: 'NGN',
  interval: 'monthly',
  paystackPlanCode: 'PLN_1',
  features: [],
  active: true,
  sortOrder: 0,
};

function makeService(overrides: Record<string, unknown> = {}) {
  const prisma = {
    paymentGatewaySetting: {
      findUnique: vi.fn(async () => null as unknown),
      upsert: vi.fn(async (args: { create: Record<string, unknown> }) => ({ id: 'gw_1', ...args.create })),
    },
    plan: {
      findMany: vi.fn(async () => [plan]),
      findUnique: vi.fn(async () => plan),
      create: vi.fn(async () => plan),
      update: vi.fn(async () => plan),
    },
    billingAccount: {
      upsert: vi.fn(async () => ({ id: 'ba_1', organizationId: 'org_1', provider: 'paystack' })),
      findUnique: vi.fn(async () => ({ id: 'ba_1', organizationId: 'org_1', subscriptions: [] })),
      findFirst: vi.fn(async () => ({ id: 'ba_1', organizationId: 'org_1', subscriptions: [] })),
      update: vi.fn(async () => ({})),
    },
    invoice: {
      create: vi.fn(async () => ({ id: 'inv_1' })),
      findFirst: vi.fn(async () => null as unknown),
      update: vi.fn(async () => ({})),
    },
    subscription: {
      findFirst: vi.fn(async () => null as unknown),
      create: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
    ...overrides,
  };
  const service = new BillingService(prisma as never);
  const client = {
    initializeTransaction: vi.fn(async () => ({
      authorizationUrl: 'https://checkout.paystack.com/abc',
      accessCode: 'ac',
      reference: 'sg_ref1',
    })),
    verifyTransaction: vi.fn(async () => ({
      status: 'success',
      amount: 500000,
      currency: 'NGN',
      metadata: { planId: 'plan_1' },
      customerCode: 'CUS_9',
    })),
    createPlan: vi.fn(async () => ({ planCode: 'PLN_NEW' })),
    ping: vi.fn(async () => undefined),
  };
  service.clientFactory = vi.fn(() => client as never);
  return { service, prisma, client };
}

const enabledGateway = () => ({
  id: 'gw_1',
  gateway: 'paystack',
  enabled: true,
  publicKey: 'pk_test_x',
  secretKeyEncrypted: sealSecret('sk_test_secret'),
  currency: 'NGN',
});

beforeEach(() => {
  process.env.SURFGEN_ENCRYPTION_KEY = KEY;
});

afterEach(() => {
  delete process.env.SURFGEN_ENCRYPTION_KEY;
});

describe('gateway settings', () => {
  test('returns masked secret, never the sealed or plain value', async () => {
    const { service, prisma } = makeService();
    prisma.paymentGatewaySetting.findUnique.mockResolvedValue(enabledGateway());

    const settings = await service.getGatewaySettings();

    expect(settings.secretKeyMasked).toBe('••••cret');
    expect(JSON.stringify(settings)).not.toContain('sk_test_secret');
    expect(JSON.stringify(settings)).not.toContain('v1:');
  });

  test('update seals a newly provided secret key', async () => {
    const { service, prisma } = makeService();

    await service.updateGatewaySettings({ enabled: true, publicKey: 'pk_x', secretKey: 'sk_new', currency: 'NGN' });

    const args = prisma.paymentGatewaySetting.upsert.mock.calls[0][0] as {
      create: { secretKeyEncrypted: string };
    };
    expect(args.create.secretKeyEncrypted.startsWith('v1:')).toBe(true);
    expect(args.create.secretKeyEncrypted).not.toContain('sk_new');
  });

  test('update without secretKey leaves the stored secret untouched', async () => {
    const { service, prisma } = makeService();
    prisma.paymentGatewaySetting.findUnique.mockResolvedValue(enabledGateway());

    await service.updateGatewaySettings({ enabled: false, publicKey: 'pk_x', currency: 'NGN' });

    const args = prisma.paymentGatewaySetting.upsert.mock.calls[0][0] as {
      update: Record<string, unknown>;
    };
    expect(args.update.secretKeyEncrypted).toBeUndefined();
  });
});

describe('checkout', () => {
  test('refuses when the gateway is disabled', async () => {
    const { service, prisma } = makeService();
    prisma.paymentGatewaySetting.findUnique.mockResolvedValue({ ...enabledGateway(), enabled: false });

    await expect(service.checkout('org_1', 'ada@example.com', 'plan_1')).rejects.toBeInstanceOf(ConfigurationError);
  });

  test('creates an open invoice and returns the authorization URL', async () => {
    const { service, prisma, client } = makeService();
    prisma.paymentGatewaySetting.findUnique.mockResolvedValue(enabledGateway());

    const session = await service.checkout('org_1', 'ada@example.com', 'plan_1');

    expect(session.authorizationUrl).toBe('https://checkout.paystack.com/abc');
    const invoiceArgs = prisma.invoice.create.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(invoiceArgs.data).toMatchObject({ status: 'open', amountCents: 500000, currency: 'NGN' });
    expect(invoiceArgs.data.externalId).toBe(session.reference);
    const initArgs = client.initializeTransaction.mock.calls[0][0] as { metadata: Record<string, unknown> };
    expect(initArgs.metadata).toMatchObject({ planId: 'plan_1', organizationId: 'org_1' });
  });
});

function sign(body: string, secret: string): string {
  return createHmac('sha512', secret).update(body).digest('hex');
}

describe('webhook', () => {
  test('rejects an invalid signature', async () => {
    const { service, prisma } = makeService();
    prisma.paymentGatewaySetting.findUnique.mockResolvedValue(enabledGateway());
    const body = JSON.stringify({ event: 'charge.success', data: {} });

    await expect(service.handleWebhook(Buffer.from(body), 'bad-signature')).rejects.toBeInstanceOf(UnauthorizedError);
  });

  test('charge.success with matching amount marks the invoice paid and activates the subscription', async () => {
    const { service, prisma } = makeService();
    prisma.paymentGatewaySetting.findUnique.mockResolvedValue(enabledGateway());
    prisma.invoice.findFirst.mockResolvedValue({
      id: 'inv_1',
      status: 'open',
      amountCents: 500000,
      currency: 'NGN',
      billingAccountId: 'ba_1',
      billingAccount: { id: 'ba_1', organizationId: 'org_1' },
    });
    const body = JSON.stringify({
      event: 'charge.success',
      data: {
        reference: 'sg_ref1',
        amount: 500000,
        currency: 'NGN',
        metadata: { planId: 'plan_1' },
        customer: { customer_code: 'CUS_9' },
      },
    });

    await service.handleWebhook(Buffer.from(body), sign(body, 'sk_test_secret'));

    expect(prisma.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'inv_1' }, data: expect.objectContaining({ status: 'paid' }) }),
    );
    expect(prisma.subscription.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ billingAccountId: 'ba_1', plan: 'pro-monthly', status: 'active' }),
      }),
    );
  });

  test('charge.success with a mismatched amount does NOT mark the invoice paid', async () => {
    const { service, prisma } = makeService();
    prisma.paymentGatewaySetting.findUnique.mockResolvedValue(enabledGateway());
    prisma.invoice.findFirst.mockResolvedValue({
      id: 'inv_1',
      status: 'open',
      amountCents: 500000,
      currency: 'NGN',
      billingAccountId: 'ba_1',
      billingAccount: { id: 'ba_1', organizationId: 'org_1' },
    });
    const body = JSON.stringify({
      event: 'charge.success',
      data: { reference: 'sg_ref1', amount: 100, currency: 'NGN', metadata: { planId: 'plan_1' } },
    });

    await service.handleWebhook(Buffer.from(body), sign(body, 'sk_test_secret'));

    expect(prisma.invoice.update).not.toHaveBeenCalled();
    expect(prisma.subscription.create).not.toHaveBeenCalled();
  });

  test('replayed charge.success on a paid invoice is a no-op', async () => {
    const { service, prisma } = makeService();
    prisma.paymentGatewaySetting.findUnique.mockResolvedValue(enabledGateway());
    prisma.invoice.findFirst.mockResolvedValue({
      id: 'inv_1',
      status: 'paid',
      amountCents: 500000,
      currency: 'NGN',
      billingAccountId: 'ba_1',
      billingAccount: { id: 'ba_1', organizationId: 'org_1' },
    });
    const body = JSON.stringify({
      event: 'charge.success',
      data: { reference: 'sg_ref1', amount: 500000, currency: 'NGN', metadata: { planId: 'plan_1' } },
    });

    await service.handleWebhook(Buffer.from(body), sign(body, 'sk_test_secret'));

    expect(prisma.invoice.update).not.toHaveBeenCalled();
  });

  test('subscription.disable cancels by external id', async () => {
    const { service, prisma } = makeService();
    prisma.paymentGatewaySetting.findUnique.mockResolvedValue(enabledGateway());
    const body = JSON.stringify({
      event: 'subscription.disable',
      data: { subscription_code: 'SUB_1' },
    });

    await service.handleWebhook(Buffer.from(body), sign(body, 'sk_test_secret'));

    expect(prisma.subscription.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { externalId: 'SUB_1' }, data: { status: 'canceled' } }),
    );
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @surfgen/api test -- billing`
Expected: FAIL — cannot resolve `../src/billing/billing.service`.

- [ ] **Step 3: Implement `BillingService`**

`apps/api/src/billing/billing.service.ts`:

```ts
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigurationError, NotFoundError, UnauthorizedError, ValidationError } from '@surfgen/core';
import { maskSecret, openSecret, sealSecret } from '../common/secret-box';
import { PrismaService } from '../common/prisma.service';
import { PaystackClient } from './paystack.client';

const GATEWAY = 'paystack';

export interface GatewaySettingsInput {
  enabled: boolean;
  publicKey?: string | null;
  /** Write-only — omit to keep the stored secret. */
  secretKey?: string;
  currency: string;
}

export interface PlanInput {
  code: string;
  name: string;
  description?: string | null;
  amountCents: number;
  currency: string;
  interval: 'monthly' | 'annually';
  features?: string[];
  active?: boolean;
  sortOrder?: number;
}

interface StoredGateway {
  id: string;
  gateway: string;
  enabled: boolean;
  publicKey: string | null;
  secretKeyEncrypted: string | null;
  currency: string;
}

@Injectable()
export class BillingService {
  /** Overridable seam so tests can stub the Paystack HTTP surface. */
  clientFactory: (secretKey: string) => PaystackClient = (secretKey) => new PaystackClient(secretKey);

  constructor(private readonly prisma: PrismaService) {}

  // -- gateway settings -----------------------------------------------------

  private gatewayRow(): Promise<StoredGateway | null> {
    return this.prisma.paymentGatewaySetting.findUnique({ where: { gateway: GATEWAY } });
  }

  private present(row: StoredGateway | null) {
    return {
      gateway: GATEWAY as const,
      enabled: row?.enabled ?? false,
      publicKey: row?.publicKey ?? null,
      secretKeyMasked: row?.secretKeyEncrypted ? maskSecret(openSecret(row.secretKeyEncrypted)) : null,
      currency: row?.currency ?? 'NGN',
    };
  }

  async getGatewaySettings() {
    return this.present(await this.gatewayRow());
  }

  async updateGatewaySettings(input: GatewaySettingsInput) {
    const sealed = input.secretKey ? sealSecret(input.secretKey) : undefined;
    const common = {
      enabled: input.enabled,
      publicKey: input.publicKey ?? null,
      currency: input.currency,
    };
    const row = await this.prisma.paymentGatewaySetting.upsert({
      where: { gateway: GATEWAY },
      create: { gateway: GATEWAY, ...common, secretKeyEncrypted: sealed ?? null },
      update: { ...common, ...(sealed && { secretKeyEncrypted: sealed }) },
    });
    return this.present(row);
  }

  /** Builds a client from the stored secret, or explains what is missing. */
  private async requireClient(requireEnabled = true): Promise<{ client: PaystackClient; row: StoredGateway }> {
    const row = await this.gatewayRow();
    if (!row?.secretKeyEncrypted) {
      throw new ConfigurationError('Paystack secret key is not configured');
    }
    if (requireEnabled && !row.enabled) {
      throw new ConfigurationError('Payments are currently disabled');
    }
    return { client: this.clientFactory(openSecret(row.secretKeyEncrypted)), row };
  }

  async testGateway(): Promise<{ ok: true }> {
    const { client } = await this.requireClient(false);
    await client.ping();
    return { ok: true };
  }

  // -- plans ----------------------------------------------------------------

  listPlansAdmin() {
    return this.prisma.plan.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
  }

  async listActivePlans() {
    const [row, plans] = await Promise.all([
      this.gatewayRow(),
      this.prisma.plan.findMany({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
    ]);
    return {
      gateway: { enabled: row?.enabled ?? false, currency: row?.currency ?? 'NGN' },
      plans: plans.map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        description: p.description,
        amountCents: p.amountCents,
        currency: p.currency,
        interval: p.interval,
        features: p.features,
      })),
    };
  }

  async createPlan(input: PlanInput) {
    const plan = await this.prisma.plan.create({
      data: {
        code: input.code,
        name: input.name,
        description: input.description ?? null,
        amountCents: input.amountCents,
        currency: input.currency,
        interval: input.interval,
        features: input.features ?? [],
        active: input.active ?? true,
        sortOrder: input.sortOrder ?? 0,
      },
    });
    return this.syncPlanToPaystack(plan);
  }

  async updatePlan(planId: string, input: Partial<PlanInput>) {
    const existing = await this.prisma.plan.findUnique({ where: { id: planId } });
    if (!existing) throw new NotFoundError('Plan', planId);
    const plan = await this.prisma.plan.update({ where: { id: planId }, data: input });
    return this.syncPlanToPaystack(plan);
  }

  /** Best-effort Paystack sync — a disabled/unconfigured gateway defers it. */
  private async syncPlanToPaystack<T extends { id: string; name: string; amountCents: number; interval: string; currency: string; paystackPlanCode: string | null }>(plan: T): Promise<T> {
    if (plan.paystackPlanCode) return plan;
    const row = await this.gatewayRow();
    if (!row?.enabled || !row.secretKeyEncrypted) return plan;
    const client = this.clientFactory(openSecret(row.secretKeyEncrypted));
    const { planCode } = await client.createPlan({
      name: plan.name,
      amount: plan.amountCents,
      interval: plan.interval,
      currency: plan.currency,
    });
    return this.prisma.plan.update({ where: { id: plan.id }, data: { paystackPlanCode: planCode } });
  }

  // -- subscription + checkout ----------------------------------------------

  async getSubscription(orgId: string) {
    const [row, account] = await Promise.all([
      this.gatewayRow(),
      this.prisma.billingAccount.findUnique({
        where: { organizationId: orgId },
        include: { subscriptions: { orderBy: { createdAt: 'desc' }, take: 1 } },
      }),
    ]);
    const subscription = account?.subscriptions[0] ?? null;
    return {
      plan: subscription?.plan ?? null,
      status: subscription?.status ?? null,
      currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
      gateway: {
        enabled: row?.enabled ?? false,
        currency: row?.currency ?? 'NGN',
        publicKey: row?.publicKey ?? null,
      },
    };
  }

  async checkout(orgId: string, email: string, planId: string) {
    const { client, row } = await this.requireClient();
    let plan = await this.prisma.plan.findUnique({ where: { id: planId } });
    if (!plan || !plan.active) throw new NotFoundError('Plan', planId);
    plan = await this.syncPlanToPaystack(plan);

    const account = await this.prisma.billingAccount.upsert({
      where: { organizationId: orgId },
      create: { organizationId: orgId, provider: GATEWAY },
      update: { provider: GATEWAY },
    });

    const reference = `sg_${randomUUID().replaceAll('-', '')}`;
    await this.prisma.invoice.create({
      data: {
        billingAccountId: account.id,
        externalId: reference,
        amountCents: plan.amountCents,
        currency: plan.currency,
        status: 'open',
      },
    });

    const session = await client.initializeTransaction({
      email,
      amount: plan.amountCents,
      currency: plan.currency,
      reference,
      callbackUrl: `${process.env.PUBLIC_WEB_URL ?? 'http://localhost:3000'}/billing/callback`,
      ...(plan.paystackPlanCode && { planCode: plan.paystackPlanCode }),
      metadata: { planId: plan.id, organizationId: orgId },
    });
    void row; // enabled check already done by requireClient
    return { authorizationUrl: session.authorizationUrl, reference };
  }

  async verifyCheckout(orgId: string, reference: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { externalId: reference, billingAccount: { organizationId: orgId } },
      include: { billingAccount: true },
    });
    if (!invoice) throw new NotFoundError('Invoice', reference);
    if (invoice.status === 'paid') return { status: 'paid' as const };

    const { client } = await this.requireClient(false);
    const tx = await client.verifyTransaction(reference);
    if (tx.status !== 'success') {
      return { status: tx.status === 'failed' ? ('failed' as const) : ('pending' as const) };
    }
    await this.settleInvoice(invoice, {
      amount: tx.amount,
      currency: tx.currency,
      planId: (tx.metadata?.planId as string | undefined) ?? null,
      customerCode: tx.customerCode,
    });
    return { status: 'paid' as const };
  }

  // -- webhook ----------------------------------------------------------------

  async handleWebhook(rawBody: Buffer, signature: string | undefined): Promise<void> {
    const row = await this.gatewayRow();
    if (!row?.secretKeyEncrypted) throw new UnauthorizedError('Gateway not configured');
    const expected = createHmac('sha512', openSecret(row.secretKeyEncrypted)).update(rawBody).digest('hex');
    const provided = signature ?? '';
    const valid =
      provided.length === expected.length && timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
    if (!valid) throw new UnauthorizedError('Invalid webhook signature');

    let event: { event: string; data: Record<string, unknown> };
    try {
      event = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new ValidationError('Webhook payload is not valid JSON');
    }

    switch (event.event) {
      case 'charge.success':
        return this.onChargeSuccess(event.data);
      case 'subscription.create':
        return this.onSubscriptionCreate(event.data);
      case 'subscription.disable':
      case 'subscription.not_renew':
        return this.onSubscriptionDisable(event.data);
      default:
        return; // unknown events are acknowledged and ignored
    }
  }

  private async onChargeSuccess(data: Record<string, unknown>): Promise<void> {
    const reference = data.reference as string | undefined;
    if (!reference) return;
    const invoice = await this.prisma.invoice.findFirst({
      where: { externalId: reference },
      include: { billingAccount: true },
    });
    if (!invoice || invoice.status === 'paid') return; // unknown or replay — idempotent
    const metadata = (data.metadata ?? null) as Record<string, unknown> | null;
    await this.settleInvoice(invoice, {
      amount: data.amount as number,
      currency: data.currency as string,
      planId: (metadata?.planId as string | undefined) ?? null,
      customerCode: ((data.customer as Record<string, unknown> | undefined)?.customer_code as string) ?? null,
    });
  }

  /** Shared by webhook + redirect verify: amount-check, mark paid, activate. */
  private async settleInvoice(
    invoice: { id: string; status: string; amountCents: number; currency: string; billingAccountId: string },
    payment: { amount: number; currency: string; planId: string | null; customerCode: string | null },
  ): Promise<void> {
    if (payment.amount !== invoice.amountCents || payment.currency.toUpperCase() !== invoice.currency.toUpperCase()) {
      return; // amount tampering — leave the invoice open for investigation
    }
    await this.prisma.invoice.update({ where: { id: invoice.id }, data: { status: 'paid' } });
    if (payment.customerCode) {
      await this.prisma.billingAccount.update({
        where: { id: invoice.billingAccountId },
        data: { externalCustomerId: payment.customerCode },
      });
    }
    if (!payment.planId) return;
    const plan = await this.prisma.plan.findUnique({ where: { id: payment.planId } });
    if (!plan) return;
    const existing = await this.prisma.subscription.findFirst({
      where: { billingAccountId: invoice.billingAccountId, plan: plan.code },
    });
    if (existing) {
      await this.prisma.subscription.update({ where: { id: existing.id }, data: { status: 'active' } });
    } else {
      await this.prisma.subscription.create({
        data: { billingAccountId: invoice.billingAccountId, plan: plan.code, status: 'active' },
      });
    }
  }

  private async onSubscriptionCreate(data: Record<string, unknown>): Promise<void> {
    const customerCode = (data.customer as Record<string, unknown> | undefined)?.customer_code as string | undefined;
    const subscriptionCode = data.subscription_code as string | undefined;
    if (!customerCode || !subscriptionCode) return;
    const account = await this.prisma.billingAccount.findFirst({ where: { externalCustomerId: customerCode } });
    if (!account) return;
    const nextPayment = data.next_payment_date ? new Date(data.next_payment_date as string) : null;
    const subscription = await this.prisma.subscription.findFirst({
      where: { billingAccountId: account.id, externalId: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!subscription) return;
    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: { externalId: subscriptionCode, ...(nextPayment && { currentPeriodEnd: nextPayment }) },
    });
  }

  private async onSubscriptionDisable(data: Record<string, unknown>): Promise<void> {
    const subscriptionCode = data.subscription_code as string | undefined;
    if (!subscriptionCode) return;
    await this.prisma.subscription.updateMany({
      where: { externalId: subscriptionCode },
      data: { status: 'canceled' },
    });
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @surfgen/api test -- billing`
Expected: all billing tests pass (9). Also run the full suite: `pnpm --filter @surfgen/api test` — no regressions.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/billing/billing.service.ts apps/api/test/billing.test.ts
git commit -m "feat(api): BillingService — gateway settings, plans, Paystack checkout, verified webhooks"
```

---

### Task 5: Controllers, module wiring, raw body

**Files:**
- Create: `apps/api/src/billing/billing-admin.controller.ts`
- Create: `apps/api/src/billing/billing.controller.ts`
- Create: `apps/api/src/billing/billing-webhook.controller.ts`
- Modify: `apps/api/src/app.module.ts` (register controllers + `BillingService`)
- Modify: `apps/api/src/main.ts` (enable `rawBody`)
- Test: extend `apps/api/test/billing.test.ts`

**Interfaces:**
- Consumes: `BillingService` (Task 4), guards from `../auth/guards`, `ZodValidationPipe` from `../common/zod-validation.pipe`.
- Produces routes:
  - `GET/PUT /v1/admin/billing/gateway`, `POST /v1/admin/billing/gateway/test`, `GET/POST /v1/admin/billing/plans`, `PATCH /v1/admin/billing/plans/:planId` (all super-admin)
  - `GET /v1/billing/plans` (any authed principal)
  - `GET /v1/orgs/:orgId/billing/subscription` (viewer), `POST /v1/orgs/:orgId/billing/checkout` (admin), `GET /v1/orgs/:orgId/billing/verify/:reference` (viewer)
  - `POST /v1/billing/webhooks/paystack` (`@Public()`, raw-body HMAC)

- [ ] **Step 1: Write the failing guard test**

Append to `apps/api/test/billing.test.ts`:

```ts
import { SUPER_ADMIN_KEY } from '../src/auth/guards';
import { BillingAdminController } from '../src/billing/billing-admin.controller';

describe('admin controller guard', () => {
  test('BillingAdminController is super-admin gated at the class level', () => {
    expect(Reflect.getMetadata(SUPER_ADMIN_KEY, BillingAdminController)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @surfgen/api test -- billing`
Expected: FAIL — cannot resolve `../src/billing/billing-admin.controller`.

- [ ] **Step 3: Implement the three controllers**

`apps/api/src/billing/billing-admin.controller.ts`:

```ts
import { Body, Controller, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequireSuperAdmin } from '../auth/guards';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { BillingService } from './billing.service';

const CURRENCIES = ['NGN', 'USD', 'GHS', 'ZAR', 'KES'] as const;

const GatewaySchema = z.object({
  enabled: z.boolean(),
  publicKey: z.string().trim().max(200).nullish(),
  /** Write-only; omit to keep the stored secret. */
  secretKey: z.string().trim().min(8).max(200).optional(),
  currency: z.enum(CURRENCIES),
});

const PlanCreateSchema = z.object({
  code: z.string().trim().min(2).max(64).regex(/^[a-z0-9-]+$/),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullish(),
  amountCents: z.number().int().positive(),
  currency: z.enum(CURRENCIES),
  interval: z.enum(['monthly', 'annually']),
  features: z.array(z.string().trim().max(200)).max(24).optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

const PlanUpdateSchema = PlanCreateSchema.partial();

/** Deployment-level payment gateway administration — super admins only. */
@ApiTags('billing-admin')
@ApiBearerAuth()
@RequireSuperAdmin()
@Controller({ path: 'admin/billing', version: '1' })
export class BillingAdminController {
  constructor(private readonly billing: BillingService) {}

  @Get('gateway')
  getGateway() {
    return this.billing.getGatewaySettings();
  }

  @Put('gateway')
  updateGateway(@Body(new ZodValidationPipe(GatewaySchema)) body: z.infer<typeof GatewaySchema>) {
    return this.billing.updateGatewaySettings(body);
  }

  @Post('gateway/test')
  testGateway() {
    return this.billing.testGateway();
  }

  @Get('plans')
  listPlans() {
    return this.billing.listPlansAdmin();
  }

  @Post('plans')
  createPlan(@Body(new ZodValidationPipe(PlanCreateSchema)) body: z.infer<typeof PlanCreateSchema>) {
    return this.billing.createPlan(body);
  }

  @Patch('plans/:planId')
  updatePlan(
    @Param('planId') planId: string,
    @Body(new ZodValidationPipe(PlanUpdateSchema)) body: z.infer<typeof PlanUpdateSchema>,
  ) {
    return this.billing.updatePlan(planId, body);
  }
}
```

`apps/api/src/billing/billing.controller.ts`:

```ts
import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { UnauthorizedError } from '@surfgen/core';
import { Principal, RequireOrgRole, type AuthenticatedPrincipal } from '../auth/guards';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { BillingService } from './billing.service';

const CheckoutSchema = z.object({ planId: z.string().min(1) });

/** Org-facing billing: browse plans, subscribe, check status. */
@ApiTags('billing')
@ApiBearerAuth()
@Controller({ version: '1' })
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('billing/plans')
  listPlans() {
    return this.billing.listActivePlans();
  }

  @Get('orgs/:orgId/billing/subscription')
  @RequireOrgRole('viewer')
  getSubscription(@Param('orgId') orgId: string) {
    return this.billing.getSubscription(orgId);
  }

  @Post('orgs/:orgId/billing/checkout')
  @RequireOrgRole('admin')
  checkout(
    @Param('orgId') orgId: string,
    @Principal() principal: AuthenticatedPrincipal,
    @Body(new ZodValidationPipe(CheckoutSchema)) body: z.infer<typeof CheckoutSchema>,
  ) {
    if (!principal.email) throw new UnauthorizedError('Checkout requires a user session (not an API key)');
    return this.billing.checkout(orgId, principal.email, body.planId);
  }

  @Get('orgs/:orgId/billing/verify/:reference')
  @RequireOrgRole('viewer')
  verify(@Param('orgId') orgId: string, @Param('reference') reference: string) {
    return this.billing.verifyCheckout(orgId, reference);
  }
}
```

`apps/api/src/billing/billing-webhook.controller.ts`:

```ts
import { Controller, Headers, Post, Req, type RawBodyRequest } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { ValidationError } from '@surfgen/core';
import { Public } from '../auth/guards';
import { BillingService } from './billing.service';

/**
 * Paystack server-to-server events. @Public — authentication is the
 * HMAC-SHA512 signature over the exact raw bytes (requires rawBody: true
 * in main.ts). Paystack retries any non-2xx, so unknown events return 200.
 */
@ApiTags('billing')
@Controller({ path: 'billing/webhooks', version: '1' })
export class BillingWebhookController {
  constructor(private readonly billing: BillingService) {}

  @Public()
  @Post('paystack')
  async paystack(
    @Req() request: RawBodyRequest<FastifyRequest>,
    @Headers('x-paystack-signature') signature: string | undefined,
  ) {
    const raw = request.rawBody;
    if (!raw || raw.length === 0) throw new ValidationError('Empty webhook body');
    await this.billing.handleWebhook(Buffer.isBuffer(raw) ? raw : Buffer.from(raw), signature);
    return { received: true };
  }
}
```

- [ ] **Step 4: Wire module + raw body**

In `apps/api/src/app.module.ts`: import and add `BillingAdminController`, `BillingController`, `BillingWebhookController` to `controllers`, and `BillingService` to `providers` (alphabetical placement with the existing imports).

In `apps/api/src/main.ts`, add `rawBody: true` to the NestFactory options:

```ts
const app = await NestFactory.create<NestFastifyApplication>(
  AppModule,
  new FastifyAdapter({ trustProxy: true, bodyLimit: 50 * 1024 * 1024 }),
  { logger: false, rawBody: true },
);
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @surfgen/api test && pnpm --filter @surfgen/api typecheck`
Expected: all tests pass, no type errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/billing apps/api/src/app.module.ts apps/api/src/main.ts apps/api/test/billing.test.ts
git commit -m "feat(api): billing endpoints — admin gateway/plans, org checkout+verify, Paystack webhook"
```

---

### Task 6: Web — API types + hooks

**Files:**
- Modify: `apps/web/lib/api/types.ts` (append billing types)
- Modify: `apps/web/lib/api/hooks.ts` (append billing hooks)

**Interfaces:**
- Produces (consumed by Tasks 7–8):

```ts
// types.ts
export interface GatewaySettings {
  gateway: 'paystack';
  enabled: boolean;
  publicKey: string | null;
  secretKeyMasked: string | null;
  currency: string;
}

export interface BillingPlan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  amountCents: number;
  currency: string;
  interval: 'monthly' | 'annually';
  paystackPlanCode?: string | null;
  features: string[];
  active?: boolean;
  sortOrder?: number;
}

export interface PublicPlans {
  gateway: { enabled: boolean; currency: string };
  plans: BillingPlan[];
}

export interface OrgSubscription {
  plan: string | null;
  status: string | null;
  currentPeriodEnd: string | null;
  gateway: { enabled: boolean; currency: string; publicKey: string | null };
}

export interface CheckoutSession {
  authorizationUrl: string;
  reference: string;
}
```

- [ ] **Step 1: Add the types** (code above, appended to `types.ts`).

- [ ] **Step 2: Add the hooks**

Append to `apps/web/lib/api/hooks.ts` (mirror the file's existing `useQuery`/`useOrgMutation` idioms exactly — e.g. how `usePlugins`/`useTogglePlugin` are written):

```ts
// --- billing ---------------------------------------------------------------

export function useGatewaySettings() {
  const authed = useAuthed();
  return useQuery({
    queryKey: ['billing-gateway'],
    enabled: authed,
    queryFn: async () => (await api<GatewaySettings>('GET', '/v1/admin/billing/gateway')).data,
  });
}

export function useUpdateGateway() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      enabled: boolean;
      publicKey?: string | null;
      secretKey?: string;
      currency: string;
    }) => (await api<GatewaySettings>('PUT', '/v1/admin/billing/gateway', body)).data,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['billing-gateway'] }),
  });
}

export function useTestGateway() {
  return useMutation({
    mutationFn: async () => (await api<{ ok: true }>('POST', '/v1/admin/billing/gateway/test')).data,
  });
}

export function useAdminPlans() {
  const authed = useAuthed();
  return useQuery({
    queryKey: ['billing-admin-plans'],
    enabled: authed,
    queryFn: async () => (await api<BillingPlan[]>('GET', '/v1/admin/billing/plans')).data,
  });
}

export function useCreatePlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: Partial<BillingPlan> & { code: string; name: string; amountCents: number }) =>
      (await api<BillingPlan>('POST', '/v1/admin/billing/plans', body)).data,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['billing-admin-plans'] }),
  });
}

export function useUpdatePlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ planId, ...body }: Partial<BillingPlan> & { planId: string }) =>
      (await api<BillingPlan>('PATCH', `/v1/admin/billing/plans/${planId}`, body)).data,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['billing-admin-plans'] }),
  });
}

export function useBillingPlans() {
  const authed = useAuthed();
  return useQuery({
    queryKey: ['billing-plans'],
    enabled: authed,
    queryFn: async () => (await api<PublicPlans>('GET', '/v1/billing/plans')).data,
  });
}

export function useOrgSubscription() {
  const org = useOrg();
  return useQuery({
    queryKey: ['billing-subscription', org.data?.id],
    enabled: Boolean(org.data?.id),
    queryFn: async () =>
      (await api<OrgSubscription>('GET', `/v1/orgs/${org.data!.id}/billing/subscription`)).data,
  });
}

export const useCheckout = () =>
  useOrgMutation<{ planId: string }, { data: CheckoutSession }>(
    ['billing-subscription'],
    async (orgId, body) => api<CheckoutSession>('POST', `/v1/orgs/${orgId}/billing/checkout`, body),
  );

export function useVerifyCheckout(reference: string | null) {
  const org = useOrg();
  return useQuery({
    queryKey: ['billing-verify', reference],
    enabled: Boolean(org.data?.id && reference),
    queryFn: async () =>
      (await api<{ status: 'paid' | 'pending' | 'failed' }>(
        'GET',
        `/v1/orgs/${org.data!.id}/billing/verify/${reference}`,
      )).data,
  });
}
```

Add the new type names to the existing `import type { ... } from './types'` statement.

> Note: `useOrgMutation`'s exact generic signature lives at `apps/web/lib/api/hooks.ts:140-154` — match it; if it doesn't fit `useCheckout`, write a plain `useMutation` with `useOrg()` like `useOrgSubscription` does.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @surfgen/web typecheck` (check the exact script name in `apps/web/package.json`; use `pnpm --filter web ...` if the package name differs)
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/api/types.ts apps/web/lib/api/hooks.ts
git commit -m "feat(web): billing API types and TanStack Query hooks"
```

---

### Task 7: Web — `/payments` admin page + sidebar entries

**Files:**
- Create: `apps/web/app/(studio)/payments/page.tsx`
- Create: `apps/web/app/(studio)/payments/gateway-card.tsx`
- Create: `apps/web/app/(studio)/payments/plan-editor.tsx`
- Modify: `apps/web/components/shell/sidebar.tsx` (add nav items)

**Interfaces:**
- Consumes: hooks from Task 6, `useToast`, `LoadingState`/`EmptyState` from `components/ui/states`.

- [ ] **Step 1: Sidebar entries**

In `apps/web/components/shell/sidebar.tsx`, import `CreditCard` and `Wallet` from `lucide-react` and add:

```ts
// CREATE_NAV gains:
{ href: '/billing', label: 'Billing', icon: Wallet },
// ADMIN_NAV gains:
{ href: '/payments', label: 'Payments', icon: CreditCard },
```

- [ ] **Step 2: Gateway settings card**

`apps/web/app/(studio)/payments/gateway-card.tsx` — a `'use client'` component:

- Local form state seeded from `useGatewaySettings()` via a `useEffect` that runs when data arrives (enabled, publicKey, currency, blank secretKey field).
- Fields: enable toggle (same `role="switch"` pattern as the plugins page), `publicKey` text input, `secretKey` password input with placeholder set to `secretKeyMasked ?? 'sk_live_…'` (never echoes the stored value), currency `<select>` over `['NGN','USD','GHS','ZAR','KES']`.
- Buttons: **Save** → `useUpdateGateway().mutate({ enabled, publicKey, currency, ...(secretKey && { secretKey }) })`, flash success/error via `useToast`; **Test connection** → `useTestGateway().mutate` flashing `'Paystack key is valid'` / the error message.
- Card chrome: `rounded-2xl border border-line bg-card p-[18px]` matching the plugins page.

- [ ] **Step 3: Plan editor**

`apps/web/app/(studio)/payments/plan-editor.tsx` — `'use client'`:

- `useAdminPlans()` table: name, code, price (`(amountCents / 100).toLocaleString()` + currency), interval, Paystack sync badge (`paystackPlanCode ? 'synced' : 'not synced'`), active toggle (→ `useUpdatePlan().mutate({ planId, active })`).
- "New plan" inline form: code, name, price (major units input, `Math.round(value * 100)` → `amountCents`), currency select, interval select, description. Submit → `useCreatePlan()`.
- Empty state: `EmptyState` with hint "Create your first plan — it syncs to Paystack automatically when the gateway is enabled."

- [ ] **Step 4: Page shell**

`apps/web/app/(studio)/payments/page.tsx`:

```tsx
'use client';

import { GatewayCard } from './gateway-card';
import { PlanEditor } from './plan-editor';

export default function PaymentsPage() {
  return (
    <div className="sg-fade px-8 pt-6 pb-12">
      <div className="mb-[18px]">
        <div className="font-display text-[15px] font-bold">Payments</div>
        <div className="mt-0.5 text-[12.5px] text-taupe">
          Paystack gateway configuration and subscription plans — deployment-wide, super-admin only
        </div>
      </div>
      <div className="grid grid-cols-[minmax(320px,420px)_1fr] gap-4">
        <GatewayCard />
        <PlanEditor />
      </div>
    </div>
  );
}
```

When `useGatewaySettings()` errors with code `FORBIDDEN`, render an `EmptyState` titled "Super-admin access required" instead of the grid (the API enforces regardless).

- [ ] **Step 5: Verify + commit**

Run: `pnpm --filter @surfgen/web typecheck && pnpm --filter @surfgen/web lint`
Expected: clean.

```bash
git add "apps/web/app/(studio)/payments" apps/web/components/shell/sidebar.tsx
git commit -m "feat(web): /payments admin page — Paystack gateway config + plan editor"
```

---

### Task 8: Web — `/billing` user page + `/billing/callback`

**Files:**
- Create: `apps/web/app/(studio)/billing/page.tsx`
- Create: `apps/web/app/(studio)/billing/callback/page.tsx`

**Interfaces:**
- Consumes: `useBillingPlans`, `useOrgSubscription`, `useCheckout`, `useVerifyCheckout` (Task 6).

- [ ] **Step 1: `/billing` page**

`apps/web/app/(studio)/billing/page.tsx` — `'use client'`:

- Header block matching other studio pages ("Billing" / "Choose the plan that fits your team").
- Subscription banner when `useOrgSubscription().data?.plan`: plan name, status pill (`active` → success dot, `past_due`/`canceled` → danger), renewal date when `currentPeriodEnd`.
- Plan cards grid (`grid grid-cols-3 gap-4`) from `useBillingPlans()`: name, formatted price + `/mo` or `/yr`, description, feature list, **Subscribe** button.
- Subscribe: `useCheckout().mutate({ planId }, { onSuccess: ({ data }) => { window.location.href = data.authorizationUrl; }, onError: (e) => flash(e.message) })`.
- When `gateway.enabled === false`: `EmptyState` titled "Payments are not enabled" with hint "An administrator can enable Paystack under Payments."
- Current plan's card shows a "Current plan" badge instead of the button (`subscription.plan === plan.code`).

- [ ] **Step 2: `/billing/callback` page**

`apps/web/app/(studio)/billing/callback/page.tsx` — `'use client'`; `useSearchParams` must sit inside a `<Suspense>` boundary:

```tsx
'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { LoadingState } from '../../../../components/ui/states';
import { useVerifyCheckout } from '../../../../lib/api/hooks';

function CallbackInner() {
  const params = useSearchParams();
  const reference = params.get('reference') ?? params.get('trxref');
  const verify = useVerifyCheckout(reference);

  if (!reference) return <StatusCard tone="failed" title="Missing payment reference" />;
  if (verify.isPending) return <LoadingState label="Confirming your payment with Paystack…" />;
  if (verify.isError) return <StatusCard tone="failed" title="We could not confirm this payment" />;

  const status = verify.data.status;
  if (status === 'paid') return <StatusCard tone="paid" title="Payment confirmed — your plan is active" />;
  if (status === 'pending') return <StatusCard tone="pending" title="Payment is still processing" />;
  return <StatusCard tone="failed" title="Payment failed — you have not been charged" />;
}

function StatusCard({ tone, title }: { tone: 'paid' | 'pending' | 'failed'; title: string }) {
  const dot = tone === 'paid' ? 'bg-success' : tone === 'pending' ? 'bg-camel' : 'bg-danger';
  return (
    <div className="mx-auto mt-16 max-w-md rounded-2xl border border-line bg-card p-6 text-center">
      <span className={`mx-auto mb-3 block size-2.5 rounded-full ${dot}`} />
      <div className="font-display text-[15px] font-bold">{title}</div>
      <Link href="/billing" className="mt-4 inline-block rounded-full border border-line px-[18px] py-2 text-[12.5px] font-bold text-primary">
        Back to billing
      </Link>
    </div>
  );
}

export default function BillingCallbackPage() {
  return (
    <div className="sg-fade px-8 pt-6 pb-12">
      <Suspense fallback={<LoadingState label="Confirming your payment…" />}>
        <CallbackInner />
      </Suspense>
    </div>
  );
}
```

- [ ] **Step 3: Verify + commit**

Run: `pnpm --filter @surfgen/web typecheck && pnpm --filter @surfgen/web lint`
Expected: clean.

```bash
git add "apps/web/app/(studio)/billing"
git commit -m "feat(web): /billing plan picker and Paystack callback verification page"
```

---

### Task 9: Full verification sweep

**Files:** none new.

- [ ] **Step 1: API suite + types + lint**

Run: `pnpm --filter @surfgen/api test && pnpm --filter @surfgen/api typecheck && pnpm --filter @surfgen/api lint`
Expected: all green.

- [ ] **Step 2: Web typecheck + lint + build**

Run: `pnpm --filter @surfgen/web typecheck && pnpm --filter @surfgen/web lint && pnpm --filter @surfgen/web build`
Expected: production build succeeds (this catches Suspense/`useSearchParams` misuse).

- [ ] **Step 3: Visual check (if a dev stack is available)**

Boot web (`pnpm --filter @surfgen/web dev`) and screenshot `/payments` and `/billing` via Chrome DevTools MCP at 1440 and 768 widths. If the API/Postgres are Docker-gated and unavailable, note that live checkout requires `SURFGEN_ENCRYPTION_KEY` + Paystack test keys and was not exercised.

- [ ] **Step 4: Commit anything outstanding + update memory**

```bash
git status --short   # should be clean; commit stragglers with fix:/chore:
```
