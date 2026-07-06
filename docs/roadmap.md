# SurfGen Roadmap

**Who this is for:** contributors and adopters deciding what to build on (or wait for). This is an honest gap list grounded in the current codebase — items exist here because the schema, config, or UI already points at them but the implementation isn't finished. Nothing on this page is a commitment or a date; it's a statement of direction. What already works is documented in the [User Guide](guides/user-guide.md), [Admin Guide](guides/admin-guide.md), and [CLI Guide](guides/cli.md).

## Near term

Things the current code visibly stops just short of.

- **Initial Prisma migration + live end-to-end run.** `packages/db/prisma/` has a complete schema but no `migrations/` directory yet. With Docker up, `./scripts/install.sh` generates and commits the initial migration; the first full live e2e (script → rendered MP4 in object storage) gates the release.
- **`apps/admin` decision.** The studio's ADMIN section (Providers, GPU & Queues, Developer, Plugins) may make a separate admin app unnecessary — decide, then either build `apps/admin` or formally fold its scope into the studio.
- **Asset upload UI + API.** The `Asset` model (image/video/audio/font/subtitle kinds) exists in the schema, but there are no upload endpoints and no UI; avatars can be registered by name but source media can't be uploaded yet.
- **Voice-clone consent flow.** The `VoiceClone` model (consent artifact + training samples, pending→training→ready states) and the pipeline-side `VoiceCloneInput` exist; the API route and studio flow that collect a signed consent token do not. The studio's "Clone a voice" card is a placeholder until this lands.
- **Quota enforcement.** `Quota` and `UsageRecord` tables exist, the seed creates quota rows, the pipeline records `render.seconds`, and the `QUOTA_EXCEEDED` (HTTP 402) error code is reserved — but no code path checks usage against limits yet. Enforcement plus emitting the remaining metrics (`tts.characters`, `llm.tokens`, `storage.bytes`) is the gap.
- **Standalone workflow execution.** `POST /v1/orgs/:orgId/workflows/:workflowId/runs` records a pending `WorkflowRun`; the orchestrator doesn't yet execute declarative workflow definitions (video pipelines already run end to end). This unblocks the "Run workflow" button doing real work.
- **OAuth login.** The `OAuthAccount` table is in the schema; there are no OAuth endpoints. Password login (and API keys) are the only mechanisms today.
- **Registration and org-management UI.** Sign-up, member invite/removal, and org switching are API-only; the studio pins you to your first org and project. Bring `POST /v1/auth/register` and the members endpoints into the UI, including an in-studio video-creation form (today the dashboard defers to the CLI).
- **Templates UI.** `Template` and `TemplateVariable` models (text/image/color/audio/avatar/voice variables) exist; the "From template" starter currently routes to Brand Kits. A template gallery and editor are needed to close that loop.
- **Frontend quality gates: responsive, a11y, visual regression.** The studio is desktop-first with fixed grids; add breakpoint coverage, automated accessibility checks, reduced-motion behavior, and Playwright screenshot baselines as CI gates.

## Mid term

Broadening the provider surface and operational depth.

- **More providers and runners.** `config/ai.yaml` already sketches the chains with commented-out entries — enabling each means shipping its plugin/runner:
  - `llm-anthropic` (cloud, `env:ANTHROPIC_API_KEY`)
  - `tts-xtts` (local voice cloning; the studio copy already names XTTS as the local clone path)
  - `lipsync-wav2lip` (Docker runner, GPU recommended). The SadTalker talking-head provider is already shipped (`plugins/avatar-sadtalker`, CLI runner) — disabled by default for licensing reasons, see its README
  - ComfyUI as an image/video generation backend (model discovery already knows how to probe a local ComfyUI)
  - NLLB for local translation alongside DeepL
- **Runner kinds: `python`, `docker`, `grpc`, `onnx`.** The provider schema and UI labels accept all six kinds, but only `http` and `cli` runners are implemented in `@surfgen/ai-sdk`. The four remaining runners are what most GPU-bound providers above need.
- **Per-org provider overrides.** The `ProviderConfig` table (org-scoped enable/priority/options overrides on top of the config files) exists but is not read by the registry yet.
- **Webhook delivery observability.** `WebhookDelivery` rows (status, attempts, response codes) are written today; expose them in the Developer page with redelivery.
- **Notifications and audit surfacing.** `Notification` and `AuditLog` tables exist; wire event-driven writes and an in-studio inbox / audit view.
- **Chaos, load, and coverage gates.** Load/chaos test scaffolding against the live stack and an enforced coverage report round out the Phase 8 quality bar.

## Long term

Direction, contingent on the above.

- **Plugin registry.** The Plugins page's "Install from registry" button is a stub; a real registry means remote discovery, signed packages, and conformance-verified installs instead of dropping folders into `plugins/`.
- **Billing.** `BillingAccount`, `Subscription`, and `Invoice` tables (Stripe-shaped) are schema-only; a billing integration builds on quota enforcement and usage metering.
- **Visual workflow builder.** The workflows page renders node graphs read-only; editing (drag, connect, configure nodes) turns recorded definitions into a real automation product once standalone execution exists.
- **Desktop app maturity.** The Electron shell (`apps/desktop`, sandboxed with local-runtime detection) exists; deeper local-model management (download, GPU selection, offline mode) is the long-term value.
- **Teams as a first-class scope.** `Team`/`TeamMember` models and `Project.teamId` are in the schema but unused by the API — team-scoped permissions and views would build on the org-role system.

## How to read this page

If an item matters to you, check the linked models/configs in the repo — every entry above names the exact table, file, or endpoint where the seam is. Contributions that close a near-term gap end-to-end (API + UI + tests + docs) are the most valuable.
