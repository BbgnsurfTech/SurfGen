# ADR-010: Zero-credential local reference path (Piper + FFmpeg + mocks)

Status: Accepted (2026-06)

## Context

An open-source platform that only works after signing up for five cloud APIs is dead on arrival for contributors, and untestable in CI. The provider-swap promise (ADR-003) also needs a "local" side that is always real.

## Decision

The default `config/ai.yaml` chains put free local providers first: Piper (CLI runner) for TTS, Ollama for LLM when discovered, FFmpeg for render/thumbnail (always), and mock providers (priority 100) as the guaranteed last resort. A fresh checkout + `./scripts/install.sh` produces a script→mp4 pipeline with **no API keys whatsoever**.

## Consequences

- CI runs the full pipeline end-to-end (real ffmpeg, real artifacts) on every PR — cloud providers are tested via injected fetch stubs, local ones for real.
- The render stage is deterministic (`color=c=0x10101c` background + TTS audio, libx264 CRF), giving reproducible artifacts for regression checks.
- Mocks emit `mock/`-prefixed artifact keys that `materialize()` skips, so the zero-cred path needs no object storage either.
- Cost: reference output quality is deliberately basic — it proves the pipeline, not the art; production deployments override the chains in config.
- Rejected: recorded-fixture-only testing (would never exercise runners/ffmpeg), requiring at least one cloud key (kills contributor onboarding and CI hermeticity).
