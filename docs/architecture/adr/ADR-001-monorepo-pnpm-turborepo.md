# ADR-001: Monorepo with pnpm workspaces + Turborepo

Status: Accepted (2026-06)

## Context

SurfGen spans ~20 packages (domain, SDKs, infrastructure adapters, plugins, apps) that must share types and evolve in lockstep — a provider interface change must be visible to every plugin in the same commit. Options: polyrepo, Nx, pnpm+Turborepo, Bazel.

## Decision

pnpm workspaces for linking + `catalog:` for single-source version pinning; Turborepo for task orchestration (`turbo build test lint typecheck`) with dependency-aware caching.

## Consequences

- One atomic commit can change `ai-sdk` and all plugins; the provider-swap gate test runs against workspace-linked code.
- `catalog:` prevents version drift (one place pins `zod`, `vitest`, etc.).
- Turborepo caches make full-repo verification cheap (76 tasks, seconds when warm).
- Cost: contributors need pnpm (enforced via `packageManager` + corepack); Turborepo task graph must be kept honest (`dependsOn: ["^build"]`).
- Rejected: Nx (heavier generator/executor lock-in), Bazel (overkill for TS-only), polyrepo (cross-repo type sync would make config-only provider swap untestable).
