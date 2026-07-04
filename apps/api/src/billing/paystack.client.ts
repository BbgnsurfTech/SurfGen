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
    const data = await this.request<{
      authorization_url: string;
      access_code: string;
      reference: string;
    }>('POST', '/transaction/initialize', {
      email: input.email,
      amount: input.amount,
      currency: input.currency,
      reference: input.reference,
      callback_url: input.callbackUrl,
      ...(input.planCode && { plan: input.planCode }),
      ...(input.metadata && { metadata: input.metadata }),
    });
    return {
      authorizationUrl: data.authorization_url,
      accessCode: data.access_code,
      reference: data.reference,
    };
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

  async createPlan(input: {
    name: string;
    amount: number;
    interval: string;
    currency: string;
  }): Promise<{ planCode: string }> {
    const data = await this.request<{ plan_code: string }>('POST', '/plan', input);
    return { planCode: data.plan_code };
  }

  /** Cheapest authenticated call — proves the secret key works. */
  async ping(): Promise<void> {
    await this.request('GET', '/transaction?perPage=1');
  }
}
