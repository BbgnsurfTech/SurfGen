# ADR-007: Stateless event-driven pipeline orchestration (no saga process)

Status: Accepted (2026-06)

## Context

Video generation is a DAG (`script → [translate] → tts → avatar ∥ subtitles → render → thumbnail → finalize`). Orchestration options: a long-lived saga/workflow engine (Temporal, custom state process) vs. reacting to events with state in the database.

## Decision

The orchestrator is a stateless event handler: on `video.queued` / `pipeline.stage_completed` / `pipeline.stage_failed` it loads the `PipelineRun`, computes `readyStages()` (pure function over the DAG definition + completed/skipped sets), and enqueues them with `jobId = runId:stage`. Stage results live in `PipelineRun.artifacts` (Postgres JSON). Stage handlers no-op when their artifact already exists.

## Consequences

- Crash-safe by construction: any orchestrator or worker can die at any point; re-delivery re-derives the next action from the DB. Resume = re-emit the last event.
- Idempotent enqueue (BullMQ jobId dedup) makes duplicate events harmless.
- Pipelines are declarative JSON — the same engine will execute visual Workflow-Builder definitions (Phase 5) with zero orchestrator changes.
- Cost: no built-in timers/compensation DSL (timeouts handled per-stage via BullMQ); complex human-in-the-loop flows would need explicit wait-states later.
- Rejected: Temporal (heavy dependency, hides state from our DB), in-process saga objects (lose state on crash, pin runs to one node).
