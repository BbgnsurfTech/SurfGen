import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ConfigurationError, type Result, err, ok } from '@surfgen/core';
import { PluginManifestSchema, type PluginManifest } from './manifest.js';
import { isSurfGenPlugin, type SurfGenPlugin } from './plugin.js';

const MANIFEST_FILENAME = 'plugin.manifest.json';

export interface LoadFailure {
  readonly dir: string;
  readonly error: ConfigurationError;
}

export interface LoadAllResult {
  readonly loaded: SurfGenPlugin[];
  readonly failures: LoadFailure[];
}

/**
 * Loads filesystem plugins: read + validate plugin.manifest.json, then
 * dynamic-import the declared entry. Entry paths are confined to the plugin
 * directory — a manifest cannot point the host at arbitrary code elsewhere.
 */
export class PluginLoader {
  async loadFromDirectory(dir: string): Promise<Result<SurfGenPlugin, ConfigurationError>> {
    const manifestPath = join(dir, MANIFEST_FILENAME);
    if (!existsSync(manifestPath)) {
      return err(new ConfigurationError(`Missing ${MANIFEST_FILENAME} in ${dir}`));
    }

    let manifest: PluginManifest;
    try {
      const parsed = PluginManifestSchema.safeParse(JSON.parse(readFileSync(manifestPath, 'utf8')));
      if (!parsed.success) {
        return err(
          new ConfigurationError(`Invalid manifest in ${dir}`, {
            details: {
              issues: parsed.error.issues.map((i) => ({
                path: i.path.join('.'),
                message: i.message,
              })),
            },
          }),
        );
      }
      manifest = parsed.data;
    } catch (cause) {
      return err(new ConfigurationError(`Unparseable manifest in ${dir}`, { cause }));
    }

    const pluginRoot = resolve(dir);
    const entryPath = resolve(pluginRoot, manifest.entry);
    if (entryPath !== pluginRoot && !entryPath.startsWith(pluginRoot + sep)) {
      return err(
        new ConfigurationError(`Plugin entry escapes plugin directory: ${manifest.entry}`, {
          details: { dir, entry: manifest.entry },
        }),
      );
    }
    if (!existsSync(entryPath)) {
      return err(new ConfigurationError(`Plugin entry not found: ${entryPath}`));
    }

    let moduleExports: Record<string, unknown>;
    try {
      moduleExports = (await import(pathToFileURL(entryPath).href)) as Record<string, unknown>;
    } catch (cause) {
      return err(new ConfigurationError(`Failed to import plugin ${manifest.name}`, { cause }));
    }

    const plugin = moduleExports.default;
    if (!isSurfGenPlugin(plugin)) {
      return err(
        new ConfigurationError(`Plugin ${manifest.name} default export is not a SurfGenPlugin`),
      );
    }
    if (plugin.manifest.name !== manifest.name) {
      return err(
        new ConfigurationError(
          `Manifest mismatch: directory declares '${manifest.name}', module declares '${plugin.manifest.name}'`,
        ),
      );
    }
    return ok(plugin);
  }

  /** Scan a plugins root; one broken plugin never blocks the others. */
  async loadAll(pluginsDir: string): Promise<LoadAllResult> {
    if (!existsSync(pluginsDir)) return { loaded: [], failures: [] };
    const loaded: SurfGenPlugin[] = [];
    const failures: LoadFailure[] = [];

    for (const entry of readdirSync(pluginsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = join(pluginsDir, entry.name);
      if (!existsSync(join(dir, MANIFEST_FILENAME))) continue; // not a plugin dir
      const result = await this.loadFromDirectory(dir);
      if (result.ok) loaded.push(result.value);
      else failures.push({ dir, error: result.error });
    }
    return { loaded, failures };
  }
}
