'use client';

import { Plus, Search } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { useToast } from '../ui/toast';
import { NewProjectModal } from './new-project-modal';

const TITLES: Record<string, [crumb: string, title: string]> = {
  '/': ['Workspace', 'Dashboard'],
  '/editor': ['Project', 'Q3 Onboarding — Amara'],
  '/studio': ['Assets', 'Avatar & Voice Studio'],
  '/workflows': ['Automation', 'Workflow Builder'],
  '/brands': ['Assets', 'Brand Kits'],
  '/providers': ['Admin', 'AI Provider Registry'],
  '/monitor': ['Admin', 'GPU & Queue Monitor'],
  '/developer': ['Admin', 'Developer & API'],
  '/plugins': ['Admin', 'Plugin Registry'],
};

export function Topbar() {
  const pathname = usePathname();
  const flash = useToast();
  const [modalOpen, setModalOpen] = useState(false);
  const [crumb, title] = TITLES[pathname] ?? TITLES['/'];

  return (
    <header className="z-5 flex h-[60px] flex-none items-center gap-4 border-b border-line bg-white/92 px-6 backdrop-blur-xl">
      <div className="min-w-0">
        <div className="text-[9.5px] font-bold tracking-[0.14em] text-bronze uppercase">{crumb}</div>
        <div className="font-display truncate text-[17px] leading-[1.1] font-bold text-ink">{title}</div>
      </div>
      <div className="flex-1" />
      <div className="flex h-[38px] w-60 items-center gap-2 rounded-full border border-line bg-cream px-3.5 text-taupe">
        <Search className="size-[15px]" strokeWidth={1.6} />
        <span className="text-[13px]">Search projects, assets…</span>
      </div>
      <button
        onClick={() => flash('Health check passed — 3 GPUs online, all queues nominal')}
        className="flex h-[38px] items-center gap-[7px] rounded-full border border-line bg-card px-3.5 text-[12.5px] font-semibold text-bark"
      >
        <span className="size-2 rounded-full bg-success shadow-[0_0_0_3px_rgba(79,124,58,.18)]" />
        All systems operational
      </button>
      <button
        onClick={() => setModalOpen(true)}
        className="flex h-[38px] items-center gap-2 rounded-full bg-primary px-[18px] text-[13px] font-bold text-white shadow-[0_6px_18px_rgba(122,79,34,.22)]"
      >
        <Plus className="size-4" strokeWidth={2} /> New Project
      </button>
      {modalOpen && <NewProjectModal onClose={() => setModalOpen(false)} />}
    </header>
  );
}
