import { readFileSync } from 'node:fs';
import { ConfigurationError } from '@surfgen/core';

/**
 * Resolve a secret reference to its value at the moment of use. Config files
 * only ever contain references (enforced by @surfgen/config schemas):
 *   env:ELEVENLABS_API_KEY   → process.env.ELEVENLABS_API_KEY
 *   file:/run/secrets/token  → file contents (trimmed) — docker/k8s secrets
 *   vault:<path>             → reserved for the vault plugin
 */
export function resolveSecretRef(ref: string, env: NodeJS.ProcessEnv = process.env): string {
  const [scheme, ...rest] = ref.split(':');
  const target = rest.join(':');

  switch (scheme) {
    case 'env': {
      const value = env[target];
      if (!value) {
        throw new ConfigurationError(`Secret env var not set: ${target}`, {
          details: { ref },
        });
      }
      return value;
    }
    case 'file': {
      try {
        return readFileSync(target, 'utf8').trim();
      } catch (cause) {
        throw new ConfigurationError(`Secret file unreadable: ${target}`, { cause });
      }
    }
    case 'vault':
      throw new ConfigurationError(
        'vault: secret refs require the vault secrets plugin to be installed',
        { details: { ref } },
      );
    default:
      throw new ConfigurationError(`Unknown secret ref scheme: ${ref}`);
  }
}

/** Resolve every ref in a secrets map; missing optional secrets can be tolerated by callers. */
export function resolveSecrets(
  refs: Readonly<Record<string, string>> | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  if (!refs) return {};
  return Object.fromEntries(
    Object.entries(refs).map(([key, ref]) => [key, resolveSecretRef(ref, env)]),
  );
}
