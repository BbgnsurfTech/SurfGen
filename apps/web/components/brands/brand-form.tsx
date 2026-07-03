'use client';

import { ArrowLeft, Globe, ImageUp, Loader, Sparkles } from 'lucide-react';
import { useToast } from '../ui/toast';
import { BRAND_FONTS, fontVar, type BrandDraft } from '../../lib/brand';

interface BrandFormProps {
  brand: BrandDraft;
  url: string;
  extracting: boolean;
  onUrl: (url: string) => void;
  onChange: (update: Partial<BrandDraft>) => void;
  onExtract: () => void;
  onBack: () => void;
}

const COLOR_FIELDS: Array<{ key: keyof BrandDraft['colors']; label: string; hint: string }> = [
  { key: 'primary', label: 'Primary', hint: 'Buttons, links, brand presence' },
  { key: 'secondary', label: 'Secondary', hint: 'Accents, highlights' },
  { key: 'ink', label: 'Ink / Dark', hint: 'Text, footers' },
  { key: 'surface', label: 'Surface', hint: 'Soft backgrounds' },
];

function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-[9px] text-[11px] font-bold tracking-[0.08em] text-taupe">{children}</div>;
}

function FontPicker({
  value,
  weight,
  onPick,
}: {
  value: string;
  weight: number;
  onPick: (font: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {BRAND_FONTS.map((font) => (
        <button
          key={font}
          onClick={() => onPick(font)}
          className={`rounded-[10px] px-3 py-2 text-left text-[13px] text-ink ${
            value === font ? 'border-[1.5px] border-primary bg-paper' : 'border border-line bg-card'
          }`}
          style={{ fontFamily: fontVar(font), fontWeight: weight }}
        >
          {font}
        </button>
      ))}
    </div>
  );
}

export function BrandForm({ brand, url, extracting, onUrl, onChange, onExtract, onBack }: BrandFormProps) {
  const flash = useToast();
  return (
    <div className="w-[400px] flex-none overflow-y-auto border-r border-line bg-card px-6 py-[22px]">
      <button
        onClick={onBack}
        className="mb-[18px] flex items-center gap-1.5 text-[12.5px] font-semibold text-taupe hover:text-bark"
      >
        <ArrowLeft className="size-[15px]" strokeWidth={1.6} /> All brand kits
      </button>

      <Label>GENERATE FROM WEBSITE</Label>
      <div className="mb-2 flex h-10 items-center gap-2 rounded-[11px] border border-line bg-paper px-[13px]">
        <Globe className="size-[15px] text-primary" strokeWidth={1.6} />
        <input
          value={url}
          onChange={(event) => onUrl(event.target.value)}
          placeholder="yourbrand.com"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-stone"
        />
      </div>
      <button
        onClick={onExtract}
        disabled={extracting}
        className="flex h-10 w-full items-center justify-center gap-2 rounded-[11px] bg-ink text-[13px] font-bold text-white disabled:opacity-70"
      >
        {extracting ? (
          <Loader className="size-[15px] animate-[sg-spin_.8s_linear_infinite]" strokeWidth={1.6} />
        ) : (
          <Sparkles className="size-[15px]" strokeWidth={1.6} />
        )}
        {extracting ? 'Analysing…' : 'Generate from site'}
      </button>
      <div className="mt-2 text-[11px] leading-[1.45] text-stone">
        The API fetches the public site and pulls its palette from the page&apos;s CSS and theme-color meta.
        Everything stays editable below.
      </div>

      <div className="my-[22px] h-px bg-hairline" />

      <Label>BRAND NAME</Label>
      <input
        value={brand.name}
        onChange={(event) => onChange({ name: event.target.value })}
        placeholder="e.g. BBGNSURF Core"
        className="mb-[22px] h-10 w-full rounded-[11px] border border-line bg-paper px-[13px] text-[13px] text-ink outline-none placeholder:text-stone"
      />

      <Label>LOGO</Label>
      <button
        onClick={() => flash('Logo upload lands with asset storage wiring')}
        className="mb-[22px] flex w-full items-center gap-[13px] rounded-xl border-[1.5px] border-dashed border-sand bg-paper p-3.5"
      >
        <div className="flex size-11 flex-none items-center justify-center rounded-[10px] border border-line bg-card text-primary">
          <ImageUp className="size-5" strokeWidth={1.6} />
        </div>
        <div className="text-left">
          <div className="font-display text-[13px] font-bold text-ink">Upload logo</div>
          <div className="text-[11px] text-stone">SVG or PNG · light &amp; dark variants</div>
        </div>
      </button>

      <Label>COLOURS</Label>
      <div className="mb-[22px] flex flex-col gap-[9px]">
        {COLOR_FIELDS.map((field) => (
          <div key={field.key} className="flex items-center gap-3 rounded-xl border border-line p-2">
            <label
              className="relative size-10 flex-none cursor-pointer overflow-hidden rounded-[10px] border border-black/12"
              style={{ background: brand.colors[field.key] }}
            >
              <input
                type="color"
                value={brand.colors[field.key]}
                onChange={(event) => onChange({ colors: { ...brand.colors, [field.key]: event.target.value } })}
                aria-label={`${field.label} colour`}
                className="absolute -inset-1 h-[150%] w-[150%] cursor-pointer border-none p-0"
              />
            </label>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold">{field.label}</div>
              <div className="text-[10.5px] text-stone">{field.hint}</div>
            </div>
            <span className="font-mono text-[11.5px] text-taupe uppercase">{brand.colors[field.key]}</span>
          </div>
        ))}
      </div>

      <Label>DISPLAY FONT</Label>
      <div className="mb-[18px]">
        <FontPicker
          value={brand.fonts.display}
          weight={700}
          onPick={(font) => onChange({ fonts: { ...brand.fonts, display: font } })}
        />
      </div>
      <Label>BODY FONT</Label>
      <FontPicker
        value={brand.fonts.body}
        weight={600}
        onPick={(font) => onChange({ fonts: { ...brand.fonts, body: font } })}
      />
    </div>
  );
}
