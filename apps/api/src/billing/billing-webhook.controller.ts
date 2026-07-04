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
