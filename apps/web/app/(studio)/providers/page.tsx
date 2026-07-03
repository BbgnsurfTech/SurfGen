'use client';

import { Activity, PlugZap } from 'lucide-react';
import { useState } from 'react';
import {
  PROVIDER_CATEGORIES,
  PROVIDERS_BY_CATEGORY,
  STATE_COLOR,
  type ProviderCategory,
} from '../../../lib/demo/providers';

export default function ProvidersPage() {
  const [category, setCategory] = useState<ProviderCategory>('llm');

  return (
    <div className="sg-fade px-8 pt-6 pb-12">
      <div className="mb-[22px] flex items-center gap-4 rounded-2xl bg-ink px-[22px] py-[18px]">
        <div className="flex size-[42px] items-center justify-center rounded-xl bg-camel/16 text-camel">
          <PlugZap className="size-[22px]" strokeWidth={1.6} />
        </div>
        <div className="flex-1">
          <div className="font-display text-[15px] font-bold text-white">Provider abstraction layer</div>
          <div className="mt-0.5 text-[12.5px] text-stone">
            Every capability implements a common interface. Swap cloud ↔ local by config alone — the app code never
            changes.
          </div>
        </div>
        <div className="rounded-lg bg-espresso px-3 py-2 font-mono text-[11px] text-camel">config/providers.json</div>
      </div>

      <div className="mb-5 flex flex-wrap gap-1.5">
        {PROVIDER_CATEGORIES.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setCategory(id)}
            className={`h-8 rounded-full px-4 text-[12.5px] font-semibold ${
              category === id ? 'bg-primary text-white' : 'border border-line bg-card text-taupe'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-4">
        {PROVIDERS_BY_CATEGORY[category].map((provider) => {
          const [fg, bg] = STATE_COLOR[provider.state];
          return (
            <div
              key={`${category}-${provider.name}`}
              className={`rounded-2xl bg-card p-[18px] shadow-[0_1px_2px_rgba(26,26,26,.04)] ${
                provider.state === 'Primary' ? 'border-[1.5px] border-primary' : 'border border-line'
              } ${provider.state === 'Disabled' ? 'opacity-62' : ''}`}
            >
              <div className="mb-3 flex items-center gap-[11px]">
                <div className="flex size-[38px] flex-none items-center justify-center rounded-[10px] bg-ink font-mono text-[13px] font-bold text-camel">
                  {provider.mark}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-display text-sm font-bold">{provider.name}</div>
                  <div className="text-[11px] text-taupe">{provider.kind}</div>
                </div>
                <span
                  className="rounded-full px-2.5 py-[3px] text-[10.5px] font-bold"
                  style={{ color: fg, background: bg }}
                >
                  {provider.state}
                </span>
              </div>
              <div className="mb-3.5 flex flex-wrap gap-2">
                {provider.caps.map((cap) => (
                  <span
                    key={cap}
                    className="rounded-full border border-line bg-paper px-2 py-[3px] text-[10.5px] font-semibold text-taupe"
                  >
                    {cap}
                  </span>
                ))}
              </div>
              <div className="flex items-center justify-between border-t border-hairline pt-[11px] text-[11px] text-stone">
                <span className="flex items-center gap-[5px]">
                  <Activity className="size-[13px]" strokeWidth={1.6} />
                  {provider.latency}
                </span>
                <span>{provider.calls}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
