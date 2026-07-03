# ADR-005: PostgreSQL + Prisma with extension-enforced soft delete

Status: Accepted (2026-06)

## Context

34 relational models with org-scoped multi-tenancy, JSON documents where flexibility matters (pipeline artifacts, workflow definitions), and a recovery/GDPR story that needs soft delete without every query remembering to filter it.

## Decision

PostgreSQL 16 + Prisma. All org-scoped entities carry `deletedAt`; a Prisma client extension AND-merges `{ deletedAt: null }` into the `where` of 12 guarded operations unless the caller explicitly names `deletedAt` (AND-merge so caller filters can never widen visibility). Transactional outbox table (`OutboxEvent`) written in the same transaction as domain changes.

## Consequences

- Forgotten-filter bugs are structurally impossible at the ORM layer; restore = null the column; hard purge is a scheduled admin job (NFR DAT-2).
- JSON columns (`PipelineRun.artifacts`) keep the DB the source of truth for resume without a migration per new stage.
- Costs: partial indexes should include `WHERE deleted_at IS NULL`; raw SQL bypasses the extension (reviewed usage only); Prisma's `InputJsonValue` needs explicit casts for typed artifact maps.
- Rejected: DB rules/views for soft delete (opaque), MongoDB (relational integrity across tenancy/billing matters more than schema flexibility).
