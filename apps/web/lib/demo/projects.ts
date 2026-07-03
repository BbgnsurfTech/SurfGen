/**
 * Demo workspace data mirroring the SurfGen.dc.html handoff. Phase 8 replaces
 * these modules with TanStack Query calls against apps/api — components only
 * consume the exported types, so the swap is contained here.
 */
import {
  Clock,
  Copy,
  Cpu,
  FileText,
  Film,
  GitBranch,
  Languages,
  LayoutTemplate,
  Layers,
  Sparkles,
  User,
  type LucideIcon,
} from 'lucide-react';

export type ProjectStatus = 'Rendering' | 'Ready' | 'Draft' | 'Queued';

export interface Project {
  title: string;
  status: ProjectStatus;
  duration: string;
  updated: string;
  pipeline: string;
  pipeIcon: LucideIcon;
  thumb: string;
}

export const STATUS_COLOR: Record<ProjectStatus, string> = {
  Rendering: '#C48A1F',
  Ready: '#4F7C3A',
  Draft: '#7A6B5C',
  Queued: '#5C7A8B',
};

export const THUMBS = [
  'linear-gradient(135deg,#8B5E2F,#C49A6C)',
  'linear-gradient(135deg,#3a2f26,#7A4F22)',
  'linear-gradient(135deg,#A67040,#E8D5C0)',
  'linear-gradient(135deg,#524740,#A67040)',
  'linear-gradient(135deg,#C49A6C,#8B5E2F)',
  'linear-gradient(135deg,#1A1A1A,#524740)',
  'linear-gradient(135deg,#7A4F22,#C49A6C)',
  'linear-gradient(135deg,#A89684,#524740)',
] as const;

const ROWS: Array<[string, ProjectStatus, string, string, string, LucideIcon]> = [
  ['SEMIS Feature Walkthrough', 'Rendering', '01:12', '2m ago', 'Full pipeline', GitBranch],
  ['Governor Address — Hausa', 'Ready', '02:40', '1h ago', 'Translate → Voice → Lip-sync', Languages],
  ['Q3 Onboarding — Amara', 'Ready', '00:48', '3h ago', 'Avatar + Lip-sync', User],
  ['Product Launch Teaser', 'Draft', '00:30', 'yesterday', 'Text → Video', Sparkles],
  ['BAMIS Training Module', 'Ready', '04:15', '2d ago', 'Template render', LayoutTemplate],
  ['Investor Update EN/FR', 'Queued', '01:55', '2d ago', 'Multi-lang batch', Copy],
  ['Health Campaign — 3 langs', 'Ready', '00:52', '4d ago', 'Batch · 3 locales', Copy],
  ['Recruitment Explainer', 'Draft', '02:10', '1w ago', 'Script → Render', FileText],
];

export const PROJECTS: Project[] = ROWS.map(([title, status, duration, updated, pipeline, pipeIcon], i) => ({
  title,
  status,
  duration,
  updated,
  pipeline,
  pipeIcon,
  thumb: THUMBS[i % THUMBS.length] as string,
}));

export interface Stat {
  icon: LucideIcon;
  value: string;
  label: string;
  delta: string;
  up: boolean;
}

export const STATS: Stat[] = [
  { icon: Film, value: '1,284', label: 'Videos generated', delta: '+12%', up: true },
  { icon: Clock, value: '3.4 min', label: 'Avg render time', delta: '−18%', up: true },
  { icon: Cpu, value: '78%', label: 'GPU utilisation', delta: '+6%', up: true },
  { icon: Layers, value: '32', label: 'Active workflows', delta: '+3', up: true },
];
