'use client';

import { Link as LinkIcon, Palette, Plus, Type } from 'lucide-react';
import { useState } from 'react';
import { BrandForm } from '../../../components/brands/brand-form';
import { BrandPreview } from '../../../components/brands/brand-preview';
import { EmptyState, LoadingState } from '../../../components/ui/states';
import { useToast } from '../../../components/ui/toast';
import { useBrandKits, useCreateBrandKit, useExtractBrand, useUpdateBrandKit } from '../../../lib/api/hooks';
import { EMPTY_BRAND, fontVar, type BrandDraft } from '../../../lib/brand';
import { ApiError } from '../../../lib/api/client';

export default function BrandsPage() {
  const flash = useToast();
  const kits = useBrandKits();
  const createKit = useCreateBrandKit();
  const updateKit = useUpdateBrandKit();
  const extract = useExtractBrand();

  const [mode, setMode] = useState<'list' | 'edit'>('list');
  const [brand, setBrand] = useState<BrandDraft>(EMPTY_BRAND);
  const [url, setUrl] = useState('');

  const change = (update: Partial<BrandDraft>) => setBrand((current) => ({ ...current, ...update }));

  const runExtract = () => {
    if (!url.trim()) {
      flash('Enter a website URL first');
      return;
    }
    extract.mutate(
      { url: url.trim() },
      {
        onSuccess: ({ data }) =>
          setBrand((current) => ({
            ...current,
            name: current.name || data.name,
            sourceUrl: data.sourceUrl,
            colors: data.colors,
          })),
        onError: (error) =>
          flash(error instanceof ApiError ? error.message : 'Extraction failed — is the API reachable?'),
      },
    );
  };

  const save = () => {
    const payload = {
      name: brand.name || 'Untitled brand',
      sourceUrl: brand.sourceUrl ?? undefined,
      colors: brand.colors,
      fonts: brand.fonts,
    };
    const done = () => {
      setMode('list');
      flash(`${payload.name} saved to Brand Kits`);
    };
    const fail = (error: unknown) =>
      flash(error instanceof ApiError ? `${error.code}: ${error.message}` : 'Save failed');
    if (brand.id) updateKit.mutate({ id: brand.id, ...payload }, { onSuccess: done, onError: fail });
    else createKit.mutate(payload as Omit<BrandDraft, 'id'>, { onSuccess: done, onError: fail });
  };

  if (mode === 'edit') {
    return (
      <div className="sg-fade flex h-full">
        <BrandForm
          brand={brand}
          url={url}
          extracting={extract.isPending}
          onUrl={setUrl}
          onChange={change}
          onExtract={runExtract}
          onBack={() => setMode('list')}
        />
        <BrandPreview brand={brand} saving={createKit.isPending || updateKit.isPending} onSave={save} />
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
            Reusable colours, fonts &amp; logos. Apply a kit to any video, template or workflow — or generate one
            from a website in seconds.
          </div>
        </div>
      </div>

      {kits.isPending ? (
        <LoadingState label="Loading brand kits…" />
      ) : (
        <div className="grid grid-cols-3 gap-[18px]">
          <button
            onClick={() => {
              setBrand(EMPTY_BRAND);
              setUrl('');
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

          {kits.data?.length === 0 && (
            <div className="col-span-2">
              <EmptyState title="No brand kits yet" hint="Create the first one — or run the seed script for a starter kit." />
            </div>
          )}

          {kits.data?.map((kit) => (
            <button
              key={kit.id}
              onClick={() => {
                setBrand({ ...kit });
                setUrl(kit.sourceUrl && kit.sourceUrl !== 'manual' ? kit.sourceUrl : '');
                setMode('edit');
              }}
              className="overflow-hidden rounded-2xl border border-line bg-card text-left shadow-[0_1px_2px_rgba(26,26,26,.04)] transition-[transform,box-shadow] duration-200 hover:-translate-y-[3px] hover:shadow-[0_16px_40px_rgba(122,79,34,.14)]"
            >
              <div className="flex h-2">
                <span className="flex-[2]" style={{ background: kit.colors.primary }} />
                <span className="flex-1" style={{ background: kit.colors.secondary }} />
                <span className="flex-1" style={{ background: kit.colors.ink }} />
                <span className="flex-1" style={{ background: kit.colors.surface }} />
              </div>
              <div className="p-[18px]">
                <div className="flex items-center gap-[13px]">
                  <div
                    className="flex size-11 flex-none items-center justify-center rounded-xl text-base font-extrabold text-white"
                    style={{ background: kit.colors.primary, fontFamily: fontVar(kit.fonts.display) }}
                  >
                    {kit.name
                      .split(/\s+/)
                      .slice(0, 2)
                      .map((word) => word[0])
                      .join('')
                      .toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-display truncate text-[15px] font-bold">{kit.name}</div>
                    <div className="mt-[3px] flex items-center gap-[5px] text-[11.5px] text-taupe">
                      <LinkIcon className="size-3" strokeWidth={1.6} />
                      {kit.sourceUrl ?? 'manual'}
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-hairline pt-[13px] text-[11px] text-stone">
                  <span className="flex items-center gap-[5px]">
                    <Type className="size-[13px]" strokeWidth={1.6} />
                    {kit.fonts.display} · {kit.fonts.body}
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
