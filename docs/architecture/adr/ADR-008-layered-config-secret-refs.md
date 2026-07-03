# ADR-008: Layered configuration with zod validation and secret references

Status: Accepted (2026-06)

## Context

A self-hostable platform needs config that works for laptops (files), containers (env vars), and orgs (DB overrides) — without ever putting secret material in files, DB rows, or logs.

## Decision

Precedence: defaults → `config/*.yaml|json` → environment (`SURFGEN_SCOPE__PATH`, case-insensitively resolved against existing keys so env vars can address camelCase) → zod parse (fail-fast, path-level errors) → per-org DB overrides at the registry layer. Secrets are accepted **only as references** matching `/^(env|vault|file):/` (zod-refined); `resolveSecretRef` dereferences at use time.

## Consequences

- The provider-swap requirement (ADR-003) rides on this: `config/ai.yaml` is the single lever that decides vendors.
- A leaked config file or DB dump contains no credentials; pino redaction covers the runtime paths.
- Hot reload via file watcher lets ops rotate chains without restarts.
- Cost: schema duplication (`KNOWN_CAPABILITIES` copied into config schemas to avoid a core→config dependency inversion) must be kept in sync by a test.
- Rejected: dotenv-only (no structure/validation), consul/etcd (operational weight; the file+env layers already cover K8s ConfigMaps).
