# ADR-009: Manifest-based plugin system with a mandatory conformance suite

Status: Accepted (2026-06)

## Context

Providers, storage drivers, and integrations must be addable by third parties without forking the platform — but loaded code is an attack surface, and inconsistent provider behavior would break the failover chain.

## Decision

- Every plugin ships `plugin.manifest.json` (zod-validated: kebab name, semver, capabilities, declared permissions `network|filesystem|subprocess|gpu`) + a default export created by `definePlugin()`.
- `PluginLoader` confines the manifest `entry` inside the plugin directory (path-traversal guard) and `loadAll` isolates failures — one broken plugin never takes down the process.
- Every provider plugin must pass `providerConformanceSuite()` (separate `./conformance` subpath export so vitest never enters runtime bundles): init/health/streaming-generate/shutdown/error-mapping contracts.

## Consequences

- Registry failover can trust uniform behavior (e.g. errors are `ProviderError` with `retryable`, output events precede completion) because the suite enforces it.
- Declared permissions give admins an honest install-time signal and a future enforcement point (subprocess sandboxing is roadmap, not implemented).
- Cost: manifest + conformance is friction for quick hacks — accepted; the mock-suite plugin is the copyable template.
- Rejected: bare npm packages with naming conventions (no permission surface, no validation), VM/isolate sandboxing now (Node isolation is weak; honest declaration + review beats false confidence).
