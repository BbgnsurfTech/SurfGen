'use client';

import { AudioLines, Clapperboard, Film, Layers, Loader, ScanFace, type LucideIcon } from 'lucide-react';
import { EmptyState, LoadingState } from '../../../components/ui/states';
import { useMonitor } from '../../../lib/api/hooks';

const QUEUE_STYLE: Array<{ match: string; color: string; icon: LucideIcon }> = [
  { match: 'gpu', color: '#8B5E2F', icon: Clapperboard },
  { match: 'media', color: '#A67040', icon: Film },
  { match: 'webhook', color: '#5C7A8B', icon: ScanFace },
  { match: 'analytics', color: '#7A4F22', icon: Layers },
  { match: '', color: '#524740', icon: AudioLines },
];

const styleFor = (queue: string) => QUEUE_STYLE.find((entry) => queue.includes(entry.match)) ?? QUEUE_STYLE.at(-1)!;

export default function MonitorPage() {
  const monitor = useMonitor();

  if (monitor.isPending) return <LoadingState label="Loading queue telemetry…" />;

  const queues = monitor.data?.queues ?? [];
  const jobs = monitor.data?.jobs ?? [];
  const maxDepth = Math.max(...queues.map((queue) => queue.active + queue.waiting), 1);

  return (
    <div className="sg-fade px-8 pt-6 pb-12">
      <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-5">
        <div className="rounded-2xl border border-line bg-card px-5 py-[18px]">
          <div className="mb-3.5 flex items-center justify-between">
            <div className="font-display text-sm font-bold">Queues</div>
            <span className="text-[11px] text-stone">from the Job table · refreshes every 10 s</span>
          </div>
          {queues.length === 0 ? (
            <EmptyState
              title="No jobs in any queue"
              hint="Queue depth appears here as soon as a video generation is running."
            />
          ) : (
            queues.map((queue) => {
              const style = styleFor(queue.name);
              const depth = queue.active + queue.waiting;
              return (
                <div key={queue.name} className="flex items-center gap-3 border-b border-hairline py-[11px]">
                  <span
                    className="flex size-[30px] flex-none items-center justify-center rounded-lg text-white"
                    style={{ background: style.color }}
                  >
                    <style.icon className="size-[15px]" strokeWidth={1.6} />
                  </span>
                  <div className="w-[130px]">
                    <div className="font-mono text-[12.5px] font-semibold">{queue.name}</div>
                  </div>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-cream">
                    <div
                      className="h-full origin-left animate-[sg-bar_.6s_ease] rounded-full"
                      style={{ width: `${(depth / maxDepth) * 100}%`, background: style.color }}
                    />
                  </div>
                  <div className="w-[120px] text-right text-[11px] text-taupe">
                    <span className="font-mono font-bold text-ink">{queue.active}</span> active · {queue.waiting}{' '}
                    queued
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="rounded-2xl border border-line bg-card px-5 py-[18px]">
          <div className="font-display mb-3.5 text-sm font-bold">Live jobs</div>
          {jobs.length === 0 ? (
            <EmptyState title="Nothing running" hint="Active pipeline stages show here with per-stage progress." />
          ) : (
            jobs.map((job) => (
              <div key={job.id} className="flex items-center gap-[11px] border-b border-hairline py-[9px]">
                <span className="flex size-7 flex-none items-center justify-center rounded-full border border-line bg-paper text-primary">
                  <Loader className="size-3.5 animate-[sg-spin_1.6s_linear_infinite]" strokeWidth={1.6} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-semibold">{job.videoTitle}</div>
                  <div className="text-[10.5px] text-stone">
                    {job.stage} · {job.queue}
                  </div>
                </div>
                <div className="font-mono text-[11px] font-semibold text-primary">
                  {job.progress?.percent != null ? `${Math.round(job.progress.percent)}%` : '…'}
                </div>
              </div>
            ))
          )}
          <div className="mt-4 rounded-xl border border-dashed border-sand bg-paper p-3 text-[11px] leading-relaxed text-stone">
            GPU utilisation comes from the Prometheus stack (worker exporters) — see the Grafana dashboard in
            infra/monitoring for hardware telemetry.
          </div>
        </div>
      </div>
    </div>
  );
}
