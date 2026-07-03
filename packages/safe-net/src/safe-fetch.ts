import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { ValidationError } from '@surfgen/core';
import { Agent, fetch as undiciFetch } from 'undici';
import { isPublicUnicast } from './unicast.js';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BODY_BYTES = 1_000_000;

export interface PinnedAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

export interface SafeFetchOptions {
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly body?: string;
  readonly timeoutMs?: number;
  readonly maxBodyBytes?: number;
}

export interface SafeFetchResult {
  readonly status: number;
  readonly ok: boolean;
  readonly bodyText: string;
}

/**
 * Resolve once, verify every answer, then pin all sockets for this request to
 * the verified address — the actual connection can never follow a re-resolved
 * (rebound) DNS answer.
 */
export async function resolvePinnedAddress(host: string): Promise<PinnedAddress> {
  if (isIP(host)) {
    if (!isPublicUnicast(host)) {
      throw new ValidationError('URL does not resolve to a public address');
    }
    return { address: host, family: isIP(host) === 6 ? 6 : 4 };
  }
  const answers = await lookup(host, { all: true }).catch(() => []);
  if (answers.length === 0 || !answers.every((entry) => isPublicUnicast(entry.address))) {
    throw new ValidationError('URL does not resolve to a public address');
  }
  const first = answers[0]!;
  return { address: first.address, family: first.family === 6 ? 6 : 4 };
}

function pinnedAgent(pin: PinnedAddress): Agent {
  return new Agent({
    connect: {
      // net/tls lookup signature — always answer with the verified address.
      lookup: (_hostname, options, callback) => {
        if ((options as { all?: boolean }).all) {
          (callback as unknown as (err: null, addrs: Array<{ address: string; family: number }>) => void)(null, [
            pin,
          ]);
        } else {
          callback(null, [pin] as never, pin.family as never);
        }
      },
    },
  });
}

/**
 * Validate a caller-supplied URL against the outbound-request policy:
 * http(s) only, default ports only, no embedded credentials. Returns the
 * parsed URL; throws ValidationError otherwise.
 */
export function assertSafeUrl(rawUrl: string | URL): URL {
  let url: URL;
  try {
    url = typeof rawUrl === 'string' ? new URL(rawUrl) : rawUrl;
  } catch {
    throw new ValidationError('invalid URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ValidationError('only http(s) URLs are supported');
  }
  // Default ports only — no tunnelling to arbitrary services.
  if (url.port !== '' && url.port !== (url.protocol === 'https:' ? '443' : '80')) {
    throw new ValidationError('non-default ports are not allowed');
  }
  if (url.username || url.password) {
    throw new ValidationError('credentials in URLs are not allowed');
  }
  return url;
}

/**
 * SSRF-hardened fetch for user-supplied URLs (brand extraction, webhook
 * delivery). Policy checks, single verified DNS resolution pinned to every
 * socket, no redirects (a redirect could point back into the private
 * network), bounded time and body size.
 */
export async function safeFetch(
  rawUrl: string | URL,
  options: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const url = assertSafeUrl(rawUrl);
  const pin = await resolvePinnedAddress(url.hostname);
  const agent = pinnedAgent(pin);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const response = await undiciFetch(url, {
      method: options.method ?? 'GET',
      signal: controller.signal,
      redirect: 'error',
      headers: options.headers ?? {},
      ...(options.body !== undefined && { body: options.body }),
      dispatcher: agent,
    });
    const bodyText = (await response.text()).slice(0, options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES);
    return { status: response.status, ok: response.ok, bodyText };
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError('request failed (blocked, redirected, or timed out)');
  } finally {
    clearTimeout(timer);
    await agent.close().catch(() => undefined);
  }
}
