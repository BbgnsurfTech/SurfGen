# SurfGen Marketing Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Public marketing landing page at `/` selling the hosted SurfGen SaaS (editorial-scrolly treatment, live Paystack pricing), with the studio dashboard moved to `/dashboard`.

**Architecture:** New Next.js route group `apps/web/app/(marketing)/` renders `/` with its own nav/footer shell (no studio sidebar). The studio dashboard moves from `(studio)/page.tsx` to `(studio)/dashboard/page.tsx`. Pricing fetches the existing `GET /v1/billing/plans` endpoint, which gains `@Public()` (one-decorator API change — the global `AuthGuard` currently blocks anonymous reads; spec said "public" but it is not yet).

**Tech Stack:** Next.js 15 App Router, React 19, Tailwind v4 tokens from `apps/web/app/globals.css` (`@theme`), lucide-react, vitest. No new runtime dependencies. Playwright added as dev-only e2e (not wired into the turbo gate).

## Global Constraints

- Design tokens only — use existing Tailwind theme utilities (`bg-paper`, `bg-cream`, `bg-ink`, `bg-espresso`, `text-bark`, `text-taupe`, `text-stone`, `border-line`, `bg-primary`, `text-camel`, `bg-shell`, `border-line-dark`, `font-display`, `font-mono`). Never hardcode hex values in components.
- Shapes: pills `rounded-full`, cards `rounded-2xl` (16px). Lucide icons `strokeWidth={1.6}`.
- Motion: CSS transitions on `transform`/`opacity` only; everything must respect `prefers-reduced-motion: reduce`. No animation libraries.
- Semantic HTML: `<header>/<nav>/<main>/<section aria-labelledby>/<footer>`; every `<section>` has a labelled heading.
- Web coding style: components PascalCase symbol in kebab-case files (matches existing `apps/web/components/**` convention), `type Props` destructured in params, `'use client'` only where state/effects/browser APIs are used.
- Monorepo commands: run from repo root; web = `pnpm -C apps/web <script>`, api = `pnpm -C apps/api test`.
- Copy voice: confident, concrete, no filler ("studio-quality avatar video", not "unleash the power of AI").
- Final gate must stay green: `pnpm turbo build test lint typecheck`.

---

### Task 1: Make `GET /v1/billing/plans` public

The landing page fetches plans while signed out. The global `AuthGuard` (`apps/api/src/auth/auth.module.ts` registers it as `APP_GUARD`) rejects anonymous requests unless the route is marked `@Public()` — the decorator already exists (`apps/api/src/auth/guards.ts:24-25`) and is already used by `billing-webhook.controller.ts`.

**Files:**
- Modify: `apps/api/src/billing/billing.controller.ts`
- Test: `apps/api/test/billing.test.ts` (append)

**Interfaces:**
- Consumes: `Public`, `PUBLIC_KEY` from `apps/api/src/auth/guards.ts`
- Produces: anonymous `GET /v1/billing/plans` returns `{ gateway: { enabled, currency }, plans: BillingPlan[] }` — Task 7 (PricingSection) relies on this being reachable without a token.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/test/billing.test.ts` (top of file already imports vitest helpers; add the two new imports next to the existing ones):

```ts
import 'reflect-metadata';
import { PUBLIC_KEY } from '../src/auth/guards';
import { BillingController } from '../src/billing/billing.controller';
```

At the bottom of the file:

```ts
describe('BillingController route metadata', () => {
  test('GET /v1/billing/plans is public — the marketing page reads it signed-out', () => {
    const isPublic = Reflect.getMetadata(PUBLIC_KEY, BillingController.prototype.listPlans);
    expect(isPublic).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C apps/api test billing`
Expected: FAIL — `expected undefined to be true`

- [ ] **Step 3: Add the decorator**

In `apps/api/src/billing/billing.controller.ts`:

```ts
import { Principal, Public, RequireOrgRole, type AuthenticatedPrincipal } from '../auth/guards';
```

(replacing the existing `../auth/guards` import) and:

```ts
  /** Plan catalog is deliberately public — the marketing site renders it signed-out. */
  @Public()
  @Get('billing/plans')
  listPlans() {
    return this.billing.listActivePlans();
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C apps/api test billing`
Expected: PASS (all existing billing tests still green)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/billing/billing.controller.ts apps/api/test/billing.test.ts
git commit -m "feat(api): make billing plan catalog public for the marketing site"
```

---

### Task 2: Move the studio dashboard from `/` to `/dashboard`

**Files:**
- Move: `apps/web/app/(studio)/page.tsx` → `apps/web/app/(studio)/dashboard/page.tsx`
- Modify: `apps/web/components/shell/sidebar.tsx` (CREATE_NAV first item)
- Modify: `apps/web/app/login/page.tsx` (two `router.push('/')` calls, lines ~42 and ~60)
- Modify: `apps/web/app/signup/page.tsx` (one `router.push('/')`, line ~84)
- Modify: `apps/web/app/(studio)/editor/page.tsx` (one `<Link href="/">`, line ~72)

**Interfaces:**
- Produces: `/dashboard` renders the studio dashboard behind `AuthGate`; `/` becomes free for the marketing page (Task 8). Login/signup/verify flows land on `/dashboard`.

- [ ] **Step 1: Move the route file**

```bash
mkdir -p "apps/web/app/(studio)/dashboard"
git mv "apps/web/app/(studio)/page.tsx" "apps/web/app/(studio)/dashboard/page.tsx"
```

The `(studio)/layout.tsx` (QueryProvider + AuthGate + Sidebar + Topbar) wraps the new path automatically — no layout change.

- [ ] **Step 2: Update every link/redirect that meant "dashboard"**

`sidebar.tsx`: `{ href: '/', label: 'Dashboard', icon: LayoutDashboard }` → `{ href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard }`.

`login/page.tsx`: both `router.push('/');` → `router.push('/dashboard');`

`signup/page.tsx`: `if (result.verified) router.push('/');` → `if (result.verified) router.push('/dashboard');`

`editor/page.tsx`: `<Link href="/" className=` → `<Link href="/dashboard" className=`

Verify nothing else routes to root-as-dashboard:

```bash
grep -rn "href=\"/\"\|push('/')\|push(\"/\")\|replace('/')" apps/web/app apps/web/components apps/web/lib
```

Expected: no matches (the only remaining root references should be the marketing files added later).

- [ ] **Step 3: Verify the app builds**

Run: `pnpm -C apps/web typecheck && pnpm -C apps/web build`
Expected: both succeed. (`/` currently 404s — that is expected until Task 8; Next builds fine without a root page.)

- [ ] **Step 4: Commit**

```bash
git add -A apps/web
git commit -m "refactor(web): move studio dashboard to /dashboard to free / for marketing"
```

---

### Task 3: Plan formatting utilities (TDD)

**Files:**
- Create: `apps/web/lib/marketing/format-plan.ts`
- Test: `apps/web/lib/marketing/format-plan.test.ts`

**Interfaces:**
- Consumes: `BillingPlan` from `apps/web/lib/api/types.ts` (`amountCents: number`, `currency: string`, `interval: 'monthly' | 'annually'`).
- Produces: `formatPlanPrice(amountCents: number, currency: string): string` and `intervalLabel(interval: BillingPlan['interval']): string` — used by Task 7's PricingSection.

- [ ] **Step 1: Write the failing tests**

`apps/web/lib/marketing/format-plan.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { formatPlanPrice, intervalLabel } from './format-plan';

describe('formatPlanPrice', () => {
  test('converts Paystack subunits to whole major units without decimals', () => {
    // Arrange: 500000 kobo = ₦5,000
    // Act
    const price = formatPlanPrice(500000, 'NGN');
    // Assert
    expect(price).toBe('₦5,000');
  });

  test('keeps decimals when the amount is not a whole major unit', () => {
    expect(formatPlanPrice(12550, 'USD')).toBe('$125.50');
  });

  test('renders zero as a plain zero price', () => {
    expect(formatPlanPrice(0, 'NGN')).toBe('₦0');
  });

  test('falls back to CODE-prefixed output for unknown currency codes', () => {
    expect(formatPlanPrice(500000, 'ZZZ')).toBe('ZZZ 5,000');
  });
});

describe('intervalLabel', () => {
  test('labels monthly plans per month', () => {
    expect(intervalLabel('monthly')).toBe('/month');
  });

  test('labels annual plans per year', () => {
    expect(intervalLabel('annually')).toBe('/year');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -C apps/web test format-plan`
Expected: FAIL — cannot resolve `./format-plan`

- [ ] **Step 3: Implement**

`apps/web/lib/marketing/format-plan.ts`:

```ts
import type { BillingPlan } from '../api/types';

/**
 * Paystack stores amounts in subunits (kobo, cents). Display in major units,
 * dropping ".00" on whole amounts. Unknown ISO codes (Intl throws RangeError)
 * degrade to "CODE 5,000" rather than crashing the pricing section.
 */
export function formatPlanPrice(amountCents: number, currency: string): string {
  const major = amountCents / 100;
  const wholeUnit = Number.isInteger(major);
  try {
    return new Intl.NumberFormat('en', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: wholeUnit ? 0 : 2,
    }).format(major);
  } catch {
    return `${currency} ${new Intl.NumberFormat('en').format(major)}`;
  }
}

export function intervalLabel(interval: BillingPlan['interval']): string {
  return interval === 'monthly' ? '/month' : '/year';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -C apps/web test format-plan`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/marketing
git commit -m "feat(web): plan price formatting utilities for the marketing page"
```

---

### Task 4: Marketing shell — reveal hook, global motion CSS, nav, footer, layout

**Files:**
- Create: `apps/web/components/marketing/use-reveal.ts`
- Create: `apps/web/components/marketing/marketing-nav.tsx`
- Create: `apps/web/components/marketing/marketing-footer.tsx`
- Create: `apps/web/app/(marketing)/layout.tsx`
- Modify: `apps/web/app/globals.css` (append reveal classes)
- Asset: `cp docs/assets/surfgen-banner.webp apps/web/public/og.webp`

**Interfaces:**
- Consumes: `ensureSession`, `isAuthed` from `apps/web/lib/api/client.ts`; `surfgen:auth` window event (fired by the client on token changes).
- Produces: `useReveal<T extends HTMLElement>(): React.RefObject<T | null>` + `.sg-reveal`/`.is-revealed` CSS contract, `MarketingNav`, `MarketingFooter`, and the `(marketing)` layout — Tasks 5–8 mount inside this shell and use the hook.

- [ ] **Step 1: Copy the OG image**

```bash
cp docs/assets/surfgen-banner.webp apps/web/public/og.webp
```

- [ ] **Step 2: Append reveal CSS to `apps/web/app/globals.css`**

```css
/* --- marketing reveal (IntersectionObserver adds .is-revealed) --- */
.sg-reveal {
  opacity: 0;
  transform: translateY(24px);
  transition:
    opacity 0.6s cubic-bezier(0.16, 1, 0.3, 1),
    transform 0.6s cubic-bezier(0.16, 1, 0.3, 1);
}
.sg-reveal.is-revealed {
  opacity: 1;
  transform: none;
}
@media (prefers-reduced-motion: reduce) {
  .sg-reveal {
    opacity: 1;
    transform: none;
    transition: none;
  }
}
```

- [ ] **Step 3: Create the reveal hook**

`apps/web/components/marketing/use-reveal.ts`:

```ts
'use client';

import { useEffect, useRef } from 'react';

/**
 * Adds .is-revealed to the element when it enters the viewport (once).
 * Under prefers-reduced-motion the CSS shows content immediately, so the
 * observer is skipped entirely.
 */
export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            el.classList.add('is-revealed');
            observer.disconnect();
          }
        }
      },
      { threshold: 0.15 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return ref;
}
```

- [ ] **Step 4: Create the nav**

`apps/web/components/marketing/marketing-nav.tsx`:

```tsx
'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ensureSession, isAuthed } from '../../lib/api/client';

const LINKS = [
  { href: '#product', label: 'Product' },
  { href: '#pipeline', label: 'Pipeline' },
  { href: '#capabilities', label: 'Capabilities' },
  { href: '#pricing', label: 'Pricing' },
  { href: '#faq', label: 'FAQ' },
];

export function MarketingNav() {
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    const sync = () => setAuthed(isAuthed());
    void ensureSession().then(sync);
    window.addEventListener('surfgen:auth', sync);
    return () => window.removeEventListener('surfgen:auth', sync);
  }, []);

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-paper/85 backdrop-blur-md">
      <nav
        aria-label="Main navigation"
        className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-6 px-5"
      >
        <Link href="/" className="flex items-center gap-2.5">
          <Image src="/logo-brown.png" alt="SurfGen" width={28} height={28} />
          <span className="font-display text-lg font-extrabold tracking-tight text-ink">SurfGen</span>
        </Link>

        <div className="hidden items-center gap-7 md:flex">
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm font-semibold text-bark transition-colors hover:text-primary"
            >
              {link.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <a
            href="https://github.com/BBGNSURF/SurfGen"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden text-sm font-semibold text-taupe transition-colors hover:text-primary sm:block"
          >
            GitHub
          </a>
          {authed ? (
            <Link
              href="/dashboard"
              className="rounded-full bg-primary px-5 py-2 text-sm font-bold text-white transition-colors hover:bg-deep"
            >
              Open Studio
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className="text-sm font-semibold text-bark transition-colors hover:text-primary"
              >
                Sign in
              </Link>
              <Link
                href="/signup"
                className="rounded-full bg-primary px-5 py-2 text-sm font-bold text-white transition-colors hover:bg-deep"
              >
                Start free
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
```

- [ ] **Step 5: Create the footer**

`apps/web/components/marketing/marketing-footer.tsx`:

```tsx
import Image from 'next/image';
import Link from 'next/link';

const COLUMNS = [
  {
    title: 'Product',
    links: [
      { href: '#pipeline', label: 'How it works' },
      { href: '#capabilities', label: 'Capabilities' },
      { href: '#pricing', label: 'Pricing' },
      { href: '/signup', label: 'Start free' },
    ],
  },
  {
    title: 'Open source',
    links: [
      { href: 'https://github.com/BBGNSURF/SurfGen', label: 'GitHub' },
      { href: 'https://github.com/BBGNSURF/SurfGen#quick-start', label: 'Self-host guide' },
      { href: 'https://github.com/BBGNSURF/SurfGen/blob/main/docs/roadmap.md', label: 'Roadmap' },
    ],
  },
  {
    title: 'Account',
    links: [
      { href: '/login', label: 'Sign in' },
      { href: '/signup', label: 'Create account' },
      { href: '/billing', label: 'Billing' },
    ],
  },
];

export function MarketingFooter() {
  return (
    <footer className="bg-ink text-stone">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-5 py-16 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2.5">
            <Image src="/logo-white.png" alt="" width={28} height={28} />
            <span className="font-display text-lg font-extrabold tracking-tight text-white">SurfGen</span>
          </div>
          <p className="mt-4 max-w-xs text-sm leading-relaxed">
            Studio-quality avatar video from a single pipeline — hosted for you, open source
            underneath.
          </p>
        </div>
        {COLUMNS.map((column) => (
          <nav key={column.title} aria-label={`${column.title} links`}>
            <h3 className="font-display text-sm font-bold uppercase tracking-wider text-camel">
              {column.title}
            </h3>
            <ul className="mt-4 space-y-2.5">
              {column.links.map((link) =>
                link.href.startsWith('http') ? (
                  <li key={link.href}>
                    <a
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm transition-colors hover:text-white"
                    >
                      {link.label}
                    </a>
                  </li>
                ) : (
                  <li key={link.href}>
                    <Link href={link.href} className="text-sm transition-colors hover:text-white">
                      {link.label}
                    </Link>
                  </li>
                ),
              )}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-line-dark">
        <p className="mx-auto w-full max-w-6xl px-5 py-6 text-xs">
          © {new Date().getFullYear()} SurfGen. Apache-2.0 licensed — no application code ever
          names a vendor.
        </p>
      </div>
    </footer>
  );
}
```

- [ ] **Step 6: Create the marketing layout**

`apps/web/app/(marketing)/layout.tsx`:

```tsx
import type { Metadata } from 'next';
import { MarketingFooter } from '../../components/marketing/marketing-footer';
import { MarketingNav } from '../../components/marketing/marketing-nav';

export const metadata: Metadata = {
  title: 'SurfGen — Turn scripts into studio-quality avatar video',
  description:
    'Write a script, pick a voice, choose an avatar — SurfGen generates, lip-syncs, subtitles, and renders the finished video. Hosted studio on an open-source engine.',
  openGraph: {
    title: 'SurfGen — AI avatar video, one pipeline',
    description:
      'Talking photos, voice cloning, lip sync, translation, and a full timeline editor — every AI capability swappable by configuration.',
    images: [{ url: '/og.webp', width: 1520, height: 760 }],
  },
};

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <MarketingNav />
      <main className="flex-1">{children}</main>
      <MarketingFooter />
    </div>
  );
}
```

- [ ] **Step 7: Verify typecheck**

Run: `pnpm -C apps/web typecheck`
Expected: PASS (layout unused until Task 8 — Next allows a layout without a page, but if `next build` complains later, Task 8 adds the page).

- [ ] **Step 8: Commit**

```bash
git add apps/web/components/marketing apps/web/app/\(marketing\) apps/web/app/globals.css apps/web/public/og.webp
git commit -m "feat(web): marketing shell — nav, footer, layout, reveal motion"
```

---

### Task 5: Hero section

**Files:**
- Create: `apps/web/components/marketing/hero.tsx`

**Interfaces:**
- Consumes: `useReveal` (Task 4), lucide icons.
- Produces: `Hero` server-renderable section (client component for reveal), `id="product"` anchor target. Mounted by Task 8.

- [ ] **Step 1: Create the hero**

`apps/web/components/marketing/hero.tsx`:

```tsx
'use client';

import { ArrowRight, AudioLines, Clapperboard, Play, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useReveal } from './use-reveal';

/** CSS-built studio frame — no screenshot dependency, zero LCP image cost. */
function StudioFrame() {
  return (
    <div
      aria-hidden="true"
      className="relative overflow-hidden rounded-2xl border border-line-dark bg-espresso p-4 shadow-[0_40px_80px_-40px_rgba(26,26,26,0.5)]"
    >
      <div className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-danger/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-warn/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-success/70" />
        <span className="ml-3 rounded-full bg-carbon px-3 py-1 font-mono text-[10px] text-stone">
          studio / product-launch.mp4
        </span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_180px]">
        <div className="flex aspect-video items-center justify-center rounded-xl bg-carbon">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-camel text-ink">
            <Play size={22} strokeWidth={1.6} fill="currentColor" />
          </span>
        </div>
        <div className="hidden flex-col gap-3 sm:flex">
          <div className="flex items-center gap-2 rounded-xl bg-carbon px-3 py-2.5">
            <UserRound size={16} strokeWidth={1.6} className="text-camel" />
            <span className="text-xs font-semibold text-shell">Avatar · Nadia</span>
          </div>
          <div className="flex items-center gap-2 rounded-xl bg-carbon px-3 py-2.5">
            <AudioLines size={16} strokeWidth={1.6} className="text-camel" />
            <span className="text-xs font-semibold text-shell">Voice · cloned</span>
          </div>
          <div className="flex items-center gap-2 rounded-xl bg-carbon px-3 py-2.5">
            <Clapperboard size={16} strokeWidth={1.6} className="text-camel" />
            <span className="text-xs font-semibold text-shell">Render · 1080p</span>
          </div>
        </div>
      </div>

      <div className="mt-3 space-y-1.5">
        <div className="h-2 rounded-full bg-deep/80" style={{ width: '82%' }} />
        <div className="h-2 rounded-full bg-camel/60" style={{ width: '64%' }} />
        <div className="h-2 rounded-full bg-carbon" style={{ width: '91%' }} />
      </div>
    </div>
  );
}

export function Hero() {
  const ref = useReveal<HTMLDivElement>();

  return (
    <section id="product" aria-labelledby="hero-heading" className="overflow-hidden">
      <div
        ref={ref}
        className="sg-reveal mx-auto grid w-full max-w-6xl items-center gap-12 px-5 pb-20 pt-16 md:grid-cols-[1.15fr_1fr] md:pt-24"
      >
        <div>
          <p className="inline-flex items-center gap-2 rounded-full bg-shell px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-deep">
            Hosted studio · Open-source engine
          </p>
          <h1
            id="hero-heading"
            className="mt-6 font-display text-[clamp(2.75rem,2rem+3.5vw,4.5rem)] font-extrabold leading-[1.02] tracking-tight text-ink"
          >
            Turn scripts into studio&#8209;quality avatar video.
          </h1>
          <p className="mt-6 max-w-lg text-lg leading-relaxed text-taupe">
            SurfGen writes the narration, clones the voice, animates the avatar, and renders the
            finished cut — one pipeline, from first draft to published video.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-4">
            <Link
              href="/signup"
              className="group inline-flex items-center gap-2 rounded-full bg-primary px-7 py-3.5 text-sm font-bold text-white transition-colors hover:bg-deep"
            >
              Start creating free
              <ArrowRight size={16} strokeWidth={2} className="transition-transform group-hover:translate-x-0.5" />
            </Link>
            <a
              href="#pipeline"
              className="rounded-full border border-line bg-card px-7 py-3.5 text-sm font-bold text-bark transition-colors hover:border-primary hover:text-primary"
            >
              See how it works
            </a>
          </div>
          <p className="mt-6 text-xs font-semibold text-stone">
            No credit card required · Self-hosting always free
          </p>
        </div>
        <StudioFrame />
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm -C apps/web typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/marketing/hero.tsx
git commit -m "feat(web): marketing hero with CSS-built studio frame"
```

---

### Task 6: Pipeline section (scroll-driven)

**Files:**
- Create: `apps/web/components/marketing/pipeline-section.tsx`

**Interfaces:**
- Consumes: lucide icons; IntersectionObserver (native).
- Produces: `PipelineSection` with `id="pipeline"` anchor. Mounted by Task 8.

- [ ] **Step 1: Create the section**

`apps/web/components/marketing/pipeline-section.tsx`:

```tsx
'use client';

import { AudioLines, Clapperboard, FileText, UserRound, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface Stage {
  id: string;
  icon: LucideIcon;
  title: string;
  body: string;
  chip: string;
}

const STAGES: Stage[] = [
  {
    id: 'script',
    icon: FileText,
    title: 'Script',
    body: 'Start from a prompt or paste your draft — AI script generation and prompt enhancement shape the narration, scene by scene.',
    chip: 'script-generation',
  },
  {
    id: 'voice',
    icon: AudioLines,
    title: 'Voice',
    body: 'Pick a studio voice, or clone your own from a short sample. Text-to-speech renders every line with the pacing you set.',
    chip: 'tts · voice-cloning',
  },
  {
    id: 'avatar',
    icon: UserRound,
    title: 'Avatar',
    body: 'A talking photo or a full AI presenter, lip-synced to the audio frame by frame — with face animation and background replacement.',
    chip: 'lipsync · face-animation',
  },
  {
    id: 'render',
    icon: Clapperboard,
    title: 'Render',
    body: 'Subtitles, translation into new languages, and a broadcast-ready MP4 — delivered by the same worker pipeline that powers the editor.',
    chip: 'subtitles · translate · mp4',
  },
];

export function PipelineSection() {
  const [active, setActive] = useState(0);
  const panelRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const index = panelRefs.current.indexOf(entry.target as HTMLDivElement);
          if (index >= 0) setActive(index);
        }
      },
      { rootMargin: '-45% 0px -45% 0px' },
    );
    for (const panel of panelRefs.current) if (panel) observer.observe(panel);
    return () => observer.disconnect();
  }, []);

  return (
    <section id="pipeline" aria-labelledby="pipeline-heading" className="bg-cream/60 py-24">
      <div className="mx-auto w-full max-w-6xl px-5">
        <p className="text-xs font-bold uppercase tracking-widest text-bronze">One pipeline</p>
        <h2
          id="pipeline-heading"
          className="mt-3 max-w-2xl font-display text-[clamp(1.9rem,1.4rem+2vw,3rem)] font-extrabold leading-tight tracking-tight text-ink"
        >
          Four stages between your idea and a finished video.
        </h2>

        <div className="mt-14 grid gap-12 md:grid-cols-[280px_1fr]">
          {/* Sticky rail */}
          <ol className="top-28 hidden self-start md:sticky md:block" aria-hidden="true">
            {STAGES.map((stage, index) => {
              const Icon = stage.icon;
              const isActive = index === active;
              return (
                <li key={stage.id} className="relative flex gap-4 pb-10 last:pb-0">
                  {index < STAGES.length - 1 && (
                    <span
                      className={`absolute left-[19px] top-10 h-[calc(100%-2.5rem)] w-px ${index < active ? 'bg-primary' : 'bg-sand'}`}
                    />
                  )}
                  <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition-colors duration-300 ${
                      isActive
                        ? 'border-primary bg-primary text-white'
                        : 'border-sand bg-card text-taupe'
                    }`}
                  >
                    <Icon size={17} strokeWidth={1.6} />
                  </span>
                  <span
                    className={`pt-2 font-display text-sm font-bold transition-colors duration-300 ${isActive ? 'text-ink' : 'text-stone'}`}
                  >
                    {stage.title}
                  </span>
                </li>
              );
            })}
          </ol>

          {/* Scrolling panels */}
          <div className="space-y-6">
            {STAGES.map((stage, index) => {
              const Icon = stage.icon;
              return (
                <div
                  key={stage.id}
                  ref={(el) => {
                    panelRefs.current[index] = el;
                  }}
                  className={`rounded-2xl border bg-card p-8 transition-colors duration-300 md:p-10 ${
                    index === active ? 'border-primary/50 shadow-[0_20px_50px_-30px_rgba(139,94,47,0.4)]' : 'border-line'
                  }`}
                >
                  <div className="flex items-center gap-3 md:hidden">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-shell text-deep">
                      <Icon size={16} strokeWidth={1.6} />
                    </span>
                    <span className="font-display text-sm font-bold text-ink">{stage.title}</span>
                  </div>
                  <p className="mt-4 text-xs font-bold uppercase tracking-widest text-bronze md:mt-0">
                    Stage {index + 1}
                  </p>
                  <h3 className="mt-2 hidden font-display text-2xl font-extrabold text-ink md:block">
                    {stage.title}
                  </h3>
                  <p className="mt-3 max-w-xl leading-relaxed text-taupe">{stage.body}</p>
                  <code className="mt-5 inline-block rounded-full bg-cream px-4 py-1.5 font-mono text-xs text-bark">
                    {stage.chip}
                  </code>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm -C apps/web typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/marketing/pipeline-section.tsx
git commit -m "feat(web): scroll-driven pipeline section"
```

---

### Task 7: Capabilities bento, provider strip, pricing, FAQ

**Files:**
- Create: `apps/web/components/marketing/capabilities-bento.tsx`
- Create: `apps/web/components/marketing/provider-strip.tsx`
- Create: `apps/web/components/marketing/pricing-section.tsx`
- Create: `apps/web/components/marketing/faq-section.tsx`

**Interfaces:**
- Consumes: `api`, `ApiError` from `lib/api/client.ts`; `PublicPlans`, `BillingPlan` from `lib/api/types.ts`; `formatPlanPrice`, `intervalLabel` from `lib/marketing/format-plan.ts` (Task 3); `useReveal` (Task 4).
- Produces: `CapabilitiesBento` (`id="capabilities"`), `ProviderStrip`, `PricingSection` (`id="pricing"`), `FaqSection` (`id="faq"`). Mounted by Task 8.

- [ ] **Step 1: Capabilities bento**

`apps/web/components/marketing/capabilities-bento.tsx`:

```tsx
'use client';

import {
  AudioLines,
  Captions,
  Clapperboard,
  Image as ImageIcon,
  Languages,
  MessageSquareText,
  Mic,
  PersonStanding,
  Replace,
  ScanFace,
  Sparkles,
  SwatchBook,
  UserRound,
  Video,
  Wand2,
  type LucideIcon,
} from 'lucide-react';
import { useReveal } from './use-reveal';

interface Tile {
  icon: LucideIcon;
  title: string;
  body?: string;
  large?: boolean;
}

const TILES: Tile[] = [
  {
    icon: UserRound,
    title: 'AI Avatars',
    body: 'Studio presenters that read your script on camera — no crew, no reshoots.',
    large: true,
  },
  {
    icon: Mic,
    title: 'Voice Cloning',
    body: 'A short sample becomes a reusable voice that narrates every video you make.',
    large: true,
  },
  {
    icon: ScanFace,
    title: 'Talking Photos',
    body: 'Any portrait becomes a presenter, lip-synced frame by frame.',
    large: true,
  },
  { icon: AudioLines, title: 'Text-to-Speech' },
  { icon: Languages, title: 'Translation' },
  { icon: Captions, title: 'Subtitles' },
  { icon: Video, title: 'Video Generation' },
  { icon: PersonStanding, title: 'Face Animation' },
  { icon: Replace, title: 'Background Replace' },
  { icon: MessageSquareText, title: 'Script Generation' },
  { icon: Clapperboard, title: 'Lip Sync' },
  { icon: SwatchBook, title: 'Motion Generation' },
  { icon: ImageIcon, title: 'Image Generation' },
  { icon: Sparkles, title: 'Prompt Enhancement' },
  { icon: Wand2, title: 'AI Editing' },
];

export function CapabilitiesBento() {
  const ref = useReveal<HTMLDivElement>();

  return (
    <section id="capabilities" aria-labelledby="capabilities-heading" className="py-24">
      <div ref={ref} className="sg-reveal mx-auto w-full max-w-6xl px-5">
        <p className="text-xs font-bold uppercase tracking-widest text-bronze">Fifteen capabilities</p>
        <h2
          id="capabilities-heading"
          className="mt-3 max-w-2xl font-display text-[clamp(1.9rem,1.4rem+2vw,3rem)] font-extrabold leading-tight tracking-tight text-ink"
        >
          Everything a video team does, as one toolkit.
        </h2>

        <div className="mt-12 grid grid-cols-2 gap-4 md:grid-cols-6">
          {TILES.map((tile) => {
            const Icon = tile.icon;
            return tile.large ? (
              <div
                key={tile.title}
                className="col-span-2 rounded-2xl border border-line bg-card p-7 transition-shadow hover:shadow-[0_20px_50px_-30px_rgba(139,94,47,0.45)]"
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-shell text-deep">
                  <Icon size={19} strokeWidth={1.6} />
                </span>
                <h3 className="mt-4 font-display text-lg font-extrabold text-ink">{tile.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-taupe">{tile.body}</p>
              </div>
            ) : (
              <div
                key={tile.title}
                className="col-span-1 flex flex-col justify-between gap-3 rounded-2xl border border-line bg-cream/70 p-5 transition-colors hover:border-primary/40 md:col-span-2 lg:col-span-1"
              >
                <Icon size={18} strokeWidth={1.6} className="text-bronze" />
                <h3 className="text-[13px] font-bold leading-snug text-bark">{tile.title}</h3>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
```

Note the small-tile column spans: on `md` (6-col grid) small tiles are `md:col-span-2` (3 per row), on `lg` they tighten to `lg:col-span-1` (6 per row) — the 12 small tiles form two clean rows under the three large ones.

- [ ] **Step 2: Provider strip**

`apps/web/components/marketing/provider-strip.tsx`:

```tsx
import { ArrowLeftRight } from 'lucide-react';

const YAML_BEFORE = `capabilities:
  tts:
    provider: elevenlabs`;

const YAML_AFTER = `capabilities:
  tts:
    provider: piper   # local, free`;

export function ProviderStrip() {
  return (
    <section aria-labelledby="providers-heading" className="bg-ink py-24 text-shell">
      <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-5 md:grid-cols-2">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-camel">No lock-in, by design</p>
          <h2
            id="providers-heading"
            className="mt-3 font-display text-[clamp(1.9rem,1.4rem+2vw,3rem)] font-extrabold leading-tight tracking-tight text-white"
          >
            No application code ever names a vendor.
          </h2>
          <p className="mt-5 max-w-md leading-relaxed text-stone">
            Every AI capability sits behind a provider abstraction. Swap a cloud voice API for a
            local model — or bring your own keys — by editing one line of configuration. The
            engine is open source; your videos never depend on our vendor choices.
          </p>
        </div>
        <div className="grid items-center gap-4 sm:grid-cols-[1fr_auto_1fr]">
          <pre className="overflow-x-auto rounded-2xl border border-line-dark bg-espresso p-5 font-mono text-xs leading-relaxed text-camel">
            {YAML_BEFORE}
          </pre>
          <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-carbon text-camel">
            <ArrowLeftRight size={17} strokeWidth={1.6} />
          </span>
          <pre className="overflow-x-auto rounded-2xl border border-line-dark bg-espresso p-5 font-mono text-xs leading-relaxed text-camel">
            {YAML_AFTER}
          </pre>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Pricing section**

`apps/web/components/marketing/pricing-section.tsx`:

```tsx
'use client';

import { Check } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api/client';
import type { BillingPlan, PublicPlans } from '../../lib/api/types';
import { formatPlanPrice, intervalLabel } from '../../lib/marketing/format-plan';

type PlansState =
  | { status: 'loading' }
  | { status: 'ready'; plans: BillingPlan[] }
  | { status: 'fallback' };

function PlanCard({ plan, featured }: { plan: BillingPlan; featured: boolean }) {
  return (
    <div
      className={`flex flex-col rounded-2xl border p-8 ${
        featured ? 'border-primary bg-ink text-shell shadow-[0_30px_60px_-30px_rgba(26,26,26,0.6)]' : 'border-line bg-card'
      }`}
    >
      <h3 className={`font-display text-lg font-extrabold ${featured ? 'text-white' : 'text-ink'}`}>
        {plan.name}
      </h3>
      {plan.description && (
        <p className={`mt-1.5 text-sm ${featured ? 'text-stone' : 'text-taupe'}`}>{plan.description}</p>
      )}
      <p className="mt-6">
        <span className={`font-display text-4xl font-extrabold ${featured ? 'text-white' : 'text-ink'}`}>
          {formatPlanPrice(plan.amountCents, plan.currency)}
        </span>
        <span className={`text-sm font-semibold ${featured ? 'text-stone' : 'text-taupe'}`}>
          {intervalLabel(plan.interval)}
        </span>
      </p>
      <ul className="mt-6 flex-1 space-y-2.5">
        {plan.features.map((feature) => (
          <li key={feature} className="flex items-start gap-2.5 text-sm">
            <Check size={15} strokeWidth={2} className={`mt-0.5 shrink-0 ${featured ? 'text-camel' : 'text-success'}`} />
            <span className={featured ? 'text-shell' : 'text-bark'}>{feature}</span>
          </li>
        ))}
      </ul>
      <Link
        href="/signup"
        className={`mt-8 rounded-full px-6 py-3 text-center text-sm font-bold transition-colors ${
          featured ? 'bg-camel text-ink hover:bg-shell' : 'bg-primary text-white hover:bg-deep'
        }`}
      >
        Get started
      </Link>
    </div>
  );
}

/** Shown when the API is unreachable or no plans are configured — the page never blanks. */
function FallbackCard() {
  return (
    <div className="mx-auto max-w-xl rounded-2xl border border-line bg-card p-10 text-center">
      <h3 className="font-display text-xl font-extrabold text-ink">Start free today</h3>
      <p className="mt-3 leading-relaxed text-taupe">
        Create an account and start generating — or self-host the full open-source platform on
        your own hardware, free forever.
      </p>
      <div className="mt-7 flex flex-wrap justify-center gap-4">
        <Link
          href="/signup"
          className="rounded-full bg-primary px-7 py-3 text-sm font-bold text-white transition-colors hover:bg-deep"
        >
          Create account
        </Link>
        <a
          href="https://github.com/BBGNSURF/SurfGen"
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-full border border-line px-7 py-3 text-sm font-bold text-bark transition-colors hover:border-primary hover:text-primary"
        >
          Self-host on GitHub
        </a>
      </div>
    </div>
  );
}

export function PricingSection() {
  const [state, setState] = useState<PlansState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    api<PublicPlans>('GET', '/v1/billing/plans')
      .then(({ data }) => {
        if (cancelled) return;
        if (data.gateway.enabled && data.plans.length > 0) {
          setState({ status: 'ready', plans: data.plans });
        } else {
          setState({ status: 'fallback' });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'fallback' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const featuredIndex = state.status === 'ready' ? Math.min(1, state.plans.length - 1) : -1;

  return (
    <section id="pricing" aria-labelledby="pricing-heading" className="bg-cream/60 py-24">
      <div className="mx-auto w-full max-w-6xl px-5">
        <p className="text-center text-xs font-bold uppercase tracking-widest text-bronze">Pricing</p>
        <h2
          id="pricing-heading"
          className="mx-auto mt-3 max-w-xl text-center font-display text-[clamp(1.9rem,1.4rem+2vw,3rem)] font-extrabold leading-tight tracking-tight text-ink"
        >
          Simple plans. The engine itself is free.
        </h2>

        <div className="mt-14">
          {state.status === 'loading' && (
            <div className="grid gap-6 md:grid-cols-3" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-80 animate-pulse rounded-2xl border border-line bg-card" />
              ))}
            </div>
          )}
          {state.status === 'ready' && (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {state.plans.map((plan, index) => (
                <PlanCard key={plan.id} plan={plan} featured={index === featuredIndex} />
              ))}
            </div>
          )}
          {state.status === 'fallback' && <FallbackCard />}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: FAQ section**

`apps/web/components/marketing/faq-section.tsx`:

```tsx
const FAQS = [
  {
    q: 'Is there a free way to use SurfGen?',
    a: 'Yes — two. Create an account on the hosted studio and start on the free tier, or self-host the entire open-source platform on your own hardware. The default self-host configuration runs on local providers only (Piper TTS, FFmpeg rendering) and needs no API keys at all.',
  },
  {
    q: 'What is the difference between the hosted studio and self-hosting?',
    a: 'Same code, different operator. The hosted studio is our managed deployment: we run the GPU workers, storage, and upgrades, and you pay a subscription. Self-hosting gives you the identical platform under the Apache-2.0 license — you bring the infrastructure.',
  },
  {
    q: 'Can I bring my own AI provider keys?',
    a: 'Yes. Every capability — voice, avatar, translation, rendering — resolves through a provider registry driven by configuration. Point a capability at your own ElevenLabs, OpenAI, or local model endpoint and the pipeline uses it; application code never names a vendor.',
  },
  {
    q: 'Who owns the videos I generate?',
    a: 'You do. Your scripts, voices, avatars, and rendered videos belong to you. Outputs are stored under your workspace and served through signed URLs only you control, and you can export or delete them at any time.',
  },
  {
    q: 'Can I cancel my subscription anytime?',
    a: 'Yes. Billing runs on monthly or annual cycles through Paystack; cancel from the billing page and your plan simply does not renew. Your projects remain exportable after cancellation.',
  },
  {
    q: 'What languages does SurfGen support?',
    a: 'Scripts can be written or generated in any language your chosen text provider supports, and the translation capability re-voices and re-subtitles a finished video into new languages without re-recording anything.',
  },
];

export function FaqSection() {
  return (
    <section id="faq" aria-labelledby="faq-heading" className="py-24">
      <div className="mx-auto w-full max-w-3xl px-5">
        <h2
          id="faq-heading"
          className="text-center font-display text-[clamp(1.9rem,1.4rem+2vw,3rem)] font-extrabold tracking-tight text-ink"
        >
          Questions, answered.
        </h2>
        <div className="mt-12 space-y-3">
          {FAQS.map((faq) => (
            <details
              key={faq.q}
              className="group rounded-2xl border border-line bg-card px-6 transition-colors open:border-primary/40"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 font-display text-[15px] font-bold text-ink [&::-webkit-details-marker]:hidden">
                {faq.q}
                <span className="text-xl font-light text-bronze transition-transform duration-200 group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="pb-6 text-sm leading-relaxed text-taupe">{faq.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Verify typecheck**

Run: `pnpm -C apps/web typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/marketing
git commit -m "feat(web): capabilities bento, provider strip, live pricing, FAQ"
```

---

### Task 8: Assemble the landing page + full gate

**Files:**
- Create: `apps/web/app/(marketing)/page.tsx`

**Interfaces:**
- Consumes: every marketing component from Tasks 4–7.
- Produces: public `/` route.

- [ ] **Step 1: Create the page**

`apps/web/app/(marketing)/page.tsx`:

```tsx
import { CapabilitiesBento } from '../../components/marketing/capabilities-bento';
import { FaqSection } from '../../components/marketing/faq-section';
import { Hero } from '../../components/marketing/hero';
import { PipelineSection } from '../../components/marketing/pipeline-section';
import { PricingSection } from '../../components/marketing/pricing-section';
import { ProviderStrip } from '../../components/marketing/provider-strip';

export default function LandingPage() {
  return (
    <>
      <Hero />
      <PipelineSection />
      <CapabilitiesBento />
      <ProviderStrip />
      <PricingSection />
      <FaqSection />
    </>
  );
}
```

- [ ] **Step 2: Full verification gate**

Run: `pnpm turbo build test lint typecheck`
Expected: all green, including the new web unit tests and api metadata test.

- [ ] **Step 3: Manual smoke check**

Run `pnpm -C apps/web dev` and load `http://localhost:3000/`:
- `/` renders the landing page (hero headline visible, no sidebar).
- Nav anchors scroll to sections; pricing shows the fallback card when the API is down.
- `/dashboard` redirects to `/login` when signed out (AuthGate).
- 320px viewport: no horizontal overflow.
Stop the dev server afterwards.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/app/(marketing)/page.tsx"
git commit -m "feat(web): assemble public marketing landing page at /"
```

---

### Task 9: Playwright e2e + visual screenshots (dev-only, outside the turbo gate)

**Files:**
- Modify: `apps/web/package.json` (devDependency + script)
- Create: `apps/web/playwright.config.ts`
- Create: `apps/web/e2e/landing.spec.ts`
- Modify: `apps/web/.gitignore` or create if missing (ignore `playwright-report/`, `test-results/`, `e2e/__screenshots__/`)

**Interfaces:**
- Consumes: the running dev server (`pnpm -C apps/web dev`); no API needed — specs assert the pricing fallback path.
- Produces: `pnpm -C apps/web test:e2e`. Deliberately NOT added to the turbo `test` task — browser downloads are environment-gated, same policy as the repo's k6/ZAP suites.

- [ ] **Step 1: Add dependency and script**

In `apps/web/package.json` add to `devDependencies`: `"@playwright/test": "^1.53.0"` and to `scripts`: `"test:e2e": "playwright test"`. Then:

```bash
pnpm install
pnpm -C apps/web exec playwright install chromium
```

(If the browser download is blocked in this environment, still commit the config + specs; note it in the commit body.)

- [ ] **Step 2: Config**

`apps/web/playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: { baseURL: 'http://localhost:3000' },
  webServer: {
    command: 'pnpm dev',
    port: 3000,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
```

- [ ] **Step 3: Specs**

`apps/web/e2e/landing.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

test('landing hero loads', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toContainText('studio‑quality avatar video');
});

test('nav anchor scrolls to pricing', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Main navigation' }).getByText('Pricing').click();
  await expect(page.locator('#pricing')).toBeInViewport();
});

test('pricing falls back gracefully when the API is unreachable', async ({ page }) => {
  await page.route('**/v1/billing/plans', (route) => route.abort());
  await page.goto('/');
  await expect(page.getByText('Start free today')).toBeVisible();
});

test('signed-out /dashboard redirects to login', async ({ page }) => {
  await page.goto('/dashboard');
  await page.waitForURL('**/login');
});

for (const width of [320, 768, 1440]) {
  test(`no horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `e2e/__screenshots__/landing-${width}.png`, fullPage: true });
  });
}
```

Note: the h1 assertion uses a non-breaking hyphen (`‑`, U+2011) matching `studio&#8209;quality` in the hero.

- [ ] **Step 4: Ignore artifacts**

Append to `apps/web/.gitignore` (create the file if it does not exist):

```
playwright-report/
test-results/
e2e/__screenshots__/
```

- [ ] **Step 5: Run**

Run: `pnpm -C apps/web test:e2e`
Expected: 7 tests pass (screenshots written locally). If browsers cannot be installed in this environment, mark this step skipped in the commit message.

- [ ] **Step 6: Final full gate + commit**

```bash
pnpm turbo build test lint typecheck
git add apps/web/package.json apps/web/playwright.config.ts apps/web/e2e apps/web/.gitignore pnpm-lock.yaml
git commit -m "test(web): Playwright e2e + responsive screenshots for the landing page"
```

---

## Self-Review Notes

- **Spec coverage:** routing move (Task 2), marketing shell + metadata/OG (Task 4), hero (5), pipeline (6), bento + provider strip + pricing + FAQ (7), assembly (8), unit + e2e + visual tests (3, 9). One deliberate deviation: the spec assumed `GET /v1/billing/plans` was already public — it is not (global `AuthGuard`); Task 1 adds `@Public()`, which is a decorator on an existing endpoint, not a new endpoint.
- **Type consistency:** `formatPlanPrice(amountCents, currency)` and `intervalLabel(interval)` match between Task 3 and Task 7; `useReveal<T>()` returns a ref used via `ref={ref}` in Tasks 5/7; `PublicPlans.gateway.enabled` gate matches the API response shape in `billing.service.ts:134-146`.
- **GitHub URL:** `https://github.com/BBGNSURF/SurfGen` inferred from the git user; verify the real repo slug during Task 4 and adjust in nav/footer/provider-strip/pricing-fallback if different.
