'use client';

import { Link as LinkIcon, Palette, Plus, Type } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { BrandForm } from '../../../components/brands/brand-form';
import { BrandPreview } from '../../../components/brands/brand-preview';
import { useToast } from '../../../components/ui/toast';
import { EMPTY_BRAND, FONT_VAR, SAVED_BRANDS, type BrandKit } from '../../../lib/demo/brands';

const EXTRACT_DELAY_MS = 1600;

/** Simulated palette pulled by "Generate from site" — mirrors the prototype. */
const EXTRACTED: Partial<BrandKit> = {
  primary: '#0E5A4A',
  secondary: '#2FA98C',
  accent: '#0A2A24',
  surface: '#F3FAF7',
  display: 'Space Grotesk',
  body: 'DM Sans',
};

export default function BrandsPage() {
  const flash = useToast();
  const [mode, setMode] = useState<'list' | 'edit'>('list');
  const [brand, setBrand] = useState<BrandKit>(EMPTY_BRAND);
  const [extracting, setExtracting] = useState(false);
  const extractTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => clearTimeout(extractTimer.current ?? undefined), []);

  const setField = <K extends keyof BrandKit>(key: K, value: BrandKit[K]) =>
    setBrand((current) => ({ ...current, [key]: value }));

  const extract = () => {
    if (!brand.url) {
      flash('Enter a website URL first');
      return;
    }
    setExtracting(true);
    if (extractTimer.current) clearTimeout(extractTimer.current);
    extractTimer.current = setTimeout(() => {
      setExtracting(false);
      setBrand((current) => ({ ...current, name: current.name || 'Extracted Brand', ...EXTRACTED }));
      flash(`Palette, fonts & logo pulled from ${brand.url.replace(/^https?:\/\//, '').split('/')[0]}`);
    }, EXTRACT_DELAY_MS);
  };

  if (mode === 'edit') {
    return (
      <div className="sg-fade flex h-full">
        <BrandForm
          brand={brand}
          extracting={extracting}
          onChange={setField}
          onExtract={extract}
          onBack={() => setMode('list')}
        />
        <BrandPreview
          brand={brand}
          onSave={() => {
            setMode('list');
            flash(`${brand.name || 'Untitled brand'} saved to Brand Kits`);
          }}
        />
      </div>
    );
  }

  return (
    <div className="sg-fade px-8 pt-6 pb-12">
      <div className="mb-[22px] flex items-center gap-4 rounded-2xl bg-ink px-[22px] py-[18px]">
        <div className="flex size-[42px] items-center justify-center rounded-xl bg-camel/16 text-camel">
          <Palette className="size-[22px]" strokeWidth={1.6} />
        </div>
        <div className="flex-1">
          <div className="font-display text-[15px] font-bold text-white">Brand Kits</div>
          <div className="mt-0.5 text-[12.5px] text-stone">
            Reusable colours, fonts &amp; logos. Apply a kit to any video, template or workflow — or generate one from
            a website in seconds.
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-[18px]">
        <button
          onClick={() => {
            setBrand(EMPTY_BRAND);
            setMode('edit');
          }}
          className="flex min-h-[186px] flex-col items-center justify-center gap-2.5 rounded-2xl border-[1.5px] border-dashed border-sand bg-card text-primary"
        >
          <div className="flex size-[52px] items-center justify-center rounded-full bg-cream">
            <Plus className="size-6" strokeWidth={1.6} />
          </div>
          <div className="font-display text-sm font-bold">Create brand kit</div>
          <div className="max-w-[180px] text-center text-[11.5px] text-stone">
            From scratch or generated from a website URL
          </div>
        </button>

        {SAVED_BRANDS.map((kit) => (
          <button
            key={kit.name}
            onClick={() => {
              setBrand({ ...kit });
              setMode('edit');
            }}
            className="overflow-hidden rounded-2xl border border-line bg-card text-left shadow-[0_1px_2px_rgba(26,26,26,.04)] transition-[transform,box-shadow] duration-200 hover:-translate-y-[3px] hover:shadow-[0_16px_40px_rgba(122,79,34,.14)]"
          >
            <div className="flex h-2">
              <span className="flex-[2]" style={{ background: kit.primary }} />
              <span className="flex-1" style={{ background: kit.secondary }} />
              <span className="flex-1" style={{ background: kit.accent }} />
              <span className="flex-1" style={{ background: kit.surface }} />
            </div>
            <div className="p-[18px]">
              <div className="flex items-center gap-[13px]">
                <div
                  className="flex size-11 flex-none items-center justify-center rounded-xl text-base font-extrabold text-white"
                  style={{ background: kit.primary, fontFamily: FONT_VAR[kit.display] }}
                >
                  {kit.mark}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-display truncate text-[15px] font-bold">{kit.name}</div>
                  <div className="mt-[3px] flex items-center gap-[5px] text-[11.5px] text-taupe">
                    <LinkIcon className="size-3" strokeWidth={1.6} />
                    {kit.url}
                  </div>
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-hairline pt-[13px] text-[11px] text-stone">
                <span className="flex items-center gap-[5px]">
                  <Type className="size-[13px]" strokeWidth={1.6} />
                  {kit.display} · {kit.body}
                </span>
                <span>{kit.videos} videos</span>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
