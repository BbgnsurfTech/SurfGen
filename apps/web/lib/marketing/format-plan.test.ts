import { describe, expect, test } from 'vitest';
import { formatPlanPrice, intervalLabel } from './format-plan';

describe('formatPlanPrice', () => {
  test('converts Paystack subunits to whole major units without decimals', () => {
    // Arrange: 500000 kobo = 5,000 naira
    // Act
    const price = formatPlanPrice(500000, 'NGN');
    // Assert
    expect(price).toBe('NGN 5,000');
  });

  test('keeps decimals when the amount is not a whole major unit', () => {
    expect(formatPlanPrice(12550, 'USD')).toBe('$125.50');
  });

  test('renders zero as a plain zero price', () => {
    expect(formatPlanPrice(0, 'NGN')).toBe('NGN 0');
  });

  test('falls back for malformed currency codes that Intl rejects', () => {
    expect(formatPlanPrice(500000, '!!')).toBe('!! 5,000');
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
