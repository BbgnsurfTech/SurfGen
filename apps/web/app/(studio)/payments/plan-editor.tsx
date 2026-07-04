'use client';

import { BadgePlus } from 'lucide-react';
import { useState } from 'react';
import { EmptyState, LoadingState } from '../../../components/ui/states';
import { useToast } from '../../../components/ui/toast';
import { useAdminPlans, useCreatePlan, useUpdatePlan } from '../../../lib/api/hooks';

const CURRENCIES = ['NGN', 'USD', 'GHS', 'ZAR', 'KES'] as const;

const formatPrice = (amountCents: number, currency: string) =>
  `${(amountCents / 100).toLocaleString()} ${currency}`;

/** Subscription plan CRUD — plans sync to Paystack when the gateway is on. */
export function PlanEditor() {
  const flash = useToast();
  const plans = useAdminPlans();
  const createPlan = useCreatePlan();
  const updatePlan = useUpdatePlan();

  const [showForm, setShowForm] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState<string>('NGN');
  const [interval, setInterval] = useState<'monthly' | 'annually'>('monthly');
  const [description, setDescription] = useState('');

  const handleCreate = () => {
    const major = Number(price);
    if (!code || !name || !Number.isFinite(major) || major <= 0) {
      flash('Code, name and a positive price are required');
      return;
    }
    createPlan.mutate(
      {
        code,
        name,
        amountCents: Math.round(major * 100),
        currency,
        interval,
        ...(description && { description }),
      },
      {
        onSuccess: () => {
          setShowForm(false);
          setCode('');
          setName('');
          setPrice('');
          setDescription('');
          flash('Plan created');
        },
        onError: (error) => flash(error.message),
      },
    );
  };

  const inputClass =
    'h-[34px] rounded-[9px] border border-line bg-shell px-2.5 text-[12px] text-primary outline-none focus:border-camel';

  return (
    <div className="rounded-2xl border border-line bg-card p-[18px] shadow-[0_1px_2px_rgba(26,26,26,.04)]">
      <div className="mb-3.5 flex items-center justify-between">
        <div>
          <div className="font-display text-sm font-bold">Subscription plans</div>
          <div className="mt-0.5 text-[10.5px] text-stone">
            Synced to Paystack automatically while the gateway is enabled
          </div>
        </div>
        <button
          onClick={() => setShowForm((value) => !value)}
          className="flex h-[34px] items-center gap-[6px] rounded-full border border-line bg-card px-4 text-[12px] font-bold text-primary"
        >
          <BadgePlus className="size-[15px]" strokeWidth={1.6} /> {showForm ? 'Cancel' : 'New plan'}
        </button>
      </div>

      {showForm && (
        <div className="mb-4 grid grid-cols-2 gap-2.5 rounded-[14px] border border-hairline bg-shell/60 p-3">
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="code (pro-monthly)" className={inputClass} />
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (Pro)" className={inputClass} />
          <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Price (major units)" inputMode="decimal" className={inputClass} />
          <select value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputClass}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            value={interval}
            onChange={(e) => setInterval(e.target.value as 'monthly' | 'annually')}
            className={inputClass}
          >
            <option value="monthly">monthly</option>
            <option value="annually">annually</option>
          </select>
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" className={inputClass} />
          <button
            onClick={handleCreate}
            disabled={createPlan.isPending}
            className="col-span-2 h-[34px] rounded-full bg-primary text-[12px] font-bold text-white disabled:opacity-60"
          >
            {createPlan.isPending ? 'Creating…' : 'Create plan'}
          </button>
        </div>
      )}

      {plans.isPending ? (
        <LoadingState label="Loading plans…" />
      ) : plans.data?.length === 0 ? (
        <EmptyState
          title="No plans yet"
          hint="Create your first plan — it syncs to Paystack automatically when the gateway is enabled."
        />
      ) : (
        <div className="flex flex-col">
          {plans.data?.map((plan) => (
            <div
              key={plan.id}
              className="flex items-center gap-3 border-t border-hairline py-2.5 first:border-t-0"
            >
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-bold text-primary">{plan.name}</div>
                <div className="truncate font-mono text-[10.5px] text-stone">{plan.code}</div>
              </div>
              <div className="text-[12px] font-semibold text-primary">
                {formatPrice(plan.amountCents, plan.currency)}
                <span className="text-stone"> / {plan.interval === 'monthly' ? 'mo' : 'yr'}</span>
              </div>
              <span
                className={`rounded-full px-[7px] py-px text-[10px] font-bold ${
                  plan.paystackPlanCode ? 'bg-success/15 text-success' : 'bg-sand text-stone'
                }`}
              >
                {plan.paystackPlanCode ? 'synced' : 'not synced'}
              </span>
              <button
                role="switch"
                aria-checked={plan.active}
                aria-label={`Toggle ${plan.name}`}
                disabled={updatePlan.isPending}
                onClick={() =>
                  updatePlan.mutate(
                    { planId: plan.id, active: !plan.active },
                    { onError: (error) => flash(error.message) },
                  )
                }
                className={`relative h-[22px] w-[38px] flex-none rounded-full transition-colors ${
                  plan.active ? 'bg-primary' : 'bg-sand'
                }`}
              >
                <span
                  className={`absolute top-0.5 size-[18px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,.3)] transition-[left] ${
                    plan.active ? 'left-[18px]' : 'left-0.5'
                  }`}
                />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
