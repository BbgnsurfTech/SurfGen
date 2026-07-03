'use client';

import {
  AudioLines,
  Brain,
  Clapperboard,
  Languages,
  Play,
  Save,
  ScanFace,
  Type,
  User,
  type LucideIcon,
} from 'lucide-react';
import { useToast } from '../../../components/ui/toast';

interface PaletteItem {
  label: string;
  icon: LucideIcon;
  bg: string;
}

const PALETTE: PaletteItem[] = [
  { label: 'Text Input', icon: Type, bg: '#7A6B5C' },
  { label: 'LLM / Script', icon: Brain, bg: '#8B5E2F' },
  { label: 'Translate', icon: Languages, bg: '#A67040' },
  { label: 'Voice (TTS)', icon: AudioLines, bg: '#5C7A8B' },
  { label: 'Avatar', icon: User, bg: '#8B5E2F' },
  { label: 'Lip-sync', icon: ScanFace, bg: '#A8442B' },
  { label: 'Render', icon: Clapperboard, bg: '#7A4F22' },
];

interface FlowNode {
  x: number;
  y: number;
  icon: LucideIcon;
  title: string;
  body: string;
  bg: string;
}

const NODES: FlowNode[] = [
  { x: 60, y: 70, icon: Type, title: 'Script', body: 'Product brief → outline', bg: '#7A6B5C' },
  { x: 300, y: 70, icon: Brain, title: 'LLM Enhance', body: 'Anthropic · Claude', bg: '#8B5E2F' },
  { x: 540, y: 70, icon: Languages, title: 'Translate', body: 'NLLB · en→ha,yo', bg: '#A67040' },
  { x: 300, y: 220, icon: AudioLines, title: 'Voice', body: 'XTTS · cloned', bg: '#5C7A8B' },
  { x: 540, y: 220, icon: User, title: 'Avatar + Lip-sync', body: 'Amara · MuseTalk', bg: '#8B5E2F' },
  { x: 780, y: 145, icon: Clapperboard, title: 'Render', body: '1080p · S3 + CDN', bg: '#7A4F22' },
];

const EDGES = [
  'M236 96 C270 96 266 96 300 96',
  'M476 96 C510 96 506 96 540 96',
  'M616 122 C616 180 476 175 476 246',
  'M476 246 C510 246 506 246 540 246',
  'M716 246 C760 246 756 190 780 175',
  'M616 122 C700 122 730 160 780 165',
];

export default function WorkflowsPage() {
  const flash = useToast();
  return (
    <div className="sg-fade flex h-full">
      <div className="w-[210px] flex-none overflow-y-auto border-r border-line bg-card px-3.5 py-4">
        <div className="mb-2.5 text-[11px] font-bold tracking-[0.08em] text-taupe">NODES</div>
        <div className="flex flex-col gap-2">
          {PALETTE.map((item) => (
            <div
              key={item.label}
              className="flex cursor-grab items-center gap-2.5 rounded-[10px] border border-line bg-paper px-[11px] py-[9px] text-[12.5px] font-semibold text-bark"
            >
              <span
                className="flex size-[26px] flex-none items-center justify-center rounded-[7px] text-white"
                style={{ background: item.bg }}
              >
                <item.icon className="size-3.5" strokeWidth={1.6} />
              </span>
              {item.label}
            </div>
          ))}
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden bg-paper [background-image:radial-gradient(var(--color-line)_1.1px,transparent_1.1px)] [background-size:22px_22px]">
        <svg className="pointer-events-none absolute inset-0 size-full" preserveAspectRatio="none" aria-hidden>
          {EDGES.map((d) => (
            <path
              key={d}
              d={d}
              fill="none"
              stroke="#C49A6C"
              strokeWidth={2}
              strokeDasharray="6 6"
              style={{ animation: 'sg-flow .8s linear infinite' }}
            />
          ))}
        </svg>
        {NODES.map((node) => (
          <div
            key={node.title}
            className="absolute w-44 rounded-xl border border-line bg-card shadow-[0_6px_18px_rgba(122,79,34,.10)]"
            style={{ left: node.x, top: node.y }}
          >
            <div className="flex items-center gap-2 border-b border-hairline px-[11px] py-[9px]">
              <span
                className="flex size-[22px] flex-none items-center justify-center rounded-md text-white"
                style={{ background: node.bg }}
              >
                <node.icon className="size-[13px]" strokeWidth={1.6} />
              </span>
              <span className="font-display text-[12.5px] font-bold">{node.title}</span>
            </div>
            <div className="px-[11px] py-[9px] text-[11px] leading-[1.4] text-taupe">{node.body}</div>
            <span className="absolute top-1/2 -right-1.5 size-[11px] -translate-y-1/2 rounded-full border-2 border-white bg-primary" />
            <span className="absolute top-1/2 -left-1.5 size-[11px] -translate-y-1/2 rounded-full border-2 border-white bg-sand" />
          </div>
        ))}
        <div className="absolute bottom-5 left-5 flex gap-2">
          <button
            onClick={() => flash('Workflow dispatched to 6 pipeline stages')}
            className="flex h-[38px] items-center gap-[7px] rounded-full bg-primary px-[18px] text-[13px] font-bold text-white shadow-[0_6px_18px_rgba(122,79,34,.22)]"
          >
            <Play className="size-[15px]" strokeWidth={1.6} /> Run workflow
          </button>
          <button
            onClick={() => flash('Workflow saved as declarative pipeline JSON')}
            aria-label="Save workflow"
            className="flex size-[38px] items-center justify-center rounded-full border border-line bg-card text-taupe"
          >
            <Save className="size-[18px]" strokeWidth={1.6} />
          </button>
        </div>
      </div>
    </div>
  );
}
