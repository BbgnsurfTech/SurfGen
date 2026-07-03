import { spawn } from 'node:child_process';
import { ProviderError } from '@surfgen/core';
import type { Runner, RunnerRequest, RunnerResponse } from './runner.js';

export interface CliRunnerConfig {
  readonly command: string;
  /** Static args; use {placeholders} resolved from the payload object. */
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  /** Write JSON payload to stdin instead of interpolating args. */
  readonly stdinPayload?: boolean;
  readonly defaultTimeoutMs?: number;
  /** Health probe: `command healthArgs` must exit 0. Defaults to --version. */
  readonly healthArgs?: readonly string[];
}

const DEFAULT_TIMEOUT_MS = 600_000; // local model runs can be long
const MAX_BUFFER_BYTES = 512 * 1024 * 1024;

/**
 * Runs local executables (piper, ffmpeg, whisper, custom python scripts).
 * Docker providers reuse this with command = "docker" and templated args.
 * Placeholders: args like "--text={text}" are substituted from payload keys —
 * values are passed as discrete argv entries, never through a shell.
 */
export class CliRunner implements Runner {
  readonly kind = 'cli' as const;

  constructor(private readonly config: CliRunnerConfig) {}

  private resolveArgs(payload: unknown): string[] {
    const source = (payload ?? {}) as Record<string, unknown>;
    return this.config.args.map((arg) =>
      arg.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key: string) => {
        const value = source[key];
        if (value === undefined || value === null) {
          throw new ProviderError('cli-runner', `missing payload key '${key}' for arg template`, {
            retryable: false,
          });
        }
        return String(value);
      }),
    );
  }

  async invoke(request: RunnerRequest): Promise<RunnerResponse> {
    const args = this.resolveArgs(request.payload);
    const timeoutMs = request.timeoutMs ?? this.config.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;

    return new Promise<RunnerResponse>((resolve, reject) => {
      const child = spawn(this.config.command, args, {
        cwd: this.config.cwd,
        env: { ...process.env, ...this.config.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let stdoutBytes = 0;
      let settled = false;

      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        child.kill('SIGKILL');
        reject(error);
      };

      const timer = setTimeout(
        () =>
          fail(
            new ProviderError('cli-runner', `${this.config.command} timed out after ${timeoutMs}ms`),
          ),
        timeoutMs,
      );

      request.signal?.addEventListener('abort', () =>
        fail(new ProviderError('cli-runner', 'aborted', { retryable: false })),
      );

      child.stdout.on('data', (chunk: Buffer) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes > MAX_BUFFER_BYTES) {
          fail(new ProviderError('cli-runner', 'stdout exceeded buffer limit', { retryable: false }));
          return;
        }
        stdout.push(chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));

      child.on('error', (cause) =>
        fail(new ProviderError('cli-runner', `failed to spawn ${this.config.command}`, { cause })),
      );

      child.on('close', (code) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        if (code !== 0) {
          reject(
            new ProviderError(
              'cli-runner',
              `${this.config.command} exited ${code}: ${Buffer.concat(stderr).toString('utf8').slice(0, 4096)}`,
            ),
          );
          return;
        }
        const raw = new Uint8Array(Buffer.concat(stdout));
        const text = Buffer.from(raw).toString('utf8');
        let body: unknown;
        try {
          body = JSON.parse(text);
        } catch {
          body = text.length > 0 && raw.length < 1024 * 1024 ? text : null;
        }
        resolve({ body, raw });
      });

      if (this.config.stdinPayload) {
        child.stdin.write(JSON.stringify(request.payload));
      }
      child.stdin.end();
    });
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs?: number; reason?: string }> {
    const started = Date.now();
    return new Promise((resolve) => {
      const child = spawn(this.config.command, [...(this.config.healthArgs ?? ['--version'])], {
        stdio: 'ignore',
      });
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve({ healthy: false, reason: 'health probe timeout' });
      }, 5_000);
      child.on('error', (cause) => {
        clearTimeout(timer);
        resolve({ healthy: false, reason: String(cause) });
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({
          healthy: code === 0,
          latencyMs: Date.now() - started,
          reason: code === 0 ? undefined : `exit ${code}`,
        });
      });
    });
  }

  async dispose(): Promise<void> {
    // per-invocation processes; nothing persistent
  }
}
