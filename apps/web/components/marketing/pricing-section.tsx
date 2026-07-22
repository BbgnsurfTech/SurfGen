'use client';

import { Check } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api/client';
import type { BillingPlan, PublicPlans } from '../../lib/api/types';
import { formatPlanPrice, intervalLabel } from '../../lib/marketing/format-plan';
import { GITHUB_REPO_URL } from '@/lib/marketing/links';

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
          href={GITHUB_REPO_URL}
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
