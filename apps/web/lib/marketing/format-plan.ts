import type { BillingPlan } from '../api/types';

/**
 * Paystack stores amounts in subunits (kobo, cents). Display in major units,
 * dropping ".00" on whole amounts. Malformed currency codes (Intl throws
 * RangeError) degrade to "CODE 5,000" rather than crashing the pricing section.
 * Intl separates code and amount with U+00A0 (or U+202F on some ICU builds);
 * normalize to plain spaces so output is stable to assert and copy.
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
      .replace(/[\u00a0\u202f]/g, ' ');
  } catch {
    return `${currency} ${new Intl.NumberFormat('en').format(major)}`;
  }
}

export function intervalLabel(interval: BillingPlan['interval']): string {
  return interval === 'monthly' ? '/month' : '/year';
}
