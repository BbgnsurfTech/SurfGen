'use client';

import { Braces, Copy, Plus, Radio, Share2, Terminal, Zap, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { useToast } from '../../../components/ui/toast';
import {
  API_KEYS,
  DEV_SNIPPETS,
  ENDPOINTS,
  METHOD_COLOR,
  SDKS,
  SURFACES,
  WEBHOOK_EVENTS,
} from '../../../lib/demo/developer';

const SURFACE_ICONS: Record<string, LucideIcon> = { braces: Braces, 'share-2': Share2, radio: Radio, zap: Zap };
const LANGS = [
  ['curl', 'cURL'],
  ['node', 'Node.js'],
  ['python', 'Python'],
] as const;

function CardTitle({ children }: { children: React.ReactNode }) {
  return <div className="font-display text-sm font-bold">{children}</div>;
}

export default function DeveloperPage() {
  const flash = useToast();
  const [lang, setLang] = useState<(typeof LANGS)[number][0]>('curl');

  return (
    <div className="sg-fade px-8 pt-6 pb-12">
      <div className="mb-[26px] grid grid-cols-4 gap-4">
        {SURFACES.map((surface) => {
          const Icon = SURFACE_ICONS[surface.icon] ?? Braces;
          return (
            <div key={surface.label} className="rounded-2xl border border-line bg-card p-[18px] shadow-[0_1px_2px_rgba(26,26,26,.04)]">
              <div className="flex items-center gap-3">
                <div
                  className="flex size-10 flex-none items-center justify-center rounded-[11px] text-white"
                  style={{ background: surface.bg }}
                >
                  <Icon className="size-[18px]" strokeWidth={1.6} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-display text-sm font-bold">{surface.label}</div>
                  <span className="font-mono text-[10px] text-primary">{surface.tag}</span>
                </div>
              </div>
              <div className="mt-3 text-xs leading-normal text-taupe">{surface.desc}</div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] items-start gap-5">
        <div className="overflow-hidden rounded-[18px] border border-line-dark bg-ink">
          <div className="flex h-12 items-center gap-2.5 border-b border-carbon px-4">
            <div className="flex gap-0.5 rounded-[9px] bg-espresso p-[3px]">
              {LANGS.map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setLang(id)}
                  className={`h-8 rounded-lg px-4 text-[12.5px] font-semibold ${
                    lang === id ? 'bg-primary text-white' : 'text-taupe'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex-1" />
            <span className="font-mono text-[11px] text-taupe">POST /v1/videos</span>
            <button
              onClick={() => {
                void navigator.clipboard?.writeText(DEV_SNIPPETS[lang]);
                flash('Snippet copied');
              }}
              className="flex h-[30px] items-center gap-1.5 rounded-lg border border-line-dark bg-espresso px-3 text-xs font-semibold text-sand"
            >
              <Copy className="size-[13px]" strokeWidth={1.6} /> Copy
            </button>
          </div>
          <pre className="m-0 overflow-x-auto p-[22px] font-mono text-[12.5px] leading-[1.65] whitespace-pre text-shell">
            {DEV_SNIPPETS[lang]}
          </pre>
        </div>

        <div className="rounded-2xl border border-line bg-card px-5 py-[18px]">
          <div className="mb-3.5 flex items-center justify-between">
            <CardTitle>API keys</CardTitle>
            <button
              onClick={() => flash("New API key generated — copy it now, it won't be shown again")}
              className="flex h-8 items-center gap-1.5 rounded-full bg-primary px-[13px] text-xs font-bold text-white"
            >
              <Plus className="size-3.5" strokeWidth={2} /> New key
            </button>
          </div>
          {API_KEYS.map((apiKey) => (
            <div key={apiKey.name} className="flex items-center gap-[11px] border-b border-hairline py-[11px]">
              <span className="size-2 flex-none rounded-full" style={{ background: apiKey.dot }} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold">{apiKey.name}</span>
                  <span className="rounded-full border border-line bg-cream px-[9px] py-[3px] text-[10.5px] font-bold text-taupe">
                    {apiKey.scope}
                  </span>
                </div>
                <div className="mt-[3px] truncate font-mono text-[11px] text-stone">{apiKey.key}</div>
              </div>
              <div className="flex-none text-right">
                <button
                  onClick={() => flash(`${apiKey.name} key copied`)}
                  aria-label={`Copy ${apiKey.name} key`}
                  className="flex size-[30px] items-center justify-center rounded-lg border border-line bg-paper text-primary"
                >
                  <Copy className="size-3.5" strokeWidth={1.6} />
                </button>
                <div className="mt-[3px] text-[10px] text-stone">{apiKey.used}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 items-start gap-5">
        <div className="rounded-2xl border border-line bg-card px-5 py-[18px]">
          <div className="mb-3 flex items-center justify-between">
            <CardTitle>Endpoints</CardTitle>
            <span className="font-mono text-[11px] text-stone">api.surfgen.io</span>
          </div>
          {ENDPOINTS.map(([method, path, desc]) => (
            <div key={`${method}-${path}`} className="flex items-center gap-[11px] border-b border-hairline py-[9px]">
              <span
                className="min-w-[42px] flex-none rounded-md px-2 py-[3px] text-center font-mono text-[10.5px] font-bold text-white"
                style={{ background: METHOD_COLOR[method] ?? '#8B5E2F' }}
              >
                {method}
              </span>
              <span className="flex-none font-mono text-xs text-ink">{path}</span>
              <span className="ml-auto truncate text-right text-[11.5px] text-stone">{desc}</span>
            </div>
          ))}
        </div>

        <div className="rounded-2xl border border-line bg-card px-5 py-[18px]">
          <div className="mb-3 flex items-center justify-between">
            <CardTitle>Webhook events</CardTitle>
            <button
              onClick={() => flash('Webhook endpoint added')}
              className="flex h-[30px] items-center gap-1.5 rounded-full border border-line bg-card px-3 text-[11.5px] font-semibold text-primary"
            >
              <Plus className="size-[13px]" strokeWidth={2} /> Add endpoint
            </button>
          </div>
          {WEBHOOK_EVENTS.map(([event, desc, dot]) => (
            <div key={event} className="flex items-center gap-[11px] border-b border-hairline py-2.5">
              <span className="size-2 flex-none rounded-full" style={{ background: dot }} />
              <span className="flex-none font-mono text-xs font-semibold text-primary">{event}</span>
              <span className="ml-auto text-right text-[11.5px] text-taupe">{desc}</span>
            </div>
          ))}
          <div className="mt-3.5 mb-2.5 text-[11px] font-bold tracking-[0.08em] text-taupe">SDKS</div>
          <div className="flex flex-col gap-[9px]">
            {SDKS.map((sdk) => (
              <div key={sdk.pkg} className="flex items-center gap-3 rounded-xl border border-line bg-paper px-3 py-2.5">
                <div
                  className="flex size-[34px] flex-none items-center justify-center rounded-[9px] text-white"
                  style={{ background: sdk.bg }}
                >
                  <Terminal className="size-4" strokeWidth={1.6} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-display text-[13px] font-bold">{sdk.pkg}</div>
                  <div className="text-[11px] text-stone">{sdk.lang}</div>
                </div>
                <span className="max-w-[190px] truncate rounded-lg border border-line bg-card px-2.5 py-[5px] font-mono text-[11px] whitespace-nowrap text-taupe">
                  {sdk.cmd}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
