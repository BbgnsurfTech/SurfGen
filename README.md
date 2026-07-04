# SurfGen

**Open-source, provider-agnostic AI avatar video generation platform.**

SurfGen generates studio-quality avatar videos — talking photos, voice cloning, lip sync, TTS,
translation, subtitles, AI script generation, and a full timeline editor — with every AI
capability behind a pluggable provider abstraction. Swap ElevenLabs for a local Piper model, or
a cloud avatar API for SadTalker running in Docker, by editing a YAML file. **No application code
ever names a vendor.**

```
┌─────────────┐   ┌──────────────┐   ┌───────────────────────────────┐
│  Next.js    │   │  NestJS API  │   │  BullMQ Pipeline Workers      │
│  Studio     │──▶│  REST/GQL/WS │──▶│  tts → lipsync → render → cdn │
└─────────────┘   └──────┬───────┘   └──────────────┬────────────────┘
                         │                          │
                  ┌──────▼──────────────────────────▼──────┐
                  │        AI Provider Registry            │
                  │  capability → provider (config-driven) │
                  ├────────────┬───────────┬───────────────┤
                  │ Cloud APIs │ Local HTTP│ CLI / Docker  │
                  │ (11Labs,…) │ (Ollama,…)│ (Piper, FFmpeg)│
                  └────────────┴───────────┴───────────────┘
```

## Capabilities

AI Avatars · Talking Photos · Voice Cloning · Lip Sync · Text-to-Speech · Translation ·
Video Generation · Face Animation · Background Replacement · Script Generation ·
Subtitle Generation · Motion Generation · Image Generation · Prompt Enhancement · AI Editing

## Quick start

```bash
./scripts/install.sh                                   # checks prerequisites, installs deps
docker compose -f infra/docker/docker-compose.dev.yml up -d
pnpm dev                                               # api + web + workers
```

The default configuration uses **only local providers** (Piper TTS, FFmpeg rendering, mock
avatar) — no API keys required. Add cloud providers in `config/ai.yaml` when you want them.

## Repository layout

| Path        | Contents                                                             |
| ----------- | -------------------------------------------------------------------- |
| `apps/`     | api (NestJS), web + admin (Next.js), workers, desktop, CLIs          |
| `packages/` | core domain, ai-sdk, plugin-sdk, config, queue, storage, events, ui  |
| `plugins/`  | first-party provider plugins (one folder per provider)               |
| `config/`   | providers.json, models.yaml, ai.yaml, storage.yaml, video.yaml       |
| `infra/`    | docker, helm, terraform, monitoring                                  |
| `docs/`     | PRD, specs, architecture, ERD, ADRs, guides                          |

## Documentation

- [Product Requirements](docs/product/PRD.md)
- [Architecture](docs/architecture/high-level-architecture.md)
- [User Guide](docs/guides/user-guide.md) · [Admin Guide](docs/guides/admin-guide.md) · [CLI](docs/guides/cli.md)
- [Developer Guide](docs/guides/developer-guide.md)
- [Deployment & Operations](docs/guides/deployment.md)
- [Plugin SDK Guide](docs/plugins/plugin-sdk-guide.md) · [Sample Plugin Walkthrough](docs/plugins/sample-plugin-walkthrough.md)
- [Roadmap](docs/roadmap.md)

## License

[Apache-2.0](LICENSE)
