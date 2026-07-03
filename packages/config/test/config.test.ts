import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { unwrap, isErr } from '@surfgen/core';
import {
  AiConfigSchema,
  ProvidersConfigSchema,
  StorageConfigSchema,
  VideoConfigSchema,
  ModelsConfigSchema,
} from '../src/schemas.js';
import { applyEnvOverrides, loadAll, loadConfigFile } from '../src/loader.js';
import { DEFAULT_STORAGE_CONFIG, DEFAULT_VIDEO_CONFIG } from '../src/defaults.js';

const tempDirs: string[] = [];
const makeDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'surfgen-config-'));
  tempDirs.push(dir);
  return dir;
};
afterAll(() => tempDirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe('schemas', () => {
  test('ai.yaml: valid chain parses with defaults applied', () => {
    const parsed = AiConfigSchema.parse({
      capabilities: { tts: { chain: [{ provider: 'tts-piper' }] } },
    });
    expect(parsed.capabilities.tts?.chain[0]).toEqual({
      provider: 'tts-piper',
      priority: 100,
      enabled: true,
    });
  });

  test('ai.yaml: unknown capability key is rejected', () => {
    expect(
      AiConfigSchema.safeParse({ capabilities: { teleport: { chain: [{ provider: 'x' }] } } })
        .success,
    ).toBe(false);
  });

  test('providers.json: duplicate ids rejected, secret literals rejected', () => {
    const dup = ProvidersConfigSchema.safeParse({
      providers: [
        { id: 'a', capability: 'tts', kind: 'cli' },
        { id: 'a', capability: 'tts', kind: 'http' },
      ],
    });
    expect(dup.success).toBe(false);

    const literal = ProvidersConfigSchema.safeParse({
      providers: [
        { id: 'a', capability: 'tts', kind: 'http', secrets: { apiKey: 'sk-live-plaintext' } },
      ],
    });
    expect(literal.success).toBe(false);

    const ref = ProvidersConfigSchema.safeParse({
      providers: [
        { id: 'a', capability: 'tts', kind: 'http', secrets: { apiKey: 'env:ELEVENLABS_API_KEY' } },
      ],
    });
    expect(ref.success).toBe(true);
  });

  test('storage.yaml: driver/block cross-validation', () => {
    expect(StorageConfigSchema.safeParse({ driver: 's3' }).success).toBe(false);
    expect(StorageConfigSchema.safeParse({ driver: 'local' }).success).toBe(false);
    expect(
      StorageConfigSchema.safeParse({ driver: 'local', local: { rootDir: '/tmp/x' } }).success,
    ).toBe(true);
  });

  test('video.yaml: odd resolution and bad frame rate rejected', () => {
    const bad = structuredClone(DEFAULT_VIDEO_CONFIG) as Record<string, any>;
    bad.defaults.resolution.width = 1921;
    expect(VideoConfigSchema.safeParse(bad).success).toBe(false);
    const bad2 = structuredClone(DEFAULT_VIDEO_CONFIG) as Record<string, any>;
    bad2.defaults.frameRate = 23;
    expect(VideoConfigSchema.safeParse(bad2).success).toBe(false);
  });

  test('models.yaml: defaults to empty list', () => {
    expect(ModelsConfigSchema.parse({}).models).toEqual([]);
  });
});

describe('env overrides', () => {
  test('nested path with type coercion', () => {
    const result = applyEnvOverrides(
      'video',
      { defaults: { quality: 23 } },
      { SURFGEN_VIDEO__DEFAULTS__QUALITY: '18', SURFGEN_VIDEO__LIMITS__MAXDURATIONSECONDS: '60' },
    ) as any;
    expect(result.defaults.quality).toBe(18);
    expect(result.limits.maxdurationseconds).toBe(60);
  });

  test('boolean coercion and scope isolation', () => {
    const result = applyEnvOverrides(
      'storage',
      { driver: 's3' },
      { SURFGEN_STORAGE__DRIVER: 'local', SURFGEN_VIDEO__DEFAULTS__QUALITY: '10' },
    ) as any;
    expect(result.driver).toBe('local');
    expect(result.defaults).toBeUndefined();
  });
});

describe('loadConfigFile', () => {
  test('file values override defaults; env overrides file', () => {
    const dir = makeDir();
    const file = join(dir, 'storage.yaml');
    writeFileSync(file, 'driver: local\nlocal:\n  rootDir: /data/from-file\n');
    const loaded = unwrap(
      loadConfigFile('storage', file, StorageConfigSchema, DEFAULT_STORAGE_CONFIG, {
        env: { SURFGEN_STORAGE__SIGNEDURLTTLSECONDS: '300' },
      }),
    );
    expect(loaded.local?.rootDir).toBe('/data/from-file');
    expect(loaded.signedUrlTtlSeconds).toBe(300);
  });

  test('missing file falls back to defaults', () => {
    const loaded = unwrap(
      loadConfigFile(
        'storage',
        '/nonexistent/storage.yaml',
        StorageConfigSchema,
        DEFAULT_STORAGE_CONFIG,
        { env: {} },
      ),
    );
    expect(loaded).toEqual(DEFAULT_STORAGE_CONFIG);
  });

  test('invalid file returns ConfigurationError with zod issues', () => {
    const dir = makeDir();
    const file = join(dir, 'storage.yaml');
    writeFileSync(file, 'driver: s3\n'); // s3 driver without s3 block
    const result = loadConfigFile('storage', file, StorageConfigSchema, DEFAULT_STORAGE_CONFIG, {
      env: {},
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe('CONFIGURATION_ERROR');
      expect(Array.isArray(result.error.details.issues)).toBe(true);
    }
  });

  test('malformed yaml is a parse error, not a crash', () => {
    const dir = makeDir();
    const file = join(dir, 'storage.yaml');
    writeFileSync(file, 'driver: [unclosed');
    const result = loadConfigFile('storage', file, StorageConfigSchema, DEFAULT_STORAGE_CONFIG, {
      env: {},
    });
    expect(isErr(result)).toBe(true);
  });
});

describe('loadAll', () => {
  test('empty dir returns full default bundle', () => {
    const bundle = unwrap(loadAll(makeDir(), { env: {} }));
    expect(bundle.storage.driver).toBe('local');
    expect(bundle.video.defaults.frameRate).toBe(30);
    expect(bundle.ai.capabilities.tts?.chain.length).toBeGreaterThan(0);
  });

  test('repo sample config directory is valid', () => {
    const bundle = unwrap(loadAll(join(import.meta.dirname, '../../../config'), { env: {} }));
    expect(bundle.providers.providers.map((p) => p.id)).toContain('tts-piper');
    expect(bundle.ai.capabilities.llm?.chain[0]?.provider).toBe('llm-ollama');
  });
});
