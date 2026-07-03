# SurfGen — Low-Level Architecture

Status: Living document · Related: [High-Level Architecture](./high-level-architecture.md), [ERD](./erd.md)

This document explains the load-bearing mechanisms package by package, with the invariants that keep them correct. File references are repo-relative.

## 1. `packages/core` — domain

- **Result type** (`src/result.ts`): `ok/err` discriminated union with `map`, `andThen`, `all`, `tryCatch`. Domain functions never throw for expected failures.
- **Errors** (`src/errors.ts`): `DomainError` carries an `ErrorCode` union and a `retryable` flag. Workers use `retryable` to decide between BullMQ retry and `UnrecoverableError`; the API maps codes to HTTP statuses in one exception filter.
- **Branded IDs** (`src/ids.ts`): `Brand<string, 'VideoId'>` etc. — compile-time prevention of ID cross-wiring.
- **State machines as data** (`src/domain/state-machine.ts`): `TransitionTable<S>` maps `state → allowed next states`. `JOB_TRANSITIONS` and `VIDEO_TRANSITIONS` are plain objects; `canTransition`/`assertTransition` are pure functions, trivially testable, and shared by API and workers.
- **Pipeline DAG** (`src/domain/pipeline.ts`): a pipeline definition is data — stages with `dependsOn` and `optional`. `validatePipeline` runs Kahn's algorithm (cycle + unknown-dep detection); `readyStages(definition, completed, skipped)` returns the next executable stages. The orchestrator holds no state of its own.
- **Ports** (`src/ports/ports.ts`): `StoragePort`, `EventPublisherPort`, `EventSubscriberPort`, `JobQueuePort`, `ClockPort`, `UnitOfWorkPort`. Everything infrastructure implements one of these.

Invariant: this package has **zero runtime dependencies**. If a change needs an import, it belongs in another package.

## 2. `packages/ai-sdk` — provider abstraction

- **`AIProvider<TIn, TOut>`** (`src/provider.ts`): `initialize(cfg)`, `health()`, `capabilities()`, `generate(input, ctx): AsyncIterable<ProviderEvent<TOut>>`, `shutdown()`. Streaming is the *only* generate shape — non-streaming providers emit one `output` event. `ProviderEvent` = `progress | output | log`.
- **Capability catalog** (`src/capability.ts`): the 15 capabilities as a readonly tuple; `CapabilityDescriptor` declares formats, limits, cost hints, `deployment: cloud | local | self_hosted`, and languages.
- **Typed capability contracts** (`src/capabilities/*.ts`): `TTSInput/Output` (with `WordTiming[]` for lip-sync/subtitles), `LLMInput/Output`, `AvatarInput` (`avatarRef` union), `TranslationInput/Output`, etc. `VoiceCloneInput` and `FaceSwapInput` **require** `consentToken` at the type level.
- **`ProviderRegistry`** (`src/registry.ts`) — the heart:
  - Resolution: `resolve(capability, opts)` filters by deployment/language, applies per-org overrides, sorts by priority (lower wins).
  - Health gating: `health()` results cached 30 s; a provider that fails goes into a 60 s unhealthy cooldown before re-probe.
  - Failover: `generateWithFailover` walks the chain, but **only fails over before the first `output` event** — two providers' outputs are never spliced into one result.
- **Runners** (`src/runners/`): transport strategies (`http-runner`, `cli-runner`; python/docker/grpc/onnx follow the same interface). A provider = manifest + runner + input/output mappers, so adding a vendor is mapping code only.
- **`ModelDiscoveryService`** (`src/discovery.ts`): probes well-known local endpoints (Ollama :11434, LM Studio :1234, vLLM :8000, ComfyUI :8188, …) and binaries (`ffmpeg`, `piper`, `whisper`) to auto-flag which local providers are usable.
- **`MockProvider`** (`src/testing/mock-provider.ts`): configurable `failFirst`, `progressSteps`, `produce` — used by unit tests, the conformance suite, and the zero-credential path.

## 3. `packages/plugin-sdk` — plugin contract

- **Manifest** (`src/manifest.ts`): zod-validated `plugin.manifest.json` — kebab-case name, semver, capability list, permissions enum (`network`, `filesystem`, `subprocess`, `gpu`), config schema ref.
- **Loader** (`src/loader.ts`): resolves the manifest `entry` and **confines it inside the plugin directory** (path-traversal guard); `loadAll` isolates failures so one broken plugin cannot take down the process.
- **Secrets** (`src/secrets.ts`): `resolveSecretRef` accepts only `env:`, `file:`, `vault:` prefixes — raw secret strings are rejected upstream by the config schema.
- **Conformance** (`./conformance` subpath export): `providerConformanceSuite(factory)` — a vitest suite every plugin must pass (init/health/generate-streams/shutdown/error mapping). Kept in a separate export so runtime consumers never pull in vitest.

## 4. `packages/config` — layered configuration

Precedence: defaults → `config/*.yaml|json` file → environment (`SURFGEN_SCOPE__PATH`, case-insensitively matched against existing keys so env vars can address camelCase keys) → zod parse. Boot fails fast with a readable path-level error. `watchConfigFile` supports hot reload. The schemas cross-validate (e.g. storage driver ↔ required fields; `secretRef` regex; video dimensions `multipleOf(2)` because H.264 requires even dimensions).

## 5. `packages/events` — messaging

- **Envelope** (`src/envelope.ts`): `{ id: evt_…, name, occurredAt, orgId?, correlationId?, payload }` — one shape for both buses.
- **`InMemoryEventBus`**: AMQP topic semantics (`matchTopic` implements `*`/`#` with memoized DP incl. `#` backtracking) + a dead-letter array; used in dev/tests so API and worker behave identically without RabbitMQ.
- **`RabbitMqEventBus`**: confirm channel (publisher confirms), topic exchange `surfgen.events`, per-subscription queues with DLX → `surfgen.events.dead`, reconnect with exponential backoff, injectable `connectImpl` for tests.
- **Outbox** (`src/outbox.ts`): `OutboxRelay` polls the outbox store and publishes with at-least-once semantics; `PrismaOutboxStore` in `packages/db` writes events in the same transaction as domain writes.

## 6. `packages/queue` — job execution

- **Queue classes** (`src/queues.ts`): `cpu.default`, `cpu.media`, `gpu.default`, `gpu.heavy`, `io.webhooks`, `io.analytics` — workers subscribe by class (`WORKER_QUEUES` env), which is how CPU-only and GPU fleets scale independently.
- **Idempotency**: `jobId = runId:stage`; BullMQ dedupes on jobId, so orchestrator re-emission after a crash is harmless.
- **Cancellation** (`src/worker.ts`): `createStageWorker` polls `surfgen:cancel:{jobId}` every 2 s, flips an `AbortSignal`, and raises `UnrecoverableError` so BullMQ won't retry a cancelled job.

## 7. `packages/storage`

Key discipline in `src/keys.ts`: `org/<orgId>/<area>/<id>/<file>` with `sanitizeSegment` stripping traversal characters. `LocalStorage` writes atomically (temp file + rename), guards `resolveKey` against escaping the root, and serves dev-signed `local://` URLs; `S3Storage` takes an injected client factory (unit-testable, works with MinIO/R2/GCS-interop).

## 8. `packages/db`

Prisma schema: 34 models (see [ERD](./erd.md)). Two non-obvious mechanisms:

- **Soft-delete extension** (`src/index.ts`): wraps 12 guarded operations, AND-merging `{ deletedAt: null }` into `where` — `args.where = { AND: [{ deletedAt: null }, where] }` — unless the caller explicitly names `deletedAt`. AND-merge (not spread) so caller filters can never accidentally *widen* visibility.
- **Seed safety** (`src/seed.ts`): refuses `NODE_ENV=production`, generates a random password when none is provided, and only prints secrets to a TTY.

## 9. `apps/api`

NestJS on Fastify, CommonJS + decorators (`emitDecoratorMetadata`). Pipeline of cross-cutting pieces, in order: helmet → rate limit → `AuthGuard` (APP_GUARD; `@Public` opt-out; `@RequireOrgRole` with `viewer<editor<admin<owner` rank) → `ZodValidationPipe` → controller → `AuditInterceptor` (state-changing requests) → `EnvelopeInterceptor` (`{success,data,error,meta}`) → `DomainExceptionFilter` (ErrorCode → HTTP status). WS gateway authenticates via message protocol and joins org-membership rooms; it subscribes to the same event bus the workers publish to. Event bus selection: `AMQP_URL` present → RabbitMQ, else in-memory.

**Footgun (documented in `apps/api/eslint.config.mjs`):** `import type` on DI-injected classes erases `design:paramtypes` and silently breaks injection — the per-app ESLint config disables `consistent-type-imports` for value-injected classes.

## 10. `apps/workers/pipeline`

- **`StageRuntime`** (`src/runtime.ts`): loads/saves artifacts on `PipelineRun.artifacts` (JSON column — DB is the source of truth, enabling resume).
- **Default pipeline** (`src/pipelines/default-video.ts`): `script → [translate] → tts → (avatar ∥ subtitles) → render → thumbnail → finalize`, with `STAGE_PROGRESS_WEIGHTS` for smooth overall progress.
- **Stage wrapper** (`src/stages/handlers.ts`): every handler runs through `stage()` — if the artifact already exists the stage is a no-op (resume), and only the *final* BullMQ attempt publishes `stage_failed`. `materialize()` skips `mock/`-prefixed keys so mock providers need no storage.
- **Render**: FFmpeg reference path — avatar video or `color=c=0x10101c` background + TTS audio (or 3 s color slate), libx264 CRF. Works with zero cloud credentials.
- **Bootstrap** (`src/main.ts`): loads plugins via `PluginLoader.loadAll`, builds the registry from config, runs model discovery, then starts workers for the queue classes in `WORKER_QUEUES`.

## 11. Testing strategy per layer

| Layer | Approach |
|---|---|
| core / ai-sdk | pure unit tests, no mocks needed beyond `MockProvider` |
| plugins | injected `fetch`/CLI shims + `providerConformanceSuite` |
| config/events/storage/queue | contract tests against in-memory implementations |
| api | vitest + swc (es6 module transform), supertest-style integration |
| integration | **provider-swap gate**: same `generateScript()` flow under cloud-first, local-first, zero-cred, and outage-failover configs |
| worker | stage handlers against temp dirs + real ffmpeg where available |
