# Architecture Decision Records

Format: Status / Context / Decision / Consequences. New decisions append the next number; superseding an ADR updates its Status line with a pointer.

| # | Decision |
|---|----------|
| [001](./ADR-001-monorepo-pnpm-turborepo.md) | Monorepo with pnpm workspaces + Turborepo |
| [002](./ADR-002-hexagonal-framework-free-core.md) | Hexagonal architecture, zero-dependency domain core |
| [003](./ADR-003-provider-abstraction-registry.md) | Provider abstraction + health-gated registry (config-only vendor swap) |
| [004](./ADR-004-nestjs-fastify.md) | NestJS on the Fastify adapter |
| [005](./ADR-005-postgres-prisma-soft-delete.md) | PostgreSQL + Prisma, extension-enforced soft delete |
| [006](./ADR-006-rabbitmq-events-bullmq-jobs.md) | RabbitMQ for events, BullMQ/Redis for jobs |
| [007](./ADR-007-stateless-event-driven-orchestration.md) | Stateless event-driven pipeline orchestration |
| [008](./ADR-008-layered-config-secret-refs.md) | Layered config with zod + secret references |
| [009](./ADR-009-plugin-system-conformance.md) | Manifest plugins + mandatory conformance suite |
| [010](./ADR-010-zero-credential-reference-path.md) | Zero-credential local reference path |
