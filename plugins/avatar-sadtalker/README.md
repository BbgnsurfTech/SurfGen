# @surfgen/plugin-avatar-sadtalker

Local talking-head avatar animation via [SadTalker](https://github.com/OpenTalker/SadTalker),
run through its `inference.py` CLI — no cloud credentials, no network calls.

## Licensing — read before enabling in production

SadTalker's own code is Apache 2.0, same as this plugin's wrapper code. It
depends on third-party model checkpoints and incorporates research-only
components under **separate, more restrictive licenses**:

- **Wav2Lip components** — SadTalker incorporates ideas and checkpoints associated with Wav2Lip,
  whose original license is research/non-commercial only.
- **Deep3DFaceReconstruction** and the **Basel Face Model (BFM)** — both
  require agreeing to a non-commercial academic license to download.

SurfGen ships this plugin disabled by default and takes no position on your
right to use these models commercially — **you, the deploying operator, are
responsible for obtaining and complying with each of these licenses** before
enabling this plugin in a production or revenue-generating deployment. This
is the same posture SurfGen already takes toward `tts-elevenlabs` and
`llm-openai`: SurfGen integrates the tool, you bring compliant credentials
and rights.

## Setup

1. Install SadTalker per its own instructions (Python environment, PyTorch,
   and its checkpoints) somewhere reachable from wherever this plugin's host
   process runs.
2. Note the absolute path to its `inference.py`.
3. Enable the plugin in `config/ai.yaml` (see the commented example there)
   with:
   - `pythonCommand`: the interpreter to run it with (default `python3`).
   - `scriptPath`: absolute path to `inference.py` (required).
   - `checkpointDir`: optional, only if checkpoints aren't colocated with the script.

## Scope

Only `AvatarKind.photo` avatars are supported — a single source photo plus a
driving audio track produces a talking-head video. Video, 3D, and animated-
character avatars are not handled by this provider.

Performance: SadTalker is GPU-recommended. It runs on CPU with `--cpu`-style
flags in the upstream project but is considerably slower — plan render-queue
timeouts accordingly for CPU-only deployments.

## Operational notes

`health()` uses the shared CLI runner's 5-second probe timeout. A cold GPU or
a slow `torch` import on the first invocation can exceed that window, which
reads as unhealthy and makes the provider registry fail over to
`avatar-mock` even though a longer-running request would have succeeded.
Warm the Python process (or run a manual inference once) before relying on
health checks in production.
