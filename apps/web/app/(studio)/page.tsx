'use client';

import { Clock, Play } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { PROJECTS, STATS, STATUS_COLOR, type ProjectStatus } from '../../lib/demo/projects';

const FILTERS = ['All', 'Rendering', 'Drafts'] as const;
type Filter = (typeof FILTERS)[number];

const FILTER_STATUS: Record<Filter, ProjectStatus | null> = {
  All: null,
  Rendering: 'Rendering',
  Drafts: 'Draft',
};

export default function DashboardPage() {
  const [filter, setFilter] = useState<Filter>('All');
  const wanted = FILTER_STATUS[filter];
  const visible = wanted ? PROJECTS.filter((p) => p.status === wanted) : PROJECTS;

  return (
    <div className="sg-fade px-8 pt-7 pb-12">
      <div className="mb-7 grid grid-cols-4 gap-4">
        {STATS.map((stat) => (
          <div
            key={stat.label}
            className="rounded-2xl border border-line bg-card px-5 py-[18px] shadow-[0_1px_2px_rgba(26,26,26,.04)]"
          >
            <div className="flex items-center justify-between">
              <div className="flex size-[34px] items-center justify-center rounded-[10px] bg-cream text-primary">
                <stat.icon className="size-[18px]" strokeWidth={1.6} />
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                  stat.up ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'
                }`}
              >
                {stat.delta}
              </span>
            </div>
            <div className="font-display mt-3.5 text-[28px] leading-none font-extrabold text-ink">{stat.value}</div>
            <div className="mt-1 text-[12.5px] text-taupe">{stat.label}</div>
          </div>
        ))}
      </div>

      <div className="mb-3.5 flex items-center justify-between">
        <div className="font-display text-base font-bold">Recent projects</div>
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

      <div className="grid grid-cols-4 gap-[18px]">
        {visible.map((project) => (
          <Link
            key={project.title}
            href="/editor"
            className="overflow-hidden rounded-2xl border border-line bg-card shadow-[0_1px_2px_rgba(26,26,26,.04)] transition-[transform,box-shadow] duration-200 hover:-translate-y-[3px] hover:shadow-[0_16px_40px_rgba(122,79,34,.14)]"
          >
            <div className="relative h-[118px]" style={{ background: project.thumb }}>
              <div className="absolute inset-0 bg-gradient-to-b from-transparent from-40% to-ink/55" />
              <span
                className="absolute top-2.5 left-2.5 inline-flex items-center gap-[5px] rounded-full bg-white/92 px-[9px] py-[3px] text-[10.5px] font-bold"
                style={{ color: STATUS_COLOR[project.status] }}
              >
                <span className="size-1.5 rounded-full" style={{ background: STATUS_COLOR[project.status] }} />
                {project.status}
              </span>
              <div className="absolute bottom-[11px] left-3 flex items-center gap-1.5 text-[11px] font-semibold text-white">
                <Clock className="size-[13px]" strokeWidth={1.6} />
                {project.duration}
              </div>
              <div className="absolute right-3 bottom-2.5 flex size-[30px] items-center justify-center rounded-full bg-white/92 text-primary">
                <Play className="size-[15px]" strokeWidth={1.6} />
              </div>
            </div>
            <div className="px-[15px] pt-[13px] pb-[15px]">
              <div className="font-display truncate text-sm font-bold">{project.title}</div>
              <div className="mt-2 flex items-center gap-[7px] text-[11px] text-taupe">
                <project.pipeIcon className="size-[13px] text-bronze" strokeWidth={1.6} />
                {project.pipeline}
                <span className="ml-auto">{project.updated}</span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
