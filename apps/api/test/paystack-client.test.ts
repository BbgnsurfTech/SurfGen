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
    // Arrange
    const impl = mockFetchOnce(200, {
      status: true,
      data: { authorization_url: 'https://checkout.paystack.com/abc', access_code: 'ac_1', reference: 'sg_ref1' },
    });
    const client = new PaystackClient('sk_test_x');

    // Act
    const session = await client.initializeTransaction({
      email: 'ada@example.com',
      amount: 500000,
      currency: 'NGN',
      reference: 'sg_ref1',
      callbackUrl: 'http://localhost:3000/billing/callback',
      planCode: 'PLN_1',
      metadata: { planId: 'plan_1' },
    });

    // Assert
    expect(session.authorizationUrl).toBe('https://checkout.paystack.com/abc');
    const [url, init] = impl.mock.calls[0] as unknown as [string, RequestInit];
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
    // Arrange
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

    // Act
    const result = await new PaystackClient('sk_test_x').verifyTransaction('sg_ref1');

    // Assert
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
