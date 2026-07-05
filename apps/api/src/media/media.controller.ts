import type { Readable } from 'node:stream';
import { Controller, Get, Inject, Query, StreamableFile } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ForbiddenError, NotFoundError, type StoragePort } from '@surfgen/core';
import { verifyMediaKey } from '@surfgen/storage';
import { Public } from '../auth/guards';
import { MEDIA_SECRET_LABEL, STORAGE } from '../common/storage.provider';
import { deriveSecret } from '../common/jwt-secret';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

const MediaQuerySchema = z.object({
  key: z.string().min(1),
  expires: z.coerce.number(),
  sig: z.string().min(1),
});

/**
 * Serves local-storage files via the signed links LocalStorage.signedUrl()
 * issues. S3 deployments never reach this route — S3's signedUrl points
 * straight at the bucket. Public because a bare <video src> can't send an
 * Authorization header; the signature itself is the access control.
 */
@ApiTags('media')
@Controller({ path: 'media', version: '1' })
export class MediaController {
  constructor(@Inject(STORAGE) private readonly storage: StoragePort) {}

  @Get()
  @Public()
  async serve(
    @Query(new ZodValidationPipe(MediaQuerySchema)) query: z.infer<typeof MediaQuerySchema>,
  ): Promise<StreamableFile> {
    const valid = verifyMediaKey(deriveSecret(MEDIA_SECRET_LABEL), query.key, query.expires, query.sig);
    if (!valid) throw new ForbiddenError('Media link is invalid or has expired');

    const stat = await this.storage.stat(query.key);
    if (!stat) throw new NotFoundError('Media', query.key);

    const stream = await this.storage.get(query.key);
    return new StreamableFile(stream as unknown as Readable, {
      type: stat.contentType,
      length: stat.sizeBytes,
    });
  }
}
