'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { useToast } from '../ui/toast';
import { brandCssVars, brandInitials, brandJson, fontVar, type BrandDraft } from '../../lib/brand';

const TABS = [
  ['guideline', 'Guideline'],
  ['css', 'CSS Tokens'],
  ['json', 'JSON'],
] as const;
type Tab = (typeof TABS)[number][0];

function Heading({ display, children }: { display: string; children: React.ReactNode }) {
  return (
    <h2
      className="mt-[26px] mb-3 text-[13px] font-extrabold tracking-[0.06em] text-taupe uppercase"
      style={{ fontFamily: display }}
    >
      {children}
    </h2>
  );
}

export function BrandPreview({ brand, saving, onSave }: { brand: BrandDraft; saving: boolean; onSave: () => void }) {
  const flash = useToast();
  const [tab, setTab] = useState<Tab>('guideline');
  const displayFont = fontVar(brand.fonts.display);
  const bodyFont = fontVar(brand.fonts.body);
  const name = brand.name || 'Your Brand';
  const tokens = [
    { name: 'Primary', hex: brand.colors.primary },
    { name: 'Secondary', hex: brand.colors.secondary },
    { name: 'Ink', hex: brand.colors.ink },
    { name: 'Surface', hex: brand.colors.surface },
  ];
  const code = tab === 'css' ? brandCssVars(brand) : brandJson(brand);

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-[52px] flex-none items-center gap-2.5 border-b border-line bg-card px-[22px]">
        <div className="flex gap-0.5 rounded-[10px] bg-cream p-[3px]">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`h-[30px] rounded-lg px-3.5 text-xs font-semibold ${
                tab === id ? 'bg-primary text-white' : 'text-taupe'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <button
          onClick={onSave}
          disabled={saving}
          className="flex h-[38px] items-center gap-[7px] rounded-full bg-primary px-5 text-[13px] font-bold text-white shadow-[0_6px_18px_rgba(122,79,34,.22)] disabled:opacity-60"
        >
          <Check className="size-4" strokeWidth={2} /> {saving ? 'Saving…' : 'Save brand kit'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-7">
        {tab === 'guideline' ? (
          <div className="max-w-[720px]">
            <div className="rounded-2xl border border-line p-[22px]" style={{ background: brand.colors.surface }}>
              <div className="flex items-center gap-4">
                <div
                  className="flex size-[54px] flex-none items-center justify-center rounded-[14px] text-xl font-extrabold text-white"
                  style={{ background: brand.colors.primary, fontFamily: displayFont }}
                >
                  {brandInitials(name)}
                </div>
                <div>
                  <div className="text-2xl leading-[1.1] font-extrabold text-ink" style={{ fontFamily: displayFont }}>
                    {name}
                  </div>
                  <div className="mt-1 text-[13px] text-taupe" style={{ fontFamily: bodyFont }}>
                    Brand guideline · auto-generated
                  </div>
                </div>
              </div>
            </div>

            <Heading display={displayFont}>Colour tokens</Heading>
            <div className="flex gap-3">
              {tokens.map((token) => (
                <div key={token.name} className="min-w-0 flex-1 overflow-hidden rounded-xl border border-line">
                  <div className="h-[62px]" style={{ background: token.hex }} />
                  <div className="bg-card px-2.5 py-2">
                    <div className="text-xs font-bold text-ink">{token.name}</div>
                    <div className="font-mono text-[10.5px] text-stone uppercase">{token.hex}</div>
                  </div>
                </div>
              ))}
            </div>

            <Heading display={displayFont}>Typography</Heading>
            <div className="rounded-2xl border border-line bg-card p-6">
              <div className="text-[34px] leading-[1.1] font-extrabold text-ink" style={{ fontFamily: displayFont }}>
                Turning your vision
                <br />
                into digital reality
              </div>
              <div className="mt-1.5 text-[11px] text-stone">Display · {brand.fonts.display}</div>
              <div
                className="mt-[18px] max-w-[520px] text-[15px] leading-[1.6] text-bark"
                style={{ fontFamily: bodyFont }}
              >
                Empowering businesses with innovative cross-platform mobile apps and data solutions. This body copy
                renders live in your chosen brand typeface.
              </div>
              <div className="mt-1.5 text-[11px] text-stone">Body · {brand.fonts.body}</div>
            </div>

            <Heading display={displayFont}>Components</Heading>
            <div className="flex flex-wrap items-center gap-3.5 rounded-2xl border border-line bg-card p-6">
              <button
                className="inline-flex h-10 items-center gap-[7px] rounded-full px-5 text-[13px] font-bold text-white"
                style={{ background: brand.colors.primary, fontFamily: bodyFont }}
              >
                Get Started
              </button>
              <button
                className="inline-flex h-10 items-center gap-[7px] rounded-full bg-transparent px-5 text-[13px] font-bold"
                style={{ color: brand.colors.primary, border: `1.5px solid ${brand.colors.primary}`, fontFamily: bodyFont }}
              >
                Learn More
              </button>
              <span
                className="rounded-full px-3.5 py-1.5 text-xs font-bold"
                style={{
                  color: brand.colors.primary,
                  background: brand.colors.surface,
                  border: `1px solid ${brand.colors.secondary}`,
                  fontFamily: bodyFont,
                }}
              >
                Pill badge
              </span>
            </div>
          </div>
        ) : (
          <div className="max-w-[720px]">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-[13px] font-bold text-bark">Drop-in tokens for {name}</div>
              <button
                onClick={() => {
                  void navigator.clipboard?.writeText(code);
                  flash('Copied to clipboard');
                }}
                className="flex h-8 items-center gap-1.5 rounded-full border border-line bg-card px-3.5 text-xs font-semibold text-primary"
              >
                <Copy className="size-3.5" strokeWidth={1.6} /> Copy
              </button>
            </div>
            <pre className="overflow-x-auto rounded-2xl bg-ink p-[22px] font-mono text-[12.5px] leading-[1.7] whitespace-pre text-shell">
              {code}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
