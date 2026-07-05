'use client';

import { FilePlus, LayoutTemplate, UserRound, Workflow, X, type LucideIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useToast } from '../ui/toast';
import { useCreateProject, useCreateVideo, useWorkspace } from '../../lib/api/hooks';

/** "video" starters land in the editor and need a project + video to exist first; "navigate" starters open an already-functional area of the studio. */
type Starter =
  | { title: string; desc: string; icon: LucideIcon; iconBg: string; kind: 'video' }
  | { title: string; desc: string; icon: LucideIcon; iconBg: string; kind: 'navigate'; href: string };

const STARTERS: Starter[] = [
  { title: 'Blank project', desc: 'Start from an empty timeline.', icon: FilePlus, iconBg: 'bg-taupe', kind: 'video' },
  {
    title: 'Avatar + script',
    desc: 'Type a script, pick an avatar & voice.',
    icon: UserRound,
    iconBg: 'bg-primary',
    kind: 'video',
  },
  {
    title: 'From template',
    desc: 'Brand-styled reusable layout.',
    icon: LayoutTemplate,
    iconBg: 'bg-bronze',
    kind: 'navigate',
    href: '/brands',
  },
  {
    title: 'AI workflow',
    desc: 'Node-based multi-stage automation.',
    icon: Workflow,
    iconBg: 'bg-info',
    kind: 'navigate',
    href: '/workflows',
  },
];

export function NewProjectModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const flash = useToast();
  const workspace = useWorkspace();
  const createProject = useCreateProject();
  const createVideo = useCreateVideo();
  const [startingTitle, setStartingTitle] = useState<string | null>(null);

  const startVideo = async (starter: Extract<Starter, { kind: 'video' }>) => {
    setStartingTitle(starter.title);
    try {
      const project =
        workspace.data?.project ?? (await createProject.mutateAsync({ name: 'Untitled project' }));
      const video = await createVideo.mutateAsync({ projectId: project.id, title: 'Untitled video' });
      onClose();
      router.push(`/editor?video=${video.id}`);
    } catch {
      flash('Could not create the project — try again');
      setStartingTitle(null);
    }
  };

  const isBusy = startingTitle !== null;

  return createPortal(
    <div
      onClick={onClose}
      className="sg-fade fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-[3px]"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-project-title"
        onClick={(event) => event.stopPropagation()}
        className="w-[520px] max-w-[92vw] overflow-hidden rounded-[20px] bg-card shadow-[0_30px_80px_rgba(26,26,26,.4)]"
      >
        <div className="flex items-center border-b border-hairline px-[26px] py-[22px]">
          <div className="flex-1">
            <div id="new-project-title" className="font-display text-lg font-bold">
              New video project
            </div>
            <div className="mt-[3px] text-[12.5px] text-taupe">
              Pick a starting point — you can change every provider later.
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex size-8 items-center justify-center rounded-full border border-line bg-paper text-taupe hover:text-bark"
          >
            <X className="size-4" strokeWidth={1.6} />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3 px-[26px] py-[22px]">
          {STARTERS.map((starter) => (
            <button
              key={starter.title}
              disabled={isBusy}
              onClick={() => {
                if (isBusy) return;
                if (starter.kind === 'video') {
                  void startVideo(starter);
                } else {
                  onClose();
                  router.push(starter.href);
                }
              }}
              className="rounded-[14px] border border-line p-4 text-left transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-primary disabled:cursor-wait disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:border-line"
            >
              <div className={`flex size-10 items-center justify-center rounded-[11px] text-white ${starter.iconBg}`}>
                <starter.icon className="size-[18px]" strokeWidth={1.6} />
              </div>
              <div className="font-display mt-[11px] text-[13.5px] font-bold">
                {startingTitle === starter.title ? 'Creating…' : starter.title}
              </div>
              <div className="mt-1 text-[11.5px] leading-[1.45] text-taupe">{starter.desc}</div>
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
