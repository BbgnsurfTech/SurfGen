'use client';

import { AudioLines, Check, ChevronRight, Languages, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
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

export interface InspectorProps {
  script: string;
  sceneId: string | null;
  isSaving: boolean;
  onSaveScript: (script: string) => void;
  avatarName: string | null;
  avatarMeta: string;
  voiceName: string | null;
  voiceMeta: string;
}

export function Inspector({
  script,
  sceneId,
  isSaving,
  onSaveScript,
  avatarName,
  avatarMeta,
  voiceName,
  voiceMeta,
}: InspectorProps) {
  const flash = useToast();
  const [tab, setTab] = useState<(typeof TABS)[number]>('Script');
  const [emotion, setEmotion] = useState<(typeof EMOTIONS)[number]>('Warm');
  const [draft, setDraft] = useState(script);
  // Re-sync the textarea when the selected scene (and thus its script) changes.
  useEffect(() => setDraft(script), [script, sceneId]);
  const dirty = draft !== script;

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
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={!sceneId}
          rows={5}
          placeholder={sceneId ? 'Write the presenter script for this scene…' : 'Add a scene to start writing.'}
          className="w-full resize-y rounded-xl border border-line bg-paper p-3 text-[13px] leading-relaxed text-bark outline-none placeholder:text-stone focus:border-primary disabled:opacity-60"
        />
        <div className="mt-2.5 flex gap-2">
          <button
            onClick={() => (dirty && sceneId ? onSaveScript(draft) : flash('Enhance runs through the configured LLM provider on generate'))}
            disabled={isSaving}
            className="flex h-[34px] flex-1 items-center justify-center gap-1.5 rounded-full bg-primary text-xs font-bold text-white disabled:opacity-60"
          >
            {dirty ? <Check className="size-3.5" strokeWidth={2} /> : <Sparkles className="size-3.5" strokeWidth={1.6} />}
            {isSaving ? 'Saving…' : dirty ? 'Save script' : 'Enhance'}
          </button>
          <button
            onClick={() => flash('Translation runs in the pipeline (NLLB / DeepL by config)')}
            aria-label="Translate script"
            className="flex size-[34px] items-center justify-center rounded-full border border-line bg-cream text-primary"
          >
            <Languages className="size-[15px]" strokeWidth={1.6} />
          </button>
        </div>

        <SectionLabel>AVATAR</SectionLabel>
        {avatarName ? (
          <AssetRow
            icon={<div className="size-10 flex-none rounded-[10px] bg-gradient-to-br from-camel to-primary" />}
            title={avatarName}
            meta={avatarMeta}
          />
        ) : (
          <div className="rounded-xl border border-dashed border-sand bg-paper p-3 text-[11.5px] text-stone">
            No avatar assigned — pick one in Avatar &amp; Voice.
          </div>
        )}

        <SectionLabel>VOICE</SectionLabel>
        {voiceName ? (
          <AssetRow
            icon={
              <div className="flex size-10 flex-none items-center justify-center rounded-[10px] bg-cream text-primary">
                <AudioLines className="size-[18px]" strokeWidth={1.6} />
              </div>
            }
            title={voiceName}
            meta={voiceMeta}
          />
        ) : (
          <div className="rounded-xl border border-dashed border-sand bg-paper p-3 text-[11.5px] text-stone">
            No voice assigned — the pipeline uses the configured default chain.
          </div>
        )}

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
