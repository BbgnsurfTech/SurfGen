import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { collectFinalOutput } from '@surfgen/ai-sdk';
import { SadTalkerAvatarProvider } from '../src/index.js';

/**
 * SadTalker is exercised through a shim script that mimics inference.py's
 * contract (accepts --source_image/--driven_audio/--result_dir, timestamps a
 * subdirectory, writes a fake .mp4 into it, exits 0) so the provider's
 * process handling, output-globbing, and storage upload are tested without
 * the real model, checkpoints, or a GPU.
 */
const shimDir = mkdtempSync(join(tmpdir(), 'sadtalker-shim-'));
const shimPath = join(shimDir, 'inference-shim.mjs');
writeFileSync(
  shimPath,
  `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const args = process.argv.slice(2);
const flag = (name) => args[args.indexOf(name) + 1];
if (args.includes('--help')) process.exit(0);
const resultDir = flag('--result_dir');
const subDir = join(resultDir, '2026_07_05_12.00.00');
mkdirSync(subDir, { recursive: true });
writeFileSync(join(subDir, 'result.mp4'), Buffer.from('fake-mp4-bytes'));
process.exit(0);
`,
);
chmodSync(shimPath, 0o755);
afterAll(() => rmSync(shimDir, { recursive: true, force: true }));

class MemoryStorage {
  files = new Map<string, Buffer>();
  async put(key: string, body: Uint8Array): Promise<{ key: string; sizeBytes: number; contentType: string; lastModified: Date }> {
    this.files.set(key, Buffer.from(body));
    return { key, sizeBytes: body.length, contentType: 'video/mp4', lastModified: new Date() };
  }
  async get(key: string): Promise<NodeJS.ReadableStream> {
    const { Readable } = await import('node:stream');
    return Readable.from([this.files.get(key)]);
  }
  async stat(): Promise<null> {
    return null;
  }
  async delete(): Promise<void> {}
  async list(): Promise<{ objects: never[] }> {
    return { objects: [] };
  }
  async signedUrl(): Promise<string> {
    return 'unused';
  }
}

async function makeProvider(storage: MemoryStorage = new MemoryStorage()) {
  const provider = new SadTalkerAvatarProvider();
  await provider.initialize({
    id: 'avatar-sadtalker',
    capability: 'avatar',
    enabled: true,
    priority: 10,
    options: { pythonCommand: 'node', scriptPath: shimPath, storage },
  });
  return provider;
}

describe('SadTalkerAvatarProvider', () => {
  test('initialize() rejects config missing options.scriptPath', async () => {
    const provider = new SadTalkerAvatarProvider();
    await expect(
      provider.initialize({
        id: 'avatar-sadtalker',
        capability: 'avatar',
        enabled: true,
        priority: 10,
        options: { pythonCommand: 'node' },
      }),
    ).rejects.toThrow(/requires options\.scriptPath/);
  });

  test('animates a photo avatar and uploads the result', async () => {
    const storage = new MemoryStorage();
    // Pre-seed a fake source image + audio so the provider's own materialize step finds them.
    await storage.put('org/o1/assets/a1/photo.png', new TextEncoder().encode('fake-png-bytes'));
    await storage.put('org/o1/runs/r1/tts/audio.wav', new TextEncoder().encode('fake-wav-bytes'));
    const provider = await makeProvider(storage);

    const output = await collectFinalOutput(
      provider.generate(
        {
          avatarRef: { image: { storageKey: 'org/o1/assets/a1/photo.png', contentType: 'image/png' } },
          drivingAudio: { storageKey: 'org/o1/runs/r1/tts/audio.wav', contentType: 'audio/wav' },
          resolution: { width: 1920, height: 1080 },
        },
        {},
      ),
    );

    expect(output.video.contentType).toBe('video/mp4');
    expect(output.hasAlpha).toBe(false);
    expect(storage.files.get(output.video.storageKey)?.toString()).toBe('fake-mp4-bytes');
  });

  test('rejects a bare avatarId — requires an already-resolved image', async () => {
    const provider = await makeProvider();
    await expect(
      collectFinalOutput(
        provider.generate(
          {
            avatarRef: { avatarId: 'a1' },
            drivingAudio: { storageKey: 'x', contentType: 'audio/wav' },
            resolution: { width: 1920, height: 1080 },
          },
          {},
        ),
      ),
    ).rejects.toThrow(/requires a resolved source image/);
  });

  test('surfaces a non-zero shim exit as a ProviderError', async () => {
    const storage = new MemoryStorage();
    await storage.put('img.png', new TextEncoder().encode('x'));
    await storage.put('audio.wav', new TextEncoder().encode('x'));
    const provider = new SadTalkerAvatarProvider();
    const failingShim = join(shimDir, 'failing-shim.mjs');
    writeFileSync(failingShim, `#!/usr/bin/env node\nprocess.exit(1);\n`);
    chmodSync(failingShim, 0o755);
    await provider.initialize({
      id: 'avatar-sadtalker',
      capability: 'avatar',
      enabled: true,
      priority: 10,
      options: { pythonCommand: 'node', scriptPath: failingShim, storage },
    });

    await expect(
      collectFinalOutput(
        provider.generate(
          {
            avatarRef: { image: { storageKey: 'img.png', contentType: 'image/png' } },
            drivingAudio: { storageKey: 'audio.wav', contentType: 'audio/wav' },
            resolution: { width: 1920, height: 1080 },
          },
          {},
        ),
      ),
    ).rejects.toThrow(/exited 1/);
  });

  test('declares itself local with a non-zero cost hint', async () => {
    const provider = await makeProvider();
    const descriptor = provider.capabilities();
    expect(descriptor.deployment).toBe('local');
    expect(descriptor.costHint?.amount).toBeGreaterThan(0);
    expect(descriptor.features.offline).toBe(true);
  });

  test('resultDir has no .mp4 after a clean exit — ProviderError', async () => {
    const storage = new MemoryStorage();
    await storage.put('img.png', new TextEncoder().encode('x'));
    await storage.put('audio.wav', new TextEncoder().encode('x'));
    const provider = new SadTalkerAvatarProvider();
    const noMp4Shim = join(shimDir, 'no-mp4-shim.mjs');
    writeFileSync(
      noMp4Shim,
      `#!/usr/bin/env node
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
const args = process.argv.slice(2);
const flag = (name) => args[args.indexOf(name) + 1];
const resultDir = flag('--result_dir');
const subDir = join(resultDir, '2026_07_05_12.00.00');
mkdirSync(subDir, { recursive: true });
process.exit(0);
`,
    );
    chmodSync(noMp4Shim, 0o755);
    await provider.initialize({
      id: 'avatar-sadtalker',
      capability: 'avatar',
      enabled: true,
      priority: 10,
      options: { pythonCommand: 'node', scriptPath: noMp4Shim, storage },
    });

    await expect(
      collectFinalOutput(
        provider.generate(
          {
            avatarRef: { image: { storageKey: 'img.png', contentType: 'image/png' } },
            drivingAudio: { storageKey: 'audio.wav', contentType: 'audio/wav' },
            resolution: { width: 1920, height: 1080 },
          },
          {},
        ),
      ),
    ).rejects.toThrow(/no \.mp4 produced/);
  });
});
