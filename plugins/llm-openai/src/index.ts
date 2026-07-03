import {
  HttpRunner,
  type AIProvider,
  type CapabilityDescriptor,
  type GenerationContext,
  type HealthStatus,
  type LLMInput,
  type LLMOutput,
  type ProviderConfig,
  type ProviderEvent,
} from '@surfgen/ai-sdk';
import { definePlugin, resolveSecrets } from '@surfgen/plugin-sdk';
import manifest from '../plugin.manifest.json' with { type: 'json' };

interface OpenAIOptions {
  baseUrl?: string;
  model?: string;
  secrets?: Record<string, string>;
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

const DEFAULT_BASE_URL = 'https://api.openai.com';
const DEFAULT_MODEL = 'gpt-4o-mini';

export class OpenAILLMProvider implements AIProvider<LLMInput, LLMOutput> {
  readonly id: string;
  readonly capability = 'llm' as const;
  private runner!: HttpRunner;
  private model = DEFAULT_MODEL;
  private fetchImpl: typeof fetch | undefined;

  constructor(id = 'llm-openai', fetchImpl?: typeof fetch) {
    this.id = id;
    this.fetchImpl = fetchImpl;
  }

  async initialize(config: ProviderConfig): Promise<void> {
    const options = config.options as OpenAIOptions;
    const secrets = resolveSecrets(options.secrets);
    const apiKey = secrets.apiKey;
    if (!apiKey) {
      throw new Error(`${this.id}: secrets.apiKey is required (e.g. "env:OPENAI_API_KEY")`);
    }
    this.model = options.model ?? DEFAULT_MODEL;
    this.runner = new HttpRunner({
      baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
      path: '/v1/chat/completions',
      healthPath: '/v1/models',
      headers: { authorization: `Bearer ${apiKey}` },
      ...(this.fetchImpl && { fetchImpl: this.fetchImpl }),
    });
  }

  async health(): Promise<HealthStatus> {
    const result = await this.runner.healthCheck();
    return { ...result, checkedAt: new Date() };
  }

  capabilities(): CapabilityDescriptor {
    return {
      capability: 'llm',
      displayName: `OpenAI (${this.model})`,
      deployment: 'cloud',
      streaming: false,
      languages: [],
      inputFormats: ['text'],
      outputFormats: ['text'],
      costHint: { unit: '1M tokens', amount: 0.6, currency: 'USD' },
      features: { json: true, functions: true },
    };
  }

  async *generate(
    input: LLMInput,
    context: GenerationContext,
  ): AsyncIterable<ProviderEvent<LLMOutput>> {
    const response = await this.runner.invoke({
      payload: {
        model: this.model,
        messages: input.messages,
        ...(input.temperature !== undefined && { temperature: input.temperature }),
        ...(input.maxTokens !== undefined && { max_tokens: input.maxTokens }),
        ...(input.jsonSchema && {
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'output', schema: input.jsonSchema },
          },
        }),
      },
      ...(context.signal && { signal: context.signal }),
    });

    const body = response.body as ChatCompletionResponse;
    const choice = body.choices?.[0];
    const promptTokens = body.usage?.prompt_tokens ?? 0;
    const completionTokens = body.usage?.completion_tokens ?? 0;
    context.recordUsage?.('llm.tokens', promptTokens + completionTokens);

    yield {
      type: 'output',
      final: true,
      data: {
        text: choice?.message?.content ?? '',
        finishReason:
          choice?.finish_reason === 'length'
            ? 'length'
            : choice?.finish_reason === 'content_filter'
              ? 'content_filter'
              : 'stop',
        usage: { promptTokens, completionTokens },
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
    const provider = new OpenAILLMProvider();
    await provider.initialize({
      id: 'llm-openai',
      capability: 'llm',
      enabled: true,
      priority: (options.priority as number) ?? 20,
      options,
    });
    registry.register(provider, { priority: (options.priority as number) ?? 20 });
  },
});
