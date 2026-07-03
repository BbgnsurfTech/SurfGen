# SurfGen — Non-Functional Specification

Status: Living document · Owner: Architecture · Related: [PRD](./PRD.md), [Functional Spec](./functional-spec.md), [High-Level Architecture](../architecture/high-level-architecture.md)

Every requirement below is stated as a measurable target. "MUST" targets gate a release; "SHOULD" targets are tracked on dashboards and drive roadmap priority.

## 1. Scalability

| ID | Requirement | Target |
|----|-------------|--------|
| SCA-1 | Registered users supported per deployment | MUST: 1M; SHOULD: 10M |
| SCA-2 | Concurrent render jobs in flight | MUST: 1,000; SHOULD: 10,000 |
| SCA-3 | API horizontal scaling | MUST: stateless api pods — any request served by any pod (JWT auth, Redis-backed rate limits, no in-process session) |
| SCA-4 | Worker scaling | MUST: workers scale per queue class (`cpu.default`, `cpu.media`, `gpu.default`, `gpu.heavy`, `io.*`) independently; adding a worker requires zero config changes elsewhere |
| SCA-5 | Queue depth headroom | MUST: 100k queued jobs without broker degradation (BullMQ/Redis); RabbitMQ event backlog 1M messages with lazy queues |
| SCA-6 | Database growth | MUST: schema supports partition-ready hot tables (`Job`, `UsageRecord`, `AuditLog`, `OutboxEvent` are append-heavy and keyed by time + org) |
| SCA-7 | Multi-region readiness | SHOULD: object storage + CDN per region; single-writer Postgres with read replicas; no architectural blocker to region sharding by org |

## 2. Performance

| ID | Requirement | Target |
|----|-------------|--------|
| PER-1 | API read latency (p95) | MUST: < 200 ms; SHOULD: < 100 ms |
| PER-2 | API write latency (p95) | MUST: < 400 ms |
| PER-3 | Job pickup latency (enqueue → worker start) | MUST: < 2 s p95 under nominal load |
| PER-4 | Progress event latency (worker → WebSocket client) | MUST: < 1 s p95 |
| PER-5 | 60-second 1080p video, all-local reference providers | SHOULD: < 5 min wall clock on 8-core CPU (no GPU) |
| PER-6 | Web studio Core Web Vitals | MUST: LCP < 2.5 s, INP < 200 ms, CLS < 0.1 on landing + dashboard |
| PER-7 | Web JS budget | MUST: landing < 150 kB gz; app pages < 300 kB gz (editor may lazy-load beyond via dynamic import) |
| PER-8 | Provider failover decision time | MUST: < 5 s from first failure to fallback provider start (health cache TTL 30 s, unhealthy cooldown 60 s) |

## 3. Availability & Reliability

| ID | Requirement | Target |
|----|-------------|--------|
| AVA-1 | API availability | MUST: 99.9% monthly (SLO); error budget 43 min/month |
| AVA-2 | Job completion guarantee | MUST: at-least-once processing; every stage idempotent (jobId = `runId:stage`); a killed worker mid-stage MUST NOT lose the run — retry resumes from persisted artifacts |
| AVA-3 | Event delivery | MUST: transactional outbox for DB-coupled events; publisher confirms on RabbitMQ; DLX dead-letter queue with replay tooling |
| AVA-4 | Provider outage tolerance | MUST: any single AI provider outage degrades to the next provider in the capability chain with no failed videos (failover only before first output event) |
| AVA-5 | Graceful shutdown | MUST: workers drain in-flight jobs on SIGTERM (30 s grace) before exit; API stops accepting, finishes in-flight |
| AVA-6 | Backups | MUST: Postgres PITR (WAL archiving), daily snapshot, RPO ≤ 5 min, RTO ≤ 1 h; object storage versioning on `org/**` buckets |
| AVA-7 | Chaos posture | SHOULD: kill-worker-mid-render test in CI (Phase 8); monthly game-day in production ops manual |

## 4. Security

| ID | Requirement | Target |
|----|-------------|--------|
| SEC-1 | Transport | MUST: TLS 1.2+ everywhere external; HSTS (max-age ≥ 1 y, includeSubDomains) |
| SEC-2 | Authentication | MUST: 15-min access JWTs, rotating refresh tokens stored hashed (sha256); API keys scoped + hashed; OAuth2/OIDC pluggable |
| SEC-3 | Authorization | MUST: org-scoped RBAC (viewer < editor < admin < owner) enforced by guards on every org route; no cross-org data access (tested) |
| SEC-4 | Secrets | MUST: config accepts only secret *references* (`env:`, `file:`, `vault:` — zod-enforced); no secret material in DB, logs, or config files |
| SEC-5 | Log hygiene | MUST: pino redaction of `apiKey`, `password`, `token`, `secret`, `authorization`, `cookie` paths |
| SEC-6 | Input validation | MUST: zod validation at every API boundary; Prisma parameterized queries only; upload content-type + size allowlists |
| SEC-7 | Rate limiting | MUST: per-IP and per-principal limits on all endpoints; stricter on auth endpoints |
| SEC-8 | Audit | MUST: audit log on every state-changing API request (actor, org, action, resource, ip) |
| SEC-9 | Consent for biometric cloning | MUST: `consentToken` required by the SDK types on voice-clone and face-swap inputs; providers reject without it |
| SEC-10 | Supply chain | MUST: dependency audit + image scan in CI; plugin entry paths confined to plugin dir; plugin permissions declared in manifest (`network`, `filesystem`, `subprocess`, `gpu`) |
| SEC-11 | Webhooks | MUST: HMAC-SHA256 signed deliveries with timestamp, replay window ≤ 5 min |

## 5. Data & Compliance

| ID | Requirement | Target |
|----|-------------|--------|
| DAT-1 | Soft delete | MUST: all org-scoped entities soft-delete (`deletedAt`); reads filtered by default at the ORM extension layer |
| DAT-2 | Hard delete / GDPR erasure | MUST: admin job purges soft-deleted rows + storage objects after retention window (default 30 days) |
| DAT-3 | Data residency | SHOULD: storage driver + bucket per region selectable per org |
| DAT-4 | PII minimization | MUST: only email + name required; media consent artifacts retained with the clone that used them |
| DAT-5 | Exportability | SHOULD: org data export (JSON + media manifest) via async job |

## 6. Observability

| ID | Requirement | Target |
|----|-------------|--------|
| OBS-1 | Logs | MUST: structured JSON (pino), request-id + org-id correlation, centralized shipping |
| OBS-2 | Metrics | MUST: Prometheus `/metrics` on api + workers: `jobs_processed_total`, `job_duration_seconds` (buckets → 600 s), `provider_latency_seconds`, `provider_failures_total`, queue depths, HTTP RED metrics |
| OBS-3 | Traces | MUST: OpenTelemetry spans across api → queue → worker → provider (traceparent propagated in job payload + event envelope) |
| OBS-4 | Dashboards | MUST: Grafana boards for API RED, pipeline throughput/failures, provider health, queue depth (shipped in `infra/monitoring`) |
| OBS-5 | Alerting | MUST: alert rules for error-budget burn, queue depth stall, DLQ growth, provider chain exhaustion |

## 7. Portability & Deployability

| ID | Requirement | Target |
|----|-------------|--------|
| POR-1 | Zero-credential path | MUST: fresh checkout + `./scripts/install.sh` yields a working script→mp4 pipeline with NO cloud API keys (Piper TTS + FFmpeg + mocks) |
| POR-2 | Provider swap | MUST: swapping any AI provider (cloud ↔ local) is a config-only change to `config/ai.yaml`; proven by the `provider-swap` integration gate test |
| POR-3 | Runtime targets | MUST: docker-compose (dev + full) and Helm/K8s; SHOULD: Terraform reference modules for AWS |
| POR-4 | Images | MUST: multi-stage builds, non-root user, pinned base images; worker image bundles ffmpeg |
| POR-5 | Config | MUST: defaults → file → env layering; boot fails fast with a readable error on invalid config |

## 8. Maintainability & Quality

| ID | Requirement | Target |
|----|-------------|--------|
| MNT-1 | Coverage | MUST: ≥ 80% on packages/*; conformance suite (`providerConformanceSuite`) passed by every plugin |
| MNT-2 | Architecture boundaries | MUST: `packages/core` has zero runtime deps; nothing outside `plugins/` names a vendor; enforced by review + lint |
| MNT-3 | File size | MUST: < 800 lines/file (hook-enforced); functions < 50 lines target |
| MNT-4 | CI | MUST: lint + typecheck + unit + integration + docker build on every PR; main always releasable |
| MNT-5 | Versioning | MUST: semver via changesets; plugin manifests declare compatible SDK range |

## 9. Cost

| ID | Requirement | Target |
|----|-------------|--------|
| CST-1 | Provider routing | SHOULD: registry cost hints allow "cheapest healthy provider" routing policy per org |
| CST-2 | GPU utilization | SHOULD: GPU queues sized so idle GPU time < 20% at steady state (HPA on queue depth) |
| CST-3 | Storage lifecycle | SHOULD: renders older than N days transition to infrequent-access tier; temp artifacts TTL-deleted |
