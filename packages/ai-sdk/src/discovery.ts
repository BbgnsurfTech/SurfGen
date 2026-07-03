import { spawn } from 'node:child_process';
import type { Capability } from './capability.js';

/**
 * Automatic local model runtime discovery. Probes well-known endpoints and
 * binaries; discovered runtimes register providers without any configuration.
 */
export interface DiscoveredRuntime {
  readonly id: string;
  readonly kind: 'http' | 'cli';
  readonly capability: Capability | 'multi';
  readonly endpoint?: string;
  readonly command?: string;
  /** Models the runtime reports (Ollama tags, ComfyUI checkpoints, …). */
  readonly models: readonly string[];
}

export interface HttpProbe {
  readonly id: string;
  readonly capability: Capability | 'multi';
  readonly endpoint: string;
  readonly healthPath: string;
  /** Optional endpoint returning available models. */
  readonly modelsPath?: string;
  readonly extractModels?: (body: unknown) => string[];
}

export interface CliProbe {
  readonly id: string;
  readonly capability: Capability | 'multi';
  readonly command: string;
  readonly versionArgs: readonly string[];
}

export const DEFAULT_HTTP_PROBES: readonly HttpProbe[] = [
  {
    id: 'ollama',
    capability: 'llm',
    endpoint: 'http://127.0.0.1:11434',
    healthPath: '/api/version',
    modelsPath: '/api/tags',
    extractModels: (body) =>
      ((body as { models?: { name: string }[] })?.models ?? []).map((m) => m.name),
  },
  {
    id: 'lm-studio',
    capability: 'llm',
    endpoint: 'http://127.0.0.1:1234',
    healthPath: '/v1/models',
    modelsPath: '/v1/models',
    extractModels: (body) => ((body as { data?: { id: string }[] })?.data ?? []).map((m) => m.id),
  },
  {
    id: 'vllm',
    capability: 'llm',
    endpoint: 'http://127.0.0.1:8000',
    healthPath: '/health',
    modelsPath: '/v1/models',
    extractModels: (body) => ((body as { data?: { id: string }[] })?.data ?? []).map((m) => m.id),
  },
  {
    id: 'comfyui',
    capability: 'image_generation',
    endpoint: 'http://127.0.0.1:8188',
    healthPath: '/system_stats',
  },
  {
    id: 'a1111',
    capability: 'image_generation',
    endpoint: 'http://127.0.0.1:7860',
    healthPath: '/sdapi/v1/sd-models',
    modelsPath: '/sdapi/v1/sd-models',
    extractModels: (body) =>
      ((body as { model_name: string }[]) ?? []).map((m) => m.model_name),
  },
  {
    id: 'triton',
    capability: 'multi',
    endpoint: 'http://127.0.0.1:8001',
    healthPath: '/v2/health/ready',
  },
  {
    id: 'torchserve',
    capability: 'multi',
    endpoint: 'http://127.0.0.1:8080',
    healthPath: '/ping',
  },
];

export const DEFAULT_CLI_PROBES: readonly CliProbe[] = [
  { id: 'ffmpeg', capability: 'multi', command: 'ffmpeg', versionArgs: ['-version'] },
  { id: 'whisper', capability: 'asr', command: 'whisper', versionArgs: ['--help'] },
  { id: 'piper', capability: 'tts', command: 'piper', versionArgs: ['--help'] },
];

export interface DiscoveryOptions {
  readonly httpProbes?: readonly HttpProbe[];
  readonly cliProbes?: readonly CliProbe[];
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

const PROBE_TIMEOUT_MS = 1_500;

export class ModelDiscoveryService {
  private readonly httpProbes: readonly HttpProbe[];
  private readonly cliProbes: readonly CliProbe[];
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: DiscoveryOptions = {}) {
    this.httpProbes = options.httpProbes ?? DEFAULT_HTTP_PROBES;
    this.cliProbes = options.cliProbes ?? DEFAULT_CLI_PROBES;
    this.timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** Probe everything concurrently; absent runtimes are simply omitted. */
  async discover(): Promise<DiscoveredRuntime[]> {
    const results = await Promise.all([
      ...this.httpProbes.map((probe) => this.probeHttp(probe)),
      ...this.cliProbes.map((probe) => this.probeCli(probe)),
    ]);
    return results.filter((runtime): runtime is DiscoveredRuntime => runtime !== null);
  }

  private async probeHttp(probe: HttpProbe): Promise<DiscoveredRuntime | null> {
    try {
      const health = await this.fetchImpl(`${probe.endpoint}${probe.healthPath}`, {
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!health.ok) return null;

      let models: string[] = [];
      if (probe.modelsPath && probe.extractModels) {
        try {
          const response = await this.fetchImpl(`${probe.endpoint}${probe.modelsPath}`, {
            signal: AbortSignal.timeout(this.timeoutMs),
          });
          if (response.ok) models = probe.extractModels(await response.json());
        } catch {
          // models endpoint is best-effort
        }
      }
      return {
        id: probe.id,
        kind: 'http',
        capability: probe.capability,
        endpoint: probe.endpoint,
        models,
      };
    } catch {
      return null;
    }
  }

  private probeCli(probe: CliProbe): Promise<DiscoveredRuntime | null> {
    return new Promise((resolve) => {
      const child = spawn(probe.command, [...probe.versionArgs], { stdio: 'ignore' });
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve(null);
      }, this.timeoutMs);
      child.on('error', () => {
        clearTimeout(timer);
        resolve(null);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve(
          code === 0
            ? {
                id: probe.id,
                kind: 'cli',
                capability: probe.capability,
                command: probe.command,
                models: [],
              }
            : null,
        );
      });
    });
  }
}
