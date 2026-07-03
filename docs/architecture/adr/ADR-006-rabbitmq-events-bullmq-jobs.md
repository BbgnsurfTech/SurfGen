# ADR-006: RabbitMQ for domain events, BullMQ/Redis for work queues

Status: Accepted (2026-06)

## Context

Two messaging needs with different semantics: (a) domain events — fan-out facts ("video.queued", "stage_completed") that multiple consumers react to; (b) work — jobs that exactly one worker should process, with retries, backoff, priorities, and cancellation.

## Decision

Split by semantics, not by tool fashion:

- **RabbitMQ** topic exchange `surfgen.events` for domain events: publisher confirms, per-subscription queues, DLX → `surfgen.events.dead`. `InMemoryEventBus` mirrors AMQP topic matching (`*`/`#`) for dev/test parity. Transactional outbox bridges Postgres commits → publishes.
- **BullMQ on Redis** for job execution, queues split by resource class (`cpu.default`, `cpu.media`, `gpu.default`, `gpu.heavy`, `io.webhooks`, `io.analytics`); idempotency via `jobId = runId:stage`; cooperative cancellation via Redis flag polled by workers.

## Consequences

- Each tool does what it's best at; GPU/CPU fleets scale independently by subscribing to queue classes.
- At-least-once everywhere → every consumer/stage must be idempotent (artifact-exists check makes retries converge to exactly-once effects).
- Cost: two brokers to operate; compose/Helm ship both. `AMQP_URL` absent → in-memory bus, so laptops run without RabbitMQ.
- Rejected: RabbitMQ-only (no first-class job retry/progress model), Redis-streams-only (weak fan-out + DLX semantics), Kafka (operational overkill at this stage; revisit if event replay becomes a product feature).
