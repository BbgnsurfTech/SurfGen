'use client';

import { Captions, Plus, Trash2, WandSparkles } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Inspector } from '../../../components/editor/inspector';
import { Timeline } from '../../../components/editor/timeline';
import { EmptyState, LoadingState, gradientFor } from '../../../components/ui/states';
import { useToast } from '../../../components/ui/toast';
import {
  useAvatars,
  useCreateScene,
  useDeleteScene,
  useGenerateVideo,
  useUpdateScene,
  useVideoDetail,
  useVideoOutput,
  useVoices,
  useWorkspace,
} from '../../../lib/api/hooks';
import { useLiveEvent } from '../../../lib/api/live';
import { ApiError } from '../../../lib/api/client';

function formatDuration(ms: number | null): string {
  if (!ms) return '—:—';
  const total = Math.round(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function EditorContent() {
  const flash = useToast();
  const params = useSearchParams();
  const workspace = useWorkspace();
  const videoId = params.get('video') ?? workspace.data?.videos[0]?.id ?? null;
  const detail = useVideoDetail(videoId);
  const avatars = useAvatars();
  const voices = useVoices();
  const generate = useGenerateVideo();
  const createScene = useCreateScene();
  const updateScene = useUpdateScene();
  const deleteScene = useDeleteScene();
  const [activeScene, setActiveScene] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState<{ stage: string; percent: number } | null>(null);

  // Live pipeline progress for THIS video (org-scoped WebSocket).
  useLiveEvent((event) => {
    if (event.payload.videoId && event.payload.videoId !== videoId) return;
    if (event.name === 'video.progress') {
      setProgress({ stage: String(event.payload.stage ?? ''), percent: Number(event.payload.overallPercent ?? 0) });
    } else if (event.name === 'video.ready' || event.name === 'video.failed') {
      setProgress(null);
    }
  });

  const isReady = detail.data?.status === 'ready';
  const output = useVideoOutput(videoId, !!isReady);

  if (workspace.isPending || (videoId && detail.isPending)) {
    return <LoadingState label="Loading project…" />;
  }

  const video = detail.data;
  if (!videoId || !video) {
    return (
      <div className="p-8">
        <EmptyState
          title="No video to edit"
          hint="Create a video first — from the New Project button or the dashboard."
          action={
            <Link href="/dashboard" className="mt-2 rounded-full bg-primary px-5 py-2 text-xs font-bold text-white">
              Back to dashboard
            </Link>
          }
        />
      </div>
    );
  }

  const scenes = video.scenes;
  const scene = scenes[Math.min(activeScene, Math.max(scenes.length - 1, 0))];
  const script = (scene?.content.script as string | undefined) ?? '';
  const sceneAvatarId = scene?.content.avatarId as string | undefined;
  const sceneVoiceId = scene?.content.voiceId as string | undefined;
  const avatar = avatars.data?.find((a) => a.id === sceneAvatarId) ?? avatars.data?.[0] ?? null;
  const voice = voices.data?.find((v) => v.id === sceneVoiceId) ?? voices.data?.[0] ?? null;
  const durationMs =
    video.output?.durationMs ?? scenes.reduce((sum, s) => sum + (s.durationMs ?? 0), 0) ?? 0;

  const render = () => {
    generate.mutate(video.id, {
      onSuccess: () => flash('Render queued — the pipeline picks it up from video.queued'),
      onError: (error) =>
        flash(error instanceof ApiError ? `${error.code}: ${error.message}` : 'Render request failed'),
    });
  };

  return (
    <div className="sg-fade flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        {/* Scene rail */}
        <div className="flex w-[190px] flex-none flex-col border-r border-line bg-card">
          <div className="px-4 pt-3.5 pb-2.5 text-[11px] font-bold tracking-[0.1em] text-taupe">SCENES</div>
          <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto px-3 pb-3">
            {scenes.length === 0 && (
              <div className="rounded-xl border border-dashed border-sand bg-paper p-3 text-[11px] leading-relaxed text-stone">
                No scenes yet — the generation pipeline creates them from the script.
              </div>
            )}
            {scenes.map((s, i) => (
              <div
                key={s.id}
                className={`group relative overflow-hidden rounded-xl text-left ${
                  activeScene === i ? 'border-2 border-primary bg-paper' : 'border border-line bg-card'
                }`}
              >
                <button onClick={() => setActiveScene(i)} className="block w-full text-left">
                  <div className="relative h-[62px]" style={{ background: gradientFor(i) }}>
                    <span className="absolute top-[5px] left-[7px] text-[10px] font-bold text-white [text-shadow:0_1px_2px_rgba(0,0,0,.5)]">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                  </div>
                  <div className="px-[9px] py-[7px]">
                    <div className="truncate text-[11.5px] font-semibold">
                      {(s.content.name as string | undefined) ?? `Scene ${i + 1}`}
                    </div>
                    <div className="mt-0.5 text-[10px] text-stone">{formatDuration(s.durationMs)}</div>
                  </div>
                </button>
                <button
                  onClick={() =>
                    deleteScene.mutate(
                      { videoId: video.id, sceneId: s.id },
                      { onSuccess: () => { setActiveScene(0); flash('Scene deleted'); } },
                    )
                  }
                  aria-label={`Delete scene ${i + 1}`}
                  className="absolute top-1.5 right-1.5 hidden size-6 items-center justify-center rounded-full bg-ink/60 text-white backdrop-blur-sm group-hover:flex"
                >
                  <Trash2 className="size-3" strokeWidth={1.6} />
                </button>
              </div>
            ))}
            <button
              onClick={() =>
                createScene.mutate(
                  { videoId: video.id, content: { name: `Scene ${scenes.length + 1}` } },
                  { onSuccess: () => { setActiveScene(scenes.length); flash('Scene added'); } },
                )
              }
              disabled={createScene.isPending}
              className="flex items-center justify-center gap-1.5 rounded-xl border-[1.5px] border-dashed border-sand bg-paper p-3 text-xs font-semibold text-primary disabled:opacity-60"
            >
              <Plus className="size-[15px]" strokeWidth={1.6} /> Add scene
            </button>
          </div>
        </div>

        {/* Canvas */}
        <div className="flex min-w-0 flex-1 flex-col bg-espresso">
          <div className="flex h-11 flex-none items-center gap-2 border-b border-line-dark px-4">
            <span className="text-xs font-semibold text-stone">
              {video.title} · {video.status}
            </span>
            {progress && (
              <span className="flex items-center gap-2 rounded-full border border-line-dark bg-carbon px-3 py-1 text-[11px] font-semibold text-camel">
                <span className="size-[7px] animate-[sg-pulse_1.2s_infinite] rounded-full bg-camel" />
                {progress.stage} · {progress.percent}%
                <span className="relative h-1 w-16 overflow-hidden rounded-full bg-line-dark">
                  <span
                    className="absolute inset-y-0 left-0 rounded-full bg-camel transition-[width] duration-500"
                    style={{ width: `${progress.percent}%` }}
                  />
                </span>
              </span>
            )}
            <div className="flex-1" />
            <button
              onClick={() => flash('AI rewrite runs via the configured LLM provider on generate')}
              className="flex h-[30px] items-center gap-1.5 rounded-full border border-line-dark bg-carbon px-3 text-xs font-semibold text-sand"
            >
              <WandSparkles className="size-3.5 text-camel" strokeWidth={1.6} /> AI Rewrite
            </button>
            <button
              onClick={() => flash('Subtitles are generated by the pipeline subtitle stage')}
              className="flex h-[30px] items-center gap-1.5 rounded-full border border-line-dark bg-carbon px-3 text-xs font-semibold text-sand"
            >
              <Captions className="size-3.5 text-camel" strokeWidth={1.6} /> Subtitles
            </button>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center p-6">
            <div className="relative aspect-video w-[min(100%,720px)] overflow-hidden rounded-[14px] border border-line-dark bg-gradient-to-br from-[#3a2f26] to-ink shadow-[0_24px_60px_rgba(0,0,0,.5)]">
              {isReady && output.data?.media ? (
                <video
                  controls
                  src={output.data.media}
                  poster={output.data.thumbnail ?? undefined}
                  className="absolute inset-0 size-full bg-black object-contain"
                />
              ) : (
                <>
              <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_70%_20%,rgba(196,154,108,.22),transparent_60%)]" />
              <div className="absolute bottom-0 left-1/2 flex h-[88%] w-[46%] -translate-x-1/2 items-start justify-center rounded-t-[120px] bg-gradient-to-b from-camel to-primary pt-[22px]">
                <div className="aspect-square w-[52%] rounded-full bg-gradient-to-br from-shell to-sand shadow-[inset_0_-8px_20px_rgba(122,79,34,.25)]" />
              </div>
              {script && (
                <div className="absolute bottom-5 left-5 max-w-[52%]">
                  <div className="inline-block rounded-[10px] bg-ink/55 px-[13px] py-2 text-[15px] leading-[1.35] font-semibold text-white backdrop-blur-sm">
                    {script}
                  </div>
                </div>
              )}
              {avatar && (
                <div className="absolute top-3.5 left-3.5 flex items-center gap-[7px] rounded-full bg-ink/50 px-[11px] py-1.5 text-[11px] font-semibold text-white backdrop-blur-sm">
                  <span className="size-[7px] animate-[sg-pulse_1.6s_infinite] rounded-full bg-camel" />
                  {avatar.name} · {avatar.providerId ?? avatar.kind}
                </div>
              )}
                </>
              )}
            </div>
          </div>
        </div>

        <Inspector
          script={script}
          sceneId={scene?.id ?? null}
          isSaving={updateScene.isPending}
          onSaveScript={(nextScript) =>
            scene &&
            updateScene.mutate(
              { videoId: video.id, sceneId: scene.id, content: { script: nextScript } },
              {
                onSuccess: () => flash('Script saved'),
                onError: (error) =>
                  flash(error instanceof ApiError ? `${error.code}: ${error.message}` : 'Save failed'),
              },
            )
          }
          avatarName={avatar?.name ?? null}
          avatarMeta={avatar ? `${avatar.kind} avatar · ${avatar.providerId ?? 'default provider'}` : ''}
          voiceName={voice?.name ?? null}
          voiceMeta={voice ? `${voice.providerId} · ${voice.language}${voice.isCloned ? ' · cloned' : ''}` : ''}
        />
      </div>

      <Timeline
        tracks={scene?.tracks ?? []}
        durationMs={durationMs}
        playing={playing}
        rendering={generate.isPending}
        onTogglePlay={() => setPlaying((p) => !p)}
        onRender={render}
      />
    </div>
  );
}

export default function EditorPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading editor…" />}>
      <EditorContent />
    </Suspense>
  );
}
