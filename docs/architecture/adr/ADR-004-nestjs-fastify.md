# ADR-004: NestJS on the Fastify adapter for the API gateway

Status: Accepted (2026-06)

## Context

The API needs DI (to wire ports→adapters per ADR-002), guards/interceptors for RBAC + audit + envelopes, OpenAPI generation, WebSockets, and high throughput.

## Decision

NestJS 11 with the Fastify adapter (not Express). Cross-cutting order: helmet → rate limit → AuthGuard (APP_GUARD) → ZodValidationPipe → controller → AuditInterceptor → EnvelopeInterceptor → DomainExceptionFilter. URI versioning (`/v1`), Swagger at `/docs`.

## Consequences

- Fastify ≈ 2× Express throughput and first-class JSON schema serialization.
- Nest DI implies decorators + `emitDecoratorMetadata` → the API is CommonJS while packages are ESM; vitest needs swc with `module: { type: 'es6' }`.
- **Recorded footgun:** `import type` on a DI-injected class erases `design:paramtypes` and silently injects `undefined`. `apps/api/eslint.config.mjs` disables `consistent-type-imports` accordingly; this ADR is the paper trail.
- Rejected: Express adapter (slower), bare Fastify (hand-rolled DI would reimplement Nest badly), tRPC-only (third-party API-key consumers need REST/OpenAPI).
