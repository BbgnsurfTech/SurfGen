import { resolve } from 'node:path';
import type { Provider } from '@nestjs/common';
import { loadAll } from '@surfgen/config';
import { unwrap, type StoragePort } from '@surfgen/core';
import { resolveSecretRef } from '@surfgen/plugin-sdk';
import { LocalStorage, S3Storage } from '@surfgen/storage';

export const STORAGE = Symbol('STORAGE');

/** Same config-driven storage selection the workers use (config/storage.yaml). */
export const storageProvider: Provider = {
  provide: STORAGE,
  useFactory: (): StoragePort => {
    const configDir = process.env.SURFGEN_CONFIG_DIR ?? resolve(process.cwd(), 'config');
    const bundle = unwrap(loadAll(configDir));
    if (bundle.storage.driver === 's3' && bundle.storage.s3) {
      const s3 = bundle.storage.s3;
      return new S3Storage({
        bucket: s3.bucket,
        region: s3.region,
        ...(s3.endpoint && { endpoint: s3.endpoint }),
        accessKeyId: resolveSecretRef(s3.accessKeyRef),
        secretAccessKey: resolveSecretRef(s3.secretKeyRef),
        forcePathStyle: s3.forcePathStyle,
      });
    }
    return new LocalStorage(bundle.storage.local?.rootDir ?? './storage/local');
  },
};
