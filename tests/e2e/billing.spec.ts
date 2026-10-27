import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('public pricing keeps free access visible while unapproved paid plans stay closed', async ({
  page,
}) => {
  await page.goto('/?screen=pricing');
  await expect(page.getByRole('heading', { name: 'Free access' })).toBeVisible();
  await expect(
    page.getByText('Paid plans are not available while pricing and terms await approval.'),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Browse free resources' })).toHaveAttribute(
    'href',
    '/?screen=free-library',
  );
  const findings = await new AxeBuilder({ page }).analyze();
  expect(findings.violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Free access' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('checkout cannot create an order for an unavailable plan', async ({ page }) => {
  await page.goto('/?screen=checkout&plan=00000000-0000-0000-0000-000000000000');
  await expect(page.getByRole('alert')).toContainText('This plan is not currently available');
  await expect(page.getByRole('link', { name: 'See plans' })).toBeVisible();
});

test('billing history requires a verified account', async ({ page }) => {
  await page.goto('/?screen=my-subscription');
  await expect(page.getByRole('alert')).toContainText('Sign in with a verified account');
  await page.goto('/?screen=invoices');
  await expect(page.getByRole('alert')).toContainText('Sign in with a verified account');
  await page.goto('/?screen=finance-dashboard');
  await expect(page.getByRole('alert')).toContainText('Sign in with a verified account');
});
