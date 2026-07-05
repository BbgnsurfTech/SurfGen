import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, describe, expect, test } from 'vitest';
import { LocalStorage, type LocalMediaLinkOptions } from '../src/local-storage.js';
import { assetKey, artifactKey, sanitizeSegment, videoOutputKey } from '../src/keys.js';
import { signMediaKey, verifyMediaKey } from '../src/media-signature.js';

const tempDirs: string[] = [];
const makeStorage = (media?: LocalMediaLinkOptions) => {
  const dir = mkdtempSync(join(tmpdir(), 'surfgen-storage-'));
  tempDirs.push(dir);
  return new LocalStorage(dir, media);
};
const testMedia: LocalMediaLinkOptions = {
  publicBaseUrl: 'http://localhost:4000',
  signingSecret: 'test-secret',
};
afterAll(() => tempDirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

async function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks).toString('utf8');
}

describe('keys', () => {
  test('builders produce org-scoped hierarchical keys', () => {
    expect(assetKey('org1', 'a1', 'photo.png')).toBe('org/org1/assets/a1/photo.png');
    expect(videoOutputKey('org1', 'v1', 'final', 'mp4')).toBe('org/org1/videos/v1/final.mp4');
    expect(artifactKey('org1', 'run1', 'tts', 'audio.wav')).toBe('org/org1/runs/run1/tts/audio.wav');
  });

  test('sanitizeSegment neutralizes traversal and separators', () => {
    expect(sanitizeSegment('../../etc/passwd')).not.toContain('..');
    expect(sanitizeSegment('a/b\\c')).toBe('a-b-c');
    expect(() => sanitizeSegment('...')).toThrow(/empty after sanitization/);
    expect(sanitizeSegment('x'.repeat(500))).toHaveLength(255);
  });
});

describe('LocalStorage contract', () => {
  test('put/get round-trip with bytes and streams', async () => {
    const storage = makeStorage();
    await storage.put('a/bytes.txt', new TextEncoder().encode('hello bytes'));
    expect(await readAll(await storage.get('a/bytes.txt'))).toBe('hello bytes');

    await storage.put('a/stream.txt', Readable.from(['hello ', 'stream']));
    expect(await readAll(await storage.get('a/stream.txt'))).toBe('hello stream');
  });

  test('stat returns size/contentType, null for missing, metadata via sidecar', async () => {
    const storage = makeStorage();
    await storage.put('video/out.mp4', new Uint8Array([1, 2, 3]), {
      metadata: { videoId: 'v1' },
    });
    const objectStat = await storage.stat('video/out.mp4');
    expect(objectStat).toMatchObject({
      key: 'video/out.mp4',
      sizeBytes: 3,
      contentType: 'video/mp4',
      metadata: { videoId: 'v1' },
    });
    expect(await storage.stat('missing/key.bin')).toBeNull();
  });

  test('rejects traversal and absolute keys', async () => {
    const storage = makeStorage();
    await expect(storage.put('../escape.txt', new Uint8Array())).rejects.toThrow(/escapes root/);
    await expect(storage.stat('a/../../b')).rejects.toThrow(/escapes root/);
    await expect(storage.get('/absolute')).rejects.toThrow(/Invalid storage key/);
  });

  test('failed stream write leaves no partial object (atomic put)', async () => {
    const storage = makeStorage();
    const exploding = new Readable({
      read() {
        this.push('partial data');
        this.destroy(new Error('stream burst'));
      },
    });
    await expect(storage.put('atomic/target.bin', exploding)).rejects.toThrow(/Failed to write/);
    expect(await storage.stat('atomic/target.bin')).toBeNull();
    const { objects } = await storage.list('atomic/');
    expect(objects).toEqual([]);
  });

  test('list: prefix filter, meta sidecars hidden, cursor pagination', async () => {
    const storage = makeStorage();
    for (const name of ['a', 'b', 'c', 'd']) {
      await storage.put(`page/${name}.txt`, new Uint8Array([1]), { metadata: { n: name } });
    }
    await storage.put('other/x.txt', new Uint8Array([1]));

    const page1 = await storage.list('page/', { maxKeys: 2 });
    expect(page1.objects.map((o) => o.key)).toEqual(['page/a.txt', 'page/b.txt']);
    expect(page1.cursor).toBe('page/b.txt');

    const page2 = await storage.list('page/', { maxKeys: 2, cursor: page1.cursor });
    expect(page2.objects.map((o) => o.key)).toEqual(['page/c.txt', 'page/d.txt']);
    expect(page2.cursor).toBeUndefined();
  });

  test('delete removes object and sidecar', async () => {
    const storage = makeStorage();
    await storage.put('del/x.txt', new Uint8Array([1]), { metadata: { a: '1' } });
    await storage.delete('del/x.txt');
    expect(await storage.stat('del/x.txt')).toBeNull();
    expect((await storage.list('del/')).objects).toEqual([]);
  });

  test('signedUrl builds a verifiable /v1/media link when media config is present', async () => {
    const storage = makeStorage(testMedia);
    const url = await storage.signedUrl('a/b.mp4', { method: 'GET', expiresInSeconds: 60 });
    expect(url).toMatch(/^http:\/\/localhost:4000\/v1\/media\?key=a%2Fb\.mp4&expires=\d+&sig=[0-9a-f]{64}$/);

    const params = new URL(url).searchParams;
    expect(verifyMediaKey(testMedia.signingSecret, 'a/b.mp4', Number(params.get('expires')), params.get('sig')!)).toBe(
      true,
    );
  });

  test('signedUrl rejects PUT (no local upload endpoint yet)', async () => {
    const storage = makeStorage(testMedia);
    await expect(storage.signedUrl('a/b.mp4', { method: 'PUT', expiresInSeconds: 60 })).rejects.toThrow(
      /does not support signed upload/,
    );
  });

  test('signedUrl throws loudly instead of returning a dead link when unconfigured', async () => {
    const storage = makeStorage();
    await expect(storage.signedUrl('a/b.mp4', { method: 'GET', expiresInSeconds: 60 })).rejects.toThrow(
      /requires media link config/,
    );
  });
});

describe('media-signature', () => {
  test('verifyMediaKey accepts a freshly signed key', () => {
    const { expires, sig } = signMediaKey('secret', 'org/1/video.mp4', 60);
    expect(verifyMediaKey('secret', 'org/1/video.mp4', expires, sig)).toBe(true);
  });

  test('verifyMediaKey rejects a tampered key, tampered signature, wrong secret, and expired link', () => {
    const { expires, sig } = signMediaKey('secret', 'org/1/video.mp4', 60);
    expect(verifyMediaKey('secret', 'org/1/OTHER.mp4', expires, sig)).toBe(false);
    expect(verifyMediaKey('secret', 'org/1/video.mp4', expires, `${sig.slice(0, -2)}00`)).toBe(false);
    expect(verifyMediaKey('wrong-secret', 'org/1/video.mp4', expires, sig)).toBe(false);
    expect(verifyMediaKey('secret', 'org/1/video.mp4', Date.now() - 1000, sig)).toBe(false);
  });

  test('verifyMediaKey rejects malformed signatures without throwing', () => {
    expect(verifyMediaKey('secret', 'k', Date.now() + 60_000, 'not-hex-!!')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// S3Storage against a recording stub client
// ---------------------------------------------------------------------------
import { S3Storage } from '../src/s3-storage.js';

function makeS3(responses: Record<string, unknown | (() => unknown)> = {}) {
  const sent: { name: string; input: Record<string, unknown> }[] = [];
  const stubClient = {
    send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      const name = command.constructor.name;
      sent.push({ name, input: command.input });
      const responder = responses[name];
      const response = typeof responder === 'function' ? responder() : responder;
      if (response instanceof Error) throw response;
      return response ?? {};
    },
    config: { region: async () => 'us-east-1' },
  };
  const storage = new S3Storage({
    bucket: 'surfgen',
    region: 'us-east-1',
    endpoint: 'http://127.0.0.1:9000',
    accessKeyId: 'test',
    secretAccessKey: 'test',
    forcePathStyle: true,
    clientFactory: () => stubClient as never,
  });
  return { storage, sent };
}

const notFound = () => {
  const error = new Error('not found') as Error & { name: string };
  error.name = 'NotFound';
  return error;
};

describe('S3Storage (stub client)', () => {
  test('put sends PutObject with content type and verifies via Head', async () => {
    const { storage, sent } = makeS3({
      HeadObjectCommand: { ContentLength: 3, ContentType: 'video/mp4' },
    });
    const result = await storage.put('org/o/videos/v/final.mp4', new Uint8Array([1, 2, 3]));
    expect(sent[0]).toMatchObject({
      name: 'PutObjectCommand',
      input: { Bucket: 'surfgen', Key: 'org/o/videos/v/final.mp4', ContentType: 'video/mp4' },
    });
    expect(result.sizeBytes).toBe(3);
  });

  test('stat maps 404 to null and errors to StorageError', async () => {
    const missing = makeS3({ HeadObjectCommand: notFound });
    expect(await missing.storage.stat('nope')).toBeNull();

    const broken = makeS3({ HeadObjectCommand: () => new Error('socket hangup') });
    await expect(broken.storage.stat('key')).rejects.toMatchObject({ code: 'STORAGE_ERROR' });
  });

  test('list maps continuation tokens to cursors', async () => {
    const { storage, sent } = makeS3({
      ListObjectsV2Command: {
        Contents: [{ Key: 'a', Size: 1 }],
        NextContinuationToken: 'tok2',
      },
    });
    const result = await storage.list('org/', { maxKeys: 1, cursor: 'tok1' });
    expect(sent[0]?.input).toMatchObject({ Prefix: 'org/', MaxKeys: 1, ContinuationToken: 'tok1' });
    expect(result.cursor).toBe('tok2');
    expect(result.objects[0]).toMatchObject({ key: 'a', sizeBytes: 1 });
  });

  test('get wraps NotFound as non-retryable StorageError', async () => {
    const { storage } = makeS3({ GetObjectCommand: notFound });
    await expect(storage.get('gone')).rejects.toMatchObject({
      code: 'STORAGE_ERROR',
      retryable: false,
    });
  });
});
