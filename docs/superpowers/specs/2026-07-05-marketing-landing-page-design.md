# SurfGen Marketing Landing Page — Design Spec

**Date:** 2026-07-05
**Status:** Approved by user (positioning, routing, pricing source, and treatment each confirmed)

## Purpose

Give SurfGen a public marketing surface that sells the **hosted SaaS product**. Primary
conversion goal: visitors click **Start free** → `/signup`. Open source is a trust signal,
not the headline offer.

Today `apps/web` has no marketing surface: root `/` renders the auth-gated studio dashboard
and the only public routes are `/login`, `/signup`, `/verify-email`.

## Decisions (user-approved)

| Decision | Choice |
|----------|--------|
| Positioning | Hosted SaaS product; open source as trust signal |
| Routing | Landing page at `/`; studio dashboard moves to `/dashboard` |
| Pricing data | Live plans from public `GET /v1/billing/plans`, graceful fallback |
| Treatment | Editorial scrolly — warm paper-first palette, scroll-driven pipeline section |

## Architecture

### Routing

- New route group `apps/web/app/(marketing)/` with:
  - `layout.tsx` — marketing shell (nav + footer), page `metadata` (title, description,
    OpenGraph using `docs/assets/surfgen-banner.webp` copied into `apps/web/public/og.webp`).
  - `page.tsx` — the landing page at `/`.
- Studio dashboard moves: `app/(studio)/page.tsx` → `app/(studio)/dashboard/page.tsx`.
  - Update: sidebar home link, post-login redirect target, any `router.push('/')` /
    `redirect('/')` / `<Link href="/">` inside the studio shell that mean "dashboard".
  - The `(studio)` layout (auth gate + sidebar) continues to wrap `/dashboard` unchanged.
- Signed-in detection on the landing page: client-side `ensureSession()` (existing silent
  refresh). On success the nav CTA pair "Sign in / Start free" swaps to a single
  "Open Studio" → `/dashboard`. No server redirects at `/`.

### Components (`apps/web/components/marketing/`)

| Component | Responsibility |
|-----------|----------------|
| `MarketingNav` | Sticky translucent nav: logo, anchor links (Product, Pipeline, Capabilities, Pricing, FAQ), GitHub link, auth-aware CTA. |
| `Hero` | Oversized display headline, subhead, CTAs (`/signup`, `#pipeline`), CSS-built stylized studio-frame visual (no screenshots). |
| `PipelineSection` | Sticky scroll-driven walkthrough of the real pipeline stages: script → voice → avatar → render. IntersectionObserver advances stage highlight. |
| `CapabilitiesBento` | Asymmetric bento grid of the 15 capabilities; avatars/talking-photos/voice-cloning as large tiles. |
| `ProviderStrip` | "No application code ever names a vendor" — YAML swap visual (ElevenLabs ↔ Piper), links to GitHub. |
| `PricingSection` | Client component; fetches `GET /v1/billing/plans`; renders plan cards with formatted currency; CTA → `/signup`. Fallback card ("Start free / self-host") on error or empty list. |
| `FaqSection` | Semantic `<details>/<summary>` accordion; 5–7 questions (pricing, self-host, providers, data, cancellation). |
| `MarketingFooter` | Dark ink panel: logo, product/resource/legal columns, GitHub. |

### Utilities & hooks

- `apps/web/lib/marketing/format-plan.ts` — pure functions: minor-units → display price
  (Paystack amounts are subunits, e.g. kobo), interval label, plan sorting. Unit tested.
- `apps/web/components/marketing/use-reveal.ts` — IntersectionObserver reveal hook;
  no-ops under `prefers-reduced-motion`.

## Visual direction

Editorial scrolly built entirely from the existing token system in `app/globals.css`:
paper `#FAF7F3` base, cream/card surfaces, bronze/camel accents, dark ink footer,
Plus Jakarta Sans display / Manrope body / JetBrains Mono for the YAML snippet,
pill radius 999px, cards 16px, lucide icons stroke 1.6.

Anti-template requirements satisfied via: scale-contrast display typography, asymmetric
bento composition, scroll-driven pipeline section, semantic color use (status greens/ambers
only for meaning), designed hover/focus states, intentional section rhythm (no uniform
padding).

## Motion & performance

- No animation library. CSS transitions/keyframes on `transform`/`opacity` only.
- `useReveal` + CSS classes for entrance; pipeline progress via IntersectionObserver.
- All motion disabled under `prefers-reduced-motion: reduce`.
- Images: explicit dimensions; hero visual is CSS (no LCP image penalty); OG image only
  for social. Budgets: landing JS < 150kb gzipped (no new deps), CSS < 30kb.
- Semantic HTML: `<header>/<nav>/<main>/<section aria-labelledby>/<footer>`.

## Error handling

- Pricing fetch: `try/catch` + empty-list check → fallback card; the page never blanks.
- `ensureSession` failure → treat as signed out (existing behavior).
- API base URL from existing `NEXT_PUBLIC_API_URL` plumbing in `lib/api/`.

## Testing

1. **Unit** — `format-plan.ts`: subunit→display conversion, zero/undefined amounts,
   interval labels, sort order. AAA structure.
2. **E2E (Playwright)** — landing hero loads (`h1` visible); nav anchor scrolls; pricing
   renders fallback when API unreachable; `/dashboard` serves the moved studio dashboard
   behind auth; `/signup` reachable from hero CTA.
3. **Visual** — screenshots at 320 / 768 / 1440; no horizontal overflow.
4. Existing gate: `pnpm turbo build test lint typecheck` stays green.

## Out of scope

- Blog, docs site, changelog pages.
- A/B testing, analytics wiring.
- New backend endpoints (billing plans endpoint already exists and is public).
- apps/admin or any studio UI changes beyond the dashboard route move.
