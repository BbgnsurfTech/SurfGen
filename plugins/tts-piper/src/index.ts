import { mkdirSync } from 'node:fs';
import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  CliRunner,
  type AIProvider,
  type CapabilityDescriptor,
  type GenerationContext,
  type HealthStatus,
  type ProviderConfig,
  type ProviderEvent,
  type TTSInput,
  type TTSOutput,
} from '@surfgen/ai-sdk';
import type { StoragePort } from '@surfgen/core';
import { definePlugin } from '@surfgen/plugin-sdk';
import manifest from '../plugin.manifest.json' with { type: 'json' };

interface PiperOptions {
  command?: string;
  modelPath?: string;
  /** Injected by the host so outputs land in platform storage. */
  storage?: StoragePort;
  /** Storage key prefix for generated audio. */
  keyPrefix?: string;
}

/**
 * Piper TTS via CLI: fully offline, CPU-only, permissively licensed — the
 * reference local voice provider. Audio is written to a temp wav, uploaded
 * through the StoragePort, and referenced by key.
 */
export class PiperTTSProvider implements AIProvider<TTSInput, TTSOutput> {
  readonly id: string;
  readonly capability = 'tts' as const;
  private runner!: CliRunner;
  private options!: PiperOptions;

  constructor(id = 'tts-piper') {
    this.id = id;
  }

  async initialize(config: ProviderConfig): Promise<void> {
    this.options = config.options as PiperOptions;
    const command = this.options.command ?? 'piper';
    this.runner = new CliRunner({
      command,
      args: ['--model', '{model}', '--output_file', '{outputFile}'],
      stdinPayload: false,
      healthArgs: ['--help'],
    });
  }

  async health(): Promise<HealthStatus> {
    const result = await this.runner.healthCheck();
    return { ...result, checkedAt: new Date() };
  }

  capabilities(): CapabilityDescriptor {
    return {
      capability: 'tts',
      displayName: 'Piper (local ONNX)',
      deployment: 'local',
      streaming: false,
      languages: ['en-US', 'en-GB', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'ru', 'zh'],
      inputFormats: ['text'],
      outputFormats: ['wav'],
      costHint: { unit: '1k chars', amount: 0, currency: 'USD' },
      features: { offline: true },
    };
  }

  async *generate(
    input: TTSInput,
    context: GenerationContext,
  ): AsyncIterable<ProviderEvent<TTSOutput>> {
    const model = this.options.modelPath ?? input.voiceId;
    const workDir = join(tmpdir(), 'surfgen-piper');
    mkdirSync(workDir, { recursive: true });
    const outputFile = join(workDir, `${randomUUID()}.wav`);

    yield { type: 'progress', percent: 5, message: 'synthesizing' };

    try {
      // Piper reads text on stdin; CliRunner streams payload JSON only when
      // stdinPayload is set, so we pass text through a dedicated runner call.
      const runner = new CliRunner({
        command: this.options.command ?? 'piper',
        args: ['--model', model, '--output_file', outputFile],
        stdinPayload: true,
        healthArgs: ['--help'],
      });
      await runner.invoke({
        payload: input.text,
        ...(context.signal && { signal: context.signal }),
      });

      yield { type: 'progress', percent: 70, message: 'storing audio' };
      const audioBytes = await readFile(outputFile);
      context.recordUsage?.('tts.characters', input.text.length);

      const storage = this.options.storage;
      if (storage) {
        const key = `${this.options.keyPrefix ?? 'tts/piper'}/${randomUUID()}.wav`;
        await storage.put(key, new Uint8Array(audioBytes), { contentType: 'audio/wav' });
        yield {
          type: 'output',
          final: true,
          data: { audio: { storageKey: key, contentType: 'audio/wav', sizeBytes: audioBytes.length } },
        };
      } else {
        // No storage injected (unit tests): return the local file path as key.
        yield {
          type: 'output',
          final: true,
          data: {
            audio: { storageKey: outputFile, contentType: 'audio/wav', sizeBytes: audioBytes.length },
          },
        };
      }
    } finally {
      if (this.options.storage) await unlink(outputFile).catch(() => {});
    }
  }

  async shutdown(): Promise<void> {
    await this.runner?.dispose();
  }
}

export default definePlugin({
  manifest,
  register: async (registry, options) => {
    const provider = new PiperTTSProvider();
    await provider.initialize({
      id: 'tts-piper',
      capability: 'tts',
      enabled: true,
      priority: (options.priority as number) ?? 10,
      options,
    });
    registry.register(provider, { priority: (options.priority as number) ?? 10 });
  },
});
