# SurfGen Developer Guide

How to set up a working environment, navigate the monorepo, and make changes that pass the gate.

## Repository layout

```
apps/
├── api/                NestJS (Fastify) API gateway — REST, OpenAPI at /docs, WebSockets
├── web/                Next.js studio (App Router)
├── workers/pipeline/   BullMQ pipeline workers + event-driven orchestrator
├── cli/                Node CLI (talks to the API)
├── cli-py/             Python CLI
└── desktop/            Desktop shell (wraps the web app)

packages/
├── core/               Domain, ports, errors, Result — framework-free, zero runtime deps
├── ai-sdk/             AIProvider contract, ProviderRegistry, runners, capability types
├── plugin-sdk/         Plugin manifest schema, loader, secret refs, conformance suite
├── config/             Layered config loader + zod schemas for config/*.yaml|json
├── db/                 Prisma schema/client, soft-delete extension, seed
├── queue/              BullMQ adapters, queue definitions, stage worker factory
├── events/             Event envelope, RabbitMQ + in-memory bus, outbox
├── storage/            StoragePort adapters (S3/MinIO, local filesystem)
├── safe-net/           SSRF-hardened fetch for outbound calls (webhooks, brand extract)
├── telemetry/          pino logger, prom-client metrics, OpenTelemetry tracing
└── integration/        Cross-package gate tests (provider swap)

plugins/                Provider plugins — vendor-specific code lives ONLY here
config/                 ai.yaml, providers.json, models.yaml, storage.yaml, video.yaml
infra/                  docker, k8s/helm, terraform, monitoring
docs/                   PRD, specs, architecture, ADRs, guides
```

Two hard boundaries (see [ADR-002](../architecture/adr/ADR-002-hexagonal-framework-free-core.md) and
[ADR-003](../architecture/adr/ADR-003-provider-abstraction-registry.md)):

- `packages/core` defines ports (`StoragePort`, `JobQueuePort`, `EventPublisherPort`, …) and has no
  framework or infrastructure dependencies. Infrastructure packages provide adapters.
- **No application code ever names an AI vendor.** Vendor code lives in `plugins/`; application code
  requests *capabilities* (`'tts'`, `'llm'`, …) from the `ProviderRegistry` in `packages/ai-sdk`.
  Which vendor serves a capability is decided by [`config/ai.yaml`](../../config/ai.yaml). The gate
  test [`packages/integration/test/provider-swap.test.ts`](../../packages/integration/test/provider-swap.test.ts)
  proves the same flow routes to OpenAI, Ollama, or a mock purely by changing YAML.

## Prerequisites

- **Node.js ≥ 22** (`engines` in the root `package.json`)
- **pnpm 10.12.1** — activated via corepack by the installer
- **Docker** — for Postgres, Redis, RabbitMQ, MinIO (`infra/docker/docker-compose.dev.yml`)
- **ffmpeg** — required for local rendering (`brew install ffmpeg` / `apt install ffmpeg`)
- Optional local model runtimes: `piper` (TTS), `whisper` (ASR), Ollama (LLM). Absent runtimes are
  fine — the default config falls back to deterministic mocks (`plugins/mock-suite`), so the
  pipeline works with **zero credentials**.

## Setup

### Scripted

```bash
./scripts/install.sh
```

[`scripts/install.sh`](../../scripts/install.sh) checks Node/pnpm/ffmpeg/Docker, runs
`pnpm install`, creates `.env` from `.env.example`, starts the dev infrastructure containers,
generates the Prisma client, applies (or creates) migrations, seeds, and runs `pnpm turbo build`.

### Manual

```bash
pnpm install
cp .env.example .env                                       # DATABASE_URL, REDIS_*, AMQP_URL, JWT_SECRET…
docker compose -f infra/docker/docker-compose.dev.yml up -d
pnpm --filter @surfgen/db generate
pnpm --filter @surfgen/db exec prisma migrate deploy       # or `prisma migrate dev --name init`
pnpm db:seed
pnpm turbo build
```

### Run

```bash
pnpm dev                                     # turbo run dev across all apps
# or individually:
pnpm --filter @surfgen/api start             # API on :4000 (Swagger at /docs, spec at /docs/openapi.json)
pnpm --filter @surfgen/worker-pipeline start # workers + orchestrator (metrics on :9464)
pnpm --filter @surfgen/web dev               # studio on :3000
```

Dev consoles: MinIO `http://127.0.0.1:9001`, RabbitMQ `http://127.0.0.1:15672`
(both `surfgen` / `surfgen-dev`).

## The gate

Every change must pass all four turbo tasks across the workspace (88 tasks at time of writing):

```bash
pnpm turbo build test lint typecheck
```

`lint`, `typecheck`, and `test` depend on `^build` (see [`turbo.json`](../../turbo.json)), so a
broken downstream build fails the whole gate. Formatting: `pnpm format:check`.

## Adding an API endpoint

`apps/api` is NestJS on Fastify ([ADR-004](../architecture/adr/ADR-004-nestjs-fastify.md)). Follow
the conventions in an existing controller, e.g.
[`apps/api/src/videos/videos.controller.ts`](../../apps/api/src/videos/videos.controller.ts):

```ts
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { Principal, RequireOrgRole, type AuthenticatedPrincipal } from '../auth/guards';

const CreateThingSchema = z.object({ title: z.string().min(1).max(200) });

@ApiTags('things')
@ApiBearerAuth()
@Controller({ path: 'orgs/:orgId/things', version: '1' })
export class ThingsController {
  constructor(private readonly things: ThingsService) {}

  @Post()
  @RequireOrgRole('editor')
  create(
    @Param('orgId') orgId: string,
    @Principal() principal: AuthenticatedPrincipal,
    @Body(new ZodValidationPipe(CreateThingSchema)) body: z.infer<typeof CreateThingSchema>,
  ) {
    return this.things.create(orgId, principal.userId, body);
  }
}
```

The moving parts (all under [`apps/api/src/common/`](../../apps/api/src/common) and
[`apps/api/src/auth/guards.ts`](../../apps/api/src/auth/guards.ts)):

- **Validation** — `ZodValidationPipe` on `@Body(...)` / `@Query(...)`. Invalid input returns a 400
  with `code: 'VALIDATION_ERROR'` and flattened zod issues. Never trust raw request data.
- **Auth** — a global `AuthGuard` accepts a Bearer JWT or an `X-Api-Key` header and attaches
  `request.principal`. Opt out with `@Public()`. `@RequireOrgRole('viewer' | 'editor' | 'admin' | 'owner')`
  enforces membership against the `:orgId` route param (role ranks: viewer < editor < admin < owner;
  API keys are pinned to one org).
- **Envelope** — `EnvelopeInterceptor` wraps every success as
  `{ success: true, data, error: null }`. Return `{ data, meta }` from a handler to attach
  pagination metadata; return a bare value otherwise. Never build the envelope by hand.
- **Errors** — throw the domain errors from `@surfgen/core` (`NotFoundError`, `ForbiddenError`,
  `ValidationError`, …); `domain-exception.filter.ts` maps them to HTTP with stable codes.
- **Data access** — inject `PrismaService`. Route URIs are versioned (`version: '1'` → `/v1/...`).

### The `import type` DI footgun (CommonJS API only)

`apps/api` is **CommonJS** with `emitDecoratorMetadata`. Using `import type` for a class that Nest
injects via constructor erases `design:paramtypes` and silently injects `undefined`:

```ts
import type { VideosService } from './videos.service'; // ✗ breaks DI — injects undefined
import { VideosService } from './videos.service';      // ✓ value import for DI-injected classes
```

`consistent-type-imports` is disabled for the API package for this reason — the paper trail is
[ADR-004](../architecture/adr/ADR-004-nestjs-fastify.md). Everything else in the monorepo is ESM
(`"module": "NodeNext"`), where relative imports **must carry the `.js` suffix**
(`import { x } from './registry.js'`), and `import type` is preferred (enforced by the root
ESLint config).

## Adding a pipeline stage

The pipeline is a declarative DAG executed by a stateless, event-driven orchestrator
([ADR-007](../architecture/adr/ADR-007-stateless-event-driven-orchestration.md)). Three places to touch:

1. **Stage definition** — add the stage to
   [`apps/workers/pipeline/src/pipelines/default-video.ts`](../../apps/workers/pipeline/src/pipelines/default-video.ts):

   ```ts
   {
     name: 'my_stage',
     capability: 'tts',        // AI capability the stage consumes, or null for pure compute (ffmpeg)
     queue: 'cpu.default',     // JobQueueName: cpu.default | cpu.media | gpu.default | gpu.heavy | io.*
     dependsOn: ['script'],    // DAG edges; [] = entry point
     maxAttempts: 3,
     optional: false,          // optional stages skip on failure instead of failing the run
   }
   ```

   If the name is new, extend the `StageName` union in
   [`packages/core/src/domain/pipeline.ts`](../../packages/core/src/domain/pipeline.ts) and add a
   weight to `STAGE_PROGRESS_WEIGHTS` (drives `video.progress` percentages).

2. **Handler** — add an entry to `createStageHandlers` in
   [`apps/workers/pipeline/src/stages/handlers.ts`](../../apps/workers/pipeline/src/stages/handlers.ts).
   Wrap the body with the `stage(runtime, …)` helper; it gives you upstream artifacts, persists your
   returned artifact into `PipelineRun.artifacts`, publishes `pipeline.stage_completed` /
   `pipeline.stage_failed`, and makes retries resume-safe (an existing artifact skips recompute).
   Call AI through the registry — never a vendor SDK:

   ```ts
   my_stage: stage(runtime, async (ctx, artifacts) => {
     const output = await collectFinalOutput(
       runtime.registry.execute<TTSInput, TTSOutput>('tts', { text, voiceId }, {
         organizationId: ctx.data.organizationId,
         correlationId: ctx.data.runId,
       }),
     );
     return { audioKey: output.audio.storageKey };   // becomes artifacts.my_stage downstream
   }),
   ```

3. **Tests** — see [`apps/workers/pipeline/test/orchestrator.test.ts`](../../apps/workers/pipeline/test/orchestrator.test.ts)
   for the fake-Prisma/fake-queue pattern.

Mechanics worth knowing: the orchestrator enqueues each ready stage with
`jobId = \`${runId}:${stage.name}\`` (BullMQ dedup makes double-enqueues no-ops), workers pick jobs
off the queues selected by `WORKER_QUEUES`, and events flow over the `surfgen.events` RabbitMQ topic
exchange with org-scoped envelopes (`createEnvelope` from `@surfgen/events`).

## Key conventions

- **Secrets are references, never literals** — `env:NAME`, `file:/path`, `vault:path`, resolved at
  the moment of use by `resolveSecretRef` in
  [`packages/plugin-sdk/src/secrets.ts`](../../packages/plugin-sdk/src/secrets.ts). The
  `@surfgen/config` schemas reject plaintext secrets in config files, and API inputs that accept
  secrets (e.g. webhook `secretRef`) validate the `^(env|vault|file):` shape.
- **Soft delete** — soft-deletable models carry `deletedAt`. Workers wrap the client with
  `withSoftDelete(createPrismaClient())` ([`packages/db/src/index.ts`](../../packages/db/src/index.ts)),
  which injects `deletedAt: null` into reads *and* writes unless the caller filters `deletedAt`
  explicitly. API services filter explicitly (`where: { …, deletedAt: null }`) and delete by setting
  `deletedAt: new Date()` — see `softDelete` in `apps/api/src/videos/videos.service.ts`.
- **Prisma JSON casts** — Prisma's generated JSON input types don't accept arbitrary domain shapes;
  the convention when writing a typed object into a `Json` column is a narrow `as never` cast at the
  write site (e.g. `data: { definition: definition as never }` in the orchestrator). Keep the cast
  at the Prisma call, not on the domain value.
- **Immutability, small files, early returns** — see the domain packages for the house style;
  `Result`/`ok`/`err` from `@surfgen/core` for expected failures, thrown domain errors for the rest.

## How the web app talks to the API

Everything lives in [`apps/web/lib/api/`](../../apps/web/lib/api):

- [`client.ts`](../../apps/web/lib/api/client.ts) — the single fetch wrapper. Base URL from
  `NEXT_PUBLIC_API_URL` (default `http://localhost:4000`). It unwraps the
  `{ success, data, error, meta }` envelope and throws `ApiError(code, message)` on failure. The
  access token lives **in memory only**; the refresh token is an httpOnly `SameSite=Strict` cookie
  scoped to `/v1/auth`. 401s trigger a single-flight silent refresh; nothing touches localStorage.
- [`hooks.ts`](../../apps/web/lib/api/hooks.ts) — TanStack Query hooks (`useOrg`, `useVideos`,
  `useProviders`, …) over `api<T>(method, path, body)`. Server state stays in React Query; don't
  duplicate it into client stores.
- [`live.tsx`](../../apps/web/lib/api/live.tsx) — one WebSocket to the API gateway (`/ws`,
  org-scoped rooms) for `video.progress` / pipeline events; incoming events invalidate the relevant
  query keys.
- [`types.ts`](../../apps/web/lib/api/types.ts) — response types shared by hooks and pages.

New UI data needs = add the endpoint to the API, a type in `types.ts`, and a hook in `hooks.ts`.

## Testing philosophy

- **Vitest everywhere, per package** — each package/app owns `vitest.config.ts` and a `test/`
  directory; `pnpm turbo test` runs them all. Arrange-Act-Assert with descriptive test names.
- **Providers prove themselves with the conformance suite** — every provider plugin runs
  `providerConformanceSuite(...)` from `@surfgen/plugin-sdk/conformance` (see
  [the Plugin SDK guide](../plugins/plugin-sdk-guide.md)). External binaries/APIs are faked: the
  Piper tests use a shim executable ([`plugins/tts-piper/test/piper.test.ts`](../../plugins/tts-piper/test/piper.test.ts)),
  HTTP providers inject a `fetchImpl`.
- **Cross-package guarantees live in `packages/integration`** — most importantly the
  provider-swap gate test, which must keep passing: it is the executable form of the headline
  requirement ([ADR-010](../architecture/adr/ADR-010-zero-credential-reference-path.md)).
- **Workers test against structural fakes** — the orchestrator and webhook dispatcher take
  interfaces (`OrchestratorDeps`, `DispatcherPrisma`), so tests pass plain objects instead of a
  database.
