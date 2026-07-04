import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigurationError, NotFoundError, UnauthorizedError, ValidationError } from '@surfgen/core';
import { PrismaService } from '../common/prisma.service';
import { maskSecret, openSecret, sealSecret } from '../common/secret-box';
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

interface SyncablePlan {
  id: string;
  name: string;
  amountCents: number;
  interval: string;
  currency: string;
  paystackPlanCode: string | null;
}

interface SettleableInvoice {
  id: string;
  status: string;
  amountCents: number;
  currency: string;
  billingAccountId: string;
}

interface PaymentFacts {
  amount: number;
  currency: string;
  planId: string | null;
  customerCode: string | null;
}

/**
 * Paystack-backed billing: deployment-wide gateway settings (secret sealed at
 * rest), admin-defined plans synced to Paystack, redirect checkout, and
 * signature-verified webhooks that settle invoices + subscriptions.
 */
@Injectable()
export class BillingService {
  /** Overridable seam so tests can stub the Paystack HTTP surface. */
  clientFactory: (secretKey: string) => PaystackClient = (secretKey) => new PaystackClient(secretKey);

  constructor(private readonly prisma: PrismaService) {}

  // -- gateway settings -------------------------------------------------------

  private gatewayRow(): Promise<StoredGateway | null> {
    return this.prisma.paymentGatewaySetting.findUnique({ where: { gateway: GATEWAY } });
  }

  private present(row: StoredGateway | null) {
    return {
      gateway: GATEWAY,
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
  private async requireClient(requireEnabled = true): Promise<PaystackClient> {
    const row = await this.gatewayRow();
    if (!row?.secretKeyEncrypted) {
      throw new ConfigurationError('Paystack secret key is not configured');
    }
    if (requireEnabled && !row.enabled) {
      throw new ConfigurationError('Payments are currently disabled');
    }
    return this.clientFactory(openSecret(row.secretKeyEncrypted));
  }

  async testGateway(): Promise<{ ok: true }> {
    const client = await this.requireClient(false);
    await client.ping();
    return { ok: true };
  }

  // -- plans --------------------------------------------------------------------

  listPlansAdmin() {
    return this.prisma.plan.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
  }

  async listActivePlans() {
    const [row, plans] = await Promise.all([
      this.gatewayRow(),
      this.prisma.plan.findMany({
        where: { active: true },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
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
    const created = await this.prisma.plan.create({
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
    return this.syncPlanToPaystack(created);
  }

  async updatePlan(planId: string, input: Partial<PlanInput>) {
    const existing = await this.prisma.plan.findUnique({ where: { id: planId } });
    if (!existing) throw new NotFoundError('Plan', planId);
    const updated = await this.prisma.plan.update({ where: { id: planId }, data: input });
    return this.syncPlanToPaystack(updated);
  }

  /** Best-effort Paystack sync — a disabled/unconfigured gateway defers it. */
  private async syncPlanToPaystack<T extends SyncablePlan>(plan: T): Promise<T> {
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

  // -- subscription + checkout ----------------------------------------------------

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
    const client = await this.requireClient();
    const found = await this.prisma.plan.findUnique({ where: { id: planId } });
    if (!found || !found.active) throw new NotFoundError('Plan', planId);
    const plan = await this.syncPlanToPaystack(found);

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
    return { authorizationUrl: session.authorizationUrl, reference };
  }

  async verifyCheckout(orgId: string, reference: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { externalId: reference, billingAccount: { organizationId: orgId } },
    });
    if (!invoice) throw new NotFoundError('Invoice', reference);
    if (invoice.status === 'paid') return { status: 'paid' as const };

    const client = await this.requireClient(false);
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

  // -- webhook -----------------------------------------------------------------

  async handleWebhook(rawBody: Buffer, signature: string | undefined): Promise<void> {
    const row = await this.gatewayRow();
    if (!row?.secretKeyEncrypted) throw new UnauthorizedError('Gateway not configured');
    const expected = createHmac('sha512', openSecret(row.secretKeyEncrypted))
      .update(rawBody)
      .digest('hex');
    const provided = signature ?? '';
    const valid =
      provided.length === expected.length &&
      timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
    if (!valid) throw new UnauthorizedError('Invalid webhook signature');

    let event: { event: string; data: Record<string, unknown> };
    try {
      event = JSON.parse(rawBody.toString('utf8')) as { event: string; data: Record<string, unknown> };
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
        return; // unknown events are acknowledged and ignored (Paystack retries non-2xx)
    }
  }

  private async onChargeSuccess(data: Record<string, unknown>): Promise<void> {
    const reference = data.reference as string | undefined;
    if (!reference) return;
    const invoice = await this.prisma.invoice.findFirst({ where: { externalId: reference } });
    if (!invoice || invoice.status === 'paid') return; // unknown or replay — idempotent
    const metadata = (data.metadata ?? null) as Record<string, unknown> | null;
    await this.settleInvoice(invoice, {
      amount: data.amount as number,
      currency: data.currency as string,
      planId: (metadata?.planId as string | undefined) ?? null,
      customerCode:
        ((data.customer as Record<string, unknown> | undefined)?.customer_code as string) ?? null,
    });
  }

  /** Shared by webhook + redirect verify: amount-check, mark paid, activate. */
  private async settleInvoice(invoice: SettleableInvoice, payment: PaymentFacts): Promise<void> {
    const amountMatches =
      payment.amount === invoice.amountCents &&
      payment.currency.toUpperCase() === invoice.currency.toUpperCase();
    if (!amountMatches) return; // amount tampering — leave the invoice open for investigation

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
    const customerCode = (data.customer as Record<string, unknown> | undefined)?.customer_code as
      | string
      | undefined;
    const subscriptionCode = data.subscription_code as string | undefined;
    if (!customerCode || !subscriptionCode) return;
    const account = await this.prisma.billingAccount.findFirst({
      where: { externalCustomerId: customerCode },
    });
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
