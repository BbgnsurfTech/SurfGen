import { ConfigurationError } from '@surfgen/core';
import type { ProviderRegistry } from '@surfgen/ai-sdk';
import { PluginManifestSchema, type PluginManifest } from './manifest.js';

/**
 * The lifecycle every SurfGen plugin implements. register() is where the
 * plugin constructs its providers and adds them to the registry; options come
 * from the host's providers.json/plugin config, already schema-validated.
 */
export interface SurfGenPlugin {
  readonly manifest: PluginManifest;
  register(registry: ProviderRegistry, options: Record<string, unknown>): Promise<void>;
  shutdown(): Promise<void>;
}

export interface PluginDefinition {
  readonly manifest: PluginManifest | Record<string, unknown>;
  readonly register: SurfGenPlugin['register'];
  readonly shutdown?: SurfGenPlugin['shutdown'];
}

/**
 * Author-side helper: validates the manifest at definition time so a broken
 * manifest fails the plugin's own tests, not the host at load time.
 */
export function definePlugin(definition: PluginDefinition): SurfGenPlugin {
  const parsed = PluginManifestSchema.safeParse(definition.manifest);
  if (!parsed.success) {
    throw new ConfigurationError('Invalid plugin manifest', {
      details: {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    });
  }
  return {
    manifest: parsed.data,
    register: definition.register,
    shutdown: definition.shutdown ?? (async () => {}),
  };
}

export const isSurfGenPlugin = (value: unknown): value is SurfGenPlugin => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.register === 'function' &&
    typeof candidate.shutdown === 'function' &&
    typeof candidate.manifest === 'object' &&
    candidate.manifest !== null
  );
};
