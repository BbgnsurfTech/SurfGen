import { AudioLines, Clapperboard, Cpu, Film, Loader, ScanFace, type LucideIcon } from 'lucide-react';

const GPUS: Array<{ name: string; model: string; vram: number; util: number; dot: string }> = [
  { name: 'GPU-1', model: 'A100 80GB', vram: 72, util: 88, dot: '#4F7C3A' },
  { name: 'GPU-2', model: 'A100 80GB', vram: 64, util: 79, dot: '#4F7C3A' },
  { name: 'GPU-3', model: 'L40S 48GB', vram: 41, util: 55, dot: '#C48A1F' },
  { name: 'GPU-4', model: 'H100 80GB', vram: 12, util: 8, dot: '#7A6B5C' },
];

const QUEUES: Array<{ name: string; type: string; pct: number; color: string; active: number; waiting: number; icon: LucideIcon }> = [
  { name: 'render-gpu', type: 'GPU · priority', pct: 68, color: '#8B5E2F', active: 3, waiting: 12, icon: Clapperboard },
  { name: 'lipsync-gpu', type: 'GPU', pct: 52, color: '#A67040', active: 2, waiting: 7, icon: ScanFace },
  { name: 'tts-cpu', type: 'CPU', pct: 34, color: '#5C7A8B', active: 1, waiting: 4, icon: AudioLines },
  { name: 'transcode-cpu', type: 'CPU · batch', pct: 20, color: '#7A4F22', active: 0, waiting: 2, icon: Film },
];

const JOBS: Array<{ name: string; stage: string; pct: number; color: string }> = [
  { name: 'SEMIS Feature Walkthrough', stage: 'Lip-sync · MuseTalk', pct: 72, color: '#8B5E2F' },
  { name: 'Governor Address — Hausa', stage: 'Voice generation · XTTS', pct: 44, color: '#A67040' },
  { name: 'Health Campaign · yo', stage: 'Translation · NLLB', pct: 88, color: '#5C7A8B' },
  { name: 'Investor Update FR', stage: 'Rendering · 1080p', pct: 26, color: '#7A4F22' },
];

function Meter({ label, value, barColor }: { label: string; value: number; barColor: string }) {
  return (
    <>
      <div className="mb-1 flex justify-between text-[10.5px] text-stone">
        <span>{label}</span>
        <span className="font-semibold text-bark">{value}%</span>
      </div>
      <div className="h-[7px] overflow-hidden rounded-full bg-cream">
        <div
          className="h-full origin-left animate-[sg-bar_.6s_ease] rounded-full"
          style={{ width: `${value}%`, background: barColor }}
        />
      </div>
    </>
  );
}

export default function MonitorPage() {
  return (
    <div className="sg-fade px-8 pt-6 pb-12">
      <div className="font-display mb-3.5 text-[15px] font-bold">GPU cluster</div>
      <div className="mb-[30px] grid grid-cols-4 gap-4">
        {GPUS.map((gpu) => (
          <div key={gpu.name} className="rounded-2xl border border-line bg-card px-[18px] py-4 shadow-[0_1px_2px_rgba(26,26,26,.04)]">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Cpu className="size-[18px] text-primary" strokeWidth={1.6} />
                <span className="font-display text-[13px] font-bold">{gpu.name}</span>
              </div>
              <span
                className="size-[9px] rounded-full"
                style={{ background: gpu.dot, boxShadow: `0 0 0 3px ${gpu.dot}22` }}
              />
            </div>
            <div className="mb-2.5 font-mono text-[11px] text-taupe">{gpu.model}</div>
            <Meter label="VRAM" value={gpu.vram} barColor="#8B5E2F" />
            <div className="mt-[11px]">
              <Meter label="Utilisation" value={gpu.util} barColor="#C49A6C" />
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-5">
        <div className="rounded-2xl border border-line bg-card px-5 py-[18px]">
          <div className="mb-3.5 flex items-center justify-between">
            <div className="font-display text-sm font-bold">Render queues</div>
            <span className="text-[11px] text-stone">BullMQ · 6 workers</span>
          </div>
          {QUEUES.map((queue) => (
            <div key={queue.name} className="flex items-center gap-3 border-b border-hairline py-[11px]">
              <span
                className="flex size-[30px] flex-none items-center justify-center rounded-lg text-white"
                style={{ background: queue.color }}
              >
                <queue.icon className="size-[15px]" strokeWidth={1.6} />
              </span>
              <div className="w-[120px]">
                <div className="text-[13px] font-semibold">{queue.name}</div>
                <div className="text-[10.5px] text-stone">{queue.type}</div>
              </div>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-cream">
                <div
                  className="h-full origin-left animate-[sg-bar_.6s_ease] rounded-full"
                  style={{ width: `${queue.pct}%`, background: queue.color }}
                />
              </div>
              <div className="w-[110px] text-right text-[11px] text-taupe">
                <span className="font-mono font-bold text-ink">{queue.active}</span> active · {queue.waiting} queued
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-2xl border border-line bg-card px-5 py-[18px]">
          <div className="font-display mb-3.5 text-sm font-bold">Live jobs</div>
          {JOBS.map((job) => (
            <div key={job.name} className="flex items-center gap-[11px] border-b border-hairline py-[9px]">
              <span
                className="flex size-7 flex-none items-center justify-center rounded-full border border-line bg-paper"
                style={{ color: job.color }}
              >
                <Loader className="size-3.5 animate-[sg-spin_1.6s_linear_infinite]" strokeWidth={1.6} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] font-semibold">{job.name}</div>
                <div className="text-[10.5px] text-stone">{job.stage}</div>
              </div>
              <div className="font-mono text-[11px] font-semibold" style={{ color: job.color }}>
                {job.pct}%
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
