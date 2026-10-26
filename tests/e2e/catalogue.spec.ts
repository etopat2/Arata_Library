import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import dotenv from 'dotenv';
import pg from 'pg';
import { csrfToken, tokenHash } from '../../apps/api/src/identity/security.js';

const local = dotenv.parse(readFileSync(process.env.ARATA_ENV_FILE ?? '.env.local', 'utf8'));
const foundation = dotenv.parse(readFileSync('.env.foundation.local', 'utf8'));

test('navigates real published series, edition and sample from the catalogue', async ({ page }) => {
  await page.goto('/?screen=catalogue');
  await expect(page.getByRole('heading', { name: 'Books and series catalogue' })).toBeVisible();
  await page
    .getByRole('link', { name: /\[DEV SAMPLE\] Web Engineering Series/i })
    .first()
    .click();
  await expect(
    page.getByRole('heading', { name: '[DEV SAMPLE] Web Engineering Series' }),
  ).toBeVisible();
  await page.getByRole('link', { name: /browse chapters/i }).click();
  await expect(page.getByRole('heading', { name: 'Table of contents' })).toBeVisible();
  await page.getByRole('link', { name: /read free sample/i }).click();
  await expect(
    page.getByText(/synthetic chapter preview contains no production manuscript/i),
  ).toBeVisible();
});

test('opens an accessible public lesson in the reader with permissions and themes', async ({
  page,
}) => {
  await page.goto('/?screen=catalogue');
  await page
    .getByRole('link', { name: /\[DEV SAMPLE\] Reader Series/i })
    .first()
    .click();
  await page.getByRole('link', { name: /browse chapters/i }).click();
  await page.getByRole('link', { name: 'Open digital reader' }).click();
  await expect(page.getByRole('navigation', { name: 'Table of contents' })).toBeVisible();
  await expect(page.getByRole('main')).toContainText('[DEV SAMPLE]');
  await page.getByText('Content permissions').click();
  await expect(
    page.getByText(
      'Browser controls cannot block operating system screenshots or copying of content already displayed.',
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByLabel('Theme').selectOption('night');
  await expect(page.locator('.bg-slate-950').first()).toBeVisible();
  await page.getByLabel('Text size').selectOption('21');
  await page.getByLabel('Font family').selectOption('serif');
  await page.getByLabel('Line spacing').selectOption('2');
  await page.getByLabel('Reduce motion').check();
  await page.reload();
  await expect(page.getByLabel('Theme')).toHaveValue('night');
  await expect(page.getByLabel('Text size')).toHaveValue('21');
  await expect(page.getByLabel('Font family')).toHaveValue('serif');
  await expect(page.getByLabel('Line spacing')).toHaveValue('2');
  await expect(page.getByLabel('Reduce motion')).toBeChecked();
  await expect(page.locator('article[aria-label="Lesson content"]')).toHaveCSS(
    'font-family',
    /Georgia/,
  );
  await expect(page.locator('article[aria-label="Lesson content"]')).toHaveAttribute(
    'style',
    /line-height: 2/,
  );
  await expect(page.locator('.reader-reduced-motion')).toBeVisible();
  const audit = await new AxeBuilder({ page }).analyze();
  expect(audit.violations).toEqual([]);
});

test('restores signed-in reader settings from the account on a fresh device state', async ({
  page,
}) => {
  if (
    !local.MIGRATION_DATABASE_URL ||
    new URL(local.MIGRATION_DATABASE_URL).pathname !== '/arata_techlibrary_dev'
  )
    throw new Error('Account reader browser test requires the isolated development database');
  const secret = process.env.AUTH_SESSION_SECRET ?? foundation.AUTH_SESSION_SECRET;
  if (!secret) throw new Error('Session signing key needed');
  const db = new pg.Client({ connectionString: local.MIGRATION_DATABASE_URL });
  const userId = randomUUID();
  const token = randomBytes(36).toString('base64url');
  await db.connect();
  try {
    await db.query(
      `INSERT INTO app."User" (id,email,status,"emailVerifiedAt","termsAcceptedAt","privacyVersion","createdAt","updatedAt")
       VALUES ($1,$2,'ACTIVE',now(),now(),'TEST-ONLY',now(),now())`,
      [userId, `reader-browser-${userId}@example.invalid`],
    );
    await db.query(
      `INSERT INTO app."AuthSession" (id,"userId","tokenHash","expiresAt")
       VALUES (gen_random_uuid(),$1,$2,now()+interval '1 hour')`,
      [userId, tokenHash(token)],
    );
    await page.context().addCookies([
      { name: 'arata_session', value: token, url: 'http://127.0.0.1:5188' },
      { name: 'arata_csrf', value: csrfToken(token, secret), url: 'http://127.0.0.1:5188' },
    ]);
    await page.goto('/?screen=catalogue');
    await page
      .getByRole('link', { name: /\[DEV SAMPLE\] Reader Series/i })
      .first()
      .click();
    await page.getByRole('link', { name: /browse chapters/i }).click();
    await page.getByRole('link', { name: 'Open digital reader' }).click();
    await expect(page.getByLabel('Theme')).toBeVisible();
    await page.getByLabel('Theme').selectOption('night');
    await page.getByLabel('Text size').selectOption('21');
    await page.getByLabel('Font family').selectOption('serif');
    await page.getByLabel('Line spacing').selectOption('2');
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/reader/settings') &&
        response.request().method() === 'PUT' &&
        response.request().postDataJSON()?.reducedMotion === true &&
        response.status() === 200,
    );
    await page.getByLabel('Reduce motion').check();
    await saved;
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.getByLabel('Theme')).toHaveValue('night');
    await expect(page.getByLabel('Text size')).toHaveValue('21');
    await expect(page.getByLabel('Font family')).toHaveValue('serif');
    await expect(page.getByLabel('Line spacing')).toHaveValue('2');
    await expect(page.getByLabel('Reduce motion')).toBeChecked();
    const row = await db.query<{ theme: string; fontSize: number }>(
      `SELECT theme,"fontSize" FROM app."ReaderPreference" WHERE "userId"=$1`,
      [userId],
    );
    expect(row.rows).toEqual([{ theme: 'night', fontSize: 21 }]);
  } finally {
    await db.query(`DELETE FROM app."User" WHERE id=$1`, [userId]);
    await db.end();
  }
});

test('searches real records and keeps premium body text out of public responses', async ({
  page,
  request,
}) => {
  await page.goto('/?screen=search');
  await page.getByRole('searchbox', { name: 'Search books and resources' }).fill('Web Engineering');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(
    page.getByRole('link', { name: /\[DEV SAMPLE\] Web Engineering Series/i }).first(),
  ).toBeVisible();
  const premium = await request.get(
    '/api/v1/catalogue/search?q=DEV_PREMIUM_SECRET_EXERCISE_CONTENT',
  );
  expect(premium.ok()).toBeTruthy();
  expect(await premium.text()).not.toContain('DEV_PREMIUM_SECRET_EXERCISE_CONTENT');
});

test('filters standalone books and forthcoming releases using live catalogue records', async ({
  page,
}) => {
  await page.goto('/?screen=catalogue');
  await page.getByLabel('Publication type').selectOption('STANDALONE');
  await page.getByLabel('Status').selectOption('PUBLISHED');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(
    page.getByRole('link', { name: /\[DEV SAMPLE\] Accessible Web Basics/i }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: /\[DEV SAMPLE\] Web Engineering Series/i }),
  ).toHaveCount(0);

  await page.getByLabel('Status').selectOption('FORTHCOMING');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(
    page.getByRole('link', { name: /\[DEV SAMPLE\] Future Technology Book/i }),
  ).toBeVisible();
  await expect(
    page
      .getByRole('article')
      .filter({ hasText: '[DEV SAMPLE] Future Technology Book' })
      .getByText('Forthcoming', { exact: true }),
  ).toBeVisible();
});

test('opens public-free text anonymously and shows registered-free access truthfully', async ({
  page,
}) => {
  await page.goto('/?screen=free-library');
  await expect(
    page.getByRole('link', { name: /\[DEV SAMPLE\] Open Web Checklist/i }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: /\[DEV SAMPLE\] Premium Exercise Guide/i }),
  ).toHaveCount(0);
  await page.goto('/?screen=free-library&access=PUBLIC_FREE');
  await page
    .getByRole('link', { name: /\[DEV SAMPLE\] Open Web Checklist/i })
    .first()
    .click();
  await expect(
    page.getByRole('heading', { name: '[DEV SAMPLE] Open Web Checklist' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Open resource' }).click();
  await expect(page.getByText(/Check headings, labels, keyboard focus/i)).toBeVisible();
  await page.goto('/?screen=free-library&access=REGISTERED_FREE');
  await page
    .getByRole('link', { name: /\[DEV SAMPLE\] Registered Study Notes/i })
    .first()
    .click();
  await page.getByRole('button', { name: 'Open resource' }).click();
  await expect(page.getByRole('alert')).toContainText('Sign in to open');
});

test('works at phone, tablet and desktop widths with accessible navigation and SEO metadata', async ({
  page,
  request,
}) => {
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: /knowledge that moves with you/i }),
    ).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    if (width < 768) {
      await page.getByText('Browse library').click();
      await expect(
        page
          .getByRole('navigation', { name: 'Mobile' })
          .getByRole('link', { name: 'Books and series' }),
      ).toBeVisible();
    } else {
      await expect(
        page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Books' }),
      ).toBeVisible();
    }
  }
  const accessibility = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  for (const path of [
    '/?screen=catalogue',
    '/?screen=free-library',
    '/?screen=series-detail&slug=dev-published-series',
  ]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(result.violations).toEqual([]);
  }
  const share = await request.get('/api/v1/share/publications/dev-published-series');
  expect(share.ok()).toBeTruthy();
  expect(await share.text()).toContain('property="og:title"');
  await page.goto('/?screen=series-detail&slug=dev-published-series');
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
    'content',
    /Web Engineering Series/,
  );
});
