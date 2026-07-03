# SurfGen — Product Requirements Document

| | |
|---|---|
| **Status** | Approved |
| **Version** | 1.0 |
| **Owners** | SurfGen Core Team |
| **License** | Apache-2.0 |
| **Related docs** | [Functional Spec](./functional-spec.md) · [Non-Functional Spec](./non-functional-spec.md) · [High-Level Architecture](../architecture/high-level-architecture.md) |

---

## 1. Vision

SurfGen is an **open-source, provider-agnostic AI avatar video generation platform**. It delivers HeyGen-class capabilities — AI avatars, talking photos, voice cloning, lip sync, translation, and a full studio editor — as software that anyone can run, extend, and own.

Every AI capability in SurfGen sits behind a **provider abstraction**. A capability (TTS, lip sync, avatar animation, LLM, translation, image generation, …) can be served by a commercial cloud API, an open-source model on the operator's own GPUs, or a local binary — selected purely through configuration, with zero code changes. The reference deployment produces a complete talking-avatar video using **only local, zero-credential providers** (Piper TTS + FFmpeg render + local avatar animation).

**One-sentence pitch:** *The video platform you can `docker compose up`, point at any AI provider — or none — and ship to millions of users without vendor lock-in.*

### Why now

- Enterprises want HeyGen-class output but cannot send scripts, customer data, or cloned voices to third-party clouds (compliance, data residency, IP).
- Open-weight models (SadTalker/Wav2Lip-class animation, XTTS/Piper TTS, NLLB translation, SD/ComfyUI image generation, open LLMs) now cover the full pipeline at usable quality.
- No existing open-source project offers the **complete product**: studio editor + template engine + workflow builder + API + pipeline orchestration + provider marketplace, in one coherent, self-hostable system.

## 2. Personas

| Persona | Profile | Primary jobs-to-be-done | Success looks like |
|---|---|---|---|
| **Marketer (Maya)** | Growth/content marketer at a B2C company; non-technical | Turn a product brief into localized promo videos; batch-personalize outreach videos from a CSV; keep brand kit consistency | Template + variables + one click → 40 localized videos published to CDN in an afternoon |
| **L&D Team (Lena)** | Learning & development manager producing training at scale | Convert SOP documents into narrated training modules; update a single scene when policy changes without re-shooting; track completion via LMS embeds | Editing one paragraph of script regenerates only the affected scenes; SCORM/embed links stay stable |
| **Developer / API user (Dev)** | Backend engineer integrating video generation into a SaaS product | Programmatic video creation via REST/GraphQL; reliable webhooks; idempotent retries; predictable quotas; sandbox keys | `POST /v1/videos` → webhook `video.completed` with a signed URL, p95 < spec, no surprise breaking changes |
| **Enterprise Admin (Elena)** | Platform admin at a 5,000-seat org | SSO/OIDC, RBAC, audit trails, usage quotas per team, cost allocation, provider governance ("marketing may use cloud TTS, legal content must use local providers") | Every generation attributed to a user/project/provider; org-level provider policy enforced; SOC 2 evidence exportable |
| **Self-hosting Engineer (Sam)** | DevOps/ML engineer running SurfGen on-prem or in a private cloud | Deploy on Kubernetes with own GPUs; auto-discover local model servers (Ollama, ComfyUI, Triton); swap providers via YAML; observe everything via Prometheus/Grafana | `helm install` + `ai.yaml` edits are the entire operational surface; no capability requires a cloud credential |

## 3. The 15 AI Capabilities

Each capability is a **port** in the domain core with at least one cloud adapter and one local adapter (see [ADR-005](../architecture/adr/ADR-005-provider-abstraction-runner-strategies.md)).

| # | Capability | Description | Example cloud provider | Example local provider |
|---|---|---|---|---|
| 1 | **AI Avatars** | Photorealistic or stylized presenter avatars rendered from a driving script + voice track | HeyGen-compatible APIs, D-ID | SadTalker-class local animation |
| 2 | **Talking Photos** | Animate a single still portrait into a speaking video | D-ID | SadTalker / LivePortrait-class |
| 3 | **Voice Cloning** | Create a reusable voice from consented sample audio (explicit consent flow required) | ElevenLabs voice clone | XTTS v2 fine-tune |
| 4 | **Lip Sync** | Align mouth movement of existing video to a new audio track | Sync-class APIs | Wav2Lip (Docker runner) |
| 5 | **Text-to-Speech (TTS)** | Convert script text to natural speech, multi-voice, SSML-aware | ElevenLabs, cloud TTS | Piper (zero-credential default), XTTS |
| 6 | **Translation** | Translate scripts/subtitles across 100+ languages with tone preservation | DeepL | NLLB-200 |
| 7 | **Video Generation** | Text-to-video / image-to-video B-roll and scene generation | Runway-class APIs | LTX-Video-class local models |
| 8 | **Face Animation** | Expression, head pose, and gaze control on avatar output | Vendor APIs | Local landmark-driven animation |
| 9 | **Background Replacement** | Segment presenter and replace/blur/green-screen backgrounds | Cloud matting APIs | RVM/robust-video-matting local |
| 10 | **Script Generation** | LLM-authored scripts from briefs, URLs, or documents; tone/length controls | OpenAI, Anthropic | Ollama-hosted open models |
| 11 | **Subtitle Generation** | ASR-based transcription, timing, styling, and burned-in or sidecar (SRT/VTT) output | Cloud ASR | whisper.cpp / faster-whisper |
| 12 | **Motion Generation** | Camera moves, scene transitions, kinetic text, and gesture timing | Vendor APIs | Deterministic FFmpeg/keyframe engine |
| 13 | **Image Generation** | Thumbnails, backgrounds, slide art from prompts | DALL·E/SD-cloud | ComfyUI, A1111 (Stable Diffusion) |
| 14 | **Prompt Enhancement** | Rewrite user prompts/scripts for better downstream model results | Any LLM provider | Any local LLM |
| 15 | **AI Editing** | Natural-language edit commands ("cut silences", "tighten to 60s", "make scene 2 upbeat") compiled to timeline operations | Any LLM provider | Any local LLM |

**Capability contract:** every capability is invoked through the same `AIProvider<TIn, TOut>` interface, streams progress as an `AsyncIterable`, declares limits/cost hints via `capabilities()`, and passes the shared `providerConformanceSuite()` before registration.

## 4. Feature List by Surface

### 4.1 Studio Editor (`apps/web`)

| Feature | Description | Priority |
|---|---|---|
| Scene-based timeline | Multi-track timeline (video, audio, captions, overlays) with clip trim/split/snap | P0 |
| Script panel | Script-first editing; script edits map to scenes; per-scene voice/avatar assignment | P0 |
| Avatar & voice library | Browse, preview, favorite avatars/voices; org-private and public catalogs | P0 |
| Live preview | Low-res proxy preview before committing a render | P0 |
| Undo/redo + autosave | Command-pattern history, IndexedDB local drafts, server sync | P0 |
| Captions editor | Style, position, per-word timing correction of generated subtitles | P1 |
| Brand kit | Org fonts, colors, logos, intro/outro applied across projects | P1 |
| AI editing commands | NL commands compiled to timeline ops (capability #15) | P1 |
| Collaboration | Comments, share links, review states | P2 (v1.x) |

### 4.2 Template Engine

| Feature | Description | Priority |
|---|---|---|
| Template authoring | Save any video as a template with declared variables (`{{first_name}}`, `{{product_image}}`) | P0 |
| Variable types | text, rich-text, image, video, audio, color, url, select | P0 |
| Batch generation | CSV/API-driven fan-out: one template × N variable sets → N render jobs | P0 |
| Template gallery | Org-private, workspace-shared, and public starter templates | P1 |
| Locked regions | Template author locks brand elements against editing | P1 |

### 4.3 Workflow Builder

| Feature | Description | Priority |
|---|---|---|
| Visual node canvas | React-Flow DAG editor: triggers → AI stages → conditions → outputs | P0 |
| Node catalog | Every pipeline stage (script, TTS, translate, lipsync, render, …) plus HTTP, branch, map/fan-out, webhook nodes | P0 |
| Declarative format | Workflows serialize to the same JSON the built-in pipeline uses — one engine, no special cases | P0 |
| Run history | Per-run node status, logs, retries, cost attribution | P0 |
| Scheduling & triggers | Manual, API, cron, webhook-in triggers | P1 |

### 4.4 API (`apps/api`)

| Feature | Description | Priority |
|---|---|---|
| REST `/v1` | Full CRUD + generation endpoints, OpenAPI 3.1 spec, idempotency keys | P0 |
| GraphQL | Code-first schema for studio/admin frontends and partner integrations | P0 |
| WebSocket progress | Real-time job/stage progress events | P0 |
| Webhooks | HMAC-SHA256-signed event delivery with retries and dead-lettering | P0 |
| API keys & scopes | Per-project keys, scoped permissions, rotation | P0 |
| SDK-friendly errors | Stable machine-readable error code catalog | P0 |

### 4.5 Admin Panel (`apps/admin`)

| Feature | Description | Priority |
|---|---|---|
| Provider management | Enable/disable providers, priorities, failover chains, per-org overrides, health dashboard | P0 |
| Queue & GPU dashboard | BullMQ queue depth, worker health, GPU slot utilization, dead-letter inspection | P0 |
| User & org management | Members, roles, invitations, SSO config | P0 |
| Usage & billing | Usage records, quotas, plan management, Stripe plugin integration | P1 |
| Plugin manager | Install/enable/disable plugins, manifest inspection, capability audit | P1 |
| Audit log explorer | Filterable, exportable audit trail | P0 |

### 4.6 CLI (`apps/cli`, `apps/cli-py`)

| Feature | Description | Priority |
|---|---|---|
| `surfgen login / init` | Auth + project scaffolding | P0 |
| `surfgen generate` | Script/template → video from the terminal, with `--watch` progress | P0 |
| `surfgen jobs / providers / plugins` | Operational inspection and control | P0 |
| Python CLI mirror | Thin REST client (`typer`) with feature parity for data teams | P1 |

### 4.7 Desktop (`apps/desktop`)

| Feature | Description | Priority |
|---|---|---|
| Electron shell | Wraps the web studio for offline-friendly local use | P1 |
| Local provider auto-detect | Discovers Ollama/ComfyUI/Piper/etc. on the user's machine and registers them | P1 |
| Local render mode | Full pipeline on-device with zero cloud credentials | P1 |

## 5. Competitive Positioning

| Dimension | HeyGen | Synthesia | D-ID | **SurfGen** |
|---|---|---|---|---|
| Source model | Closed SaaS | Closed SaaS | Closed SaaS | **Apache-2.0 open source** |
| Self-hosting | No | No | No | **First-class (compose, Helm, Terraform)** |
| Provider choice | Own models only | Own models only | Own models only | **Any provider — cloud, local GPU, or binary — via config** |
| Data residency | Vendor cloud | Vendor cloud (enterprise tiers) | Vendor cloud | **Operator-controlled; fully air-gappable** |
| Extensibility | Fixed feature set | Fixed feature set | API-centric | **Plugin SDK: manifest + dynamic import; community providers** |
| Workflow automation | Limited | Limited | API only | **Visual workflow builder + declarative pipeline JSON** |
| Pricing model | Per-seat + credits | Per-seat + minutes | Credits | **Free self-hosted; optional managed/support offerings** |
| Vendor lock-in | High | High | High | **None — S3-compatible storage, any Postgres, swappable AI providers** |

**Differentiator, stated once:** *open source + provider independence + self-hostable.* Competitors sell access to their models; SurfGen sells (gives) the **platform** and lets the operator choose the models.

**Deliberate non-goals of positioning:** SurfGen does not compete on having the single best proprietary avatar model. It competes on ownership, composability, and the ability to adopt whichever model — commercial or open — is best this quarter, via a YAML edit.

## 6. Success Metrics

### North star

**Weekly Completed Renders (WCR)** across all deployments that opt into telemetry, split by cloud-provider vs local-provider pipelines.

### v1 targets (12 months post-GA)

| Category | Metric | Target |
|---|---|---|
| Adoption | GitHub stars | 15,000 |
| Adoption | Active self-hosted deployments (opt-in telemetry) | 1,000 |
| Adoption | Docker pulls | 500,000 |
| Product | Time-to-first-video (fresh install → downloadable mp4) | < 15 minutes |
| Product | Render success rate (non-user-error) | ≥ 99% |
| Product | Template batch jobs as share of renders | ≥ 25% |
| Ecosystem | Third-party plugins published | 25 |
| Ecosystem | Capabilities with ≥ 2 community-maintained providers | 10 of 15 |
| API | Developer accounts with ≥ 1 successful API render | 2,000 |
| Quality | p95 API latency (non-generation endpoints) | < 300 ms |
| Community | Monthly active contributors | 40 |

### Guardrail metrics

- Local-only pipeline (Piper + FFmpeg + local avatar) must remain green in CI on every release — this is the product's existential guarantee.
- Provider swap test (cloud→local via `ai.yaml`, zero code change) green in CI on every release.
- No breaking `/v1` API change without a versioned successor and 6-month deprecation window.

## 7. Out of Scope for v1

| Item | Rationale | Revisit |
|---|---|---|
| Real-time / live streaming avatars (interactive agents) | Different latency architecture (WebRTC, sub-second inference); v1 is batch/pipeline-first | v2 |
| Mobile native apps (iOS/Android) | Web studio is responsive; native adds surface without differentiator value | v2+ |
| Built-in stock media marketplace | Licensing complexity; assets come from uploads, generation, or operator integrations | v1.x plugin |
| Training foundational avatar/voice models | SurfGen orchestrates models, it does not train them | Never (core scope) |
| Multi-region active-active data plane | v1 ships single-region HA with documented DR; active-active adds premature complexity | v2 |
| SCORM/LMS packaging | Embed links cover most L&D needs at launch | v1.x plugin |
| Fine-grained per-field permissions (ABAC) | RBAC at org/project scope is sufficient for v1 personas | v2 |
| Marketplace billing/revenue-share for plugin authors | Requires legal + payments infrastructure | v2 |
| On-the-fly model fine-tuning UI | Voice cloning is the only training-adjacent feature in v1, delegated to providers | v2 |

## 8. Ethical & Safety Requirements (v1, non-negotiable)

- **Consent-gated voice cloning:** cloning requires an explicit consent attestation recorded in the audit log; the consent artifact is stored with the `VoiceClone` record.
- **Provenance:** all generated videos carry C2PA-style provenance metadata where the render path supports it, and always carry SurfGen generation metadata in the container.
- **Abuse controls:** operators can enable content-policy checks (LLM-based moderation stage) as a pipeline stage; hosted offerings must enable it.
- **Watermarking hooks:** the render stage exposes an optional watermark port for operator policy.
