import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat, readFile, writeFile, unlink } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { lookup as mimeLookup } from 'mime-types';
import {
  StorageError,
  type PutObjectOptions,
  type StorageObjectStat,
  type StoragePort,
} from '@surfgen/core';

const META_SUFFIX = '.surfgen-meta.json';

/**
 * Filesystem StoragePort adapter for development and single-node deployments.
 * Writes are atomic (temp file + rename); keys are confined to the root dir.
 * signedUrl returns local:// pseudo-URLs — dev only; the API serves these
 * through an authenticated streaming endpoint instead of a CDN.
 */
export class LocalStorage implements StoragePort {
  private readonly root: string;

  constructor(rootDir: string) {
    this.root = resolve(rootDir);
  }

  /** Resolve a key inside the root; reject traversal attempts. */
  private resolveKey(storageKey: string): string {
    if (storageKey.length === 0 || storageKey.startsWith('/')) {
      throw new StorageError(`Invalid storage key: ${storageKey}`, { retryable: false });
    }
    const fullPath = resolve(this.root, storageKey);
    if (fullPath !== this.root && !fullPath.startsWith(this.root + sep)) {
      throw new StorageError(`Storage key escapes root: ${storageKey}`, { retryable: false });
    }
    return fullPath;
  }

  async put(
    storageKey: string,
    body: Uint8Array | NodeJS.ReadableStream,
    options: PutObjectOptions = {},
  ): Promise<StorageObjectStat> {
    const target = this.resolveKey(storageKey);
    await mkdir(dirname(target), { recursive: true });
    const temp = join(dirname(target), `.tmp-${randomUUID()}`);

    try {
      if (body instanceof Uint8Array) {
        await writeFile(temp, body);
      } else {
        await pipeline(body as Readable, createWriteStream(temp));
      }
      await rename(temp, target);
    } catch (cause) {
      await unlink(temp).catch(() => {});
      throw new StorageError(`Failed to write ${storageKey}`, { cause });
    }

    if (options.metadata && Object.keys(options.metadata).length > 0) {
      await writeFile(
        target + META_SUFFIX,
        JSON.stringify({ metadata: options.metadata, contentType: options.contentType }),
      );
    }

    const fileStat = await stat(target);
    return {
      key: storageKey,
      sizeBytes: fileStat.size,
      contentType: options.contentType ?? this.guessContentType(storageKey),
      lastModified: fileStat.mtime,
      ...(options.metadata && { metadata: options.metadata }),
    };
  }

  async get(storageKey: string): Promise<NodeJS.ReadableStream> {
    const target = this.resolveKey(storageKey);
    try {
      await stat(target);
    } catch {
      throw new StorageError(`Object not found: ${storageKey}`, { retryable: false });
    }
    return createReadStream(target);
  }

  async stat(storageKey: string): Promise<StorageObjectStat | null> {
    const target = this.resolveKey(storageKey);
    try {
      const fileStat = await stat(target);
      if (!fileStat.isFile()) return null;
      let metadata: Record<string, string> | undefined;
      let contentType = this.guessContentType(storageKey);
      try {
        const sidecar = JSON.parse(await readFile(target + META_SUFFIX, 'utf8'));
        metadata = sidecar.metadata;
        contentType = sidecar.contentType ?? contentType;
      } catch {
        // no sidecar — fine
      }
      return {
        key: storageKey,
        sizeBytes: fileStat.size,
        contentType,
        lastModified: fileStat.mtime,
        ...(metadata && { metadata }),
      };
    } catch {
      return null;
    }
  }

  async delete(storageKey: string): Promise<void> {
    const target = this.resolveKey(storageKey);
    await rm(target, { force: true });
    await rm(target + META_SUFFIX, { force: true });
  }

  async list(
    prefix: string,
    options: { maxKeys?: number; cursor?: string } = {},
  ): Promise<{ objects: StorageObjectStat[]; cursor?: string }> {
    const maxKeys = options.maxKeys ?? 1000;
    const keys: string[] = [];
    await this.walk(this.root, keys);
    const filtered = keys
      .filter((key) => key.startsWith(prefix) && !key.endsWith(META_SUFFIX))
      .sort()
      .filter((key) => (options.cursor ? key > options.cursor : true));

    const page = filtered.slice(0, maxKeys);
    const objects: StorageObjectStat[] = [];
    for (const key of page) {
      const objectStat = await this.stat(key);
      if (objectStat) objects.push(objectStat);
    }
    return {
      objects,
      ...(filtered.length > maxKeys && { cursor: page[page.length - 1] }),
    };
  }

  private async walk(dir: string, keys: string[]): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await this.walk(full, keys);
      else if (entry.isFile() && !entry.name.startsWith('.tmp-')) {
        keys.push(full.slice(this.root.length + 1).split(sep).join('/'));
      }
    }
  }

  async signedUrl(
    storageKey: string,
    options: { method: 'GET' | 'PUT'; expiresInSeconds: number },
  ): Promise<string> {
    this.resolveKey(storageKey); // validation only
    const expires = Date.now() + options.expiresInSeconds * 1000;
    // Dev-only pseudo-URL; production deployments use the S3 adapter.
    return `local://${storageKey}?method=${options.method}&expires=${expires}`;
  }

  private guessContentType(storageKey: string): string {
    return mimeLookup(storageKey) || 'application/octet-stream';
  }
}
