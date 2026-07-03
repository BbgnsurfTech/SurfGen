'use client';

import { AudioLines, ChevronRight, Languages, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useToast } from '../ui/toast';

const TABS = ['Script', 'Style', 'Audio'] as const;
const EMOTIONS = ['Warm', 'Neutral', 'Confident', 'Excited'] as const;

function SectionLabel({ children, first = false }: { children: React.ReactNode; first?: boolean }) {
  return (
    <div className={`${first ? '' : 'mt-5'} mb-2 text-[11px] font-bold tracking-[0.08em] text-taupe`}>{children}</div>
  );
}

function AssetRow({ icon, title, meta }: { icon: React.ReactNode; title: string; meta: string }) {
  return (
    <div className="flex items-center gap-[11px] rounded-xl border border-line bg-paper p-2.5">
      {icon}
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold">{title}</div>
        <div className="text-[11px] text-stone">{meta}</div>
      </div>
      <ChevronRight className="size-4 text-stone" strokeWidth={1.6} />
    </div>
  );
}

export function Inspector() {
  const flash = useToast();
  const [tab, setTab] = useState<(typeof TABS)[number]>('Script');
  const [emotion, setEmotion] = useState<(typeof EMOTIONS)[number]>('Warm');

  return (
    <div className="flex w-[280px] flex-none flex-col border-l border-line bg-card">
      <div className="flex gap-0.5 border-b border-line px-3 py-2.5">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`h-[30px] flex-1 rounded-lg text-xs font-semibold ${
              tab === t ? 'bg-primary text-white' : 'text-taupe hover:bg-cream'
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <SectionLabel first>SCRIPT</SectionLabel>
        <div className="rounded-xl border border-line bg-paper p-3 text-[13px] leading-relaxed text-bark">
          Welcome to BBGNSURF — turning your vision into digital reality.
          <span className="ml-px inline-block h-[15px] w-0.5 translate-y-[3px] animate-[sg-pulse_1s_infinite] bg-primary" />
        </div>
        <div className="mt-2.5 flex gap-2">
          <button
            onClick={() => flash('Script enhanced with the configured LLM provider')}
            className="flex h-[34px] flex-1 items-center justify-center gap-1.5 rounded-full bg-primary text-xs font-bold text-white"
          >
            <Sparkles className="size-3.5" strokeWidth={1.6} /> Enhance
          </button>
          <button
            onClick={() => flash('Translation drawer — 200 languages via NLLB / DeepL')}
            aria-label="Translate script"
            className="flex size-[34px] items-center justify-center rounded-full border border-line bg-cream text-primary"
          >
            <Languages className="size-[15px]" strokeWidth={1.6} />
          </button>
        </div>

        <SectionLabel>AVATAR</SectionLabel>
        <AssetRow
          icon={<div className="size-10 flex-none rounded-[10px] bg-gradient-to-br from-camel to-primary" />}
          title="Amara — Studio"
          meta="Photo avatar · v3"
        />

        <SectionLabel>VOICE</SectionLabel>
        <AssetRow
          icon={
            <div className="flex size-10 flex-none items-center justify-center rounded-[10px] bg-cream text-primary">
              <AudioLines className="size-[18px]" strokeWidth={1.6} />
            </div>
          }
          title="Amara Clone"
          meta="XTTS · en-NG · warm"
        />

        <SectionLabel>EMOTION</SectionLabel>
        <div className="flex flex-wrap gap-1.5">
          {EMOTIONS.map((e) => (
            <button
              key={e}
              onClick={() => setEmotion(e)}
              className={`rounded-full px-3 py-1.5 text-[11.5px] font-semibold ${
                emotion === e ? 'bg-primary text-white' : 'border border-line bg-card text-taupe'
              }`}
            >
              {e}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
