'use client';

import { Check } from 'lucide-react';
import { EmptyState, LoadingState } from '../../../components/ui/states';
import { useToast } from '../../../components/ui/toast';
import { useBillingPlans, useCheckout, useOrgSubscription } from '../../../lib/api/hooks';

const formatPrice = (amountCents: number, currency: string) =>
  `${(amountCents / 100).toLocaleString()} ${currency}`;

const STATUS_DOT: Record<string, string> = {
  active: 'bg-success',
  trialing: 'bg-camel',
  past_due: 'bg-danger',
  canceled: 'bg-stone',
};

export default function BillingPage() {
  const flash = useToast();
  const plans = useBillingPlans();
  const subscription = useOrgSubscription();
  const checkout = useCheckout();

  const handleSubscribe = (planId: string) => {
    checkout.mutate(
      { planId },
      {
        onSuccess: ({ data }) => {
          window.location.href = data.authorizationUrl;
        },
        onError: (error) => flash(error.message),
      },
    );
  };

  const current = subscription.data;

  return (
    <div className="sg-fade px-8 pt-6 pb-12">
      <div className="mb-[18px]">
        <div className="font-display text-[15px] font-bold">Billing</div>
        <div className="mt-0.5 text-[12.5px] text-taupe">
          Choose the plan that fits your team — payments are processed securely by Paystack
        </div>
      </div>

      {current?.plan && (
        <div className="mb-4 flex items-center gap-2.5 rounded-2xl border border-line bg-card px-[18px] py-3">
          <span className={`size-[7px] rounded-full ${STATUS_DOT[current.status ?? ''] ?? 'bg-stone'}`} />
          <span className="text-[12.5px] font-bold text-primary">
            Current plan: <span className="font-mono">{current.plan}</span>
          </span>
          <span className="text-[11.5px] text-stone">
            {current.status}
            {current.currentPeriodEnd &&
              ` · renews ${new Date(current.currentPeriodEnd).toLocaleDateString()}`}
          </span>
        </div>
      )}

      {plans.isPending ? (
        <LoadingState label="Loading plans…" />
      ) : !plans.data || plans.data.plans.length === 0 ? (
        <EmptyState
          title="No plans are available yet"
          hint="An administrator can create subscription plans under Payments."
        />
      ) : !plans.data.gateway.enabled ? (
        <EmptyState
          title="Payments are not enabled"
          hint="An administrator can enable the Paystack gateway under Payments."
        />
      ) : (
        <div className="grid grid-cols-3 gap-4 max-lg:grid-cols-1">
          {plans.data.plans.map((plan) => {
            const isCurrent = current?.plan === plan.code && current?.status === 'active';
            return (
              <div
                key={plan.id}
                className="flex flex-col rounded-2xl border border-line bg-card p-[18px] shadow-[0_1px_2px_rgba(26,26,26,.04)]"
              >
                <div className="font-display text-sm font-bold">{plan.name}</div>
                <div className="mt-2">
                  <span className="font-display text-[22px] font-extrabold text-primary">
                    {formatPrice(plan.amountCents, plan.currency)}
                  </span>
                  <span className="text-[11.5px] text-stone">
                    {' '}
                    / {plan.interval === 'monthly' ? 'mo' : 'yr'}
                  </span>
                </div>
                {plan.description && (
                  <div className="mt-2 text-xs leading-normal text-taupe">{plan.description}</div>
                )}
                {plan.features.length > 0 && (
                  <ul className="mt-3 flex flex-col gap-1.5">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-center gap-1.5 text-[11.5px] text-primary">
                        <Check className="size-[13px] text-success" strokeWidth={2.2} /> {feature}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-auto pt-4">
                  {isCurrent ? (
                    <span className="inline-flex h-[34px] items-center rounded-full bg-success/15 px-4 text-[12px] font-bold text-success">
                      Current plan
                    </span>
                  ) : (
                    <button
                      onClick={() => handleSubscribe(plan.id)}
                      disabled={checkout.isPending}
                      className="h-[34px] w-full rounded-full bg-primary text-[12px] font-bold text-white disabled:opacity-60"
                    >
                      {checkout.isPending ? 'Redirecting…' : 'Subscribe'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
