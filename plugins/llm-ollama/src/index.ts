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
import { definePlugin } from '@surfgen/plugin-sdk';
import manifest from '../plugin.manifest.json' with { type: 'json' };

interface OllamaOptions {
  baseUrl?: string;
  model?: string;
}

interface OllamaChatResponse {
  message?: { content?: string };
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'llama3.1';

export class OllamaLLMProvider implements AIProvider<LLMInput, LLMOutput> {
  readonly id: string;
  readonly capability = 'llm' as const;
  private runner!: HttpRunner;
  private model = DEFAULT_MODEL;
  private fetchImpl: typeof fetch | undefined;

  constructor(id = 'llm-ollama', fetchImpl?: typeof fetch) {
    this.id = id;
    this.fetchImpl = fetchImpl;
  }

  async initialize(config: ProviderConfig): Promise<void> {
    const options = config.options as OllamaOptions;
    this.model = options.model ?? DEFAULT_MODEL;
    this.runner = new HttpRunner({
      baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
      path: '/api/chat',
      healthPath: '/api/version',
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
      displayName: `Ollama (${this.model})`,
      deployment: 'local',
      streaming: false,
      languages: [],
      inputFormats: ['text'],
      outputFormats: ['text'],
      features: { json: true },
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
        stream: false,
        options: {
          ...(input.temperature !== undefined && { temperature: input.temperature }),
          ...(input.maxTokens !== undefined && { num_predict: input.maxTokens }),
        },
        ...(input.jsonSchema && { format: input.jsonSchema }),
      },
      ...(context.signal && { signal: context.signal }),
    });

    const body = response.body as OllamaChatResponse;
    const promptTokens = body.prompt_eval_count ?? 0;
    const completionTokens = body.eval_count ?? 0;
    context.recordUsage?.('llm.tokens', promptTokens + completionTokens);

    yield {
      type: 'output',
      final: true,
      data: {
        text: body.message?.content ?? '',
        finishReason: body.done_reason === 'length' ? 'length' : 'stop',
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
    const provider = new OllamaLLMProvider();
    await provider.initialize({
      id: 'llm-ollama',
      capability: 'llm',
      enabled: true,
      priority: (options.priority as number) ?? 10,
      options,
    });
    registry.register(provider, { priority: (options.priority as number) ?? 10 });
  },
});
