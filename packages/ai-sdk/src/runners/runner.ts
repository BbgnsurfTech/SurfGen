/**
 * Runner strategies: how a provider physically reaches its model. A provider
 * composes a Runner with input/output mappers, so "ElevenLabs over HTTPS" and
 * "Piper via CLI" differ only in configuration.
 */
export interface RunnerRequest {
  readonly payload: unknown;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export interface RunnerResponse {
  readonly body: unknown;
  readonly raw?: Uint8Array;
}

export interface Runner {
  readonly kind: 'http' | 'cli' | 'python' | 'docker' | 'grpc' | 'onnx';
  invoke(request: RunnerRequest): Promise<RunnerResponse>;
  healthCheck(): Promise<{ healthy: boolean; latencyMs?: number; reason?: string }>;
  dispose(): Promise<void>;
}
