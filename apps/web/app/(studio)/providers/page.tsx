'use client';

import { KeyRound, PlugZap } from 'lucide-react';
import { useState } from 'react';
import { EmptyState, LoadingState } from '../../../components/ui/states';
import { useProviders } from '../../../lib/api/hooks';

const CATEGORIES: Array<[string, string]> = [
  ['llm', 'LLM'],
  ['avatar', 'Avatar'],
  ['tts', 'Voice / TTS'],
  ['lipsync', 'Lip-sync'],
  ['video_generation', 'Video Gen'],
  ['image_generation', 'Image'],
  ['translation', 'Translation'],
];

const KIND_LABEL: Record<string, string> = {
  http: 'HTTP API',
  cli: 'Local CLI',
  python: 'Python process',
  docker: 'Docker runner',
  grpc: 'gRPC / Triton',
  onnx: 'ONNX runtime',
};

export default function ProvidersPage() {
  const providers = useProviders();
  const present = new Set(providers.data?.map((provider) => provider.capability));
  const categories = CATEGORIES.filter(([id]) => present.has(id));
  const [category, setCategory] = useState<string | null>(null);
  const active = category ?? categories[0]?.[0] ?? null;
  const visible = providers.data?.filter((provider) => provider.capability === active) ?? [];

  return (
    <div className="sg-fade px-8 pt-6 pb-12">
      <div className="mb-[22px] flex items-center gap-4 rounded-2xl bg-ink px-[22px] py-[18px]">
        <div className="flex size-[42px] items-center justify-center rounded-xl bg-camel/16 text-camel">
          <PlugZap className="size-[22px]" strokeWidth={1.6} />
        </div>
        <div className="flex-1">
          <div className="font-display text-[15px] font-bold text-white">Provider abstraction layer</div>
          <div className="mt-0.5 text-[12.5px] text-stone">
            Live view of this deployment&apos;s config — every capability resolves through a priority chain; swap
            cloud ↔ local by editing the files, no code changes.
          </div>
        </div>
        <div className="rounded-lg bg-espresso px-3 py-2 font-mono text-[11px] text-camel">
          config/providers.json · config/ai.yaml
        </div>
      </div>

      {providers.isPending ? (
        <LoadingState label="Loading provider registry…" />
      ) : providers.data?.length === 0 ? (
        <EmptyState title="No providers configured" hint="Check config/providers.json on the API host." />
      ) : (
        <>
          <div className="mb-5 flex flex-wrap gap-1.5">
            {categories.map(([id, label]) => (
              <button
                key={id}
                onClick={() => setCategory(id)}
                className={`h-8 rounded-full px-4 text-[12.5px] font-semibold ${
                  active === id ? 'bg-primary text-white' : 'border border-line bg-card text-taupe'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-4">
            {visible.map((provider) => {
              const isPrimary = provider.chainPosition === 0 && provider.enabled;
              return (
                <div
                  key={provider.id}
                  className={`rounded-2xl bg-card p-[18px] shadow-[0_1px_2px_rgba(26,26,26,.04)] ${
                    isPrimary ? 'border-[1.5px] border-primary' : 'border border-line'
                  } ${provider.enabled ? '' : 'opacity-62'}`}
                >
                  <div className="mb-3 flex items-center gap-[11px]">
                    <div className="flex size-[38px] flex-none items-center justify-center rounded-[10px] bg-ink font-mono text-[13px] font-bold text-camel uppercase">
                      {provider.id.slice(0, 2)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-display truncate text-sm font-bold">{provider.id}</div>
                      <div className="text-[11px] text-taupe">{KIND_LABEL[provider.kind] ?? provider.kind}</div>
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-[3px] text-[10.5px] font-bold ${
                        isPrimary
                          ? 'bg-success/12 text-success'
                          : provider.enabled
                            ? 'bg-primary/10 text-primary'
                            : 'bg-stone/15 text-stone'
                      }`}
                    >
                      {isPrimary ? 'Primary' : provider.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>
                  <div className="mb-3.5 flex flex-wrap gap-2">
                    <span className="rounded-full border border-line bg-paper px-2 py-[3px] text-[10.5px] font-semibold text-taupe">
                      priority {provider.priority}
                    </span>
                    {provider.chainPosition !== null && (
                      <span className="rounded-full border border-line bg-paper px-2 py-[3px] text-[10.5px] font-semibold text-taupe">
                        chain #{provider.chainPosition + 1}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between border-t border-hairline pt-[11px] text-[11px] text-stone">
                    <span className="flex items-center gap-[5px]">
                      <KeyRound className="size-[13px]" strokeWidth={1.6} />
                      {provider.requiresSecrets.length > 0
                        ? `secrets: ${provider.requiresSecrets.join(', ')}`
                        : 'no credentials needed'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
