# Sample Plugin Walkthrough: `tts-acme`

A complete, end-to-end tutorial: build a third-party TTS provider plugin for a fictional cloud
vendor ("Acme Voice", HTTP API), test it against the conformance suite, install it, wire it into
the routing chain with an `env:` secret reference, and verify it in a running deployment.

The plugin mirrors the real first-party plugins — compare with
[`plugins/tts-piper`](../../plugins/tts-piper) (CLI runner) and
[`plugins/tts-elevenlabs`](../../plugins/tts-elevenlabs) (HTTP runner, secrets). Contract details
are in the [Plugin SDK guide](plugin-sdk-guide.md).

## 0. Layout

```
plugins/tts-acme/
├── plugin.manifest.json
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── vitest.config.ts
├── src/index.ts
└── test/acme.test.ts
```

Dropping the directory under `plugins/` is the whole "install": it joins the pnpm workspace
(`pnpm-workspace.yaml` includes `plugins/*`), and the worker host scans `SURFGEN_PLUGINS_DIR`
(default `./plugins`) at boot.

## 1. Manifest

`plugin.manifest.json` — validated against `PluginManifestSchema` *before* any plugin code is
imported. `name` must be kebab-case and, by host convention, **equal to the provider id** used in
`config/providers.json` and `config/ai.yaml`:

```json
{
  "name": "tts-acme",
  "version": "0.1.0",
  "description": "Text-to-speech via the Acme Voice cloud API",
  "sdkVersion": "^0.1.0",
  "license": "Apache-2.0",
  "capabilities": ["tts"],
  "entry": "dist/index.js",
  "permissions": ["network"]
}
```

`permissions: ["network"]` because the provider makes outbound HTTP calls; it spawns no processes,
so no `subprocess`.

## 2. Package scaffolding

`package.json` — same shape as `plugins/tts-elevenlabs`:

```json
{
  "name": "@surfgen/plugin-tts-acme",
  "version": "0.1.0",
  "description": "Text-to-speech via the Acme Voice cloud API",
  "license": "Apache-2.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": ["dist", "plugin.manifest.json"],
  "scripts": {
    "build": "tsup",
    "lint": "eslint src test",
    "typecheck": "tsc --noEmit",
    "test": "vitest run --passWithNoTests",
    "test:coverage": "vitest run --coverage --passWithNoTests"
  },
  "dependencies": {
    "@surfgen/ai-sdk": "workspace:*",
    "@surfgen/core": "workspace:*",
    "@surfgen/plugin-sdk": "workspace:*"
  },
  "devDependencies": {
    "tsup": "catalog:",
    "vitest": "catalog:",
    "@vitest/coverage-v8": "catalog:"
  }
}
```

`tsup.config.ts`, `tsconfig.json`, `vitest.config.ts` — copy them verbatim from `plugins/tts-piper`:

```ts
// tsup.config.ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
});
```

```json
// tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": ".", "outDir": "dist", "noEmit": true },
  "include": ["src", "test"]
}
```

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['test/**/*.test.ts'] },
});
```

Plugins are ESM (`tsconfig.base.json` sets `"module": "NodeNext"`), so relative imports carry the
`.js` suffix.

## 3. The provider

`src/index.ts`. The real types from `@surfgen/ai-sdk`: the provider implements
`AIProvider<TTSInput, TTSOutput>`, and `generate()` returns
`AsyncIterable<ProviderEvent<TTSOutput>>` — a stream of `progress` events followed by at least one
`output` event whose last entry has `final: true`. Audio goes through the injected `StoragePort`
and is returned as a `MediaRef` (`{ storageKey, contentType, sizeBytes? }` — a storage key, never
a URL).

```ts
import { randomUUID } from 'node:crypto';
import {
  HttpRunner,
  type AIProvider,
  type CapabilityDescriptor,
  type GenerationContext,
  type HealthStatus,
  type ProviderConfig,
  type ProviderEvent,
  type TTSInput,
  type TTSOutput,
} from '@surfgen/ai-sdk';
import type { StoragePort } from '@surfgen/core';
import { ProviderError } from '@surfgen/core';
import { definePlugin, resolveSecrets } from '@surfgen/plugin-sdk';
import manifest from '../plugin.manifest.json' with { type: 'json' };

interface AcmeOptions {
  baseUrl?: string;
  model?: string;
  /** Secret references (env:/vault:/file:) — resolved in initialize(). */
  secrets?: Record<string, string>;
  /** Injected by the host so outputs land in platform storage. */
  storage?: StoragePort;
  keyPrefix?: string;
}

const DEFAULT_BASE_URL = 'https://api.acme-voice.example';
const DEFAULT_MODEL = 'acme-neural-1';

export class AcmeTTSProvider implements AIProvider<TTSInput, TTSOutput> {
  readonly id: string;
  readonly capability = 'tts' as const;
  private options!: AcmeOptions;
  private apiKey = '';
  private fetchImpl: typeof fetch | undefined;

  constructor(id = 'tts-acme', fetchImpl?: typeof fetch) {
    this.id = id;
    this.fetchImpl = fetchImpl;
  }

  async initialize(config: ProviderConfig): Promise<void> {
    this.options = config.options as AcmeOptions;
    const secrets = resolveSecrets(this.options.secrets);
    if (!secrets.apiKey) {
      throw new ProviderError(this.id, 'secrets.apiKey required (e.g. "env:ACME_API_KEY")', {
        retryable: false,
      });
    }
    this.apiKey = secrets.apiKey;
  }

  async health(): Promise<HealthStatus> {
    const result = await this.makeRunner('/v1/status', 'GET').healthCheck();
    return { ...result, checkedAt: new Date() };
  }

  capabilities(): CapabilityDescriptor {
    return {
      capability: 'tts',
      displayName: `Acme Voice (${this.options.model ?? DEFAULT_MODEL})`,
      deployment: 'cloud',
      streaming: false,
      languages: [], // multilingual — language-agnostic
      inputFormats: ['text'],
      outputFormats: ['mp3'],
      costHint: { unit: '1k chars', amount: 0.15, currency: 'USD' },
      features: { emotions: false },
    };
  }

  private makeRunner(path: string, method: 'GET' | 'POST' = 'POST'): HttpRunner {
    return new HttpRunner({
      baseUrl: this.options.baseUrl ?? DEFAULT_BASE_URL,
      path,
      method,
      headers: { authorization: `Bearer ${this.apiKey}` },
      healthPath: '/v1/status',
      binaryResponse: method === 'POST', // synthesis returns audio bytes, not JSON
      ...(this.fetchImpl && { fetchImpl: this.fetchImpl }),
    });
  }

  async *generate(
    input: TTSInput,
    context: GenerationContext,
  ): AsyncIterable<ProviderEvent<TTSOutput>> {
    yield { type: 'progress', percent: 10, message: 'requesting synthesis' };

    const runner = this.makeRunner('/v1/synthesize');
    const response = await runner.invoke({
      payload: {
        text: input.text,
        voice: input.voiceId,
        model: this.options.model ?? DEFAULT_MODEL,
        ...(input.speed !== undefined && { speed: input.speed }),
        ...(input.language !== undefined && { language: input.language }),
      },
      ...(context.signal && { signal: context.signal }),
    });

    const audio = response.raw;
    if (!audio || audio.length === 0) {
      throw new ProviderError(this.id, 'empty audio response');
    }
    context.recordUsage?.('tts.characters', input.text.length);

    yield { type: 'progress', percent: 70, message: 'storing audio' };
    const storage = this.options.storage;
    if (storage) {
      const key = `${this.options.keyPrefix ?? 'tts/acme'}/${randomUUID()}.mp3`;
      await storage.put(key, audio, { contentType: 'audio/mpeg' });
      yield {
        type: 'output',
        final: true,
        data: { audio: { storageKey: key, contentType: 'audio/mpeg', sizeBytes: audio.length } },
      };
    } else {
      // No storage injected (unit tests): return an inline marker key.
      yield {
        type: 'output',
        final: true,
        data: {
          audio: {
            storageKey: `inline:${Buffer.from(audio).toString('base64').slice(0, 64)}…`,
            contentType: 'audio/mpeg',
            sizeBytes: audio.length,
          },
        },
      };
    }
  }

  async shutdown(): Promise<void> {
    // stateless HTTP provider
  }
}

export default definePlugin({
  manifest,
  register: async (registry, options) => {
    const provider = new AcmeTTSProvider();
    await provider.initialize({
      id: 'tts-acme',
      capability: 'tts',
      enabled: true,
      priority: (options.priority as number) ?? 20,
      options,
    });
    registry.register(provider, { priority: (options.priority as number) ?? 20 });
  },
});
```

Notes on the contract:

- The failover chain relies on errors being thrown **before** the first `output` event — do the
  network call first, only `yield` output once you have the bytes.
- Honor `context.signal`: `HttpRunner` combines it with its own timeout via `AbortSignal.any`.
- `recordUsage` is optional (`recordUsage?.(…)`) — never assume it is present.
- The default export **must** be the `definePlugin(...)` result; the loader checks
  `isSurfGenPlugin` and that `manifest.name` matches the directory manifest.

## 4. Tests + conformance suite

`test/acme.test.ts`. HTTP providers inject a deterministic `fetchImpl`; the conformance suite is a
**subpath import** (`@surfgen/plugin-sdk/conformance`), and its factory is called fresh per test:

```ts
import { describe, expect, test } from 'vitest';
import { collectFinalOutput } from '@surfgen/ai-sdk';
import { providerConformanceSuite } from '@surfgen/plugin-sdk/conformance';
import { AcmeTTSProvider } from '../src/index.js';

// Deterministic fake for the Acme API: /v1/status is healthy, synthesis
// returns fake MP3 bytes.
const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  if (url.endsWith('/v1/status')) return new Response('{"status":"ok"}', { status: 200 });
  if (init?.signal?.aborted) throw new Error('aborted');
  return new Response(new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3]).buffer, { status: 200 });
}) as typeof fetch;

process.env.ACME_TEST_KEY = 'acme-test-key';

async function makeProvider() {
  const provider = new AcmeTTSProvider('tts-acme', fakeFetch);
  await provider.initialize({
    id: 'tts-acme',
    capability: 'tts',
    enabled: true,
    priority: 20,
    options: { secrets: { apiKey: 'env:ACME_TEST_KEY' } },
  });
  return provider;
}

describe('AcmeTTSProvider', () => {
  test('synthesizes and reports usage', async () => {
    const provider = await makeProvider();
    const usage: Array<[string, number]> = [];
    const output = await collectFinalOutput(
      provider.generate(
        { text: 'hello from acme', voiceId: 'nova' },
        { recordUsage: (metric, quantity) => usage.push([metric, quantity]) },
      ),
    );
    expect(output.audio.contentType).toBe('audio/mpeg');
    expect(output.audio.sizeBytes).toBeGreaterThan(0);
    expect(usage).toEqual([['tts.characters', 'hello from acme'.length]]);
  });

  test('fails fast without an api key secret', async () => {
    const provider = new AcmeTTSProvider('tts-acme', fakeFetch);
    await expect(
      provider.initialize({
        id: 'tts-acme',
        capability: 'tts',
        enabled: true,
        priority: 20,
        options: {},
      }),
    ).rejects.toThrow(/secrets.apiKey required/);
  });
});

// Contract proof — every provider must pass this.
providerConformanceSuite('tts-acme', () => makeProvider(), {
  sampleInput: { text: 'conformance sample', voiceId: 'nova' },
});
```

Run the gate from the repo root — turbo picks the new workspace package up automatically:

```bash
pnpm install                       # link the new workspace package
pnpm turbo build test lint typecheck --filter=@surfgen/plugin-tts-acme
pnpm turbo build test lint typecheck   # full gate before shipping
```

## 5. Wire it into the configuration

Two files, zero application code — this *is* the provider swap
([`config/ai.yaml`](../../config/ai.yaml) + [`config/providers.json`](../../config/providers.json)).

**`config/providers.json`** — the provider instance (options + secret refs; the host passes this
entry's `options` into `plugin.register()`, matched by plugin name = provider id):

```json
{
  "id": "tts-acme",
  "capability": "tts",
  "kind": "http",
  "enabled": true,
  "priority": 5,
  "options": { "model": "acme-neural-1" },
  "secrets": { "apiKey": "env:ACME_API_KEY" }
}
```

> Note: today the worker host passes `options` through to `register()`; keep the secret refs your
> provider reads under `options.secrets` (as first-party cloud plugins do):
> `"options": { "model": "acme-neural-1", "secrets": { "apiKey": "env:ACME_API_KEY" } }`.
> The schema-level `secrets` field documents required refs and surfaces them in `GET /v1/providers`.

**`config/ai.yaml`** — put Acme at the head of the TTS chain, with local and mock fallbacks (lower
priority number wins; the registry fails over down the chain when a provider is unhealthy):

```yaml
capabilities:
  tts:
    chain:
      - provider: tts-acme
        priority: 5
      - provider: tts-piper
        priority: 10
      - provider: tts-mock
        priority: 100
```

**Secret** — a reference, never a literal in config:

```bash
# .env (dev) or your secret manager / existingSecret (production)
ACME_API_KEY=ak_live_xxxxxxxx
```

In Kubernetes, ship the two config files via the Helm `config.files` values and add `ACME_API_KEY`
to the `existingSecret` — see the [deployment guide](../guides/deployment.md).

## 6. Verify in a running deployment

Restart the workers and watch the boot log:

```bash
pnpm --filter @surfgen/worker-pipeline start
# → {"plugin":"tts-acme"} plugin registered
```

The worker also self-registers the manifest into the `Plugin` table, so the API reflects it:

```bash
# Providers from config (capability, kind, priority, chain position, required secret names)
curl -H "X-Api-Key: $KEY" http://localhost:4000/v1/providers
# → { "success": true, "data": [ { "id": "tts-acme", "capability": "tts", "kind": "http",
#      "priority": 5, "requiresSecrets": ["apiKey"], "chainPosition": 0, ... }, ... ] }

# Plugins self-registered by workers at boot
curl -H "X-Api-Key: $KEY" http://localhost:4000/v1/plugins
```

In the studio, the **Providers** page (`apps/web/app/(studio)/providers`, backed by
`useProviders()` → `GET /v1/providers`) now lists `tts-acme` at chain position 0, and the
**Plugins** page shows the loaded manifest. Generate any video — the `tts` stage resolves through
the registry, so it is served by Acme; kill the key (or the vendor has an outage) and the chain
fails over to `tts-piper`, then `tts-mock`, with `surfgen_provider_failures_total{provider="tts-acme"}`
counting the failovers.

## Checklist

- [ ] `plugin.manifest.json` valid (kebab-case name = provider id, semver, ≥1 capability, honest `permissions`)
- [ ] default export is `definePlugin({ manifest, register })`
- [ ] `generate()` yields `progress* → output+`, last output `final: true`; errors thrown before first output
- [ ] secrets read only via `options.secrets` refs + `resolveSecrets`
- [ ] audio/video returned as `MediaRef` storage keys via the injected `StoragePort`
- [ ] `providerConformanceSuite` passing with faked externals
- [ ] `pnpm turbo build test lint typecheck` green (all 88 tasks)
- [ ] `config/providers.json` + `config/ai.yaml` chain entries added; `env:` secret set
- [ ] visible in `GET /v1/providers`, `GET /v1/plugins`, and the studio Providers page
