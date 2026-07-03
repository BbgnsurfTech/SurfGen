# ADR-002: Hexagonal architecture with a zero-dependency domain core

Status: Accepted (2026-06)

## Context

The platform's rules (state machines, pipeline DAG semantics, quotas, error taxonomy) must outlive any framework, broker, or ORM choice, and be testable without infrastructure.

## Decision

`packages/core` holds entities, value objects, domain events, state machines, and **port interfaces** (`StoragePort`, `EventPublisherPort`, `JobQueuePort`, `ClockPort`, `UnitOfWorkPort`) with **zero runtime dependencies**. Infrastructure packages (`storage`, `events`, `queue`, `db`) implement ports; apps wire them via DI.

## Consequences

- Domain logic tests run with no containers; in-memory adapters (`InMemoryEventBus`, local storage) give dev/prod behavioral parity.
- Swapping RabbitMQ→NATS or BullMQ→something else is an adapter, not a rewrite — the same philosophy the AI provider layer applies to vendors (ADR-003).
- Discipline cost: PRs adding a dependency to `core` are rejected; ports must stay minimal or adapters multiply.
- State machines are data (`TransitionTable`), so API and workers enforce identical transitions from one table.
