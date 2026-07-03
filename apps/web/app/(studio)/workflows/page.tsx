'use client';

import {
  AudioLines,
  Brain,
  Clapperboard,
  Languages,
  Play,
  ScanFace,
  Type,
  User,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { EmptyState, LoadingState } from '../../../components/ui/states';
import { useToast } from '../../../components/ui/toast';
import { useRunWorkflow, useWorkflows } from '../../../lib/api/hooks';
import type { WorkflowNode } from '../../../lib/api/types';

const NODE_STYLE: Record<string, { icon: LucideIcon; bg: string }> = {
  script: { icon: Type, bg: '#7A6B5C' },
  llm: { icon: Brain, bg: '#8B5E2F' },
  translate: { icon: Languages, bg: '#A67040' },
  tts: { icon: AudioLines, bg: '#5C7A8B' },
  avatar: { icon: User, bg: '#8B5E2F' },
  lipsync: { icon: ScanFace, bg: '#A8442B' },
  render: { icon: Clapperboard, bg: '#7A4F22' },
};

const NODE_WIDTH = 176;
const PORT_Y = 45;

function edgePath(from: WorkflowNode, to: WorkflowNode): string {
  const x1 = from.x + NODE_WIDTH;
  const y1 = from.y + PORT_Y;
  const x2 = to.x;
  const y2 = to.y + PORT_Y;
  const bend = Math.max((x2 - x1) / 2, 24);
  return `M${x1} ${y1} C${x1 + bend} ${y1} ${x2 - bend} ${y2} ${x2} ${y2}`;
}

export default function WorkflowsPage() {
  const flash = useToast();
  const workflows = useWorkflows();
  const run = useRunWorkflow();
  const [selected, setSelected] = useState(0);

  if (workflows.isPending) return <LoadingState label="Loading workflows…" />;
  const list = workflows.data ?? [];
  if (list.length === 0) {
    return (
      <div className="p-8">
        <EmptyState
          title="No workflows yet"
          hint="Create one via POST /v1/orgs/:orgId/workflows — the seed script adds a starter script→avatar pipeline."
        />
      </div>
    );
  }

  const workflow = list[Math.min(selected, list.length - 1)]!;
  const nodes = workflow.definition.nodes ?? [];
  const edges = workflow.definition.edges ?? [];
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  return (
    <div className="sg-fade flex h-full">
      <div className="w-[210px] flex-none overflow-y-auto border-r border-line bg-card px-3.5 py-4">
        <div className="mb-2.5 text-[11px] font-bold tracking-[0.08em] text-taupe">WORKFLOWS</div>
        <div className="flex flex-col gap-2">
          {list.map((item, index) => (
            <button
              key={item.id}
              onClick={() => setSelected(index)}
              className={`rounded-[10px] px-[11px] py-[9px] text-left text-[12.5px] font-semibold ${
                index === selected ? 'border-[1.5px] border-primary bg-paper text-ink' : 'border border-line bg-paper text-bark'
              }`}
            >
              {item.name}
              <div className="mt-0.5 text-[10.5px] font-medium text-stone">
                v{item.version} · {item.isEnabled ? 'enabled' : 'disabled'}
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden bg-paper [background-image:radial-gradient(var(--color-line)_1.1px,transparent_1.1px)] [background-size:22px_22px]">
        <svg className="pointer-events-none absolute inset-0 size-full" preserveAspectRatio="none" aria-hidden>
          {edges.map((edge) => {
            const from = nodeById.get(edge.from);
            const to = nodeById.get(edge.to);
            if (!from || !to) return null;
            return (
              <path
                key={`${edge.from}-${edge.to}`}
                d={edgePath(from, to)}
                fill="none"
                stroke="#C49A6C"
                strokeWidth={2}
                strokeDasharray="6 6"
                style={{ animation: 'sg-flow .8s linear infinite' }}
              />
            );
          })}
        </svg>
        {nodes.map((node) => {
          const style = NODE_STYLE[node.kind] ?? NODE_STYLE.script!;
          return (
            <div
              key={node.id}
              className="absolute w-44 rounded-xl border border-line bg-card shadow-[0_6px_18px_rgba(122,79,34,.10)]"
              style={{ left: node.x, top: node.y }}
            >
              <div className="flex items-center gap-2 border-b border-hairline px-[11px] py-[9px]">
                <span
                  className="flex size-[22px] flex-none items-center justify-center rounded-md text-white"
                  style={{ background: style.bg }}
                >
                  <style.icon className="size-[13px]" strokeWidth={1.6} />
                </span>
                <span className="font-display text-[12.5px] font-bold">{node.label}</span>
              </div>
              <div className="px-[11px] py-[9px] text-[11px] leading-[1.4] text-taupe">{node.kind}</div>
              <span className="absolute top-1/2 -right-1.5 size-[11px] -translate-y-1/2 rounded-full border-2 border-white bg-primary" />
              <span className="absolute top-1/2 -left-1.5 size-[11px] -translate-y-1/2 rounded-full border-2 border-white bg-sand" />
            </div>
          );
        })}
        <div className="absolute bottom-5 left-5 flex gap-2">
          <button
            onClick={() =>
              run.mutate(
                { workflowId: workflow.id },
                {
                  onSuccess: () => flash('Workflow run queued (pending in WorkflowRun)'),
                  onError: () => flash('Could not queue the run'),
                },
              )
            }
            disabled={run.isPending}
            className="flex h-[38px] items-center gap-[7px] rounded-full bg-primary px-[18px] text-[13px] font-bold text-white shadow-[0_6px_18px_rgba(122,79,34,.22)] disabled:opacity-60"
          >
            <Play className="size-[15px]" strokeWidth={1.6} /> Run workflow
          </button>
        </div>
      </div>
    </div>
  );
}
