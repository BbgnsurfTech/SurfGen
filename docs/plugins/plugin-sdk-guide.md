# SurfGen Plugin SDK Guide

The plugin contract: how a plugin is packaged, validated, loaded, registered, health-checked, and
routed to. Everything here is defined in [`packages/plugin-sdk`](../../packages/plugin-sdk) and
[`packages/ai-sdk`](../../packages/ai-sdk); the design record is
[ADR-009](../architecture/adr/ADR-009-plugin-system-conformance.md).

For a full worked example, see the [sample plugin walkthrough](sample-plugin-walkthrough.md).

## What a plugin is

A plugin is a directory (by convention under [`plugins/`](../../plugins)) containing:

```
plugins/<name>/
├── plugin.manifest.json    # validated BEFORE any plugin code is imported
├── package.json            # workspace package, ESM, builds with tsup
├── src/index.ts            # default-exports a SurfGenPlugin (via definePlugin)
└── test/                   # vitest tests incl. the conformance suite
```

The worker host ([`apps/workers/pipeline/src/main.ts`](../../apps/workers/pipeline/src/main.ts))
scans `SURFGEN_PLUGINS_DIR` (default `./plugins`) at boot with `PluginLoader.loadAll()`, registers
each plugin's providers into the shared `ProviderRegistry`, and **upserts each loaded manifest into
the `Plugin` database table** so the API (`GET /v1/plugins`) and studio Plugins page reflect what
the deployment actually runs. One broken plugin never blocks the others — failures are logged and
skipped.

## The manifest

`plugin.manifest.json` is validated against `PluginManifestSchema`
([`packages/plugin-sdk/src/manifest.ts`](../../packages/plugin-sdk/src/manifest.ts)):

| Field | Type | Rules |
| ----- | ---- | ----- |
| `name` | string | **required**, kebab-case (`/^[a-z][a-z0-9-]*$/`) — must equal the provider id used in config |
| `version` | string | **required**, strict semver |
| `description` | string | **required**, non-empty |
| `sdkVersion` | string | **required** — SDK compatibility range the plugin was built against (e.g. `"^0.1.0"`) |
| `author` | string | optional |
| `license` | string | optional |
| `capabilities` | string[] | **required**, ≥ 1 entry (e.g. `["tts"]`) |
| `entry` | string | default `"dist/index.js"` — resolved **inside** the plugin dir; escaping paths are rejected |
| `configSchema` | object | optional JSON schema describing the plugin's options block |
| `permissions` | enum[] | default `[]`; any of `network`, `filesystem`, `subprocess`, `gpu` — policy inputs for the host |

The loader also verifies that the module's `manifest.name` matches the directory's manifest — a
mismatch is a load failure.

## Lifecycle

A plugin implements `SurfGenPlugin`
([`packages/plugin-sdk/src/plugin.ts`](../../packages/plugin-sdk/src/plugin.ts)):

```ts
export interface SurfGenPlugin {
  readonly manifest: PluginManifest;
  register(registry: ProviderRegistry, options: Record<string, unknown>): Promise<void>;
  shutdown(): Promise<void>;
}
```

Author it with `definePlugin` — it validates the manifest at definition time, so a broken manifest
fails the plugin's own tests rather than the host at load time:

```ts
import { definePlugin } from '@surfgen/plugin-sdk';
import manifest from '../plugin.manifest.json' with { type: 'json' };

export default definePlugin({
  manifest,
  register: async (registry, options) => {
    const provider = new MyProvider();
    await provider.initialize({ id: 'my-provider', capability: 'tts', enabled: true,
      priority: (options.priority as number) ?? 10, options });
    registry.register(provider, { priority: (options.priority as number) ?? 10 });
  },
  // shutdown is optional; defaults to a no-op
});
```

**Where `options` comes from:** the host looks up the plugin's entry in
[`config/providers.json`](../../config/providers.json) by the convention *plugin `name` = provider
`id`*, passes that entry's `options` object, and injects shared services on top — currently the
`StoragePort` as `options.storage` (so provider outputs land in platform storage, not local disk).

## The provider contract

Every provider implements `AIProvider<TIn, TOut>`
([`packages/ai-sdk/src/provider.ts`](../../packages/ai-sdk/src/provider.ts)):

```ts
export interface AIProvider<TIn = unknown, TOut = unknown> {
  readonly id: string;
  readonly capability: Capability;
  initialize(config: ProviderConfig): Promise<void>;
  health(): Promise<HealthStatus>;                 // { healthy, latencyMs?, reason?, checkedAt }
  capabilities(): CapabilityDescriptor;            // self-description for routing + UI
  generate(input: TIn, context: GenerationContext): AsyncIterable<ProviderEvent<TOut>>;
  shutdown(): Promise<void>;
}
```

- **Capabilities** are a closed set (`packages/ai-sdk/src/capability.ts`): `llm`, `tts`, `asr`,
  `voice_clone`, `translation`, `embeddings`, `avatar`, `talking_photo`, `lipsync`,
  `video_generation`, `image_generation`, `face_swap`, `face_animation`, `background_removal`,
  `motion_generation`. Each provider implements exactly one.
- **Input/output payloads** are the capability types in `packages/ai-sdk/src/capabilities/`
  (`TTSInput`/`TTSOutput`, `LLMInput`/`LLMOutput`, `ASRInput`/`ASROutput`, `TranslationInput`/…,
  visual types in `visual.ts`). Media is always a `MediaRef`
  (`{ storageKey, contentType, sizeBytes?, durationMs? }`) — a storage key, never a URL.
- **`generate()` is a stream** of `ProviderEvent`s: `progress` (0–100), `log`, and `output`
  (`{ data, final }`). A valid run is `progress* → output+ → end`, with the last output marked
  `final: true`. Helpers: `collectFinalOutput(stream)` drains and returns the final output;
  `singleOutput(promise)` wraps a one-shot call.
- **`GenerationContext`** carries `organizationId`, `correlationId`, a cooperative `AbortSignal`
  (providers must stop work when signalled), and `recordUsage(metric, quantity)` for billing
  (e.g. `context.recordUsage?.('tts.characters', input.text.length)`).
- **`CapabilityDescriptor`** declares `displayName`, `deployment` (`cloud` | `local` |
  `self_hosted` — used for data-residency routing), `streaming`, BCP-47 `languages` (empty =
  language-agnostic), `inputFormats`/`outputFormats`, an optional `costHint`, and free-form
  `features` flags.

## Runners

A runner is *how the provider physically reaches its model*
([`packages/ai-sdk/src/runners/`](../../packages/ai-sdk/src/runners)); providers compose a runner
with input/output mapping, so "ElevenLabs over HTTPS" and "Piper via CLI" differ only in
configuration. Runner kinds: `http`, `cli`, `python`, `docker`, `grpc`, `onnx` (the first two have
shipped implementations; docker providers reuse `CliRunner` with `command: "docker"`).

- **`HttpRunner`** — cloud APIs and local HTTP model servers (Ollama, vLLM, ComfyUI…). Config:
  `baseUrl`, `path`, `method`, `headers`, `healthPath`, `defaultTimeoutMs` (120s default),
  `binaryResponse` (audio/video bytes in `response.raw`), injectable `fetchImpl` for tests.
  Non-2xx becomes a `ProviderError` (retryable for 5xx/429). `healthCheck()` GETs `healthPath`
  with a 5s timeout.
- **`CliRunner`** — local executables (piper, ffmpeg, whisper, custom scripts). Args support
  `{placeholder}` substitution from the payload object — values are passed as discrete argv
  entries, **never through a shell**. `stdinPayload: true` writes the JSON payload to stdin
  instead. 10-minute default timeout, 512 MB stdout cap, `healthArgs` probe (default `--version`).

A plugin that spawns processes must declare the `subprocess` permission in its manifest; a plugin
without it must not be given a `CliRunner`.

## Secret references

Secrets never appear in config files or manifests — only references, resolved at the moment of use
by `resolveSecretRef` / `resolveSecrets`
([`packages/plugin-sdk/src/secrets.ts`](../../packages/plugin-sdk/src/secrets.ts)):

| Scheme | Resolution |
| ------ | ---------- |
| `env:ELEVENLABS_API_KEY` | `process.env.ELEVENLABS_API_KEY` (throws `ConfigurationError` if unset) |
| `file:/run/secrets/token` | file contents, trimmed — docker/k8s secrets |
| `vault:<path>` | reserved — throws until the vault secrets plugin is installed |

The `@surfgen/config` schemas enforce the `^(env|vault|file):` shape on every secret-bearing field
(`providers.json` `secrets`, `storage.yaml` key refs, webhook `secretRef`), so plaintext secrets are
rejected platform-wide. Provider convention (see
[`plugins/tts-elevenlabs/src/index.ts`](../../plugins/tts-elevenlabs/src/index.ts)): accept
`options.secrets` as a map of refs and call `resolveSecrets(this.options.secrets)` in
`initialize()`.

## Health checks and failover

The registry health-gates every resolution
([`packages/ai-sdk/src/registry.ts`](../../packages/ai-sdk/src/registry.ts)):

- Healthy results are cached for `healthTtlMs` (default **30s**); unhealthy providers are skipped
  for `unhealthyCooldownMs` (default **60s**) before re-probing.
- A provider that throws during `generate()` is marked unhealthy immediately.
- `onHealthChange(providerId, capability, healthy)` fires on transitions — the worker host publishes
  it as a `provider.health_changed` event.

Make `health()` cheap and honest: probe the actual dependency (`HttpRunner.healthCheck()` /
`CliRunner.healthCheck()`) and return `{ ...result, checkedAt: new Date() }`.

## How the registry resolves a provider

Application code asks for a capability; the registry picks the provider:

```ts
const output = await collectFinalOutput(
  registry.execute<TTSInput, TTSOutput>('tts', input, { organizationId, correlationId }),
);
```

Resolution algorithm (documented and implemented in `ProviderRegistry`):

1. **Candidates** — enabled providers for the capability, filtered by `ResolveOptions`:
   `deployment` class, explicit `providerId`, `language` (BCP-47, primary-subtag match; empty
   descriptor list = language-agnostic).
2. **Order** — per-org override first (if any), then ascending `priority` (lower wins).
3. **Health gate** — cached health as above.
4. **Failover** — `execute()` walks the healthy chain. If a provider fails **before emitting any
   output event**, the next one is tried; after first output the attempt is committed (no
   mid-stream model splicing). If every candidate fails, a `ProviderUnavailableError` carries the
   attempted ids.

### Priority chains come from `config/ai.yaml`

[`config/ai.yaml`](../../config/ai.yaml) maps each capability to a chain; the host registers each
chain entry's provider with that priority:

```yaml
capabilities:
  tts:
    chain:
      - provider: tts-piper      # local first
        priority: 10
      - provider: tts-mock       # zero-credential fallback
        priority: 100
routing:
  preferDeployment: local
```

Validated by `AiConfigSchema` in
[`packages/config/src/schemas.ts`](../../packages/config/src/schemas.ts) (`provider`, `priority` ≥ 0
default 100, `enabled` default true). Provider *instances* (kind, options, secret refs) are defined
in [`config/providers.json`](../../config/providers.json) (`ProvidersConfigSchema` — unique
kebab-case ids). Swapping vendors is editing these files — nothing else. The executable proof is
[`packages/integration/test/provider-swap.test.ts`](../../packages/integration/test/provider-swap.test.ts).

### Per-organization overrides

The registry supports pinning a capability to a specific provider per organization —
`registry.setOrgOverride(orgId, capability, providerId)` / `clearOrgOverride(...)`, honored by
`candidates()` when `ResolveOptions.organizationId` is set (the pinned provider jumps to the front
if it is a valid candidate). **Currently this is a registry-level API covered by unit tests; no
config file, database model, or API endpoint wires it up yet** — org-scoped chains in `ai.yaml` are
not a thing today.

## The conformance suite

Every provider must pass the contract tests in `@surfgen/plugin-sdk/conformance` (a subpath export —
note the import path). Call it from your own vitest suite:

```ts
import { providerConformanceSuite } from '@surfgen/plugin-sdk/conformance';

providerConformanceSuite('tts-acme', () => makeProvider(), {
  sampleInput: { text: 'hello', voiceId: 'default' },
  // config?: Partial<ProviderConfig> — merged into the initialize() config
});
```

What it asserts ([`packages/plugin-sdk/src/conformance.ts`](../../packages/plugin-sdk/src/conformance.ts)):

1. `initialize()` resolves without error
2. `health()` returns `{ healthy: boolean, checkedAt: Date }`
3. the capability descriptor is coherent (matches `provider.capability`, valid deployment class,
   non-empty display name, languages array)
4. `generate()` yields ≥ 1 output, the last one `final: true`, progress within 0–100
5. a pre-aborted `AbortSignal` either throws or completes fast (< 5s)
6. `shutdown()` is idempotent

The factory is called fresh per test, so fake external dependencies there (shim binary for CLI
providers, injected `fetchImpl` for HTTP providers — see
[`plugins/tts-piper/test/piper.test.ts`](../../plugins/tts-piper/test/piper.test.ts) and
[`plugins/mock-suite/test/mock-suite.test.ts`](../../plugins/mock-suite/test/mock-suite.test.ts)).

## Observing plugins in a running deployment

- `GET /v1/providers` — provider instances from config, with capability, kind, enabled, priority,
  required secret names, and chain position (`apps/api/src/workspace/admin.controller.ts`); shown
  on the studio **Providers** page.
- `GET /v1/plugins` — the `Plugin` table rows self-registered by workers at boot;
  `PATCH /v1/plugins/:pluginId` toggles `enabled`. Shown on the studio **Plugins** page.
- Worker logs — `plugin registered` / `plugin skipped` / `plugin failed to load` per directory,
  and `provider.health_changed` events on health transitions.
