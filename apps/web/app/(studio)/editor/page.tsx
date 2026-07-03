'use client';

import { Captions, Plus, WandSparkles } from 'lucide-react';
import { useState } from 'react';
import { Inspector } from '../../../components/editor/inspector';
import { Timeline } from '../../../components/editor/timeline';
import { useToast } from '../../../components/ui/toast';
import { THUMBS } from '../../../lib/demo/projects';

const SCENES = [
  { name: 'Intro', dur: '00:08' },
  { name: 'Problem', dur: '00:18' },
  { name: 'Solution', dur: '00:26' },
  { name: 'CTA', dur: '00:12' },
];

export default function EditorPage() {
  const flash = useToast();
  const [activeScene, setActiveScene] = useState(0);
  const [playing, setPlaying] = useState(false);

  return (
    <div className="sg-fade flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        {/* Scene rail */}
        <div className="flex w-[190px] flex-none flex-col border-r border-line bg-card">
          <div className="px-4 pt-3.5 pb-2.5 text-[11px] font-bold tracking-[0.1em] text-taupe">SCENES</div>
          <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto px-3 pb-3">
            {SCENES.map((scene, i) => (
              <button
                key={scene.name}
                onClick={() => setActiveScene(i)}
                className={`overflow-hidden rounded-xl text-left ${
                  activeScene === i ? 'border-2 border-primary bg-paper' : 'border border-line bg-card'
                }`}
              >
                <div className="relative h-[62px]" style={{ background: THUMBS[i] }}>
                  <span className="absolute top-[5px] left-[7px] text-[10px] font-bold text-white [text-shadow:0_1px_2px_rgba(0,0,0,.5)]">
                    0{i + 1}
                  </span>
                </div>
                <div className="px-[9px] py-[7px]">
                  <div className="truncate text-[11.5px] font-semibold">{scene.name}</div>
                  <div className="mt-0.5 text-[10px] text-stone">{scene.dur}</div>
                </div>
              </button>
            ))}
            <button
              onClick={() => flash('Scene added to the timeline')}
              className="flex items-center justify-center gap-1.5 rounded-xl border-[1.5px] border-dashed border-sand bg-paper p-3 text-xs font-semibold text-primary"
            >
              <Plus className="size-[15px]" strokeWidth={1.6} /> Add scene
            </button>
          </div>
        </div>

        {/* Canvas */}
        <div className="flex min-w-0 flex-1 flex-col bg-espresso">
          <div className="flex h-11 flex-none items-center gap-2 border-b border-line-dark px-4">
            <span className="text-xs font-semibold text-stone">
              Scene 0{activeScene + 1} / 0{SCENES.length}
            </span>
            <div className="flex-1" />
            <button
              onClick={() => flash('AI rewrite drafted — review in the Script panel')}
              className="flex h-[30px] items-center gap-1.5 rounded-full border border-line-dark bg-carbon px-3 text-xs font-semibold text-sand"
            >
              <WandSparkles className="size-3.5 text-camel" strokeWidth={1.6} /> AI Rewrite
            </button>
            <button
              onClick={() => flash('Subtitles generated for 3 languages')}
              className="flex h-[30px] items-center gap-1.5 rounded-full border border-line-dark bg-carbon px-3 text-xs font-semibold text-sand"
            >
              <Captions className="size-3.5 text-camel" strokeWidth={1.6} /> Subtitles
            </button>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center p-6">
            <div className="relative aspect-video w-[min(100%,720px)] overflow-hidden rounded-[14px] border border-line-dark bg-gradient-to-br from-[#3a2f26] to-ink shadow-[0_24px_60px_rgba(0,0,0,.5)]">
              <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_70%_20%,rgba(196,154,108,.22),transparent_60%)]" />
              {/* stylized avatar silhouette */}
              <div className="absolute bottom-0 left-1/2 flex h-[88%] w-[46%] -translate-x-1/2 items-start justify-center rounded-t-[120px] bg-gradient-to-b from-camel to-primary pt-[22px]">
                <div className="aspect-square w-[52%] rounded-full bg-gradient-to-br from-shell to-sand shadow-[inset_0_-8px_20px_rgba(122,79,34,.25)]" />
              </div>
              <div className="absolute bottom-5 left-5 max-w-[52%]">
                <div className="inline-block rounded-[10px] bg-ink/55 px-[13px] py-2 text-[15px] leading-[1.35] font-semibold text-white backdrop-blur-sm">
                  Welcome to BBGNSURF — turning your vision into digital reality.
                </div>
              </div>
              <div className="absolute top-3.5 left-3.5 flex items-center gap-[7px] rounded-full bg-ink/50 px-[11px] py-1.5 text-[11px] font-semibold text-white backdrop-blur-sm">
                <span className="size-[7px] animate-[sg-pulse_1.6s_infinite] rounded-full bg-camel" />
                Lip-sync · MuseTalk
              </div>
            </div>
          </div>
        </div>

        <Inspector />
      </div>

      <Timeline playing={playing} onTogglePlay={() => setPlaying((p) => !p)} />
    </div>
  );
}
