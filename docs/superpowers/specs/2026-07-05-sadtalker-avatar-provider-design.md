# Local SadTalker Avatar Provider — Design Spec

**Date:** 2026-07-05
**Status:** Approved (model choice, licensing posture, and runner approach confirmed with owner)

## Goal

Close the audit finding that no working `avatar` provider exists at any tier —
`config/ai.yaml` only wires the capability to `avatar-mock`, and the render
stage explicitly discards `mock/`-prefixed keys, so every rendered video today
is a static color card with a voiceover, never an animated presenter. This
directly contradicts `docs/product/PRD.md`'s stated local, zero-credential
talking-avatar guarantee.

Ship a real, local, CLI-based avatar provider using SadTalker (photo + audio →
talking-head video), following the exact plugin pattern `tts-piper` already
establishes for local, subprocess-based providers.

## Decisions (confirmed)

1. **Model:** SadTalker, registered against the `avatar` capability (not the
   separate, currently-unused `lipsync` capability). SadTalker's own contract
   — single photo + audio in, talking-head video out — matches `avatar`
   directly; Wav2Lip's contract (existing *video* + new audio) matches
   `lipsync` instead and is out of scope here.
2. **Licensing posture:** SadTalker's code is Apache 2.0, but it depends on
   third-party checkpoints (Deep3DFaceReconstruction, the Basel Face Model)
   that carry separate non-commercial academic license terms, and it
   incorporates ideas/checkpoints associated with Wav2Lip's research-only
   license. SurfGen ships this as an **optional plugin**; the deploying
   operator is responsible for obtaining/complying with the model licenses
   themselves — the same posture the `tts-elevenlabs` and `llm-openai`
   plugins already take toward their own vendor terms. This must be stated
   plainly in the plugin manifest description and its README, not buried.
3. **Runner:** the existing `CliRunner` (no new runner kind). The operator
   installs a Python environment with SadTalker's `inference.py` and its
   checkpoints; the plugin shells out to it exactly like `tts-piper` shells
   out to the `piper` binary. Building the currently-unimplemented `docker`
   runner kind first was considered and explicitly deferred — out of scope
   for this slice.
4. **Scope boundary:** only `AvatarKind.photo` avatars are supported.
   `video` / `three_d` / `animated_character` avatars get a clear
   `ProviderError` rather than silent mishandling.

## Architecture

New package: `plugins/avatar-sadtalker/`, mirroring `plugins/tts-piper/`
file-for-file:

```
plugins/avatar-sadtalker/
  plugin.manifest.json   # capability: ["avatar"], permissions: ["subprocess", "filesystem"]
  package.json
  tsconfig.json
  tsup.config.ts
  vitest.config.ts
  src/index.ts           # SadTalkerAvatarProvider + definePlugin registration
  test/sadtalker.test.ts # shim-based unit tests, no GPU/model weights required
```

`plugin.manifest.json` description field states the licensing caveat from
Decision 2 verbatim, so it surfaces in the Plugins page (`/plugins`) without
needing to open the README.

## Data flow

### 1. Pipeline plumbing: resolving `avatarId` to a real image (new)

Today, `apps/workers/pipeline/src/stages/handlers.ts`'s `avatar` stage passes
`avatarRef: { avatarId: input.avatarId ?? 'default' }` straight through —
nothing resolves that id to actual source media. This is required plumbing
independent of which provider ends up handling it:

```ts
// avatar stage, before calling registry.execute('avatar', ...)
const avatar = await runtime.prisma.avatar.findFirst({
  where: { id: input.avatarId, organizationId: ctx.data.organizationId, deletedAt: null },
});
if (!avatar) throw new PipelineError('avatar', `avatar not found: ${input.avatarId}`);
if (avatar.kind !== 'photo') {
  throw new PipelineError('avatar', `unsupported avatar kind for animation: ${avatar.kind}`);
}
const version = await runtime.prisma.avatarVersion.findFirst({
  where: { avatarId: avatar.id, isActive: true },
});
const artifacts = version?.artifacts as { sourceImage?: { storageKey: string; contentType: string } } | undefined;
if (!artifacts?.sourceImage) throw new PipelineError('avatar', `avatar has no source image: ${avatar.id}`);

const output = await collectFinalOutput(
  runtime.registry.execute<AvatarInput, AvatarOutput>('avatar', {
    avatarRef: { image: artifacts.sourceImage },
    drivingAudio: { storageKey: audio.storageKey, contentType: 'audio/wav' },
    resolution: settings.resolution ?? RESOLUTIONS.fullHd,
  }, /* ... */),
);
```

This moves the "unsupported kind" and "no source image" guards up into the
pipeline stage itself (kind-agnostic), so any future avatar provider inherits
the same checks rather than reimplementing them. The `photo`-only guard in
Decision 4 doubles up here: the pipeline stage rejects non-photo kinds before
any provider is even invoked, since no registered provider handles them yet.

The `AvatarVersion.artifacts` shape (`{ sourceImage: {storageKey, contentType} }`)
is new — today the schema comment only says "Identity source material storage
keys + provider training artifacts" with no concrete shape, because nothing
writes to it yet. This spec fixes that shape for the photo case.

### 2. Provider invocation

```ts
class SadTalkerAvatarProvider implements AIProvider<AvatarInput, AvatarOutput> {
  readonly capability = 'avatar' as const;

  async *generate(input: AvatarInput, context: GenerationContext) {
    if (!('image' in input.avatarRef)) {
      throw new ProviderError('avatar-sadtalker', 'requires a resolved source image, not a bare avatarId');
    }
    const workDir = mkdtempSync(...);
    const sourceImage = await materialize(this.storage, input.avatarRef.image, join(workDir, 'source.png'));
    const drivingAudio = await materialize(this.storage, input.drivingAudio, join(workDir, 'audio.wav'));
    const resultDir = join(workDir, 'results');

    yield { type: 'progress', percent: 10, message: 'animating face' };
    await this.runner.invoke({
      args: [
        '--source_image', sourceImage,
        '--driven_audio', drivingAudio,
        '--result_dir', resultDir,
        '--still', '--preprocess', 'full',
        '--size', input.resolution.width >= 512 ? '512' : '256',
      ],
    });

    // SadTalker timestamps a subdirectory and moves the final file to
    // <subdir>.mp4 — the exact name isn't predictable ahead of time, so glob
    // the freshest .mp4 under resultDir rather than parsing stdout.
    const resultFile = await newestMp4(resultDir);
    const bytes = await readFile(resultFile);
    const key = `avatar/sadtalker/${randomUUID()}.mp4`;
    await this.storage.put(key, bytes, { contentType: 'video/mp4' });
    yield { type: 'output', final: true, data: { video: { storageKey: key, contentType: 'video/mp4' }, hasAlpha: false } };
  }
}
```

`resolution` is best-effort: mapped to SadTalker's supported `--size` values
(256/512), not passed through as arbitrary WxH — SadTalker doesn't support
arbitrary output dimensions. Fitting the result to the video's exact target
resolution is left to the existing ffmpeg render/compose stage, which already
scales inputs when compositing.

## Error handling

- **Missing/misconfigured Python env:** surfaces through `CliRunner.healthCheck()`
  (`--help` or equivalent) at provider-registration time, same as `tts-piper` —
  fails loudly before a render is ever attempted, not mid-pipeline.
- **Non-photo avatar:** rejected in the pipeline stage (see above), before the
  provider is invoked at all.
- **Subprocess failure / non-zero exit:** wrapped as `ProviderError('avatar-sadtalker', ...)`,
  consistent with every other plugin's error convention.
- **No `.mp4` found in `resultDir` after a clean exit:** treated as a
  `ProviderError` (unexpected SadTalker output layout), not a silent empty
  result.

## Testing

No GPU or model weights required, following `tts-piper/test/piper.test.ts`'s
exact convention: a Node shim script stands in for `inference.py` — parses
`--result_dir`, creates a timestamped subdirectory, writes a fake `.mp4` into
it, exits 0. This exercises argument construction, the glob-for-newest-mp4
logic, storage upload, and the photo-only guard without touching real
SadTalker.

Covered by unit tests:
- Happy path: shim run → storage upload → correct `AvatarOutput` shape.
- Non-`image` `avatarRef` (bare `avatarId` reaching the provider directly) → `ProviderError`.
- Shim exits non-zero → `ProviderError` surfaced, not swallowed.
- `resultDir` has no `.mp4` after a clean exit → `ProviderError`.
- `capabilities()` declares `deployment: 'local'` and a non-zero cost hint
  (unlike Piper, SadTalker is GPU-time-expensive even though it's "free" —
  cost hint should reflect compute time, not $0, so operators aren't misled
  into thinking it's free the way Piper genuinely is).

Pipeline-side: unit tests for the new `avatarId` → `AvatarVersion.artifacts`
resolution logic in `handlers.ts` (found / not found / wrong kind / missing
source image), independent of any specific provider.

## Out of scope for this slice

- The `lipsync` capability remains unused — no pipeline stage calls it today.
- Quota enforcement still doesn't gate avatar generation (tracked separately
  in `docs/roadmap.md`).
- No seeded "default" avatar exists — a video with no avatar assigned still
  fails cleanly (`PipelineError`), same behavior as today, just with a
  clearer message.
- The `docker` runner kind (deferred per Decision 3).
- Enabling `avatar-sadtalker` in `config/ai.yaml`'s default chain — it ships
  disabled/commented-out like `lipsync-wav2lip` already is, so a fresh
  install's zero-credential path doesn't suddenly require a GPU + multi-GB
  checkpoint download. An operator opts in explicitly.
