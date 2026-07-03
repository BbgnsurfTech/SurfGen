export interface BrandKit {
  name: string;
  url: string;
  primary: string;
  secondary: string;
  accent: string;
  surface: string;
  display: BrandFont;
  body: BrandFont;
  videos?: number;
  mark?: string;
}

export const BRAND_FONTS = ['Plus Jakarta Sans', 'Manrope', 'Space Grotesk', 'DM Sans', 'Sora'] as const;
export type BrandFont = (typeof BRAND_FONTS)[number];

/** next/font CSS variables (loaded in the root layout) keyed by font name. */
export const FONT_VAR: Record<BrandFont, string> = {
  'Plus Jakarta Sans': 'var(--font-jakarta)',
  Manrope: 'var(--font-manrope)',
  'Space Grotesk': 'var(--font-space-grotesk)',
  'DM Sans': 'var(--font-dm-sans)',
  Sora: 'var(--font-sora)',
};

export const EMPTY_BRAND: BrandKit = {
  name: '',
  url: '',
  primary: '#8B5E2F',
  secondary: '#C49A6C',
  accent: '#1A1A1A',
  surface: '#FAF7F3',
  display: 'Plus Jakarta Sans',
  body: 'Manrope',
};

export const SAVED_BRANDS: BrandKit[] = [
  { name: 'BBGNSURF Core', url: 'bbgnsurf.com', primary: '#8B5E2F', secondary: '#C49A6C', accent: '#1A1A1A', surface: '#FAF7F3', display: 'Plus Jakarta Sans', body: 'Manrope', videos: 42, mark: 'BB' },
  { name: 'SEMIS Education', url: 'semis.kt.gov.ng', primary: '#1D4E6B', secondary: '#4E9CC4', accent: '#0E2A3A', surface: '#F2F8FB', display: 'Sora', body: 'DM Sans', videos: 18, mark: 'SE' },
  { name: 'BAMIS Attendance', url: 'bamis.gov.ng', primary: '#6B4E1D', secondary: '#C4A24E', accent: '#2A230E', surface: '#FBF8F2', display: 'Space Grotesk', body: 'Manrope', videos: 9, mark: 'BA' },
];

export function brandCssVars(brand: BrandKit): string {
  return `:root {
  --brand-primary:   ${brand.primary};
  --brand-secondary: ${brand.secondary};
  --brand-ink:       ${brand.accent};
  --brand-surface:   ${brand.surface};
  --brand-display:   "${brand.display}", sans-serif;
  --brand-body:      "${brand.body}", sans-serif;
  --brand-radius:    999px; /* pill buttons */
}`;
}

export function brandJson(brand: BrandKit): string {
  const name = brand.name || 'Your Brand';
  return JSON.stringify(
    {
      name,
      source: brand.url || 'manual',
      colors: { primary: brand.primary, secondary: brand.secondary, ink: brand.accent, surface: brand.surface },
      type: { display: brand.display, body: brand.body },
      logo: null,
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
      .map((w) => w[0])
      .join('')
      .toUpperCase()
  );
}
