import { test, expect } from '@playwright/test';

test('renders the development shell and API status', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /a home for technology books/i })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('API available');
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await expect(page.locator('[data-theme="light"]')).toBeVisible();
  const contrast = await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('[data-theme="light"]')!;
    const channel = (value: string) =>
      value
        .match(/[\d.]+/g)!
        .slice(0, 3)
        .map(Number)
        .map((number) => {
          const normalized = number / 255;
          return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
        });
    const luminance = (value: string) => {
      const [red = 0, green = 0, blue = 0] = channel(value);
      return red * 0.2126 + green * 0.7152 + blue * 0.0722;
    };
    const background = luminance(getComputedStyle(root).backgroundColor);
    return Math.min(
      ...Array.from(root.querySelectorAll<HTMLElement>('main > p'), (paragraph) => {
        const foreground = luminance(getComputedStyle(paragraph).color);
        return (
          (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
        );
      }),
    );
  });
  expect(contrast).toBeGreaterThanOrEqual(4.5);
});

test('built PWA installs its service worker and loads its shell offline', async ({
  page,
  context,
}) => {
  await page.goto('/');
  const manifest = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(manifest).toBe('/manifest.webmanifest');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: /a home for technology books/i })).toBeVisible();
  await context.setOffline(false);
});

test('account screens expose recovery and guard registration until approved policies are configured', async ({
  page,
}) => {
  await page.goto('/?screen=register');
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create account' })).toBeDisabled();
  await expect(
    page.getByText('Registration awaits approved terms and privacy notices.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'recovery' }).click();
  await expect(page.getByRole('heading', { name: 'Recover account access' })).toBeVisible();
  await page.getByRole('button', { name: 'login' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in to your library' })).toBeVisible();
});
