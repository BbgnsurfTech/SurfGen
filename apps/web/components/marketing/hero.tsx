'use client';

import { ArrowRight, AudioLines, Clapperboard, Play, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useReveal } from './use-reveal';

/** CSS-built studio frame — no screenshot dependency, zero LCP image cost. */
function StudioFrame() {
  return (
    <div
      aria-hidden="true"
      className="relative overflow-hidden rounded-2xl border border-line-dark bg-espresso p-4 shadow-[0_40px_80px_-40px_rgba(26,26,26,0.5)]"
    >
      <div className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-danger/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-warn/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-success/70" />
        <span className="ml-3 rounded-full bg-carbon px-3 py-1 font-mono text-[10px] text-stone">
          studio / product-launch.mp4
        </span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_180px]">
        <div className="flex aspect-video items-center justify-center rounded-xl bg-carbon">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-camel text-ink">
            <Play size={22} strokeWidth={1.6} fill="currentColor" />
          </span>
        </div>
        <div className="hidden flex-col gap-3 sm:flex">
          <div className="flex items-center gap-2 rounded-xl bg-carbon px-3 py-2.5">
            <UserRound size={16} strokeWidth={1.6} className="text-camel" />
            <span className="text-xs font-semibold text-shell">Avatar · Nadia</span>
          </div>
          <div className="flex items-center gap-2 rounded-xl bg-carbon px-3 py-2.5">
            <AudioLines size={16} strokeWidth={1.6} className="text-camel" />
            <span className="text-xs font-semibold text-shell">Voice · cloned</span>
          </div>
          <div className="flex items-center gap-2 rounded-xl bg-carbon px-3 py-2.5">
            <Clapperboard size={16} strokeWidth={1.6} className="text-camel" />
            <span className="text-xs font-semibold text-shell">Render · 1080p</span>
          </div>
        </div>
      </div>

      <div className="mt-3 space-y-1.5">
        <div className="h-2 rounded-full bg-deep/80" style={{ width: '82%' }} />
        <div className="h-2 rounded-full bg-camel/60" style={{ width: '64%' }} />
        <div className="h-2 rounded-full bg-carbon" style={{ width: '91%' }} />
      </div>
    </div>
  );
}

export function Hero() {
  const ref = useReveal<HTMLDivElement>();

  return (
    <section id="product" aria-labelledby="hero-heading" className="overflow-hidden">
      <div
        ref={ref}
        className="sg-reveal mx-auto grid w-full max-w-6xl items-center gap-12 px-5 pb-20 pt-16 md:grid-cols-[1.15fr_1fr] md:pt-24"
      >
        <div>
          <p className="inline-flex items-center gap-2 rounded-full bg-shell px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-deep">
            Hosted studio · Open-source engine
          </p>
          <h1
            id="hero-heading"
            className="mt-6 font-display text-[clamp(2.75rem,2rem+3.5vw,4.5rem)] font-extrabold leading-[1.02] tracking-tight text-ink"
          >
            Turn scripts into studio&#8209;quality avatar video.
          </h1>
          <p className="mt-6 max-w-lg text-lg leading-relaxed text-taupe">
            SurfGen writes the narration, clones the voice, animates the avatar, and renders the
            finished cut — one pipeline, from first draft to published video.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-4">
            <Link
              href="/signup"
              className="group inline-flex items-center gap-2 rounded-full bg-primary px-7 py-3.5 text-sm font-bold text-white transition-colors hover:bg-deep"
            >
              Start creating free
              <ArrowRight size={16} strokeWidth={2} className="transition-transform group-hover:translate-x-0.5" />
            </Link>
            <a
              href="#pipeline"
              className="rounded-full border border-line bg-card px-7 py-3.5 text-sm font-bold text-bark transition-colors hover:border-primary hover:text-primary"
            >
              See how it works
            </a>
          </div>
          <p className="mt-6 text-xs font-semibold text-stone">
            No credit card required · Self-hosting always free
          </p>
        </div>
        <StudioFrame />
      </div>
    </section>
  );
}
