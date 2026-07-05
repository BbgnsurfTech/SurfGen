'use client';

import { Clock, Cpu, Film, GitBranch, Layers, Play } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useStats, useWorkspace } from '../../../lib/api/hooks';
import type { VideoStatus } from '../../../lib/api/types';
import { EmptyState, LoadingState, gradientFor } from '../../../components/ui/states';

type Badge = 'Rendering' | 'Ready' | 'Draft' | 'Queued' | 'Failed';

const BADGE: Record<VideoStatus, Badge> = {
  draft: 'Draft',
  queued: 'Queued',
  generating: 'Rendering',
  rendering: 'Rendering',
  post_processing: 'Rendering',
  ready: 'Ready',
  failed: 'Failed',
  cancelled: 'Draft',
};

const BADGE_COLOR: Record<Badge, string> = {
  Rendering: '#C48A1F',
  Ready: '#4F7C3A',
  Draft: '#7A6B5C',
  Queued: '#5C7A8B',
  Failed: '#A8442B',
};

const FILTERS = ['All', 'Rendering', 'Drafts'] as const;
type Filter = (typeof FILTERS)[number];

function formatDuration(durationMs?: number): string {
  if (!durationMs) return '—:—';
  const total = Math.round(durationMs / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function relativeTime(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / (60 * 24))}d ago`;
}

export default function DashboardPage() {
  const [filter, setFilter] = useState<Filter>('All');
  const stats = useStats();
  const workspace = useWorkspace();

  const statCards = [
    { icon: Film, value: stats.data?.videosTotal ?? '—', label: 'Videos total', sub: `${stats.data?.videosReady ?? 0} ready` },
    {
      icon: Clock,
      value: stats.data?.avgRenderMinutes != null ? `${stats.data.avgRenderMinutes.toFixed(1)} min` : '—',
      label: 'Avg render time',
      sub: 'last 50 runs',
    },
    { icon: Cpu, value: stats.data?.jobsInFlight ?? '—', label: 'Jobs in flight', sub: 'queued + active' },
    { icon: Layers, value: stats.data?.workflowsActive ?? '—', label: 'Active workflows', sub: 'enabled' },
  ];

  const videos = workspace.data?.videos ?? [];
  const visible = videos.filter((video) => {
    if (filter === 'All') return true;
    if (filter === 'Rendering') return BADGE[video.status] === 'Rendering' || BADGE[video.status] === 'Queued';
    return BADGE[video.status] === 'Draft';
  });

  return (
    <div className="sg-fade px-8 pt-7 pb-12">
      <div className="mb-7 grid grid-cols-4 gap-4">
        {statCards.map((stat) => (
          <div
            key={stat.label}
            className="rounded-2xl border border-line bg-card px-5 py-[18px] shadow-[0_1px_2px_rgba(26,26,26,.04)]"
          >
            <div className="flex items-center justify-between">
              <div className="flex size-[34px] items-center justify-center rounded-[10px] bg-cream text-primary">
                <stat.icon className="size-[18px]" strokeWidth={1.6} />
              </div>
              <span className="rounded-full bg-cream px-2 py-0.5 text-[11px] font-bold text-taupe">{stat.sub}</span>
            </div>
            <div className="font-display mt-3.5 text-[28px] leading-none font-extrabold text-ink">{stat.value}</div>
            <div className="mt-1 text-[12.5px] text-taupe">{stat.label}</div>
          </div>
        ))}
      </div>

      <div className="mb-3.5 flex items-center justify-between">
        <div className="font-display text-base font-bold">
          Recent videos
          {workspace.data?.project && (
            <span className="ml-2 align-middle text-xs font-semibold text-stone">
              {workspace.data.project.name}
            </span>
          )}
        </div>
        <div className="flex gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`h-8 rounded-full px-3.5 text-xs font-semibold ${
                filter === f ? 'bg-primary text-white' : 'border border-line bg-card text-taupe'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {workspace.isPending ? (
        <LoadingState label="Loading workspace…" />
      ) : visible.length === 0 ? (
        <EmptyState
          title={videos.length === 0 ? 'No videos yet' : `No ${filter.toLowerCase()} videos`}
          hint={
            videos.length === 0
              ? 'Create your first video from the New Project button, the editor, or the CLI: surfgen videos create --title hello --generate'
              : 'Try another filter.'
          }
        />
      ) : (
        <div className="grid grid-cols-4 gap-[18px]">
          {visible.map((video, index) => {
            const badge = BADGE[video.status];
            return (
              <Link
                key={video.id}
                href={`/editor?video=${video.id}`}
                className="overflow-hidden rounded-2xl border border-line bg-card shadow-[0_1px_2px_rgba(26,26,26,.04)] transition-[transform,box-shadow] duration-200 hover:-translate-y-[3px] hover:shadow-[0_16px_40px_rgba(122,79,34,.14)]"
              >
                <div className="relative h-[118px]" style={{ background: gradientFor(index) }}>
                  <div className="absolute inset-0 bg-gradient-to-b from-transparent from-40% to-ink/55" />
                  <span
                    className="absolute top-2.5 left-2.5 inline-flex items-center gap-[5px] rounded-full bg-white/92 px-[9px] py-[3px] text-[10.5px] font-bold"
                    style={{ color: BADGE_COLOR[badge] }}
                  >
                    <span className="size-1.5 rounded-full" style={{ background: BADGE_COLOR[badge] }} />
                    {badge}
                  </span>
                  <div className="absolute bottom-[11px] left-3 flex items-center gap-1.5 text-[11px] font-semibold text-white">
                    <Clock className="size-[13px]" strokeWidth={1.6} />
                    {formatDuration(video.output?.durationMs)}
                  </div>
                  <div className="absolute right-3 bottom-2.5 flex size-[30px] items-center justify-center rounded-full bg-white/92 text-primary">
                    <Play className="size-[15px]" strokeWidth={1.6} />
                  </div>
                </div>
                <div className="px-[15px] pt-[13px] pb-[15px]">
                  <div className="font-display truncate text-sm font-bold">{video.title}</div>
                  <div className="mt-2 flex items-center gap-[7px] text-[11px] text-taupe">
                    <GitBranch className="size-[13px] text-bronze" strokeWidth={1.6} />
                    Full pipeline · {video.language}
                    <span className="ml-auto">{relativeTime(video.updatedAt)}</span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
