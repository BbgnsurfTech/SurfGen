import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { lookup as mimeLookup } from 'mime-types';
import {
  StorageError,
  type PutObjectOptions,
  type StorageObjectStat,
  type StoragePort,
} from '@surfgen/core';

export interface S3StorageOptions {
  readonly bucket: string;
  readonly region: string;
  /** Custom endpoint for MinIO / R2 / other S3-compatibles. */
  readonly endpoint?: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly forcePathStyle?: boolean;
  /** Test hook: inject a stub client. */
  readonly clientFactory?: (config: S3ClientConfig) => S3Client;
}

const isNotFound = (error: unknown): boolean => {
  const name = (error as { name?: string })?.name;
  const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
  return name === 'NotFound' || name === 'NoSuchKey' || status === 404;
};

/** S3-compatible StoragePort adapter (AWS S3, MinIO, Cloudflare R2, GCS-interop). */
export class S3Storage implements StoragePort {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(options: S3StorageOptions) {
    this.bucket = options.bucket;
    const config: S3ClientConfig = {
      region: options.region,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
      ...(options.endpoint && { endpoint: options.endpoint }),
      ...(options.forcePathStyle !== undefined && { forcePathStyle: options.forcePathStyle }),
    };
    this.client = options.clientFactory ? options.clientFactory(config) : new S3Client(config);
  }

  async put(
    key: string,
    body: Uint8Array | NodeJS.ReadableStream,
    options: PutObjectOptions = {},
  ): Promise<StorageObjectStat> {
    const contentType =
      options.contentType ?? (mimeLookup(key) || 'application/octet-stream');
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body as never,
          ContentType: contentType,
          ...(options.metadata && { Metadata: options.metadata }),
          ...(options.cacheControl && { CacheControl: options.cacheControl }),
        }),
      );
    } catch (cause) {
      throw new StorageError(`S3 put failed for ${key}`, { cause });
    }
    const uploaded = await this.stat(key);
    if (!uploaded) throw new StorageError(`S3 put verification failed for ${key}`);
    return uploaded;
  }

  async get(key: string): Promise<NodeJS.ReadableStream> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (!response.Body) throw new StorageError(`Empty body for ${key}`);
      return response.Body as unknown as NodeJS.ReadableStream;
    } catch (cause) {
      if (cause instanceof StorageError) throw cause;
      throw new StorageError(`S3 get failed for ${key}`, {
        cause,
        retryable: !isNotFound(cause),
      });
    }
  }

  async stat(key: string): Promise<StorageObjectStat | null> {
    try {
      const head = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        key,
        sizeBytes: head.ContentLength ?? 0,
        ...(head.ContentType && { contentType: head.ContentType }),
        ...(head.LastModified && { lastModified: head.LastModified }),
        ...(head.Metadata && Object.keys(head.Metadata).length > 0 && { metadata: head.Metadata }),
      };
    } catch (cause) {
      if (isNotFound(cause)) return null;
      throw new StorageError(`S3 head failed for ${key}`, { cause });
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (cause) {
      throw new StorageError(`S3 delete failed for ${key}`, { cause });
    }
  }

  async list(
    prefix: string,
    options: { maxKeys?: number; cursor?: string } = {},
  ): Promise<{ objects: StorageObjectStat[]; cursor?: string }> {
    try {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          MaxKeys: options.maxKeys ?? 1000,
          ...(options.cursor && { ContinuationToken: options.cursor }),
        }),
      );
      return {
        objects: (response.Contents ?? []).map((object) => ({
          key: object.Key ?? '',
          sizeBytes: object.Size ?? 0,
          ...(object.LastModified && { lastModified: object.LastModified }),
        })),
        ...(response.NextContinuationToken && { cursor: response.NextContinuationToken }),
      };
    } catch (cause) {
      throw new StorageError(`S3 list failed for prefix ${prefix}`, { cause });
    }
  }

  async signedUrl(
    key: string,
    options: { method: 'GET' | 'PUT'; expiresInSeconds: number; contentType?: string },
  ): Promise<string> {
    const command =
      options.method === 'GET'
        ? new GetObjectCommand({ Bucket: this.bucket, Key: key })
        : new PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            ...(options.contentType && { ContentType: options.contentType }),
          });
    return getSignedUrl(this.client as never, command as never, {
      expiresIn: options.expiresInSeconds,
    });
  }
}
