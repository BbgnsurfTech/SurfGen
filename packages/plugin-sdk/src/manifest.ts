import { z } from 'zod';

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+)?$/;

export const PLUGIN_PERMISSIONS = ['network', 'filesystem', 'subprocess', 'gpu'] as const;
export type PluginPermission = (typeof PLUGIN_PERMISSIONS)[number];

/**
 * plugin.manifest.json — the contract a plugin publishes. Validated before
 * any plugin code is imported; capability claims and permissions are policy
 * inputs for the host (a plugin without 'subprocess' must not get a CliRunner).
 */
export const PluginManifestSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]*$/, 'kebab-case name required'),
  version: z.string().regex(SEMVER_PATTERN, 'semver required'),
  description: z.string().min(1),
  /** SDK compatibility range the plugin was built against. */
  sdkVersion: z.string().min(1),
  author: z.string().optional(),
  license: z.string().optional(),
  capabilities: z.array(z.string().min(1)).min(1),
  entry: z.string().default('dist/index.js'),
  /** JSON schema describing the plugin's options block. */
  configSchema: z.record(z.string(), z.unknown()).optional(),
  permissions: z.array(z.enum(PLUGIN_PERMISSIONS)).default([]),
});

export type PluginManifest = z.infer<typeof PluginManifestSchema>;
