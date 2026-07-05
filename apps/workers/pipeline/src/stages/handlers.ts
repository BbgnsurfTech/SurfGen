import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { collectFinalOutput, type LLMInput, type LLMOutput, type TTSInput, type TTSOutput, type TranslationInput, type TranslationOutput, type AvatarInput, type AvatarOutput, type WordTiming } from '@surfgen/ai-sdk';
import { PipelineError, RESOLUTIONS, type MediaRef } from '@surfgen/core';
import { createEnvelope } from '@surfgen/events';
import { artifactKey } from '@surfgen/storage';
import type { StageJobContext } from '@surfgen/queue';
import { loadArtifacts, saveArtifact, type StageJobData, type StageRuntime } from '../runtime.js';
import { probeDurationMs, runFfmpeg } from '../ffmpeg.js';

type Handler = (ctx: StageJobContext<StageJobData>) => Promise<void>;

/** Wrap a stage body with artifact persistence + completion/failure events. */
function stage(
  runtime: StageRuntime,
  body: (
    ctx: StageJobContext<StageJobData>,
    artifacts: Record<string, Record<string, unknown>>,
  ) => Promise<Record<string, unknown>>,
): Handler {
  return async (ctx) => {
    const { runId, stage: stageName, organizationId } = ctx.data;
    const startedAt = Date.now();
    try {
      const artifacts = await loadArtifacts(runtime.prisma, runId);
      if (artifacts[stageName]) {
        // Resume path: artifact already produced by a previous attempt.
        runtime.logger.info({ runId, stage: stageName }, 'artifact exists — skipping recompute');
      } else {
        const artifact = await body(ctx, artifacts);
        await saveArtifact(runtime.prisma, runId, stageName, artifact);
      }
      await runtime.prisma.job.updateMany({
        where: { pipelineRunId: runId, stage: stageName },
        data: { status: 'completed', finishedAt: new Date() },
      });
      await runtime.events.publish(
        createEnvelope({
          name: 'pipeline.stage_completed',
          organizationId,
          correlationId: runId,
          payload: { runId, stage: stageName, durationMs: Date.now() - startedAt, artifactKeys: [] },
        }),
      );
    } catch (error) {
      const finalAttempt = ctx.attempt >= (await maxAttemptsFor(runtime, runId, stageName));
      runtime.logger.error(
        { runId, stage: stageName, attempt: ctx.attempt, finalAttempt, error: String(error) },
        'stage failed',
      );
      if (finalAttempt) {
        await runtime.prisma.job.updateMany({
          where: { pipelineRunId: runId, stage: stageName },
          data: {
            status: 'failed',
            finishedAt: new Date(),
            error: { message: String(error) },
          },
        });
        await runtime.events.publish(
          createEnvelope({
            name: 'pipeline.stage_failed',
            organizationId,
            correlationId: runId,
            payload: { runId, stage: stageName, error: String(error) },
          }),
        );
      }
      throw error; // let BullMQ manage retry bookkeeping
    }
  };
}

async function maxAttemptsFor(
  runtime: StageRuntime,
  runId: string,
  stageName: string,
): Promise<number> {
  const job = await runtime.prisma.job.findFirst({
    where: { pipelineRunId: runId, stage: stageName },
  });
  return job?.maxAttempts ?? 3;
}

interface PipelineInput {
  script?: string;
  targetLanguage?: string;
  avatarId?: string;
  voiceId?: string;
}

async function videoContext(runtime: StageRuntime, videoId: string) {
  const video = await runtime.prisma.video.findUniqueOrThrow({ where: { id: videoId } });
  return {
    video,
    input: (video.pipeline ?? {}) as PipelineInput,
    settings: video.settings as {
      resolution: { width: number; height: number };
      frameRate: number;
      container: string;
      codec: string;
      quality: number;
    },
  };
}

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

/** Build all stage handlers bound to a runtime. */
export function createStageHandlers(runtime: StageRuntime): Record<string, Handler> {
  return {
    // ------------------------------------------------------------------ script
    script: stage(runtime, async (ctx) => {
      const { input, video } = await videoContext(runtime, ctx.data.videoId);
      if (input.script) {
        return { text: input.script, generated: false };
      }
      const output = await collectFinalOutput(
        runtime.registry.execute<LLMInput, LLMOutput>(
          'llm',
          {
            messages: [
              {
                role: 'system',
                content:
                  'You write concise spoken-video scripts. Output only the words the presenter says.',
              },
              { role: 'user', content: `Write a 30-second presenter script for: ${video.title}` },
            ],
            maxTokens: 400,
          },
          { organizationId: ctx.data.organizationId, correlationId: ctx.data.runId },
        ),
      );
      return { text: output.text, generated: true };
    }),

    // --------------------------------------------------------------- translate
    translate: stage(runtime, async (ctx, artifacts) => {
      const { input } = await videoContext(runtime, ctx.data.videoId);
      const script = artifacts.script?.text as string;
      if (!input.targetLanguage) return { text: script, skipped: true };
      const output = await collectFinalOutput(
        runtime.registry.execute<TranslationInput, TranslationOutput>(
          'translation',
          { text: script, targetLanguage: input.targetLanguage },
          { organizationId: ctx.data.organizationId, correlationId: ctx.data.runId },
        ),
      );
      return { text: output.text };
    }),

    // --------------------------------------------------------------------- tts
    tts: stage(runtime, async (ctx, artifacts) => {
      const { input, video } = await videoContext(runtime, ctx.data.videoId);
      const text = (artifacts.translate?.text ?? artifacts.script?.text) as string;
      if (!text) throw new PipelineError('tts', 'no script text available');

      await ctx.updateProgress(10, 'synthesizing voice');
      const output = await collectFinalOutput(
        runtime.registry.execute<TTSInput, TTSOutput>(
          'tts',
          {
            text,
            voiceId: input.voiceId ?? 'en_US-amy-medium',
            language: video.language,
            outputFormat: 'wav',
          },
          {
            organizationId: ctx.data.organizationId,
            correlationId: ctx.data.runId,
            signal: ctx.signal,
          },
        ),
      );
      return { audio: output.audio, wordTimings: output.wordTimings ?? [], text };
    }),

    // ------------------------------------------------------------------ avatar
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

    // --------------------------------------------------------------- subtitles
    subtitles: stage(runtime, async (ctx, artifacts) => {
      const text = artifacts.tts?.text as string;
      const timings = (artifacts.tts?.wordTimings ?? []) as WordTiming[];
      const srt = buildSrt(text, timings);
      const key = artifactKey(ctx.data.organizationId, ctx.data.runId, 'subtitles', 'captions.srt');
      await runtime.storage.put(key, new TextEncoder().encode(srt), {
        contentType: 'application/x-subrip',
      });
      return { captions: { storageKey: key, contentType: 'application/x-subrip' } };
    }),

    // ------------------------------------------------------------------ render
    render: stage(runtime, async (ctx, artifacts) => {
      const { settings, video } = await videoContext(runtime, ctx.data.videoId);
      const workDir = join(runtime.workDir, ctx.data.runId, 'render');
      await mkdir(workDir, { recursive: true });

      try {
        await ctx.updateProgress(5, 'preparing inputs');
        const audioPath = await materialize(
          runtime,
          artifacts.tts?.audio as { storageKey: string } | undefined,
          join(workDir, 'audio.wav'),
        );
        const avatarPath = await materialize(
          runtime,
          artifacts.avatar?.video as { storageKey: string } | undefined,
          join(workDir, 'avatar.mp4'),
        );

        const { width, height } = settings.resolution;
        const outPath = join(workDir, `out.${settings.container}`);
        const args: string[] = ['-y'];

        if (avatarPath) {
          args.push('-i', avatarPath);
          if (audioPath) args.push('-i', audioPath, '-map', '0:v', '-map', '1:a');
        } else if (audioPath) {
          // Reference local render: brand background + synthesized voiceover.
          args.push(
            '-f', 'lavfi', '-i', `color=c=0x10101c:s=${width}x${height}:r=${settings.frameRate}`,
            '-i', audioPath, '-shortest',
          );
        } else {
          // Nothing real to render (pure mock chain): 3s of brand background.
          args.push(
            '-f', 'lavfi', '-i', `color=c=0x10101c:s=${width}x${height}:r=${settings.frameRate}`,
            '-t', '3',
          );
        }

        args.push(
          '-c:v', settings.codec === 'h264' ? 'libx264' : settings.codec,
          '-crf', String(settings.quality),
          '-pix_fmt', 'yuv420p',
        );
        if (audioPath) args.push('-c:a', 'aac');
        args.push(outPath);

        await ctx.updateProgress(20, 'encoding');
        await runFfmpeg(args, { signal: ctx.signal });

        await ctx.updateProgress(80, 'uploading');
        const durationMs = await probeDurationMs(outPath);
        const key = artifactKey(
          ctx.data.organizationId,
          ctx.data.runId,
          'render',
          `video.${settings.container}`,
        );
        await runtime.storage.put(key, await readFile(outPath), {
          contentType: `video/${settings.container === 'mov' ? 'quicktime' : settings.container}`,
        });
        runtime.metrics
          .counter('surfgen_render_seconds_total', 'Rendered output seconds', ['org'])
          .inc({ org: ctx.data.organizationId }, durationMs / 1000);
        return {
          media: { storageKey: key, contentType: `video/${settings.container}`, durationMs },
          title: video.title,
        };
      } finally {
        await rm(workDir, { recursive: true, force: true });
      }
    }),

    // --------------------------------------------------------------- thumbnail
    thumbnail: stage(runtime, async (ctx, artifacts) => {
      const media = artifacts.render?.media as { storageKey: string } | undefined;
      if (!media) throw new PipelineError('thumbnail', 'render artifact missing');
      const workDir = join(runtime.workDir, ctx.data.runId, 'thumb');
      await mkdir(workDir, { recursive: true });
      try {
        const videoPath = (await materialize(runtime, media, join(workDir, 'in.mp4'))) as string;
        const thumbPath = join(workDir, 'thumb.jpg');
        await runFfmpeg(
          ['-y', '-i', videoPath, '-vf', 'thumbnail,scale=640:-2', '-frames:v', '1', thumbPath],
          { signal: ctx.signal },
        );
        const key = artifactKey(ctx.data.organizationId, ctx.data.runId, 'thumbnail', 'thumb.jpg');
        await runtime.storage.put(key, await readFile(thumbPath), { contentType: 'image/jpeg' });
        return { thumbnail: { storageKey: key, contentType: 'image/jpeg' } };
      } finally {
        await rm(workDir, { recursive: true, force: true });
      }
    }),

    // ---------------------------------------------------------------- finalize
    finalize: stage(runtime, async (ctx, artifacts) => {
      const media = artifacts.render?.media as
        | { storageKey: string; contentType: string; durationMs: number }
        | undefined;
      if (!media) throw new PipelineError('finalize', 'render artifact missing');
      const output = {
        media,
        thumbnail: artifacts.thumbnail?.thumbnail ?? null,
        captions: artifacts.subtitles?.captions ?? null,
        durationMs: media.durationMs,
      };
      await runtime.prisma.$transaction([
        runtime.prisma.video.update({
          where: { id: ctx.data.videoId },
          data: { status: 'ready', output },
        }),
        runtime.prisma.usageRecord.create({
          data: {
            organizationId: ctx.data.organizationId,
            metric: 'render.seconds',
            quantity: media.durationMs / 1000,
            runId: ctx.data.runId,
          },
        }),
      ]);
      await runtime.events.publish(
        createEnvelope({
          name: 'video.ready',
          organizationId: ctx.data.organizationId,
          correlationId: ctx.data.runId,
          payload: { videoId: ctx.data.videoId, runId: ctx.data.runId, output },
        }),
      );
      return { output };
    }),
  };
}

/** Download a storage object to a local path; missing/mock keys → null. */
async function materialize(
  runtime: StageRuntime,
  ref: { storageKey: string } | undefined,
  targetPath: string,
): Promise<string | null> {
  if (!ref?.storageKey || ref.storageKey.startsWith('mock/')) return null;
  const exists = await runtime.storage.stat(ref.storageKey);
  if (!exists) return null;
  const stream = await runtime.storage.get(ref.storageKey);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  await writeFile(targetPath, Buffer.concat(chunks));
  return targetPath;
}

const WORDS_PER_CAPTION = 8;
const FALLBACK_SECONDS_PER_WORD = 0.4;

/** SRT from word timings when available, else evenly-paced from the text. */
export function buildSrt(text: string, timings: readonly WordTiming[]): string {
  const format = (ms: number): string => {
    const clamped = Math.max(0, Math.round(ms));
    const h = String(Math.floor(clamped / 3_600_000)).padStart(2, '0');
    const m = String(Math.floor((clamped % 3_600_000) / 60_000)).padStart(2, '0');
    const s = String(Math.floor((clamped % 60_000) / 1000)).padStart(2, '0');
    const msPart = String(clamped % 1000).padStart(3, '0');
    return `${h}:${m}:${s},${msPart}`;
  };

  const words: WordTiming[] =
    timings.length > 0
      ? [...timings]
      : (text ?? '')
          .split(/\s+/)
          .filter(Boolean)
          .map((word, index) => ({
            word,
            startMs: index * FALLBACK_SECONDS_PER_WORD * 1000,
            endMs: (index + 1) * FALLBACK_SECONDS_PER_WORD * 1000,
          }));

  const blocks: string[] = [];
  for (let i = 0; i < words.length; i += WORDS_PER_CAPTION) {
    const group = words.slice(i, i + WORDS_PER_CAPTION);
    const first = group[0];
    const last = group[group.length - 1];
    if (!first || !last) continue;
    blocks.push(
      `${blocks.length + 1}\n${format(first.startMs)} --> ${format(last.endMs)}\n${group
        .map((w) => w.word)
        .join(' ')}\n`,
    );
  }
  return blocks.join('\n');
}

export const randomWorkDirSuffix = (): string => randomUUID();
