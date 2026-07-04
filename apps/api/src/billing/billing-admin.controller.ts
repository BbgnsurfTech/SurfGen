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
  code: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9-]+$/),
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
