import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface CliConfig {
  apiUrl: string;
  accessToken?: string;
  refreshToken?: string;
  apiKey?: string;
  defaultOrgId?: string;
  defaultProjectId?: string;
}

const CONFIG_DIR = join(homedir(), '.surfgen');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');
const DEFAULT_API_URL = 'http://127.0.0.1:4000';

export function loadConfig(): CliConfig {
  if (!existsSync(CONFIG_PATH)) return { apiUrl: process.env.SURFGEN_API_URL ?? DEFAULT_API_URL };
  const stored = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as CliConfig;
  return { ...stored, apiUrl: process.env.SURFGEN_API_URL ?? stored.apiUrl ?? DEFAULT_API_URL };
}

export function saveConfig(config: CliConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  chmodSync(CONFIG_PATH, 0o600); // holds tokens — owner-only
}

interface Envelope<T> {
  success: boolean;
  data: T;
  error: { code: string; message: string } | null;
  meta?: unknown;
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Thin REST client speaking the SurfGen envelope, with one auto-refresh. */
export class SurfGenClient {
  constructor(
    private config: CliConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    retryOnAuth = true,
  ): Promise<{ data: T; meta?: unknown }> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.config.apiKey) headers['x-api-key'] = this.config.apiKey;
    else if (this.config.accessToken) headers.authorization = `Bearer ${this.config.accessToken}`;

    const response = await this.fetchImpl(`${this.config.apiUrl}${path}`, {
      method,
      headers,
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });

    if (response.status === 401 && retryOnAuth && this.config.refreshToken) {
      await this.refresh();
      return this.request(method, path, body, false);
    }
    if (response.status === 204) return { data: undefined as T };

    const envelope = (await response.json()) as Envelope<T>;
    if (!response.ok || !envelope.success) {
      throw new ApiError(
        envelope.error?.code ?? 'HTTP_ERROR',
        envelope.error?.message ?? `HTTP ${response.status}`,
        response.status,
      );
    }
    return { data: envelope.data, ...(envelope.meta !== undefined && { meta: envelope.meta }) };
  }

  private async refresh(): Promise<void> {
    const { data } = await this.request<{
      accessToken: string;
      refreshToken: string;
    }>('POST', '/v1/auth/refresh', { refreshToken: this.config.refreshToken }, false);
    this.config = { ...this.config, accessToken: data.accessToken, refreshToken: data.refreshToken };
    saveConfig(this.config);
  }

  get currentConfig(): CliConfig {
    return this.config;
  }
}
