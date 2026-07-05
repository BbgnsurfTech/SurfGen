'use client';

import {
  AudioLines,
  Captions,
  Clapperboard,
  Layers,
  Loader,
  Pause,
  Play,
  Video,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from 'lucide-react';
import type { Track } from '../../lib/api/types';
import { useToast } from '../ui/toast';

const TRACK_META: Record<Track['kind'], { label: string; icon: LucideIcon; color: string }> = {
  video: { label: 'Video', icon: Video, color: '#8B5E2F' },
  audio: { label: 'Audio', icon: AudioLines, color: '#7A4F22' },
  caption: { label: 'Caption', icon: Captions, color: '#5C7A8B' },
  overlay: { label: 'Overlay', icon: Layers, color: '#524740' },
};

function formatTimecode(ms: number): string {
  const total = Math.round(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

interface TimelineProps {
  tracks: Track[];
  durationMs: number;
  playing: boolean;
  rendering: boolean;
  onTogglePlay: () => void;
  onRender: () => void;
}

export function Timeline({ tracks, durationMs, playing, rendering, onTogglePlay, onRender }: TimelineProps) {
  const flash = useToast();
  const span = Math.max(durationMs, 1);
  const onZoom = () => flash('Timeline zoom is not wired up yet');
  return (
    <div className="flex h-[184px] flex-none flex-col border-t border-line-dark bg-ink">
      <div className="flex h-[46px] flex-none items-center gap-3.5 border-b border-carbon px-[18px]">
        <button
          onClick={onTogglePlay}
          aria-label={playing ? 'Pause' : 'Play'}
          className="flex size-[34px] items-center justify-center rounded-full bg-primary text-white"
        >
          {playing ? <Pause className="size-4" strokeWidth={1.6} /> : <Play className="size-4" strokeWidth={1.6} />}
        </button>
        <span className="font-mono text-[12.5px] text-sand">00:00 / {formatTimecode(durationMs)}</span>
        <div className="flex-1" />
        <div className="flex items-center gap-1.5 text-taupe">
          <button onClick={onZoom} aria-label="Zoom out">
            <ZoomOut className="size-[15px]" strokeWidth={1.6} />
          </button>
          <button onClick={onZoom} aria-label="Timeline zoom" className="relative h-1 w-20 rounded-full bg-line-dark">
            <div className="absolute top-0 left-0 h-full w-[55%] rounded-full bg-camel" />
          </button>
          <button onClick={onZoom} aria-label="Zoom in">
            <ZoomIn className="size-[15px]" strokeWidth={1.6} />
          </button>
        </div>
        <button
          onClick={onRender}
          disabled={rendering}
          className="flex h-8 items-center gap-1.5 rounded-full bg-primary px-4 text-[12.5px] font-bold text-white disabled:opacity-60"
        >
          {rendering ? (
            <Loader className="size-[15px] animate-[sg-spin_.8s_linear_infinite]" strokeWidth={1.6} />
          ) : (
            <Clapperboard className="size-[15px]" strokeWidth={1.6} />
          )}
          Render
        </button>
      </div>
      <div className="relative flex-1 overflow-x-auto px-[18px] py-3">
        <div
          className="absolute top-0 bottom-0 z-3 w-0.5 bg-camel shadow-[0_0_8px_rgba(196,154,108,.6)] transition-[left] duration-500"
          style={{ left: playing ? '42%' : '2%' }}
        >
          <div className="absolute -top-px -left-1 h-2 w-2.5 rounded-[2px] bg-camel" />
        </div>
        {tracks.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs font-semibold text-taupe">
            No timeline tracks yet — generate the video to populate stages, or add clips via the API.
          </div>
        ) : (
          tracks.map((track) => {
            const meta = TRACK_META[track.kind];
            return (
              <div key={track.id} className="mb-2 flex items-center gap-2.5">
                <div className="flex w-[66px] flex-none items-center gap-[5px] text-[10.5px] font-semibold text-taupe">
                  <meta.icon className="size-[13px]" strokeWidth={1.6} />
                  {meta.label}
                </div>
                <div className="relative h-[26px] flex-1 overflow-hidden rounded-[7px] bg-espresso">
                  {track.clips.map((clip) => (
                    <div
                      key={clip.id}
                      className="absolute top-[3px] bottom-[3px] flex items-center overflow-hidden rounded-[5px] pl-[7px] text-[9.5px] font-bold whitespace-nowrap text-white"
                      style={{
                        left: `${(clip.startMs / span) * 100}%`,
                        width: `${Math.max(((clip.endMs - clip.startMs) / span) * 100, 2)}%`,
                        background: meta.color,
                      }}
                    >
                      {clip.properties.label ?? track.kind}
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
