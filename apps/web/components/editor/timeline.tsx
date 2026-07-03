'use client';

import {
  AudioLines,
  Captions,
  Clapperboard,
  Music,
  Pause,
  Play,
  User,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from 'lucide-react';
import { useToast } from '../ui/toast';

interface Clip {
  left: string;
  width: string;
  bg: string;
  label: string;
}

interface Track {
  label: string;
  icon: LucideIcon;
  clips: Clip[];
}

const TRACKS: Track[] = [
  {
    label: 'Avatar',
    icon: User,
    clips: [
      { left: '2%', width: '40%', bg: '#8B5E2F', label: 'Amara' },
      { left: '44%', width: '54%', bg: '#A67040', label: 'Amara' },
    ],
  },
  { label: 'Voice', icon: AudioLines, clips: [{ left: '2%', width: '96%', bg: '#7A4F22', label: 'en-NG · XTTS' }] },
  {
    label: 'Subtitle',
    icon: Captions,
    clips: [
      { left: '4%', width: '30%', bg: '#5C7A8B', label: 'Line 1' },
      { left: '36%', width: '28%', bg: '#5C7A8B', label: 'Line 2' },
      { left: '66%', width: '30%', bg: '#5C7A8B', label: 'Line 3' },
    ],
  },
  { label: 'Music', icon: Music, clips: [{ left: '2%', width: '96%', bg: '#524740', label: 'Ambient bed' }] },
];

export function Timeline({ playing, onTogglePlay }: { playing: boolean; onTogglePlay: () => void }) {
  const flash = useToast();
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
        <span className="font-mono text-[12.5px] text-sand">{playing ? '00:23' : '00:00'} / 01:12</span>
        <div className="flex-1" />
        <div className="flex items-center gap-1.5 text-taupe">
          <ZoomOut className="size-[15px]" strokeWidth={1.6} />
          <div className="relative h-1 w-20 rounded-full bg-line-dark">
            <div className="absolute top-0 left-0 h-full w-[55%] rounded-full bg-camel" />
          </div>
          <ZoomIn className="size-[15px]" strokeWidth={1.6} />
        </div>
        <button
          onClick={() => flash('Render job queued — GPU priority queue')}
          className="flex h-8 items-center gap-1.5 rounded-full bg-primary px-4 text-[12.5px] font-bold text-white"
        >
          <Clapperboard className="size-[15px]" strokeWidth={1.6} /> Render
        </button>
      </div>
      <div className="relative flex-1 overflow-x-auto px-[18px] py-3">
        <div
          className="absolute top-0 bottom-0 z-3 w-0.5 bg-camel shadow-[0_0_8px_rgba(196,154,108,.6)] transition-[left] duration-500"
          style={{ left: playing ? '42%' : '2%' }}
        >
          <div className="absolute -top-px -left-1 h-2 w-2.5 rounded-[2px] bg-camel" />
        </div>
        {TRACKS.map((track) => (
          <div key={track.label} className="mb-2 flex items-center gap-2.5">
            <div className="flex w-[66px] flex-none items-center gap-[5px] text-[10.5px] font-semibold text-taupe">
              <track.icon className="size-[13px]" strokeWidth={1.6} />
              {track.label}
            </div>
            <div className="relative h-[26px] flex-1 overflow-hidden rounded-[7px] bg-espresso">
              {track.clips.map((clip) => (
                <div
                  key={`${track.label}-${clip.left}`}
                  className="absolute top-[3px] bottom-[3px] flex items-center overflow-hidden rounded-[5px] pl-[7px] text-[9.5px] font-bold whitespace-nowrap text-white"
                  style={{ left: clip.left, width: clip.width, background: clip.bg }}
                >
                  {clip.label}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
