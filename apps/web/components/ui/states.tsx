import { Loader } from 'lucide-react';

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex h-48 items-center justify-center gap-2 text-[13px] font-semibold text-taupe">
      <Loader className="size-4 animate-[sg-spin_.8s_linear_infinite]" strokeWidth={1.6} />
      {label}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center gap-2 rounded-2xl border-[1.5px] border-dashed border-sand bg-card p-8 text-center">
      <div className="font-display text-sm font-bold text-ink">{title}</div>
      <div className="max-w-[380px] text-xs leading-relaxed text-taupe">{hint}</div>
      {action}
    </div>
  );
}

/** Deterministic warm gradient per index — presentation styling, not data. */
const GRADIENTS = [
  'linear-gradient(135deg,#8B5E2F,#C49A6C)',
  'linear-gradient(135deg,#3a2f26,#7A4F22)',
  'linear-gradient(135deg,#A67040,#E8D5C0)',
  'linear-gradient(135deg,#524740,#A67040)',
  'linear-gradient(135deg,#C49A6C,#8B5E2F)',
  'linear-gradient(135deg,#1A1A1A,#524740)',
  'linear-gradient(135deg,#7A4F22,#C49A6C)',
  'linear-gradient(135deg,#A89684,#524740)',
] as const;

export const gradientFor = (index: number): string => GRADIENTS[index % GRADIENTS.length] as string;
