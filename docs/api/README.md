# SurfGen API

Base URL: `http://localhost:4000` (dev) · Versioning: URI (`/v1/...`) · Interactive reference: **`/docs`** (Swagger UI, generated from the running API — always current; this page covers the concepts the generated reference can't).

## Envelope

Every response uses one shape:

```json
{ "success": true,  "data": { … }, "error": null, "meta": { "cursor": "…", "hasMore": true } }
{ "success": false, "data": null,  "error": { "code": "NOT_FOUND", "message": "…" }, "meta": null }
```

`error.code` is a stable machine key from the domain `ErrorCode` union (e.g. `VALIDATION_FAILED` 400, `UNAUTHORIZED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `INVALID_STATE_TRANSITION` 409, `QUOTA_EXCEEDED` 429, `PROVIDER_ERROR` 502). Program against codes, not messages.

## Authentication

Two interchangeable schemes on every endpoint:

1. **JWT session** — `POST /v1/auth/login` → `{ accessToken, refreshToken }`. Access tokens live 15 min; refresh via `POST /v1/auth/refresh` (tokens rotate — the old refresh token is revoked, reuse is treated as theft). Send `Authorization: Bearer <accessToken>`.
2. **API key** — org-scoped, created by an org admin; send `Authorization: Bearer <apiKey>`. Keys are stored hashed and carry scopes.

All routes require auth unless marked `@Public` (login, health, docs).

## Authorization

Everything is org-scoped: `/v1/orgs/:orgId/...`. Membership role gates access — `viewer < editor < admin < owner`. Reads need `viewer`; mutations generally `editor`; member/key/webhook management `admin`.

## Core resources

| Resource | Routes | Notes |
|---|---|---|
| Auth | `POST /v1/auth/{register,login,refresh,logout}` | |
| Orgs | `GET/POST /v1/orgs`, `GET/PATCH /v1/orgs/:orgId`, members CRUD | |
| Projects | `…/orgs/:orgId/projects` CRUD | |
| Videos | `…/projects/:projectId/videos` CRUD | `status` follows the video state machine |
| Generation | `POST …/videos/:videoId/generate` | creates a `PipelineRun`, publishes `video.queued`; 409 `INVALID_STATE_TRANSITION` if not startable |
| Cancel | `POST …/videos/:videoId/cancel` | cooperative — workers stop at the next poll |
| Health | `GET /healthz` · `GET /readyz` | liveness; readiness includes dependency checks |

List endpoints use **cursor pagination**: `?cursor=<opaque>&limit=<n>` → `meta.cursor` / `meta.hasMore`. Cursors are opaque; do not parse them.

## Realtime progress (WebSocket)

Connect to the WS endpoint, then authenticate in-band:

```jsonc
→ { "type": "auth", "token": "<accessToken>" }
← { "type": "auth_ok" }
← { "type": "event", "name": "pipeline.stage_completed", "payload": { "videoId": "…", "stage": "tts", "progress": 42 } }
```

You receive events only for orgs you belong to (server-side room membership). Event names match the domain catalog (`video.queued`, `pipeline.stage_started|stage_completed|stage_failed`, `video.completed`, `video.failed`).

## Webhooks

Org admins register webhook endpoints for the same event catalog. Deliveries are signed:

```
X-SurfGen-Signature: t=<unix>, v1=<hmac-sha256(secret, "<t>.<rawBody>")>
```

Reject if `|now - t| > 300 s` or the HMAC doesn't match. Deliveries retry with backoff; attempts are recorded and queryable.

## Rate limiting

Per-IP and per-principal limits (stricter on `/v1/auth/*`). `429` responses include `Retry-After`.

## Clients

- **Node CLI**: `apps/cli` (`surfgen auth login`, `surfgen videos create --generate`, …)
- **Python CLI**: `apps/cli-py` — same REST surface via typer
- Any HTTP client: the OpenAPI document at `/docs-json` drives codegen.

## Curl walkthrough (zero-credential stack)

```bash
TOKEN=$(curl -s localhost:4000/v1/auth/login -H 'content-type: application/json' \
  -d '{"email":"admin@surfgen.local","password":"<seed output>"}' | jq -r .data.accessToken)
ORG=$(curl -s localhost:4000/v1/orgs -H "authorization: Bearer $TOKEN" | jq -r '.data[0].id')
PROJ=$(curl -s localhost:4000/v1/orgs/$ORG/projects -H "authorization: Bearer $TOKEN" \
  -d '{"name":"demo"}' -H 'content-type: application/json' | jq -r .data.id)
VID=$(curl -s localhost:4000/v1/orgs/$ORG/projects/$PROJ/videos -H "authorization: Bearer $TOKEN" \
  -d '{"title":"hello","script":"Welcome to SurfGen.","language":"en"}' \
  -H 'content-type: application/json' | jq -r .data.id)
curl -s -X POST localhost:4000/v1/orgs/$ORG/projects/$PROJ/videos/$VID/generate \
  -H "authorization: Bearer $TOKEN"
# poll status until completed, then follow data.outputUrl (signed)
```
