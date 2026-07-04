# SurfGen Admin Guide

**Who this is for:** organization admins and deployment operators — anyone who manages members and API access for an org, or who runs the SurfGen stack and decides which AI providers and plugins it uses. For day-to-day video work see the [User Guide](user-guide.md); for scripting see the [CLI Guide](cli.md).

## Organization roles

Every user belongs to organizations through a membership with one role. Roles are ranked — a higher role can do everything a lower one can:

```
viewer < editor < admin < owner
```

| Role | Can do (as enforced by the API today) |
|---|---|
| **viewer** | Read everything in the org: projects, videos, scenes, rendered output, avatars, voices, brand kits, workflows, stats. |
| **editor** | All of viewer, plus create/update projects; create, generate, cancel, and delete videos; edit scenes and scripts; manage avatars, voices, brand kits, and workflows; queue workflow runs; run brand extraction. |
| **admin** | All of editor, plus rename the org, invite and remove members, delete projects, and manage API keys and webhooks. |
| **owner** | All of admin, plus delete (soft-delete) the organization. The user who creates an org becomes its owner. |

Two extra principals to know about:

- **API keys** act as the user who created them but are hard-bound to one organization — a key never works against another org, regardless of the user's memberships.
- **Super admins** (a flag on the user record) bypass org-role checks entirely. Reserve this for deployment operators.

### Managing members

There is no member-management UI yet ([roadmap](../roadmap.md)); admins use the API. The invited user must already have an account (see [User Guide — getting an account](user-guide.md#getting-an-account)).

```bash
# invite (or change the role of) a member — role: admin | editor | viewer
curl -X POST http://localhost:4000/v1/orgs/$ORG_ID/members \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{ "email": "teammate@example.com", "role": "editor" }'

# remove a member
curl -X DELETE http://localhost:4000/v1/orgs/$ORG_ID/members/$USER_ID \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

## Provider configuration

SurfGen never hard-codes an AI vendor. Every capability (LLM, TTS, ASR, translation, avatar, lip-sync, …) resolves through a **priority chain** defined in config files on the API/worker host — swapping cloud for local (or vendor for vendor) is a config edit, never a code change.

Three files under `config/` (override the directory with `SURFGEN_CONFIG_DIR`):

- **`ai.yaml`** — capability → provider chain routing. Lower `priority` number wins; the registry fails over down the chain when a provider is unhealthy. The default ships local-first (Ollama for LLM, Piper for TTS, Whisper for ASR) with mock providers as the final fallback, and commented-out cloud entries (`llm-openai`, `llm-anthropic`, `tts-elevenlabs`, `translation-deepl`, `avatar-heygen`, `lipsync-wav2lip`) you can enable:

```yaml
capabilities:
  llm:
    chain:
      - provider: llm-ollama     # local
        priority: 10
      - provider: llm-openai     # cloud — uncomment + set env:OPENAI_API_KEY
        priority: 5              # lower number = preferred
      - provider: llm-mock
        priority: 100
routing:
  preferDeployment: local        # local | cloud | self_hosted
```

- **`providers.json`** — provider instance definitions: `id`, `capability`, `kind` (`http`, `cli`, `python`, `docker`, `grpc`, `onnx`), `enabled`, `priority`, non-secret `options`, and `secrets` as **references only** (`env:NAME`, `vault:path`, `file:/path`) — plaintext secrets are rejected platform-wide.
- **`models.yaml`** — the model catalog; entries with `autoDiscover: true` are registered automatically when the local runtime (e.g. Ollama) is detected.

The **Providers** page in the studio (`/providers`) is a read-only live view of exactly these files: per capability you see each provider's kind, priority, chain position (the "Primary" badge is chain position 0 + enabled), and which secret references it needs. If the page shows the wrong thing, edit the files and restart — the page has no write path by design.

Note: a `ProviderConfig` table exists in the schema for per-org provider overrides, but it is not read anywhere yet — treat it as recorded but not yet enforced.

## Plugins

Vendors live only in `plugins/` (shipping today: `llm-ollama`, `llm-openai`, `tts-piper`, `tts-elevenlabs`, `translation-deepl`, `mock-suite`). Each plugin has a `plugin.manifest.json` and implements the SDK lifecycle (`initialize · health · generate · shutdown`). Pipeline workers load `plugins/` at boot and **self-register** every valid manifest into the database — that registry is what the **Plugins** page (`/plugins`) shows.

- Toggle a plugin on/off with the switch on its card (persists via `PATCH /v1/plugins/:pluginId`). Toggling requires a **super-admin** account (`isSuperAdmin`, e.g. the seeded `admin@surfgen.local`) — regular org members can view the page but their toggles are rejected with 403.
- To install a plugin, drop its folder into `plugins/` and restart the workers; the conformance suite gates registration. The "Install from registry" button is a placeholder — there is no remote registry yet ([roadmap](../roadmap.md)).

Heads-up: the providers and plugins **list** endpoints are deployment-level reads visible to any signed-in user; plugin toggling and the monitor endpoint are super-admin only (monitor rows span every organization).

## Monitoring

The **GPU & Queues** page (`/monitor`) reads the Job table and refreshes every 10 seconds. Because job rows span every organization on the deployment, the endpoint is **super-admin only** — non-admin members see an error state:

- **Queues** — per-queue active/waiting depth for every queue with in-flight jobs.
- **Live jobs** — up to 12 currently running pipeline stages with the video title, stage, queue, and per-stage progress percentage.

GPU and hardware telemetry is **not** on this page: workers export Prometheus metrics (`surfgen_jobs_processed_total`, `surfgen_job_duration_seconds`, `surfgen_provider_latency_seconds`, `surfgen_provider_failures_total`), and the Grafana dashboard in `infra/monitoring/` covers hardware and provider health. The API also exposes `GET /healthz` (liveness), `GET /readyz` (readiness incl. DB check), and `GET /metrics` (Prometheus text).

## API keys

Managed on the **Developer** page (`/developer`) or via the API; requires the **admin** role.

- Keys look like `sg_live_…` and are shown **exactly once** at creation — only a SHA-256 hash and a display prefix are stored. Copy it immediately.
- Scopes: `read`, `write` (default: both).
- Clients send the key in the `X-Api-Key` header. Keys are org-bound (see roles above).
- Revoke from the key list; revoked keys stop authenticating immediately. The list shows each key's prefix, scopes, and last-used time.

```bash
curl -X POST http://localhost:4000/v1/orgs/$ORG_ID/api-keys \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{ "name": "CI", "scopes": ["read", "write"] }'
# → { "success": true, "data": { "id": "…", "name": "CI", "scopes": [...], "key": "sg_live_…" } }
```

## Webhooks

Register endpoints per organization (admin role) on the Developer page or via:

```bash
curl -X POST http://localhost:4000/v1/orgs/$ORG_ID/webhooks \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-app.dev/hooks/surfgen",
    "events": ["video.*"],
    "secretRef": "env:SURFGEN_WEBHOOK_SECRET"
  }'
```

- `events` are AMQP-style patterns matched against event names (`video.*`, `pipeline.#`, or exact names like `video.ready`). The dispatcher subscribes to `video.#` and `pipeline.#`.
- `secretRef` must be a reference (`env:NAME`, `vault:path`, `file:/path`) — the HMAC secret itself never touches the API or database.

**Delivery contract.** Each delivery is a JSON `POST` (`{ id, name, occurredAt, payload }`) with headers:

| Header | Value |
|---|---|
| `x-surfgen-event` | event name, e.g. `video.ready` |
| `x-surfgen-delivery` | unique delivery ID |
| `x-surfgen-signature` | `t=<unix seconds>,v1=<hex hmac-sha256>` over `"<t>.<raw body>"` |

Failed deliveries retry up to **3 attempts** (delays 0.5 s then 2 s, 10 s timeout each) before being marked failed. Deliveries are idempotent per (webhook, event) — bus redeliveries never double-send. Outbound calls are SSRF-hardened (public unicast only, no redirects).

**Verifying on your receiver:** recompute `hmac_sha256(secret, t + "." + rawBody)`, constant-time-compare against `v1`, and reject timestamps older than your tolerance (e.g. 5 minutes) to block replays.

Delivery history lives in the `WebhookDelivery` table (status, attempts, response code); there is no UI for it yet.

## Quotas, usage, and billing

The schema records consumption; enforcement is not implemented yet — nothing blocks an org at its limit today ([roadmap](../roadmap.md)).

- **`UsageRecord`** — per-org metered rows (`metric`, `quantity`, optional provider/run). Intended metrics: `render.seconds`, `tts.characters`, `llm.tokens`, `storage.bytes`. Currently the pipeline writes `render.seconds` when a render finalizes; the others are schema-ready but not yet emitted.
- **`Quota`** — per-org, per-metric limit over a rolling window (`windowSeconds`, e.g. 2592000 = 30 days). The seed script creates starter quota rows. **Recorded but not yet enforced** — the `QUOTA_EXCEEDED` error code (HTTP 402) is reserved for when enforcement lands.
- **`BillingAccount` / `Subscription` / `Invoice`** — schema-only scaffolding for a billing integration (default provider `stripe`); no billing code runs today.
- **`AuditLog` / `Notification`** — likewise present in the schema for audit trails and in-app notifications, not yet written to or surfaced.

When you report usage to stakeholders, query `UsageRecord` directly; treat quota values as advisory configuration until enforcement ships.
