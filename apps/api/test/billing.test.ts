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
      create: vi.fn(async (_args: unknown) => ({ id: 'inv_1' })),
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
    initializeTransaction: vi.fn(async (_input: unknown) => ({
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
    // Arrange
    const { service, prisma } = makeService();
    prisma.paymentGatewaySetting.findUnique.mockResolvedValue(enabledGateway());

    // Act
    const settings = await service.getGatewaySettings();

    // Assert
    expect(settings.secretKeyMasked).toBe('••••cret');
    expect(JSON.stringify(settings)).not.toContain('sk_test_secret');
    expect(JSON.stringify(settings)).not.toContain('v1:');
  });

  test('update seals a newly provided secret key', async () => {
    const { service, prisma } = makeService();

    await service.updateGatewaySettings({
      enabled: true,
      publicKey: 'pk_x',
      secretKey: 'sk_new',
      currency: 'NGN',
    });

    const args = prisma.paymentGatewaySetting.upsert.mock.calls[0]![0] as unknown as {
      create: { secretKeyEncrypted: string };
    };
    expect(args.create.secretKeyEncrypted.startsWith('v1:')).toBe(true);
    expect(args.create.secretKeyEncrypted).not.toContain('sk_new');
  });

  test('update without secretKey leaves the stored secret untouched', async () => {
    const { service, prisma } = makeService();
    prisma.paymentGatewaySetting.findUnique.mockResolvedValue(enabledGateway());

    await service.updateGatewaySettings({ enabled: false, publicKey: 'pk_x', currency: 'NGN' });

    const args = prisma.paymentGatewaySetting.upsert.mock.calls[0]![0] as unknown as {
      update: Record<string, unknown>;
    };
    expect(args.update.secretKeyEncrypted).toBeUndefined();
  });
});

describe('checkout', () => {
  test('refuses when the gateway is disabled', async () => {
    const { service, prisma } = makeService();
    prisma.paymentGatewaySetting.findUnique.mockResolvedValue({ ...enabledGateway(), enabled: false });

    await expect(service.checkout('org_1', 'ada@example.com', 'plan_1')).rejects.toBeInstanceOf(
      ConfigurationError,
    );
  });

  test('creates an open invoice and returns the authorization URL', async () => {
    // Arrange
    const { service, prisma, client } = makeService();
    prisma.paymentGatewaySetting.findUnique.mockResolvedValue(enabledGateway());

    // Act
    const session = await service.checkout('org_1', 'ada@example.com', 'plan_1');

    // Assert
    expect(session.authorizationUrl).toBe('https://checkout.paystack.com/abc');
    const invoiceArgs = prisma.invoice.create.mock.calls[0]![0] as unknown as {
      data: Record<string, unknown>;
    };
    expect(invoiceArgs.data).toMatchObject({ status: 'open', amountCents: 500000, currency: 'NGN' });
    expect(invoiceArgs.data.externalId).toBe(session.reference);
    const initArgs = client.initializeTransaction.mock.calls[0]![0] as unknown as {
      metadata: Record<string, unknown>;
    };
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

    await expect(service.handleWebhook(Buffer.from(body), 'bad-signature')).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  test('charge.success with matching amount marks the invoice paid and activates the subscription', async () => {
    // Arrange
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

    // Act
    await service.handleWebhook(Buffer.from(body), sign(body, 'sk_test_secret'));

    // Assert
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
    // Arrange
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

    // Act
    await service.handleWebhook(Buffer.from(body), sign(body, 'sk_test_secret'));

    // Assert
    expect(prisma.invoice.update).not.toHaveBeenCalled();
    expect(prisma.subscription.create).not.toHaveBeenCalled();
  });

  test('replayed charge.success on a paid invoice is a no-op', async () => {
    // Arrange
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

    // Act
    await service.handleWebhook(Buffer.from(body), sign(body, 'sk_test_secret'));

    // Assert
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

describe('admin controller guard', () => {
  test('BillingAdminController is super-admin gated at the class level', async () => {
    await import('reflect-metadata');
    const { SUPER_ADMIN_KEY } = await import('../src/auth/guards');
    const { BillingAdminController } = await import('../src/billing/billing-admin.controller');
    expect(Reflect.getMetadata(SUPER_ADMIN_KEY, BillingAdminController)).toBe(true);
  });
});
