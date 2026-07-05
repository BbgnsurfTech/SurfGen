# Local SadTalker Avatar Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a real, local, CLI-based `avatar` provider (SadTalker: photo + audio → talking-head video) so rendered videos stop silently falling back to a static color card, plus the pipeline plumbing needed to feed it a real source photo.

**Architecture:** A new plugin package `plugins/avatar-sadtalker`, structured file-for-file like the existing `plugins/tts-piper` (manifest → provider class wrapping `CliRunner` → `definePlugin` registration), shipped disabled by default in `config/ai.yaml`. A small, independently-testable pipeline change resolves a video's `avatarId` to its registered source photo before calling the `avatar` capability, falling back to today's exact behavior (pass the bare `avatarId` through) whenever resolution isn't possible — so the existing always-succeeds mock chain is never broken by this change.

**Tech Stack:** TypeScript, `@surfgen/ai-sdk`'s `CliRunner` (subprocess), `@surfgen/plugin-sdk`'s `definePlugin`, Vitest with a Node shim script standing in for the real `inference.py` (no GPU/model weights needed to test).

## Global Constraints

- Design spec of record: `docs/superpowers/specs/2026-07-05-sadtalker-avatar-provider-design.md`. Every decision below traces back to it.
- Only `AvatarKind.photo` avatars are supported by this provider. `video` / `three_d` / `animated_character` avatars are unaffected by this plan (existing behavior for them is untouched).
- No new runner kind. Use the existing `CliRunner` exactly as `plugins/tts-piper/src/index.ts` uses it.
- The plugin ships **disabled** in `config/ai.yaml` (commented out, matching `lipsync-wav2lip`'s existing style). Nothing in this plan changes default pipeline behavior for an operator who doesn't opt in.
- The plugin's manifest `description` and its `README.md` must state the licensing caveat verbatim: SadTalker's code is Apache 2.0, but its required checkpoints (Deep3DFaceReconstruction, Basel Face Model) carry separate non-commercial academic license terms, and it incorporates Wav2Lip-associated components under a research-only license — the deploying operator is responsible for obtaining/complying with those terms.
- Package naming: directory `plugins/avatar-sadtalker`, `package.json` name `@surfgen/plugin-avatar-sadtalker` (matches the existing `@surfgen/plugin-tts-piper` convention — package name is prefixed `plugin-`, directory name is not).
- No task in this plan populates `AvatarVersion.artifacts.sourceImage` for any real avatar — no asset-upload API exists yet (tracked separately in `docs/roadmap.md`). This plan's pipeline change is a no-op in production until that exists; it's fully exercised by this plan's own tests via direct DB rows.

---

## Task 1: Resolve `avatarId` to a source photo in the pipeline

**Files:**
- Modify: `apps/workers/pipeline/src/stages/handlers.ts`
- Create: `apps/workers/pipeline/test/handlers.test.ts`

**Interfaces:**
- Produces: `export async function resolveAvatarImage(prisma: AvatarLookup, organizationId: string, avatarId: string): Promise<MediaRef | null>` — exported from `handlers.ts`, consumed by Task 2's provider only indirectly (Task 2 doesn't call this; it's pipeline-side). Later tasks don't depend on this function directly, but the plan's manual end-to-end check in Task 3 does.

### Step 1: Write the failing test

Create `apps/workers/pipeline/test/handlers.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { resolveAvatarImage } from '../src/stages/handlers.js';

interface FakeAvatar {
  id: string;
  organizationId: string;
  kind: string;
  deletedAt: Date | null;
}

interface FakeAvatarVersion {
  avatarId: string;
  isActive: boolean;
  artifacts: unknown;
}

function fakePrisma(avatars: FakeAvatar[], versions: FakeAvatarVersion[]) {
  return {
    avatar: {
      findFirst: async ({ where }: { where: { id: string; organizationId: string; deletedAt: null } }) =>
        avatars.find(
          (a) => a.id === where.id && a.organizationId === where.organizationId && a.deletedAt === null,
        ) ?? null,
    },
    avatarVersion: {
      findFirst: async ({ where }: { where: { avatarId: string; isActive: boolean } }) =>
        versions.find((v) => v.avatarId === where.avatarId && v.isActive === where.isActive) ?? null,
    },
  };
}

describe('resolveAvatarImage', () => {
  test('returns the active version source image for a photo avatar', async () => {
    const sourceImage = { storageKey: 'org/o1/assets/a1/photo.png', contentType: 'image/png' };
    const prisma = fakePrisma(
      [{ id: 'a1', organizationId: 'o1', kind: 'photo', deletedAt: null }],
      [{ avatarId: 'a1', isActive: true, artifacts: { sourceImage } }],
    );
    await expect(resolveAvatarImage(prisma, 'o1', 'a1')).resolves.toEqual(sourceImage);
  });

  test('returns null when the avatar does not exist', async () => {
    const prisma = fakePrisma([], []);
    await expect(resolveAvatarImage(prisma, 'o1', 'missing')).resolves.toBeNull();
  });

  test('returns null for a non-photo avatar kind', async () => {
    const prisma = fakePrisma(
      [{ id: 'a1', organizationId: 'o1', kind: 'video', deletedAt: null }],
      [{ avatarId: 'a1', isActive: true, artifacts: { sourceImage: { storageKey: 'x', contentType: 'video/mp4' } } }],
    );
    await expect(resolveAvatarImage(prisma, 'o1', 'a1')).resolves.toBeNull();
  });

  test('returns null when the avatar belongs to a different org', async () => {
    const prisma = fakePrisma(
      [{ id: 'a1', organizationId: 'other-org', kind: 'photo', deletedAt: null }],
      [{ avatarId: 'a1', isActive: true, artifacts: { sourceImage: { storageKey: 'x', contentType: 'image/png' } } }],
    );
    await expect(resolveAvatarImage(prisma, 'o1', 'a1')).resolves.toBeNull();
  });

  test('returns null when no active version exists', async () => {
    const prisma = fakePrisma([{ id: 'a1', organizationId: 'o1', kind: 'photo', deletedAt: null }], []);
    await expect(resolveAvatarImage(prisma, 'o1', 'a1')).resolves.toBeNull();
  });

  test('returns null when the active version has no sourceImage artifact', async () => {
    const prisma = fakePrisma(
      [{ id: 'a1', organizationId: 'o1', kind: 'photo', deletedAt: null }],
      [{ avatarId: 'a1', isActive: true, artifacts: {} }],
    );
    await expect(resolveAvatarImage(prisma, 'o1', 'a1')).resolves.toBeNull();
  });
});
```

### Step 2: Run test to verify it fails

Run: `pnpm --filter @surfgen/worker-pipeline test -- handlers.test.ts`
Expected: FAIL — `resolveAvatarImage` is not exported from `../src/stages/handlers.js`.

### Step 3: Implement `resolveAvatarImage` and wire it into the `avatar` stage

In `apps/workers/pipeline/src/stages/handlers.ts`, update the top import line that currently reads:

```ts
import { PipelineError, RESOLUTIONS } from '@surfgen/core';
```

to:

```ts
import { PipelineError, RESOLUTIONS, type MediaRef } from '@surfgen/core';
```

Add this new interface and function anywhere above the `createStageHandlers` export (e.g. directly above the `avatar` stage's surrounding code):

```ts
/** Narrow shape resolveAvatarImage needs — satisfied by the real PrismaClient. */
export interface AvatarLookup {
  avatar: {
    findFirst(args: {
      where: { id: string; organizationId: string; deletedAt: null };
    }): Promise<{ id: string; kind: string } | null>;
  };
  avatarVersion: {
    findFirst(args: { where: { avatarId: string; isActive: boolean } }): Promise<{ artifacts: unknown } | null>;
  };
}

/**
 * Best-effort lookup of a photo avatar's source image. Returns null (never
 * throws) whenever the avatar can't be resolved — missing, wrong org, wrong
 * kind, no active version, no sourceImage artifact — so callers can fall back
 * to the legacy avatarId-passthrough behavior instead of failing the render.
 */
export async function resolveAvatarImage(
  prisma: AvatarLookup,
  organizationId: string,
  avatarId: string,
): Promise<MediaRef | null> {
  const avatar = await prisma.avatar.findFirst({ where: { id: avatarId, organizationId, deletedAt: null } });
  if (!avatar || avatar.kind !== 'photo') return null;
  const version = await prisma.avatarVersion.findFirst({ where: { avatarId: avatar.id, isActive: true } });
  const artifacts = version?.artifacts as { sourceImage?: MediaRef } | undefined;
  return artifacts?.sourceImage ?? null;
}
```

Then find the existing `avatar` stage (currently):

```ts
    avatar: stage(runtime, async (ctx, artifacts) => {
      const { input, settings } = await videoContext(runtime, ctx.data.videoId);
      const audio = artifacts.tts?.audio as { storageKey: string } | undefined;
      if (!audio) throw new PipelineError('avatar', 'tts artifact missing');

      await ctx.updateProgress(5, 'animating avatar');
      const output = await collectFinalOutput(
        runtime.registry.execute<AvatarInput, AvatarOutput>(
          'avatar',
          {
            avatarRef: { avatarId: input.avatarId ?? 'default' },
            drivingAudio: { storageKey: audio.storageKey, contentType: 'audio/wav' },
            resolution: settings.resolution ?? RESOLUTIONS.fullHd,
          },
          {
            organizationId: ctx.data.organizationId,
            correlationId: ctx.data.runId,
            signal: ctx.signal,
          },
        ),
      );
      return { video: output.video, hasAlpha: output.hasAlpha };
    }),
```

Replace the body between `updateProgress` and `collectFinalOutput` so it resolves a real image when one exists, and only falls back to the bare id otherwise:

```ts
    avatar: stage(runtime, async (ctx, artifacts) => {
      const { input, settings } = await videoContext(runtime, ctx.data.videoId);
      const audio = artifacts.tts?.audio as { storageKey: string } | undefined;
      if (!audio) throw new PipelineError('avatar', 'tts artifact missing');

      await ctx.updateProgress(5, 'animating avatar');
      const sourceImage = input.avatarId
        ? await resolveAvatarImage(runtime.prisma, ctx.data.organizationId, input.avatarId)
        : null;
      const avatarRef = sourceImage ? { image: sourceImage } : { avatarId: input.avatarId ?? 'default' };
      const output = await collectFinalOutput(
        runtime.registry.execute<AvatarInput, AvatarOutput>(
          'avatar',
          {
            avatarRef,
            drivingAudio: { storageKey: audio.storageKey, contentType: 'audio/wav' },
            resolution: settings.resolution ?? RESOLUTIONS.fullHd,
          },
          {
            organizationId: ctx.data.organizationId,
            correlationId: ctx.data.runId,
            signal: ctx.signal,
          },
        ),
      );
      return { video: output.video, hasAlpha: output.hasAlpha };
    }),
```

**Deliberate refinement of the design spec.** The spec's Error Handling section says a non-photo avatar should be "rejected in the pipeline stage... before the provider is invoked at all." Implementing that literally — throwing a `PipelineError` whenever resolution fails — would regress every org that hasn't configured a real photo avatar (i.e. everyone today, since no asset-upload API exists yet to populate `AvatarVersion.artifacts`): the pipeline would start failing renders that currently succeed via the harmless `avatar-mock` fallback. `resolveAvatarImage` therefore never throws; it returns `null` on anything it can't resolve, and the stage falls back to today's exact `{ avatarId }` passthrough in that case. The photo-only guard still exists — just enforced by returning `null` for non-photo kinds (silently deferring to the mock chain) rather than by throwing. The provider-side guard in Task 2 (rejecting a bare `avatarId`) is the actual hard enforcement point for "SadTalker only handles resolved images," consistent with the spec's Decision 4.

### Step 4: Run test to verify it passes

Run: `pnpm --filter @surfgen/worker-pipeline test -- handlers.test.ts`
Expected: PASS — all 6 tests green.

### Step 5: Typecheck

Run: `pnpm --filter @surfgen/worker-pipeline typecheck`
Expected: no errors.

### Step 6: Commit

```bash
git add apps/workers/pipeline/src/stages/handlers.ts apps/workers/pipeline/test/handlers.test.ts
git commit -m "feat(pipeline): resolve avatarId to its source photo before calling the avatar provider"
```

---

## Task 2: `avatar-sadtalker` plugin — scaffold and provider (TDD)

**Files:**
- Create: `plugins/avatar-sadtalker/plugin.manifest.json`
- Create: `plugins/avatar-sadtalker/package.json`
- Create: `plugins/avatar-sadtalker/tsconfig.json`
- Create: `plugins/avatar-sadtalker/tsup.config.ts`
- Create: `plugins/avatar-sadtalker/vitest.config.ts`
- Create: `plugins/avatar-sadtalker/src/index.ts`
- Test: `plugins/avatar-sadtalker/test/sadtalker.test.ts`

**Interfaces:**
- Consumes: `CliRunner`, `AIProvider<AvatarInput, AvatarOutput>`, `CapabilityDescriptor`, `GenerationContext`, `HealthStatus`, `ProviderConfig`, `ProviderEvent` from `@surfgen/ai-sdk`; `StoragePort`, `ProviderError`, `MediaRef` from `@surfgen/core`; `definePlugin` from `@surfgen/plugin-sdk`.
- Produces: default export `SadTalkerAvatarProvider` class and a `definePlugin(...)` default export from `src/index.ts` — nothing else in this plan imports from this package (it's loaded by the host's plugin loader via `plugin.manifest.json`, not by direct import).

### Step 1: Create the scaffold files

Create `plugins/avatar-sadtalker/plugin.manifest.json`:

```json
{
  "name": "avatar-sadtalker",
  "version": "0.1.0",
  "description": "Local talking-head avatar animation via SadTalker (Apache-2.0 code; required checkpoints — Deep3DFaceReconstruction, Basel Face Model — carry separate non-commercial license terms the deploying operator must obtain and comply with; see README.md",
  "sdkVersion": "^0.1.0",
  "license": "Apache-2.0",
  "capabilities": ["avatar"],
  "entry": "dist/index.js",
  "permissions": ["subprocess", "filesystem"]
}
```

Create `plugins/avatar-sadtalker/package.json`:

```json
{
  "name": "@surfgen/plugin-avatar-sadtalker",
  "version": "0.1.0",
  "description": "Local talking-head avatar animation via the SadTalker CLI",
  "license": "Apache-2.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": [
    "dist",
    "plugin.manifest.json"
  ],
  "scripts": {
    "build": "tsup",
    "lint": "eslint src test",
    "typecheck": "tsc --noEmit",
    "test": "vitest run --passWithNoTests",
    "test:coverage": "vitest run --coverage --passWithNoTests"
  },
  "dependencies": {
    "@surfgen/ai-sdk": "workspace:*",
    "@surfgen/core": "workspace:*",
    "@surfgen/plugin-sdk": "workspace:*"
  },
  "devDependencies": {
    "tsup": "catalog:",
    "vitest": "catalog:",
    "@vitest/coverage-v8": "catalog:"
  }
}
```

Create `plugins/avatar-sadtalker/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": ".",
    "outDir": "dist",
    "noEmit": true
  },
  "include": [
    "src",
    "test"
  ]
}
```

Create `plugins/avatar-sadtalker/tsup.config.ts`:

```ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
});
```

Create `plugins/avatar-sadtalker/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['test/**/*.test.ts'] },
});
```

Run: `pnpm install`
Expected: pnpm links the new `@surfgen/plugin-avatar-sadtalker` workspace package (picked up via the existing `plugins/*` glob in `pnpm-workspace.yaml`) with no errors.

### Step 2: Write the failing test

Create `plugins/avatar-sadtalker/test/sadtalker.test.ts`:

```ts
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { collectFinalOutput } from '@surfgen/ai-sdk';
import { SadTalkerAvatarProvider } from '../src/index.js';

/**
 * SadTalker is exercised through a shim script that mimics inference.py's
 * contract (accepts --source_image/--driven_audio/--result_dir, timestamps a
 * subdirectory, writes a fake .mp4 into it, exits 0) so the provider's
 * process handling, output-globbing, and storage upload are tested without
 * the real model, checkpoints, or a GPU.
 */
const shimDir = mkdtempSync(join(tmpdir(), 'sadtalker-shim-'));
const shimPath = join(shimDir, 'inference-shim.mjs');
writeFileSync(
  shimPath,
  `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const args = process.argv.slice(2);
const flag = (name) => args[args.indexOf(name) + 1];
if (args.includes('--help')) process.exit(0);
const resultDir = flag('--result_dir');
const subDir = join(resultDir, '2026_07_05_12.00.00');
mkdirSync(subDir, { recursive: true });
writeFileSync(join(subDir, 'result.mp4'), Buffer.from('fake-mp4-bytes'));
process.exit(0);
`,
);
chmodSync(shimPath, 0o755);
afterAll(() => rmSync(shimDir, { recursive: true, force: true }));

class MemoryStorage {
  files = new Map<string, Buffer>();
  async put(key: string, body: Uint8Array): Promise<{ key: string; sizeBytes: number; contentType: string; lastModified: Date }> {
    this.files.set(key, Buffer.from(body));
    return { key, sizeBytes: body.length, contentType: 'video/mp4', lastModified: new Date() };
  }
  async get(key: string): Promise<NodeJS.ReadableStream> {
    const { Readable } = await import('node:stream');
    return Readable.from([this.files.get(key)]);
  }
  async stat(): Promise<null> {
    return null;
  }
  async delete(): Promise<void> {}
  async list(): Promise<{ objects: never[] }> {
    return { objects: [] };
  }
  async signedUrl(): Promise<string> {
    return 'unused';
  }
}

async function makeProvider(storage: MemoryStorage = new MemoryStorage()) {
  const provider = new SadTalkerAvatarProvider();
  await provider.initialize({
    id: 'avatar-sadtalker',
    capability: 'avatar',
    enabled: true,
    priority: 10,
    options: { pythonCommand: 'node', scriptPath: shimPath, storage },
  });
  return provider;
}

describe('SadTalkerAvatarProvider', () => {
  test('animates a photo avatar and uploads the result', async () => {
    const storage = new MemoryStorage();
    // Pre-seed a fake source image + audio so the provider's own materialize step finds them.
    await storage.put('org/o1/assets/a1/photo.png', new TextEncoder().encode('fake-png-bytes'));
    await storage.put('org/o1/runs/r1/tts/audio.wav', new TextEncoder().encode('fake-wav-bytes'));
    const provider = await makeProvider(storage);

    const output = await collectFinalOutput(
      provider.generate(
        {
          avatarRef: { image: { storageKey: 'org/o1/assets/a1/photo.png', contentType: 'image/png' } },
          drivingAudio: { storageKey: 'org/o1/runs/r1/tts/audio.wav', contentType: 'audio/wav' },
          resolution: { width: 1920, height: 1080 },
        },
        {},
      ),
    );

    expect(output.video.contentType).toBe('video/mp4');
    expect(output.hasAlpha).toBe(false);
    expect(storage.files.get(output.video.storageKey)?.toString()).toBe('fake-mp4-bytes');
  });

  test('rejects a bare avatarId — requires an already-resolved image', async () => {
    const provider = await makeProvider();
    await expect(
      collectFinalOutput(
        provider.generate(
          {
            avatarRef: { avatarId: 'a1' },
            drivingAudio: { storageKey: 'x', contentType: 'audio/wav' },
            resolution: { width: 1920, height: 1080 },
          },
          {},
        ),
      ),
    ).rejects.toThrow(/requires a resolved source image/);
  });

  test('surfaces a non-zero shim exit as a ProviderError', async () => {
    const storage = new MemoryStorage();
    await storage.put('img.png', new TextEncoder().encode('x'));
    await storage.put('audio.wav', new TextEncoder().encode('x'));
    const provider = new SadTalkerAvatarProvider();
    const failingShim = join(shimDir, 'failing-shim.mjs');
    writeFileSync(failingShim, `#!/usr/bin/env node\nprocess.exit(1);\n`);
    chmodSync(failingShim, 0o755);
    await provider.initialize({
      id: 'avatar-sadtalker',
      capability: 'avatar',
      enabled: true,
      priority: 10,
      options: { pythonCommand: 'node', scriptPath: failingShim, storage },
    });

    await expect(
      collectFinalOutput(
        provider.generate(
          {
            avatarRef: { image: { storageKey: 'img.png', contentType: 'image/png' } },
            drivingAudio: { storageKey: 'audio.wav', contentType: 'audio/wav' },
            resolution: { width: 1920, height: 1080 },
          },
          {},
        ),
      ),
    ).rejects.toThrow(/exited 1/);
  });

  test('declares itself local with a non-zero cost hint', async () => {
    const provider = await makeProvider();
    const descriptor = provider.capabilities();
    expect(descriptor.deployment).toBe('local');
    expect(descriptor.costHint?.amount).toBeGreaterThan(0);
    expect(descriptor.features.offline).toBe(true);
  });
});
```

### Step 3: Run test to verify it fails

Run: `pnpm --filter @surfgen/plugin-avatar-sadtalker test`
Expected: FAIL — `../src/index.js` doesn't exist yet.

### Step 4: Implement the provider

Create `plugins/avatar-sadtalker/src/index.ts`:

```ts
import { mkdtempSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  CliRunner,
  type AIProvider,
  type AvatarInput,
  type AvatarOutput,
  type CapabilityDescriptor,
  type GenerationContext,
  type HealthStatus,
  type ProviderConfig,
  type ProviderEvent,
} from '@surfgen/ai-sdk';
import { ConfigurationError, ProviderError, type MediaRef, type StoragePort } from '@surfgen/core';
import { definePlugin } from '@surfgen/plugin-sdk';
import manifest from '../plugin.manifest.json' with { type: 'json' };

interface SadTalkerOptions {
  /** Interpreter to invoke the script with. */
  pythonCommand?: string;
  /** Absolute path to SadTalker's inference.py — required, no sane default. */
  scriptPath: string;
  /** Optional --checkpoint_dir override if not colocated with the script. */
  checkpointDir?: string;
  /** Injected by the host so outputs land in platform storage. */
  storage?: StoragePort;
  /** Storage key prefix for generated video. */
  keyPrefix?: string;
}

/** Downloads a MediaRef to a local file; returns the path. */
async function materialize(storage: StoragePort, ref: MediaRef, targetPath: string): Promise<string> {
  const stream = await storage.get(ref.storageKey);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  await writeFile(targetPath, Buffer.concat(chunks));
  return targetPath;
}

/**
 * SadTalker timestamps a subdirectory under --result_dir and moves the final
 * video there; the exact filename isn't predictable ahead of time, so find
 * the newest .mp4 anywhere under resultDir rather than parsing stdout.
 */
async function newestMp4(resultDir: string): Promise<string> {
  const found: { path: string; mtimeMs: number }[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name.endsWith('.mp4')) {
        found.push({ path: full, mtimeMs: (await stat(full)).mtimeMs });
      }
    }
  }
  await walk(resultDir);
  if (found.length === 0) {
    throw new ProviderError('avatar-sadtalker', `no .mp4 produced under ${resultDir}`);
  }
  found.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return found[0].path;
}

/**
 * SadTalker via CLI: local, GPU-recommended (CPU works but is slow), photo +
 * audio in, talking-head video out. See README.md for the licensing caveat on
 * required third-party checkpoints before enabling this in production.
 */
export class SadTalkerAvatarProvider implements AIProvider<AvatarInput, AvatarOutput> {
  readonly id: string;
  readonly capability = 'avatar' as const;
  private options!: SadTalkerOptions;

  constructor(id = 'avatar-sadtalker') {
    this.id = id;
  }

  async initialize(config: ProviderConfig): Promise<void> {
    this.options = config.options as unknown as SadTalkerOptions;
    if (!this.options.scriptPath) {
      throw new ConfigurationError('avatar-sadtalker requires options.scriptPath (path to inference.py)');
    }
  }

  async health(): Promise<HealthStatus> {
    const runner = new CliRunner({
      command: this.options.pythonCommand ?? 'python3',
      args: [this.options.scriptPath, '--help'],
      healthArgs: [this.options.scriptPath, '--help'],
    });
    const result = await runner.healthCheck();
    return { ...result, checkedAt: new Date() };
  }

  capabilities(): CapabilityDescriptor {
    return {
      capability: 'avatar',
      displayName: 'SadTalker (local)',
      deployment: 'local',
      streaming: false,
      languages: [],
      inputFormats: ['image/png', 'image/jpeg', 'audio/wav'],
      outputFormats: ['video/mp4'],
      costHint: { unit: 'render', amount: 1, currency: 'USD' },
      features: { offline: true },
    };
  }

  async *generate(
    input: AvatarInput,
    context: GenerationContext,
  ): AsyncIterable<ProviderEvent<AvatarOutput>> {
    if (!('image' in input.avatarRef)) {
      throw new ProviderError('avatar-sadtalker', 'requires a resolved source image, not a bare avatarId');
    }
    const storage = this.options.storage;
    if (!storage) throw new ConfigurationError('avatar-sadtalker requires options.storage to be injected');

    const workDir = mkdtempSync(join(tmpdir(), 'surfgen-sadtalker-'));
    const resultDir = join(workDir, 'results');
    await mkdir(resultDir, { recursive: true });

    try {
      yield { type: 'progress', percent: 5, message: 'preparing inputs' };
      const sourceImagePath = await materialize(storage, input.avatarRef.image, join(workDir, 'source.png'));
      const drivenAudioPath = await materialize(storage, input.drivingAudio, join(workDir, 'audio.wav'));

      yield { type: 'progress', percent: 15, message: 'animating face' };
      const runner = new CliRunner({
        command: this.options.pythonCommand ?? 'python3',
        args: [
          this.options.scriptPath,
          '--source_image', sourceImagePath,
          '--driven_audio', drivenAudioPath,
          '--result_dir', resultDir,
          '--still',
          '--preprocess', 'full',
          '--size', input.resolution.width >= 512 ? '512' : '256',
          ...(this.options.checkpointDir ? ['--checkpoint_dir', this.options.checkpointDir] : []),
        ],
      });
      await runner.invoke({ payload: undefined, ...(context.signal && { signal: context.signal }) });

      yield { type: 'progress', percent: 85, message: 'storing video' };
      const resultFile = await newestMp4(resultDir);
      const bytes = await readFile(resultFile);
      const key = `${this.options.keyPrefix ?? 'avatar/sadtalker'}/${randomUUID()}.mp4`;
      await storage.put(key, new Uint8Array(bytes), { contentType: 'video/mp4' });

      yield {
        type: 'output',
        final: true,
        data: { video: { storageKey: key, contentType: 'video/mp4' }, hasAlpha: false },
      };
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  async shutdown(): Promise<void> {}
}

export default definePlugin({
  manifest,
  register: async (registry, options) => {
    const provider = new SadTalkerAvatarProvider();
    await provider.initialize({
      id: 'avatar-sadtalker',
      capability: 'avatar',
      enabled: true,
      priority: (options.priority as number) ?? 10,
      options,
    });
    registry.register(provider, { priority: (options.priority as number) ?? 10 });
  },
});
```

### Step 5: Run test to verify it passes

Run: `pnpm --filter @surfgen/plugin-avatar-sadtalker test`
Expected: PASS — all 4 tests green.

### Step 6: Typecheck

Run: `pnpm --filter @surfgen/plugin-avatar-sadtalker typecheck`
Expected: no errors.

### Step 7: Commit

```bash
git add plugins/avatar-sadtalker
git commit -m "feat(avatar-sadtalker): add local SadTalker avatar provider plugin"
```

---

## Task 3: Licensing README, optional config wiring, and final verification

**Files:**
- Create: `plugins/avatar-sadtalker/README.md`
- Modify: `config/ai.yaml`

**Interfaces:**
- Consumes: nothing new — this task only adds documentation and an inert (commented-out) config entry.
- Produces: nothing consumed by other tasks — this is the plan's terminal task.

### Step 1: Write the README

Create `plugins/avatar-sadtalker/README.md`:

```markdown
# @surfgen/plugin-avatar-sadtalker

Local talking-head avatar animation via [SadTalker](https://github.com/OpenTalker/SadTalker),
run through its `inference.py` CLI — no cloud credentials, no network calls.

## Licensing — read before enabling in production

SadTalker's own code is Apache 2.0. It depends on third-party model
checkpoints with **separate, more restrictive licenses**:

- **Deep3DFaceReconstruction** and the **Basel Face Model (BFM)** — both
  require agreeing to a non-commercial academic license to download.
- SadTalker also incorporates ideas/checkpoints associated with **Wav2Lip**,
  whose original license is research/non-commercial only.

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
```

### Step 2: Add the optional config entry

In `config/ai.yaml`, find the `avatar` chain (currently):

```yaml
  avatar:
    chain:
      # - provider: avatar-heygen     # cloud — requires env:HEYGEN_API_KEY
      #   priority: 5
      - provider: avatar-mock
        priority: 100
```

Add a commented SadTalker entry above `avatar-mock`, matching the existing style used for `lipsync-wav2lip`:

```yaml
  avatar:
    chain:
      # - provider: avatar-heygen     # cloud — requires env:HEYGEN_API_KEY
      #   priority: 5
      # - provider: avatar-sadtalker  # local CLI runner — see plugins/avatar-sadtalker/README.md for licensing + setup
      #   priority: 10
      - provider: avatar-mock
        priority: 100
```

### Step 3: Full verification pass

Run each of the following and confirm the stated result:

```bash
pnpm --filter @surfgen/worker-pipeline test
```
Expected: all pipeline tests pass, including the new `handlers.test.ts`.

```bash
pnpm --filter @surfgen/plugin-avatar-sadtalker test
```
Expected: all 4 provider tests pass.

```bash
pnpm --filter @surfgen/worker-pipeline typecheck
pnpm --filter @surfgen/plugin-avatar-sadtalker typecheck
```
Expected: no errors in either.

```bash
pnpm --filter @surfgen/plugin-avatar-sadtalker build
```
Expected: `tsup` succeeds, producing `plugins/avatar-sadtalker/dist/index.js` + `.d.ts`.

### Step 4: Commit

```bash
git add plugins/avatar-sadtalker/README.md config/ai.yaml
git commit -m "docs(avatar-sadtalker): add licensing README and optional config wiring"
```

---

## What this plan deliberately does not do

- Does not enable `avatar-sadtalker` by default — it stays commented out in `config/ai.yaml`, exactly like `lipsync-wav2lip` already does.
- Does not build the `docker` runner kind — deferred per the design spec.
- Does not add an asset-upload API to let a user actually assign a source photo to an avatar through the UI — that's a separate, already-tracked roadmap gap. Without it, `resolveAvatarImage` has nothing to find for any real avatar today (including the seeded demo avatar, whose `AvatarVersion.artifacts` is currently `{}`), so this plan's pipeline change is fully inert in the running product until that gap closes. It's exercised end-to-end only by this plan's own tests.
- Does not touch the `lipsync` capability, quota enforcement, or the seeded "default" avatar fallback — all explicitly out of scope per the design spec.
