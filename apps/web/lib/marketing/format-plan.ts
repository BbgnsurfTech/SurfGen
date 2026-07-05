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
      minimumFractionDigits: wholeUnit ? 0 : 2,
      maximumFractionDigits: wholeUnit ? 0 : 2,
    })
      .format(major)
      .replace(/[  ]/g, ' ');
  } catch {
    return `${currency} ${new Intl.NumberFormat('en').format(major)}`;
  }
}

export function intervalLabel(interval: BillingPlan['interval']): string {
  return interval === 'monthly' ? '/month' : '/year';
}
