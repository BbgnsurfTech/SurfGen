import { ProviderError } from '@surfgen/core';
import type { Runner, RunnerRequest, RunnerResponse } from './runner.js';

export interface HttpRunnerConfig {
  readonly baseUrl: string;
  readonly path?: string;
  readonly method?: 'GET' | 'POST' | 'PUT';
  readonly headers?: Readonly<Record<string, string>>;
  readonly healthPath?: string;
  readonly defaultTimeoutMs?: number;
  /** Response is binary (audio/video) rather than JSON. */
  readonly binaryResponse?: boolean;
  readonly fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 120_000;

/** Reaches cloud APIs and local HTTP model servers (Ollama, vLLM, ComfyUI…). */
export class HttpRunner implements Runner {
  readonly kind = 'http' as const;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: HttpRunnerConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async invoke(request: RunnerRequest): Promise<RunnerResponse> {
    const url = new URL(this.config.path ?? '/', this.config.baseUrl).toString();
    const timeoutMs = request.timeoutMs ?? this.config.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = request.signal
      ? AbortSignal.any([request.signal, timeoutSignal])
      : timeoutSignal;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: this.config.method ?? 'POST',
        headers: { 'content-type': 'application/json', ...this.config.headers },
        body:
          (this.config.method ?? 'POST') === 'GET' ? undefined : JSON.stringify(request.payload),
        signal,
      });
    } catch (cause) {
      throw new ProviderError('http-runner', `request to ${url} failed: ${String(cause)}`, {
        cause,
      });
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new ProviderError('http-runner', `HTTP ${response.status} from ${url}: ${text}`, {
        retryable: response.status >= 500 || response.status === 429,
        details: { status: response.status },
      });
    }

    if (this.config.binaryResponse) {
      const raw = new Uint8Array(await response.arrayBuffer());
      return { body: null, raw };
    }
    return { body: await response.json() };
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs?: number; reason?: string }> {
    const url = new URL(this.config.healthPath ?? '/', this.config.baseUrl).toString();
    const started = Date.now();
    try {
      const response = await this.fetchImpl(url, {
        method: 'GET',
        signal: AbortSignal.timeout(5_000),
      });
      return {
        healthy: response.ok,
        latencyMs: Date.now() - started,
        reason: response.ok ? undefined : `HTTP ${response.status}`,
      };
    } catch (cause) {
      return { healthy: false, reason: String(cause) };
    }
  }

  async dispose(): Promise<void> {
    // stateless
  }
}
