import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { ProviderRegistry } from '@surfgen/ai-sdk';
import { PluginManifestSchema } from '../src/manifest.js';
import { definePlugin } from '../src/plugin.js';
import { PluginLoader } from '../src/loader.js';

const tempDirs: string[] = [];
const makeDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'surfgen-plugin-'));
  tempDirs.push(dir);
  return dir;
};
afterAll(() => tempDirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const validManifest = {
  name: 'tts-example',
  version: '1.0.0',
  description: 'Example TTS plugin',
  sdkVersion: '^0.1.0',
  capabilities: ['tts'],
};

/** Self-contained plugin module (no imports) written to disk for loader tests. */
const PLUGIN_MODULE = `
export default {
  manifest: ${JSON.stringify({ ...validManifest, entry: 'index.mjs', permissions: [] })},
  register: async (registry, options) => { globalThis.__pluginRegistered = options; },
  shutdown: async () => {},
};
`;

function writePlugin(root: string, name: string, manifest: object, moduleSource = PLUGIN_MODULE) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'plugin.manifest.json'), JSON.stringify(manifest));
  writeFileSync(join(dir, 'index.mjs'), moduleSource);
  return dir;
}

describe('PluginManifestSchema', () => {
  test('accepts a valid manifest and applies defaults', () => {
    const parsed = PluginManifestSchema.parse(validManifest);
    expect(parsed.entry).toBe('dist/index.js');
    expect(parsed.permissions).toEqual([]);
  });

  test('rejects bad names, versions, empty capabilities, unknown permissions', () => {
    expect(PluginManifestSchema.safeParse({ ...validManifest, name: 'BadName' }).success).toBe(false);
    expect(PluginManifestSchema.safeParse({ ...validManifest, version: 'v1' }).success).toBe(false);
    expect(PluginManifestSchema.safeParse({ ...validManifest, capabilities: [] }).success).toBe(false);
    expect(
      PluginManifestSchema.safeParse({ ...validManifest, permissions: ['root'] }).success,
    ).toBe(false);
  });
});

describe('definePlugin', () => {
  test('returns a plugin with validated manifest and default shutdown', async () => {
    const plugin = definePlugin({ manifest: validManifest, register: async () => {} });
    expect(plugin.manifest.name).toBe('tts-example');
    await expect(plugin.shutdown()).resolves.toBeUndefined();
  });

  test('throws ConfigurationError with issues for invalid manifest', () => {
    expect(() =>
      definePlugin({ manifest: { name: 'x!' }, register: async () => {} }),
    ).toThrowError(/Invalid plugin manifest/);
  });
});

describe('PluginLoader', () => {
  test('loads a valid plugin and register() wires the registry', async () => {
    const root = makeDir();
    const dir = writePlugin(root, 'tts-example', { ...validManifest, entry: 'index.mjs' });
    const loader = new PluginLoader();
    const result = await loader.loadFromDirectory(dir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const registry = new ProviderRegistry();
      await result.value.register(registry, { hello: 'world' });
      expect((globalThis as Record<string, unknown>).__pluginRegistered).toEqual({
        hello: 'world',
      });
    }
  });

  test('rejects entry paths escaping the plugin directory', async () => {
    const root = makeDir();
    const dir = writePlugin(root, 'evil', { ...validManifest, name: 'evil', entry: '../../../etc/passwd' });
    const result = await new PluginLoader().loadFromDirectory(dir);
    expect(!result.ok && result.error.message).toMatch(/escapes plugin directory/);
  });

  test('rejects manifest/module name mismatch', async () => {
    const root = makeDir();
    const dir = writePlugin(root, 'renamed', { ...validManifest, name: 'other-name', entry: 'index.mjs' });
    const result = await new PluginLoader().loadFromDirectory(dir);
    expect(!result.ok && result.error.message).toMatch(/Manifest mismatch/);
  });

  test('rejects module without a SurfGenPlugin default export', async () => {
    const root = makeDir();
    const dir = writePlugin(
      root,
      'broken-export',
      { ...validManifest, name: 'broken-export', entry: 'index.mjs' },
      'export default { not: "a plugin" };',
    );
    const result = await new PluginLoader().loadFromDirectory(dir);
    expect(!result.ok && result.error.message).toMatch(/not a SurfGenPlugin/);
  });

  test('loadAll isolates failures: one bad plugin does not block the good one', async () => {
    const root = makeDir();
    writePlugin(root, 'good', { ...validManifest, name: 'good', entry: 'index.mjs' },
      `export default { manifest: ${JSON.stringify({ ...validManifest, name: 'good', entry: 'index.mjs' })}, register: async () => {}, shutdown: async () => {} };`);
    writePlugin(root, 'bad', { ...validManifest, name: 'bad', entry: 'missing.mjs' });
    mkdirSync(join(root, 'not-a-plugin')); // no manifest — silently skipped

    const { loaded, failures } = await new PluginLoader().loadAll(root);
    expect(loaded.map((p) => p.manifest.name)).toEqual(['good']);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.dir).toContain('bad');
  });

  test('loadAll on missing directory returns empty result', async () => {
    const { loaded, failures } = await new PluginLoader().loadAll('/nonexistent/plugins');
    expect(loaded).toEqual([]);
    expect(failures).toEqual([]);
  });
});
