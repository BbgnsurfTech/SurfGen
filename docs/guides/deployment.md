# SurfGen Deployment & Operations Manual

How to run SurfGen with Docker Compose, Kubernetes (Helm), and AWS (Terraform), and how to scale,
monitor, back up, and harden it.

## Topology

| Component | Image / chart piece | Listens on | Depends on |
| --------- | ------------------- | ---------- | ---------- |
| `api` (NestJS/Fastify) | `infra/docker/Dockerfile.api` | `:4000` (`/healthz`, `/readyz`, `/metrics`, `/docs`) | Postgres, Redis, RabbitMQ, S3 |
| `worker` (pipeline) | `infra/docker/Dockerfile.worker` | `:9464` (`/metrics`, `/healthz`) | Postgres, Redis, RabbitMQ, S3 |
| `web` (Next.js) | `infra/docker/Dockerfile.web` | `:3000` | api |
| Postgres 16 | managed / compose | 5432 | — |
| Redis 7 (BullMQ) | managed / compose | 6379 | — |
| RabbitMQ 3.13 (`surfgen.events` topic exchange) | managed / compose | 5672 | — |
| S3-compatible storage (MinIO/S3/R2) | managed / compose | 9000 | — |

## Environment variables

Everything below is read via `process.env` in the codebase (file references included so you can
verify). App-level config beyond this lives in `config/*.yaml` — see the override syntax at the end.

### API (`apps/api`)

| Variable | Default | Used in |
| -------- | ------- | ------- |
| `PORT` | `4000` | `apps/api/src/main.ts` |
| `JWT_SECRET` | dev fallback; **startup error if unset when `NODE_ENV=production`** | `apps/api/src/auth/auth.module.ts` |
| `CORS_ORIGINS` | allow all (`true`) | comma-separated origin list, `apps/api/src/main.ts` |
| `RATE_LIMIT_MAX` | `300` requests/min | `apps/api/src/main.ts` |
| `COOKIE_SECURE` | secure cookies already forced when `NODE_ENV=production`; set `true` to force elsewhere | `apps/api/src/auth/auth.controller.ts` |
| `NODE_ENV` | — | production toggles above |

### Workers (`apps/workers/pipeline`)

| Variable | Default | Used in |
| -------- | ------- | ------- |
| `WORKER_QUEUES` | `cpu.default,cpu.media,gpu.default,gpu.heavy` | queue classes this pod serves, `src/main.ts` |
| `METRICS_PORT` | `9464` | Prometheus scrape + liveness server |
| `AMQP_URL` | unset → **in-memory bus** (single-process dev only) | RabbitMQ connection |
| `REDIS_HOST` / `REDIS_PORT` | `127.0.0.1` / `6379` | BullMQ connection |
| `REDIS_PASSWORD` / `REDIS_TLS` | unset / off | managed Redis (ElastiCache auth token + in-transit TLS: `REDIS_TLS=true`) |
| `SURFGEN_CONFIG_DIR` | `./config` | where `ai.yaml` etc. are loaded from |
| `SURFGEN_PLUGINS_DIR` | `./plugins` | plugin discovery root |

### Shared / other

| Variable | Purpose |
| -------- | ------- |
| `DATABASE_URL` | Postgres DSN (`packages/db/prisma/schema.prisma`) |
| `LOG_LEVEL` | pino level, default `info` (`packages/telemetry/src/logger.ts`) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | enable OTLP trace export (`packages/telemetry/src/tracing.ts`) |
| `NEXT_PUBLIC_API_URL` | web → API base URL (`apps/web/lib/api/client.ts`) |
| `SURFGEN_S3_ACCESS_KEY` / `SURFGEN_S3_SECRET_KEY` | referenced by `config/storage.yaml` as `env:` secret refs |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`, `DEEPL_API_KEY`, `HEYGEN_API_KEY` | cloud provider keys, referenced as `env:` secret refs from provider config |
| `SEED_ADMIN_PASSWORD`, `SEED_PRINT_SECRETS` | `packages/db/src/seed.ts` (random password unless set; secrets only printed in a TTY or with `SEED_PRINT_SECRETS=1`) |
| `SURFGEN_API_URL`, `SURFGEN_API_KEY`, `SURFGEN_PASSWORD` | Node CLI (`apps/cli`) |
| `SURFGEN_WEB_URL` | desktop shell (`apps/desktop`) |

### Config file overrides via env

Any key in `config/*.yaml` can be overridden without editing files:
`SURFGEN_<SCOPE>__<PATH>__<TO>__<KEY>=value` (see `applyEnvOverrides` in
[`packages/config/src/loader.ts`](../../packages/config/src/loader.ts)). Examples used by the full
compose stack:

```bash
SURFGEN_STORAGE__DRIVER=s3
SURFGEN_STORAGE__ENDPOINT=http://minio:9000
SURFGEN_STORAGE__BUCKET=surfgen
SURFGEN_STORAGE__FORCEPATHSTYLE=true
SURFGEN_VIDEO__DEFAULTS__QUALITY=18
```

## Docker Compose

### Dev (infrastructure only)

App processes run on the host for fast iteration:

```bash
docker compose -f infra/docker/docker-compose.dev.yml up -d
pnpm dev
```

Brings up Postgres, Redis, RabbitMQ (+ management UI on `:15672`), MinIO (+ console on `:9001`),
and a one-shot `createbucket` job that creates the `surfgen` bucket. Dev credentials are
`surfgen` / `surfgen-dev` throughout.

### Full stack (everything containerized)

```bash
export JWT_SECRET="$(openssl rand -hex 32)"   # required — compose refuses to start without it
docker compose -f infra/docker/docker-compose.full.yml up --build
```

[`docker-compose.full.yml`](../../infra/docker/docker-compose.full.yml) adds:

- a `migrate` one-shot service (`prisma migrate deploy`, falling back to `db push`) that the app
  services wait on,
- `api` (`:4000`), `web` (`:3000`, `NEXT_PUBLIC_API_URL` from `PUBLIC_API_URL`), and 2 `worker`
  replicas serving `cpu.default,cpu.media,io.webhooks,io.analytics`,
- storage switched to MinIO via `SURFGEN_STORAGE__*` env overrides.

Optional profiles:

```bash
docker compose -f infra/docker/docker-compose.full.yml --profile observability up   # prometheus :9090, grafana :3300, jaeger :16686
docker compose -f infra/docker/docker-compose.full.yml --profile ollama up          # local LLM on :11434 (auto-discovered)
```

Override credentials with `POSTGRES_PASSWORD`, `RABBITMQ_PASSWORD`, `MINIO_USER`/`MINIO_PASSWORD`,
`GRAFANA_USER`/`GRAFANA_PASSWORD`. Point `OTEL_EXPORTER_OTLP_ENDPOINT` at Jaeger's `:4318` to get traces.

The stack is zero-credential by default: rendering uses Piper/FFmpeg/mocks. Cloud providers activate
by exporting their API keys and enabling the corresponding entries in `config/ai.yaml` — no image
changes.

## Kubernetes (Helm)

Chart: [`infra/k8s/helm/surfgen`](../../infra/k8s/helm/surfgen). PostgreSQL, Redis, RabbitMQ, and
S3 are **not** bundled — bring managed services or separate charts.

1. Create the secret out-of-band (sealed-secrets / external-secrets recommended) with exactly these
   keys: `DATABASE_URL`, `AMQP_URL`, `JWT_SECRET`, `SURFGEN_S3_ACCESS_KEY`, `SURFGEN_S3_SECRET_KEY`.

2. Install with your values:

```yaml
# my-values.yaml
existingSecret: surfgen-secrets

env:
  REDIS_HOST: my-redis.internal
  REDIS_PORT: "6379"
  SURFGEN_STORAGE__DRIVER: s3
  SURFGEN_STORAGE__BUCKET: surfgen

config:
  files:
    ai.yaml: |
      capabilities:
        tts:
          chain:
            - provider: tts-elevenlabs
              priority: 5
            - provider: tts-piper
              priority: 10
            - provider: tts-mock
              priority: 100

api:
  replicas: 2
  autoscaling: { enabled: true, minReplicas: 2, maxReplicas: 10, targetCPUUtilizationPercentage: 70 }

web:
  publicApiUrl: https://api.example.com

workerPools:
  - name: cpu
    queues: cpu.default,cpu.media,io.webhooks,io.analytics
    replicas: 2
    autoscaling: { enabled: true, minReplicas: 2, maxReplicas: 20, targetCPUUtilizationPercentage: 75 }
    resources:
      requests: { cpu: "1", memory: 2Gi }
      limits: { cpu: "2", memory: 4Gi }
    nodeSelector: {}
    tolerations: []
  - name: gpu
    queues: gpu.default,gpu.heavy
    replicas: 1
    autoscaling: { enabled: false }
    resources:
      limits: { nvidia.com/gpu: "1", cpu: "4", memory: 16Gi }
      requests: { cpu: "2", memory: 8Gi }
    nodeSelector: { nvidia.com/gpu.present: "true" }
    tolerations:
      - { key: nvidia.com/gpu, operator: Exists, effect: NoSchedule }

metrics:
  serviceMonitor: true   # requires Prometheus Operator
ingress:
  enabled: true
```

```bash
helm install surfgen infra/k8s/helm/surfgen -f my-values.yaml
```

Chart behavior worth knowing:

- **Migrations** — `migrate.enabled: true` runs `prisma migrate deploy` as a pre-install/pre-upgrade
  hook Job ([`templates/migrate-job.yaml`](../../infra/k8s/helm/surfgen/templates/migrate-job.yaml)).
- **Config as ConfigMap** — `config.files` is mounted at `config.mountPath` (`/app/config`) and
  `SURFGEN_CONFIG_DIR` points at it; a config checksum annotation rolls pods on change. This is the
  config-only provider swap in production: change `ai.yaml` in values, upgrade, done.
- **Worker pools** — one Deployment (+ optional HPA) per entry in `workerPools`; each pod gets
  `WORKER_QUEUES` from `pool.queues` and exposes metrics on `metrics.workerPort` (9464).
- **ServiceMonitors** — `metrics.serviceMonitor: true` creates ServiceMonitors for api and workers.
- **Security** — pods run as non-root (`runAsUser: 1000`); the ServiceAccount supports IRSA
  annotations for S3 access; secrets come only from `existingSecret`.

## Terraform (AWS reference)

[`infra/terraform`](../../infra/terraform) wraps `terraform-aws-modules` registry modules:

| Module | Provides |
| ------ | -------- |
| `network` | VPC across 3 AZs, private app subnets, NAT |
| `eks` | Cluster + `cpu`/`gpu` managed node groups. **API endpoint is private by default** — set `endpoint_public_access_cidrs` to open public access. `gpu_desired_size = 0` disables the GPU pool |
| `rds` | PostgreSQL 16, `multi_az = true`, 14-day PITR backups, deletion protection |
| `redis` | ElastiCache Redis 7.1 for BullMQ |
| `mq` | Amazon MQ for RabbitMQ 3.13, `CLUSTER_MULTI_AZ` |
| `storage` | S3 media bucket (versioned, KMS SSE, lifecycle rules, all public access blocked) + optional CloudFront CDN — **opt-in via `cdn_public_key_pem`** (empty = no CDN; provide a signing public key to enable signed URLs) |

```bash
cd infra/terraform/envs/production
terraform init && terraform plan -var-file=production.tfvars
```

Outputs (DB endpoint + secret ARN, Redis endpoint, AMQP endpoint + secret ARN, bucket, IRSA role,
CDN domain) feed the Helm `existingSecret` via external-secrets/SSM — never commit them.

## Scaling

- **Queue classes** (from [`packages/queue/src/queues.ts`](../../packages/queue/src/queues.ts)):

  | Queue | Default concurrency | Work |
  | ----- | ------------------- | ---- |
  | `cpu.default` | 8 | script, subtitles, finalize |
  | `cpu.media` | 2 | FFmpeg render/compress/thumbnail |
  | `gpu.default` | 1 | single-GPU inference (tts, lipsync) |
  | `gpu.heavy` | 1 | multi-GPU / long inference |
  | `io.webhooks` / `io.analytics` | 16 | IO fan-out |

- **`WORKER_QUEUES` is the partitioning knob** — every worker replica runs the same image; which
  queues it consumes defines the pool. Scale pools independently (CPU HPA on the cpu pool; GPU pool
  usually fixed-size on tainted GPU nodes).
- **No GPUs?** Remove the gpu pool and route `gpu.*` capabilities to cloud providers in
  `config/ai.yaml` — same images, config-only change.
- **API** — stateless; HPA on CPU (default target 70%). The orchestrator is stateless and safe to
  replicate: pipeline state lives in `PipelineRun` rows and `runId:stage` job IDs dedupe enqueues.
- **RabbitMQ/Redis** — the bus uses one durable topic exchange (`surfgen.events`) with dead-letter
  topology; Redis persistence (AOF in compose) protects queued jobs.

## Monitoring & alerting

Reference setup in [`infra/monitoring`](../../infra/monitoring); shipped in the compose
`observability` profile and as ServiceMonitors in Helm.

- **Scrape targets** — `api:4000/metrics` and `worker:9464/metrics`
  ([`prometheus.yml`](../../infra/monitoring/prometheus/prometheus.yml), 15s interval).
- **Platform metrics** (declared in [`packages/telemetry/src/metrics.ts`](../../packages/telemetry/src/metrics.ts)):
  - `surfgen_jobs_processed_total{stage,status}` — pipeline jobs processed
  - `surfgen_job_duration_seconds{stage}` — histogram, buckets 50ms → 600s
  - `surfgen_provider_latency_seconds{provider,capability}` — AI provider call latency
  - `surfgen_provider_failures_total{provider,capability}` — provider failures (failover indicator)
  - plus prom-client default process metrics, labeled `service=surfgen-api|surfgen-worker`
- **Alert rules** ([`alerts.yml`](../../infra/monitoring/prometheus/alerts.yml)):
  `PipelineFailureRateHigh` (>5% failed over 10m, page), `PipelineStalled` (no completions 15m,
  page), `JobDurationP95High` (stage p95 > 5m, warn), `ProviderFailuresSpiking` (warn),
  `ProviderLatencyP95High` (p95 > 60s, warn), `ApiDown` / `WorkerDown` (page).
- **Grafana** — the "SurfGen Overview" dashboard is provisioned from
  [`grafana/dashboards/surfgen-overview.json`](../../infra/monitoring/grafana/dashboards/surfgen-overview.json).
- **Tracing** — set `OTEL_EXPORTER_OTLP_ENDPOINT` (Jaeger/OTLP-HTTP) on api and workers.

## Backups

- **Postgres** — the system of record (videos, pipeline runs, artifacts index, webhooks, usage).
  On AWS the RDS module enables multi-AZ + 14-day PITR. Self-hosted: schedule `pg_dump` (or WAL
  archiving) of the `surfgen` database; the compose volume is `pgdata`.
- **Object storage** — all media (`MediaRef.storageKey` values resolve here). AWS: bucket
  versioning + KMS encryption + lifecycle rules are already on. MinIO: replicate with `mc mirror`
  to a second target and back up the `miniodata` volume.
- **Restore order** — restore Postgres and the media bucket together: DB rows reference storage
  keys, so a DB-only restore leaves dangling keys and vice versa.
- **Redis / RabbitMQ** — transient work (queued jobs, in-flight events). Losing them loses queued
  work but no completed data; re-enqueue via the API. AOF/durable-queue settings minimize the window.
- **Secrets** — `JWT_SECRET` and provider keys are not in any backup by design; store them in your
  secret manager and treat rotation as part of restore drills.

## Security hardening checklist

- [ ] `JWT_SECRET` set to a long random value (production refuses to boot without it); rotate on
      suspicion of exposure.
- [ ] `NODE_ENV=production` (forces secure refresh cookies); set `COOKIE_SECURE=true` in any
      non-`production` HTTPS environment.
- [ ] `CORS_ORIGINS` set to your web origins — the default (allow all) is for development only.
- [ ] TLS terminated in front of api/web (Helm ingress `tls`, or your load balancer); RabbitMQ,
      Redis (`REDIS_TLS=true` + `REDIS_PASSWORD`), and Postgres over TLS on managed services.
- [ ] All secrets flow as **references** (`env:` / `file:` / `vault:`) — config schemas reject
      inline secrets; Kubernetes uses `existingSecret`; never inline secrets in Helm values.
- [ ] Rate limiting is on by default (`RATE_LIMIT_MAX`, 300/min) — tune per environment.
- [ ] API keys: shown once at creation, stored as SHA-256 hashes, org-pinned; revoke via
      `DELETE /v1/orgs/:orgId/api-keys/:keyId`.
- [ ] Webhooks: HMAC-signed (`t=…,v1=…` over `timestamp.body`) and delivered through the
      SSRF-hardened `safeFetch` — receivers should verify signatures and reject stale timestamps.
- [ ] EKS API endpoint private (default); S3 public access blocked (default); CDN only with signed
      URLs (`cdn_public_key_pem`).
- [ ] Containers run as non-root (Dockerfiles create a `surfgen` user; Helm sets
      `runAsNonRoot: true`).
- [ ] Plugin permissions: review `permissions` in each installed plugin's manifest
      (`network` / `filesystem` / `subprocess` / `gpu`) before deploying third-party plugins.
