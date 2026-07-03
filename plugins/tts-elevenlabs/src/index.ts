import { randomUUID } from 'node:crypto';
import {
  HttpRunner,
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
import { ProviderError } from '@surfgen/core';
import { definePlugin, resolveSecrets } from '@surfgen/plugin-sdk';
import manifest from '../plugin.manifest.json' with { type: 'json' };

interface ElevenLabsOptions {
  baseUrl?: string;
  modelId?: string;
  secrets?: Record<string, string>;
  storage?: StoragePort;
  keyPrefix?: string;
}

const DEFAULT_BASE_URL = 'https://api.elevenlabs.io';
const DEFAULT_MODEL = 'eleven_multilingual_v2';

export class ElevenLabsTTSProvider implements AIProvider<TTSInput, TTSOutput> {
  readonly id: string;
  readonly capability = 'tts' as const;
  private options!: ElevenLabsOptions;
  private apiKey = '';
  private fetchImpl: typeof fetch | undefined;

  constructor(id = 'tts-elevenlabs', fetchImpl?: typeof fetch) {
    this.id = id;
    this.fetchImpl = fetchImpl;
  }

  async initialize(config: ProviderConfig): Promise<void> {
    this.options = config.options as ElevenLabsOptions;
    const secrets = resolveSecrets(this.options.secrets);
    if (!secrets.apiKey) {
      throw new ProviderError(this.id, 'secrets.apiKey required (e.g. "env:ELEVENLABS_API_KEY")', {
        retryable: false,
      });
    }
    this.apiKey = secrets.apiKey;
  }

  async health(): Promise<HealthStatus> {
    const runner = this.makeRunner('/v1/user', 'GET');
    const result = await runner.healthCheck();
    return { ...result, checkedAt: new Date() };
  }

  capabilities(): CapabilityDescriptor {
    return {
      capability: 'tts',
      displayName: `ElevenLabs (${this.options.modelId ?? DEFAULT_MODEL})`,
      deployment: 'cloud',
      streaming: true,
      languages: [], // multilingual — language-agnostic
      inputFormats: ['text', 'ssml'],
      outputFormats: ['mp3', 'pcm'],
      costHint: { unit: '1k chars', amount: 0.3, currency: 'USD' },
      features: { voiceCloning: true, emotions: true, ssml: true },
    };
  }

  private makeRunner(path: string, method: 'GET' | 'POST' = 'POST'): HttpRunner {
    return new HttpRunner({
      baseUrl: this.options.baseUrl ?? DEFAULT_BASE_URL,
      path,
      method,
      headers: { 'xi-api-key': this.apiKey },
      healthPath: '/v1/user',
      binaryResponse: method === 'POST',
      ...(this.fetchImpl && { fetchImpl: this.fetchImpl }),
    });
  }

  async *generate(
    input: TTSInput,
    context: GenerationContext,
  ): AsyncIterable<ProviderEvent<TTSOutput>> {
    yield { type: 'progress', percent: 10, message: 'requesting synthesis' };

    const runner = this.makeRunner(`/v1/text-to-speech/${encodeURIComponent(input.voiceId)}`);
    const response = await runner.invoke({
      payload: {
        text: input.text,
        model_id: this.options.modelId ?? DEFAULT_MODEL,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          ...(input.speed !== undefined && { speed: input.speed }),
          ...(input.emotion !== undefined && { style: 0.4 }),
        },
      },
      ...(context.signal && { signal: context.signal }),
    });

    const audio = response.raw;
    if (!audio || audio.length === 0) {
      throw new ProviderError(this.id, 'empty audio response');
    }
    context.recordUsage?.('tts.characters', input.text.length);

    yield { type: 'progress', percent: 70, message: 'storing audio' };
    const storage = this.options.storage;
    if (storage) {
      const key = `${this.options.keyPrefix ?? 'tts/elevenlabs'}/${randomUUID()}.mp3`;
      await storage.put(key, audio, { contentType: 'audio/mpeg' });
      yield {
        type: 'output',
        final: true,
        data: { audio: { storageKey: key, contentType: 'audio/mpeg', sizeBytes: audio.length } },
      };
    } else {
      yield {
        type: 'output',
        final: true,
        data: {
          audio: {
            storageKey: `inline:${Buffer.from(audio).toString('base64').slice(0, 64)}…`,
            contentType: 'audio/mpeg',
            sizeBytes: audio.length,
          },
        },
      };
    }
  }

  async shutdown(): Promise<void> {
    // stateless HTTP provider
  }
}

export default definePlugin({
  manifest,
  register: async (registry, options) => {
    const provider = new ElevenLabsTTSProvider();
    await provider.initialize({
      id: 'tts-elevenlabs',
      capability: 'tts',
      enabled: true,
      priority: (options.priority as number) ?? 20,
      options,
    });
    registry.register(provider, { priority: (options.priority as number) ?? 20 });
  },
});
