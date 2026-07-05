'use client';

import {
  AudioLines,
  Captions,
  Clapperboard,
  Image as ImageIcon,
  Languages,
  MessageSquareText,
  Mic,
  PersonStanding,
  Replace,
  ScanFace,
  Sparkles,
  SwatchBook,
  UserRound,
  Video,
  Wand2,
  type LucideIcon,
} from 'lucide-react';
import { useReveal } from './use-reveal';

interface Tile {
  icon: LucideIcon;
  title: string;
  body?: string;
  large?: boolean;
}

const TILES: Tile[] = [
  {
    icon: UserRound,
    title: 'AI Avatars',
    body: 'Studio presenters that read your script on camera — no crew, no reshoots.',
    large: true,
  },
  {
    icon: Mic,
    title: 'Voice Cloning',
    body: 'A short sample becomes a reusable voice that narrates every video you make.',
    large: true,
  },
  {
    icon: ScanFace,
    title: 'Talking Photos',
    body: 'Any portrait becomes a presenter, lip-synced frame by frame.',
    large: true,
  },
  { icon: AudioLines, title: 'Text-to-Speech' },
  { icon: Languages, title: 'Translation' },
  { icon: Captions, title: 'Subtitles' },
  { icon: Video, title: 'Video Generation' },
  { icon: PersonStanding, title: 'Face Animation' },
  { icon: Replace, title: 'Background Replace' },
  { icon: MessageSquareText, title: 'Script Generation' },
  { icon: Clapperboard, title: 'Lip Sync' },
  { icon: SwatchBook, title: 'Motion Generation' },
  { icon: ImageIcon, title: 'Image Generation' },
  { icon: Sparkles, title: 'Prompt Enhancement' },
  { icon: Wand2, title: 'AI Editing' },
];

export function CapabilitiesBento() {
  const ref = useReveal<HTMLDivElement>();

  return (
    <section id="capabilities" aria-labelledby="capabilities-heading" className="py-24">
      <div ref={ref} className="sg-reveal mx-auto w-full max-w-6xl px-5">
        <p className="text-xs font-bold uppercase tracking-widest text-bronze">Fifteen capabilities</p>
        <h2
          id="capabilities-heading"
          className="mt-3 max-w-2xl font-display text-[clamp(1.9rem,1.4rem+2vw,3rem)] font-extrabold leading-tight tracking-tight text-ink"
        >
          Everything a video team does, as one toolkit.
        </h2>

        <div className="mt-12 grid grid-cols-2 gap-4 md:grid-cols-6">
          {TILES.map((tile) => {
            const Icon = tile.icon;
            return tile.large ? (
              <div
                key={tile.title}
                className="col-span-2 rounded-2xl border border-line bg-card p-7 transition-shadow hover:shadow-[0_20px_50px_-30px_rgba(139,94,47,0.45)]"
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-shell text-deep">
                  <Icon size={19} strokeWidth={1.6} />
                </span>
                <h3 className="mt-4 font-display text-lg font-extrabold text-ink">{tile.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-taupe">{tile.body}</p>
              </div>
            ) : (
              <div
                key={tile.title}
                className="col-span-1 flex flex-col justify-between gap-3 rounded-2xl border border-line bg-cream/70 p-5 transition-colors hover:border-primary/40 md:col-span-2 lg:col-span-1"
              >
                <Icon size={18} strokeWidth={1.6} className="text-bronze" />
                <h3 className="text-[13px] font-bold leading-snug text-bark">{tile.title}</h3>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
