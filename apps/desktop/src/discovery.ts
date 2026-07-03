/**
 * Local AI runtime detection for the desktop shell.
 *
 * Mirrors the probe list in @surfgen/ai-sdk's ModelDiscoveryService, but kept
 * dependency-free: the desktop process only needs ids + display names to tell
 * the studio which local providers this machine can serve.
 */

export interface RuntimeProbe {
  readonly id: string;
  readonly label: string;
  readonly url: string;
}

export const LOCAL_RUNTIME_PROBES: readonly RuntimeProbe[] = [
  { id: 'ollama', label: 'Ollama', url: 'http://127.0.0.1:11434/api/tags' },
  { id: 'lmstudio', label: 'LM Studio', url: 'http://127.0.0.1:1234/v1/models' },
  { id: 'vllm', label: 'vLLM', url: 'http://127.0.0.1:8000/v1/models' },
  { id: 'comfyui', label: 'ComfyUI', url: 'http://127.0.0.1:8188/system_stats' },
  { id: 'a1111', label: 'Stable Diffusion WebUI', url: 'http://127.0.0.1:7860/sdapi/v1/sd-models' },
];

export interface DetectedRuntime {
  readonly id: string;
  readonly label: string;
}

type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean }>;

const PROBE_TIMEOUT_MS = 1_500;

/** Probe all runtimes concurrently; unreachable ones are simply absent. */
export async function detectLocalRuntimes(
  fetchImpl: FetchLike = fetch,
  probes: readonly RuntimeProbe[] = LOCAL_RUNTIME_PROBES,
): Promise<DetectedRuntime[]> {
  const results = await Promise.all(
    probes.map(async (probe) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
      try {
        const response = await fetchImpl(probe.url, { signal: controller.signal });
        return response.ok ? { id: probe.id, label: probe.label } : null;
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    }),
  );
  return results.filter((runtime): runtime is DetectedRuntime => runtime !== null);
}
