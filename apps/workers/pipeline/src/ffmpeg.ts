import { spawn } from 'node:child_process';
import { PipelineError } from '@surfgen/core';

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

/** Run ffmpeg/ffprobe with args (no shell). Rejects with stderr tail on failure. */
export function runFfmpeg(
  args: string[],
  options: { binary?: string; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<string> {
  const binary = options.binary ?? 'ffmpeg';
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const output: Buffer[] = [];
    const errors: Buffer[] = [];
    let settled = false;

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(error);
    };

    const timer = setTimeout(
      () => fail(new PipelineError('render', `${binary} timed out`)),
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
    options.signal?.addEventListener('abort', () =>
      fail(new PipelineError('render', 'cancelled')),
    );

    child.stdout.on('data', (chunk: Buffer) => output.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => errors.push(chunk));
    child.on('error', (cause) =>
      fail(new PipelineError('render', `failed to spawn ${binary}: ${String(cause)}`)),
    );
    child.on('close', (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (code === 0) {
        resolve(Buffer.concat(output).toString('utf8'));
      } else {
        reject(
          new PipelineError(
            'render',
            `${binary} exited ${code}: ${Buffer.concat(errors).toString('utf8').slice(-2048)}`,
          ),
        );
      }
    });
  });
}

/** Media duration in milliseconds via ffprobe. */
export async function probeDurationMs(filePath: string): Promise<number> {
  const output = await runFfmpeg(
    ['-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath],
    { binary: 'ffprobe', timeoutMs: 30_000 },
  );
  const seconds = Number.parseFloat(output.trim());
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : 0;
}

export async function isFfmpegAvailable(): Promise<boolean> {
  try {
    await runFfmpeg(['-version'], { timeoutMs: 5_000 });
    return true;
  } catch {
    return false;
  }
}
