import {
  HttpRunner,
  type AIProvider,
  type CapabilityDescriptor,
  type GenerationContext,
  type HealthStatus,
  type ProviderConfig,
  type ProviderEvent,
  type TranslationInput,
  type TranslationOutput,
} from '@surfgen/ai-sdk';
import { ProviderError } from '@surfgen/core';
import { definePlugin, resolveSecrets } from '@surfgen/plugin-sdk';
import manifest from '../plugin.manifest.json' with { type: 'json' };

interface DeepLOptions {
  baseUrl?: string; // api-free.deepl.com for free tier
  secrets?: Record<string, string>;
}

interface DeepLResponse {
  translations?: { text: string; detected_source_language?: string }[];
}

const DEFAULT_BASE_URL = 'https://api.deepl.com';

export class DeepLTranslationProvider implements AIProvider<TranslationInput, TranslationOutput> {
  readonly id: string;
  readonly capability = 'translation' as const;
  private runner!: HttpRunner;
  private fetchImpl: typeof fetch | undefined;

  constructor(id = 'translation-deepl', fetchImpl?: typeof fetch) {
    this.id = id;
    this.fetchImpl = fetchImpl;
  }

  async initialize(config: ProviderConfig): Promise<void> {
    const options = config.options as DeepLOptions;
    const secrets = resolveSecrets(options.secrets);
    if (!secrets.apiKey) {
      throw new ProviderError(this.id, 'secrets.apiKey required (e.g. "env:DEEPL_API_KEY")', {
        retryable: false,
      });
    }
    this.runner = new HttpRunner({
      baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
      path: '/v2/translate',
      healthPath: '/v2/usage',
      headers: { authorization: `DeepL-Auth-Key ${secrets.apiKey}` },
      ...(this.fetchImpl && { fetchImpl: this.fetchImpl }),
    });
  }

  async health(): Promise<HealthStatus> {
    const result = await this.runner.healthCheck();
    return { ...result, checkedAt: new Date() };
  }

  capabilities(): CapabilityDescriptor {
    return {
      capability: 'translation',
      displayName: 'DeepL',
      deployment: 'cloud',
      streaming: false,
      languages: ['en', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'ru', 'ja', 'zh', 'ko'],
      inputFormats: ['text'],
      outputFormats: ['text'],
      costHint: { unit: '1M chars', amount: 25, currency: 'USD' },
      features: { formality: true },
    };
  }

  async *generate(
    input: TranslationInput,
    context: GenerationContext,
  ): AsyncIterable<ProviderEvent<TranslationOutput>> {
    const response = await this.runner.invoke({
      payload: {
        text: [input.text],
        target_lang: input.targetLanguage.toUpperCase(),
        ...(input.sourceLanguage && { source_lang: input.sourceLanguage.toUpperCase() }),
        ...(input.formality &&
          input.formality !== 'default' && {
            formality: input.formality === 'formal' ? 'more' : 'less',
          }),
      },
      ...(context.signal && { signal: context.signal }),
    });

    const body = response.body as DeepLResponse;
    const translation = body.translations?.[0];
    if (!translation) throw new ProviderError(this.id, 'empty translation response');
    context.recordUsage?.('translation.characters', input.text.length);

    yield {
      type: 'output',
      final: true,
      data: {
        text: translation.text,
        ...(translation.detected_source_language && {
          detectedSourceLanguage: translation.detected_source_language.toLowerCase(),
        }),
      },
    };
  }

  async shutdown(): Promise<void> {
    await this.runner?.dispose();
  }
}

export default definePlugin({
  manifest,
  register: async (registry, options) => {
    const provider = new DeepLTranslationProvider();
    await provider.initialize({
      id: 'translation-deepl',
      capability: 'translation',
      enabled: true,
      priority: (options.priority as number) ?? 20,
      options,
    });
    registry.register(provider, { priority: (options.priority as number) ?? 20 });
  },
});
