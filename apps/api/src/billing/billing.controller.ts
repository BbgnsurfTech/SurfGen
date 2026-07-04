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
    if (!principal.email) {
      throw new UnauthorizedError('Checkout requires a user session (not an API key)');
    }
    return this.billing.checkout(orgId, principal.email, body.planId);
  }

  @Get('orgs/:orgId/billing/verify/:reference')
  @RequireOrgRole('viewer')
  verify(@Param('orgId') orgId: string, @Param('reference') reference: string) {
    return this.billing.verifyCheckout(orgId, reference);
  }
}
