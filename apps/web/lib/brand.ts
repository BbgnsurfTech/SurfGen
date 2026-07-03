import type { BrandKit } from './api/types';

/** Editable draft — a BrandKit before it has been saved. */
export type BrandDraft = Omit<BrandKit, 'id'> & { id?: string };

export const BRAND_FONTS = ['Plus Jakarta Sans', 'Manrope', 'Space Grotesk', 'DM Sans', 'Sora'] as const;

/** next/font CSS variables (loaded in the root layout) keyed by font name. */
export const FONT_VAR: Record<string, string> = {
  'Plus Jakarta Sans': 'var(--font-jakarta)',
  Manrope: 'var(--font-manrope)',
  'Space Grotesk': 'var(--font-space-grotesk)',
  'DM Sans': 'var(--font-dm-sans)',
  Sora: 'var(--font-sora)',
};

export const fontVar = (name: string): string => FONT_VAR[name] ?? 'var(--font-manrope)';

export const EMPTY_BRAND: BrandDraft = {
  name: '',
  sourceUrl: null,
  colors: { primary: '#8B5E2F', secondary: '#C49A6C', ink: '#1A1A1A', surface: '#FAF7F3' },
  fonts: { display: 'Plus Jakarta Sans', body: 'Manrope' },
};

export function brandCssVars(brand: BrandDraft): string {
  return `:root {
  --brand-primary:   ${brand.colors.primary};
  --brand-secondary: ${brand.colors.secondary};
  --brand-ink:       ${brand.colors.ink};
  --brand-surface:   ${brand.colors.surface};
  --brand-display:   "${brand.fonts.display}", sans-serif;
  --brand-body:      "${brand.fonts.body}", sans-serif;
  --brand-radius:    999px; /* pill buttons */
}`;
}

export function brandJson(brand: BrandDraft): string {
  return JSON.stringify(
    {
      name: brand.name || 'Your Brand',
      source: brand.sourceUrl ?? 'manual',
      colors: brand.colors,
      type: brand.fonts,
    },
    null,
    2,
  );
}

export function brandInitials(name: string): string {
  return (
    (name.trim() || 'Y')
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => word[0])
      .join('')
      .toUpperCase()
  );
}
