'use client';

import { AudioLines, Clapperboard, FileText, UserRound, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface Stage {
  id: string;
  icon: LucideIcon;
  title: string;
  body: string;
  chip: string;
}

const STAGES: Stage[] = [
  {
    id: 'script',
    icon: FileText,
    title: 'Script',
    body: 'Start from a prompt or paste your draft — AI script generation and prompt enhancement shape the narration, scene by scene.',
    chip: 'script-generation',
  },
  {
    id: 'voice',
    icon: AudioLines,
    title: 'Voice',
    body: 'Pick a studio voice, or clone your own from a short sample. Text-to-speech renders every line with the pacing you set.',
    chip: 'tts · voice-cloning',
  },
  {
    id: 'avatar',
    icon: UserRound,
    title: 'Avatar',
    body: 'A talking photo or a full AI presenter, lip-synced to the audio frame by frame — with face animation and background replacement.',
    chip: 'lipsync · face-animation',
  },
  {
    id: 'render',
    icon: Clapperboard,
    title: 'Render',
    body: 'Subtitles, translation into new languages, and a broadcast-ready MP4 — delivered by the same worker pipeline that powers the editor.',
    chip: 'subtitles · translate · mp4',
  },
];

export function PipelineSection() {
  const [active, setActive] = useState(0);
  const panelRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const index = panelRefs.current.indexOf(entry.target as HTMLDivElement);
          if (index >= 0) setActive(index);
        }
      },
      { rootMargin: '-45% 0px -45% 0px' },
    );
    for (const panel of panelRefs.current) if (panel) observer.observe(panel);
    return () => observer.disconnect();
  }, []);

  return (
    <section id="pipeline" aria-labelledby="pipeline-heading" className="bg-cream/60 py-24">
      <div className="mx-auto w-full max-w-6xl px-5">
        <p className="text-xs font-bold uppercase tracking-widest text-bronze">One pipeline</p>
        <h2
          id="pipeline-heading"
          className="mt-3 max-w-2xl font-display text-[clamp(1.9rem,1.4rem+2vw,3rem)] font-extrabold leading-tight tracking-tight text-ink"
        >
          Four stages between your idea and a finished video.
        </h2>

        <div className="mt-14 grid gap-12 md:grid-cols-[280px_1fr]">
          {/* Sticky rail */}
          <ol className="top-28 hidden self-start md:sticky md:block" aria-hidden="true">
            {STAGES.map((stage, index) => {
              const Icon = stage.icon;
              const isActive = index === active;
              return (
                <li key={stage.id} className="relative flex gap-4 pb-10 last:pb-0">
                  {index < STAGES.length - 1 && (
                    <span
                      className={`absolute left-[19px] top-10 h-[calc(100%-2.5rem)] w-px ${index < active ? 'bg-primary' : 'bg-sand'}`}
                    />
                  )}
                  <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition-colors duration-300 ${
                      isActive
                        ? 'border-primary bg-primary text-white'
                        : 'border-sand bg-card text-taupe'
                    }`}
                  >
                    <Icon size={17} strokeWidth={1.6} />
                  </span>
                  <span
                    className={`pt-2 font-display text-sm font-bold transition-colors duration-300 ${isActive ? 'text-ink' : 'text-stone'}`}
                  >
                    {stage.title}
                  </span>
                </li>
              );
            })}
          </ol>

          {/* Scrolling panels */}
          <div className="space-y-6">
            {STAGES.map((stage, index) => {
              const Icon = stage.icon;
              return (
                <div
                  key={stage.id}
                  ref={(el) => {
                    panelRefs.current[index] = el;
                  }}
                  className={`rounded-2xl border bg-card p-8 transition-colors duration-300 md:p-10 ${
                    index === active ? 'border-primary/50 shadow-[0_20px_50px_-30px_rgba(139,94,47,0.4)]' : 'border-line'
                  }`}
                >
                  <div className="flex items-center gap-3 md:hidden">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-shell text-deep">
                      <Icon size={16} strokeWidth={1.6} />
                    </span>
                    <span className="font-display text-sm font-bold text-ink">{stage.title}</span>
                  </div>
                  <p className="mt-4 text-xs font-bold uppercase tracking-widest text-bronze md:mt-0">
                    Stage {index + 1}
                  </p>
                  <h3 className="mt-2 hidden font-display text-2xl font-extrabold text-ink md:block">
                    {stage.title}
                  </h3>
                  <p className="mt-3 max-w-xl leading-relaxed text-taupe">{stage.body}</p>
                  <code className="mt-5 inline-block rounded-full bg-cream px-4 py-1.5 font-mono text-xs text-bark">
                    {stage.chip}
                  </code>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
