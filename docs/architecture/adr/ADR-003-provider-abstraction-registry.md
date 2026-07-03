# ADR-003: Provider abstraction with health-gated registry (config-only vendor swap)

Status: Accepted (2026-06) — this is the headline product requirement

## Context

The platform must keep functioning when any AI provider is replaced by another **through configuration alone** — cloud APIs and locally hosted models interchangeable. Hardcoding vendors anywhere outside plugins would break this.

## Decision

- One interface for all 15 capabilities: `AIProvider<TIn, TOut>` with `generate() → AsyncIterable<ProviderEvent>` (streaming-only; single-shot providers emit one `output`).
- A provider = manifest + Runner (http/cli/python/docker/grpc/onnx transport strategy) + input/output mappers. Vendors exist only under `plugins/`.
- `ProviderRegistry` resolves `capability → chain` from `config/ai.yaml`: priority order (lower wins), health cache (30 s TTL, 60 s unhealthy cooldown), per-org overrides, deployment/language filters.
- Failover walks the chain but **only before the first output event** — never splice two providers' outputs.
- Biometric capabilities (voice clone, face swap) require `consentToken` at the type level.

## Consequences

- Enforced by an executable gate: `packages/integration/test/provider-swap.test.ts` runs one flow under cloud-first, local-first, zero-credential, and outage-failover configs.
- Adding a vendor is mapper + manifest work (~a day), no core changes.
- Cost: capability contracts must be the union of what vendors need, negotiated via `CapabilityDescriptor` (formats, limits, cost hints) rather than leaking vendor options.
- Rejected: per-vendor service classes (couples call sites), LangChain-style adapters (wrong abstraction granularity for media pipelines).
