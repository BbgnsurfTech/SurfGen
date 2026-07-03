import { createHash, randomBytes } from 'node:crypto';
import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { NotFoundError } from '@surfgen/core';
import { PrismaService } from '../common/prisma.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { Principal, RequireOrgRole, type AuthenticatedPrincipal } from '../auth/guards';

const CreateKeySchema = z.object({
  name: z.string().min(1).max(120),
  scopes: z.array(z.enum(['read', 'write'])).default(['read', 'write']),
});

const CreateWebhookSchema = z.object({
  url: z.string().url().max(500),
  events: z.array(z.string().min(1)).min(1),
  /** Secret reference (env:/vault:/file:) — plaintext secrets are rejected platform-wide. */
  secretRef: z.string().regex(/^(env|vault|file):/),
});

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

@ApiTags('developer')
@ApiBearerAuth()
@Controller({ path: 'orgs/:orgId', version: '1' })
export class DeveloperController {
  constructor(private readonly prisma: PrismaService) {}

  // --------------------------------------------------------------- api keys
  @Get('api-keys')
  @RequireOrgRole('admin')
  async listKeys(@Param('orgId') orgId: string) {
    const keys = await this.prisma.apiKey.findMany({
      where: { organizationId: orgId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    // Hash never leaves the API; the UI shows the stored display prefix.
    return keys.map(({ keyHash: _keyHash, ...rest }) => rest);
  }

  @Post('api-keys')
  @RequireOrgRole('admin')
  async createKey(
    @Param('orgId') orgId: string,
    @Principal() principal: AuthenticatedPrincipal,
    @Body(new ZodValidationPipe(CreateKeySchema)) body: z.infer<typeof CreateKeySchema>,
  ) {
    const plaintext = `sg_live_${randomBytes(24).toString('hex')}`;
    const record = await this.prisma.apiKey.create({
      data: {
        organizationId: orgId,
        userId: principal.userId,
        name: body.name,
        scopes: body.scopes,
        keyHash: sha256(plaintext),
        keyPrefix: plaintext.slice(0, 12),
      },
    });
    // Plaintext is returned exactly once — never stored, never retrievable.
    return { id: record.id, name: record.name, scopes: record.scopes, key: plaintext };
  }

  @Delete('api-keys/:keyId')
  @RequireOrgRole('admin')
  async revokeKey(@Param('orgId') orgId: string, @Param('keyId') keyId: string) {
    const key = await this.prisma.apiKey.findFirst({ where: { id: keyId, organizationId: orgId } });
    if (!key) throw new NotFoundError('ApiKey', keyId);
    return this.prisma.apiKey.update({ where: { id: keyId }, data: { revokedAt: new Date() } });
  }

  // --------------------------------------------------------------- webhooks
  @Get('webhooks')
  @RequireOrgRole('admin')
  listWebhooks(@Param('orgId') orgId: string) {
    return this.prisma.webhook.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: 'desc' } });
  }

  @Post('webhooks')
  @RequireOrgRole('admin')
  createWebhook(
    @Param('orgId') orgId: string,
    @Body(new ZodValidationPipe(CreateWebhookSchema)) body: z.infer<typeof CreateWebhookSchema>,
  ) {
    return this.prisma.webhook.create({ data: { organizationId: orgId, ...body } });
  }

  @Delete('webhooks/:webhookId')
  @RequireOrgRole('admin')
  async deleteWebhook(@Param('orgId') orgId: string, @Param('webhookId') webhookId: string) {
    const webhook = await this.prisma.webhook.findFirst({ where: { id: webhookId, organizationId: orgId } });
    if (!webhook) throw new NotFoundError('Webhook', webhookId);
    await this.prisma.webhook.delete({ where: { id: webhookId } });
    return { deleted: true };
  }
}
