import { mkdtempSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  CliRunner,
  type AIProvider,
  type AvatarInput,
  type AvatarOutput,
  type CapabilityDescriptor,
  type GenerationContext,
  type HealthStatus,
  type ProviderConfig,
  type ProviderEvent,
} from '@surfgen/ai-sdk';
import { ConfigurationError, ProviderError, type MediaRef, type StoragePort } from '@surfgen/core';
import { definePlugin } from '@surfgen/plugin-sdk';
import manifest from '../plugin.manifest.json' with { type: 'json' };

interface SadTalkerOptions {
  /** Interpreter to invoke the script with. */
  pythonCommand?: string;
  /** Absolute path to SadTalker's inference.py — required, no sane default. */
  scriptPath: string;
  /** Optional --checkpoint_dir override if not colocated with the script. */
  checkpointDir?: string;
  /** Injected by the host so outputs land in platform storage. */
  storage?: StoragePort;
  /** Storage key prefix for generated video. */
  keyPrefix?: string;
}

/** Downloads a MediaRef to a local file; returns the path. */
async function materialize(storage: StoragePort, ref: MediaRef, targetPath: string): Promise<string> {
  const stream = await storage.get(ref.storageKey);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  await writeFile(targetPath, Buffer.concat(chunks));
  return targetPath;
}

/**
 * SadTalker timestamps a subdirectory under --result_dir and moves the final
 * video there; the exact filename isn't predictable ahead of time, so find
 * the newest .mp4 anywhere under resultDir rather than parsing stdout.
 */
async function newestMp4(resultDir: string): Promise<string> {
  const found: { path: string; mtimeMs: number }[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name.endsWith('.mp4')) {
        found.push({ path: full, mtimeMs: (await stat(full)).mtimeMs });
      }
    }
  }
  await walk(resultDir);
  if (found.length === 0) {
    throw new ProviderError('avatar-sadtalker', `no .mp4 produced under ${resultDir}`);
  }
  found.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return found[0]!.path;
}

/**
 * SadTalker via CLI: local, GPU-recommended (CPU works but is slow), photo +
 * audio in, talking-head video out. See README.md for the licensing caveat on
 * required third-party checkpoints before enabling this in production.
 */
export class SadTalkerAvatarProvider implements AIProvider<AvatarInput, AvatarOutput> {
  readonly id: string;
  readonly capability = 'avatar' as const;
  private options!: SadTalkerOptions;

  constructor(id = 'avatar-sadtalker') {
    this.id = id;
  }

  async initialize(config: ProviderConfig): Promise<void> {
    this.options = config.options as unknown as SadTalkerOptions;
    if (!this.options.scriptPath) {
      throw new ConfigurationError('avatar-sadtalker requires options.scriptPath (path to inference.py)');
    }
  }

  async health(): Promise<HealthStatus> {
    const runner = new CliRunner({
      command: this.options.pythonCommand ?? 'python3',
      args: [this.options.scriptPath, '--help'],
      healthArgs: [this.options.scriptPath, '--help'],
    });
    const result = await runner.healthCheck();
    return { ...result, checkedAt: new Date() };
  }

  capabilities(): CapabilityDescriptor {
    return {
      capability: 'avatar',
      displayName: 'SadTalker (local)',
      deployment: 'local',
      streaming: false,
      languages: [],
      inputFormats: ['image/png', 'image/jpeg', 'audio/wav'],
      outputFormats: ['video/mp4'],
      costHint: { unit: 'render', amount: 1, currency: 'USD' },
      features: { offline: true },
    };
  }

  async *generate(
    input: AvatarInput,
    context: GenerationContext,
  ): AsyncIterable<ProviderEvent<AvatarOutput>> {
    if (!('image' in input.avatarRef)) {
      throw new ProviderError('avatar-sadtalker', 'requires a resolved source image, not a bare avatarId');
    }
    const storage = this.options.storage;
    if (!storage) throw new ConfigurationError('avatar-sadtalker requires options.storage to be injected');

    const workDir = mkdtempSync(join(tmpdir(), 'surfgen-sadtalker-'));
    const resultDir = join(workDir, 'results');
    await mkdir(resultDir, { recursive: true });

    try {
      yield { type: 'progress', percent: 5, message: 'preparing inputs' };
      const sourceImagePath = await materialize(storage, input.avatarRef.image, join(workDir, 'source.png'));
      const drivenAudioPath = await materialize(storage, input.drivingAudio, join(workDir, 'audio.wav'));

      yield { type: 'progress', percent: 15, message: 'animating face' };
      const runner = new CliRunner({
        command: this.options.pythonCommand ?? 'python3',
        args: [
          this.options.scriptPath,
          '--source_image', sourceImagePath,
          '--driven_audio', drivenAudioPath,
          '--result_dir', resultDir,
          '--still',
          '--preprocess', 'full',
          '--size', input.resolution.width >= 512 ? '512' : '256',
          ...(this.options.checkpointDir ? ['--checkpoint_dir', this.options.checkpointDir] : []),
        ],
      });
      await runner.invoke({ payload: undefined, ...(context.signal && { signal: context.signal }) });

      yield { type: 'progress', percent: 85, message: 'storing video' };
      const resultFile = await newestMp4(resultDir);
      const bytes = await readFile(resultFile);
      const key = `${this.options.keyPrefix ?? 'avatar/sadtalker'}/${randomUUID()}.mp4`;
      await storage.put(key, new Uint8Array(bytes), { contentType: 'video/mp4' });

      yield {
        type: 'output',
        final: true,
        data: { video: { storageKey: key, contentType: 'video/mp4' }, hasAlpha: false },
      };
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  async shutdown(): Promise<void> {}
}

export default definePlugin({
  manifest,
  register: async (registry, options) => {
    const provider = new SadTalkerAvatarProvider();
    await provider.initialize({
      id: 'avatar-sadtalker',
      capability: 'avatar',
      enabled: true,
      priority: (options.priority as number) ?? 10,
      options,
    });
    registry.register(provider, { priority: (options.priority as number) ?? 10 });
  },
});
