# SurfGen — Entity-Relationship Overview

Status: Living document · Source of truth: [`packages/db/prisma/schema.prisma`](../../packages/db/prisma/schema.prisma) (34 models). This doc explains the shape and the reasoning; the schema file wins on details.

## Conventions

- Every org-scoped entity: `id` (cuid), `orgId`, `createdAt`, `updatedAt`, `deletedAt` (soft delete — reads filtered by the Prisma extension in `packages/db/src/index.ts`).
- Enums mirror the domain state machines in `packages/core` (`VideoStatus`, `JobStatus`, `RunStatus`) — the DB stores states; the *transitions* are enforced in code by `TransitionTable`.
- Money/usage rows are append-only; no row is ever mutated after creation (`UsageRecord`, `AuditLog`, `WebhookDelivery`, `OutboxEvent`).

## Domain clusters

```mermaid
erDiagram
    %% ---- Identity & tenancy ----
    User ||--o{ OAuthAccount : "logs in via"
    User ||--o{ RefreshToken : "holds (hashed, rotating)"
    User ||--o{ Membership : ""
    Organization ||--o{ Membership : "role: viewer|editor|admin|owner"
    Organization ||--o{ Team : ""
    Team ||--o{ TeamMember : ""
    Organization ||--o{ Project : ""
    Organization ||--o{ ApiKey : "scoped, hashed"

    %% ---- Video authoring ----
    Project ||--o{ Video : ""
    Video ||--o{ Scene : "ordered"
    Scene ||--o{ TimelineTrack : "kind: video|audio|caption|overlay"
    TimelineTrack ||--o{ TimelineClip : ""
    Organization ||--o{ Asset : "kind: image|audio|video|font|other"
    Organization ||--o{ Template : ""
    Template ||--o{ TemplateVariable : "kind: text|media|color|number"

    %% ---- AI identity assets ----
    Organization ||--o{ Avatar : "kind: photo|video|synthetic"
    Avatar ||--o{ AvatarVersion : "trained versions"
    Organization ||--o{ Voice : ""
    Voice ||--o{ VoiceClone : "consent artifact retained"

    %% ---- Execution ----
    Organization ||--o{ Workflow : "declarative JSON DAG"
    Workflow ||--o{ WorkflowRun : ""
    Video ||--o{ PipelineRun : "artifacts JSON = resume state"
    PipelineRun ||--o{ Job : "one per stage; jobId = runId:stage"

    %% ---- Provider management ----
    Organization ||--o{ ProviderConfig : "per-org overrides"
    ProviderConfig ||--o{ ModelRecord : "discovered/registered models"

    %% ---- Delivery & governance ----
    Organization ||--o{ Webhook : "HMAC secret ref"
    Webhook ||--o{ WebhookDelivery : "signed attempts"
    Organization ||--o{ UsageRecord : "append-only metering"
    Organization ||--o{ Quota : "per capability/period"
    Organization ||--|| BillingAccount : ""
    BillingAccount ||--o{ Subscription : ""
    BillingAccount ||--o{ Invoice : ""
    Organization ||--o{ AuditLog : "every state change"
    User ||--o{ Notification : ""
```

Plus two standalone tables: `Plugin` (installed plugin registry + manifest snapshot) and `OutboxEvent` (transactional outbox — written in the same transaction as domain changes, relayed to RabbitMQ by `OutboxRelay`).

## Cluster notes

### Identity & tenancy
`Membership.role` is the single RBAC source (`OrgRole` enum); guards rank roles `viewer < editor < admin < owner`. `ApiKey` stores only a sha256 hash + scopes; `RefreshToken` rows are rotated on every refresh (old row revoked), which makes token theft detectable via reuse.

### Video authoring
`Video → Scene → TimelineTrack → TimelineClip` is the editor's document model; the pipeline reads it, never writes it. `Template` + `TemplateVariable` let a video be instantiated from a parameterized design.

### Execution
`PipelineRun.artifacts` (JSON) maps `stage → artifact refs`. This is the crash-safety mechanism: a restarted stage first checks for its artifact and no-ops if present, so at-least-once delivery converges to exactly-once effects. `Job` rows carry per-stage status/progress/error for the UI; BullMQ holds the ephemeral copy.

### Provider management
`ProviderConfig` stores per-org provider enablement/priority overrides — the DB layer of the config precedence chain (file config is deployment-wide; this table is org-specific). Secrets are stored as references (`env:`/`vault:`/`file:`), never as material.

### Governance
`UsageRecord` is the metering primitive (capability, provider, units, cost hint) that billing aggregates into `Invoice`. `AuditLog` rows come from the API's audit interceptor: actor, org, action, resource, IP.

## Scale & partitioning posture

Hot append-only tables (`Job`, `UsageRecord`, `AuditLog`, `OutboxEvent`, `WebhookDelivery`) are keyed by `(orgId, createdAt)` and contain no cross-row constraints, so they can move to native Postgres partitioning by month without schema redesign (see [NFR SCA-6](../product/non-functional-spec.md)).

## Regenerating this view

```bash
pnpm --filter @surfgen/db exec prisma generate   # client
pnpm --filter @surfgen/db exec prisma migrate dev # against local compose stack
```

The first migration is generated on the first `scripts/install.sh` run with Docker up (deliberately not committed from a machine without a database — see build state notes).
