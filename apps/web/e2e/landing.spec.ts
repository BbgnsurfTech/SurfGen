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

test('hero CTA reaches signup', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Start creating free' }).click();
  await page.waitForURL('**/signup');
  await expect(page.getByText('Create your account')).toBeVisible();
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
