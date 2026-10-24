import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import dotenv from 'dotenv';
import pg from 'pg';
import { csrfToken, tokenHash } from '../../apps/api/src/identity/security.js';

const env = dotenv.parse(readFileSync(process.env.ARATA_ENV_FILE ?? '.env.local', 'utf8'));
const foundation = dotenv.parse(readFileSync('.env.foundation.local', 'utf8'));
if (!env.TEST_DATABASE_URL || new URL(env.TEST_DATABASE_URL).pathname !== '/arata_techlibrary_test')
  throw new Error('Studio browser test requires isolated test database');
const suffix = randomUUID().slice(0, 8);
const token = randomBytes(36).toString('base64url');
let collectionTitle: string;

test.beforeAll(async () => {
  const client = new pg.Client({ connectionString: env.TEST_DATABASE_URL });
  await client.connect();
  try {
    const user = (
      await client.query<{ id: string }>(
        `INSERT INTO app."User" (id,email,status,"emailVerifiedAt","termsAcceptedAt","privacyVersion","createdAt","updatedAt") VALUES (gen_random_uuid(),$1,'ACTIVE',now(),now(),'TEST-ONLY',now(),now()) RETURNING id`,
        [`studio-browser-${suffix}@example.invalid`],
      )
    ).rows[0]!;
    await client.query(
      `INSERT INTO app."AuthSession" (id,"userId","tokenHash","expiresAt") VALUES (gen_random_uuid(),$1,$2,now()+interval '1 hour')`,
      [user.id, tokenHash(token)],
    );
    await client.query(
      `INSERT INTO app."RoleAssignment" (id,"userId","roleId","scopeType") VALUES (gen_random_uuid(),$1,(SELECT id FROM app."Role" WHERE code='AUTHOR'),'PLATFORM')`,
      [user.id],
    );
    collectionTitle = `[TEST] Studio browser ${suffix}`;
    await client.query(
      `INSERT INTO app."Collection" (id,"libraryId",slug,title) VALUES (gen_random_uuid(),(SELECT id FROM app."Library" WHERE slug='arata-techlibrary'),$1,$2)`,
      [`studio-browser-${suffix}`, collectionTitle],
    );
  } finally {
    await client.end();
  }
});

test('uses the hierarchical Studio to create a persistent standalone draft', async ({ page }) => {
  const secret = process.env.AUTH_SESSION_SECRET ?? foundation.AUTH_SESSION_SECRET;
  if (!secret) throw new Error('Session signing key needed');
  await page.context().addCookies([
    { name: 'arata_session', value: token, url: 'http://127.0.0.1:5187' },
    { name: 'arata_csrf', value: csrfToken(token, secret), url: 'http://127.0.0.1:5187' },
  ]);
  await page.goto('/?screen=studio');
  await expect(page.getByRole('heading', { name: 'Publishing Studio' })).toBeVisible();
  await page.getByRole('button', { name: collectionTitle }).click();
  await expect(page.getByRole('heading', { name: 'New publication' })).toBeVisible();
  await page.getByLabel('Title', { exact: true }).fill(`[TEST] Browser publication ${suffix}`);
  await page.getByLabel('Slug', { exact: true }).fill(`studio-browser-book-${suffix}`);
  await page.getByLabel('Licence code').fill('TEST-ONLY');
  await page.getByLabel('Content source reference').fill('TEST-SOURCE');
  await page.getByLabel('Copyright notice').fill('[TEST] Synthetic rights');
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page.getByRole('status')).toContainText('Draft publication created');
  await page.getByRole('button', { name: `[TEST] Browser publication ${suffix}` }).click();
  await expect(page.getByRole('heading', { name: 'Publication metadata' })).toBeVisible();
  await expect(page.getByText('DRAFT', { exact: true })).toBeVisible();
  const client = new pg.Client({ connectionString: env.TEST_DATABASE_URL });
  await client.connect();
  try {
    const rows = await client.query(`SELECT id FROM app."Publication" WHERE slug=$1`, [
      `studio-browser-book-${suffix}`,
    ]);
    expect(rows.rowCount).toBe(1);
  } finally {
    await client.end();
  }
  const accessibility = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await page.screenshot({ path: '.tmp/studio-browser.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: 'Publishing Studio' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: '.tmp/studio-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Arata TechLibrary' }).click();
  const uncategorised = page
    .getByRole('heading', { name: 'New uncategorised publication' })
    .locator('..');
  await uncategorised.getByLabel('Title', { exact: true }).fill(`[TEST] Uncategorised ${suffix}`);
  await uncategorised.getByLabel('Slug', { exact: true }).fill(`uncategorised-${suffix}`);
  await uncategorised.getByLabel('Licence code').fill('TEST-ONLY');
  await uncategorised.getByLabel('Content source reference').fill('TEST-SOURCE');
  await uncategorised.getByLabel('Copyright notice').fill('[TEST] Synthetic rights');
  await uncategorised.getByRole('button', { name: 'Create draft' }).click();
  await expect(page.getByRole('status')).toContainText('Draft publication created');
  await expect(page.getByText('Uncategorised', { exact: true })).toBeVisible();
  const verify = new pg.Client({ connectionString: env.TEST_DATABASE_URL });
  await verify.connect();
  try {
    const memberships = await verify.query(
      `SELECT pc."collectionId" FROM app."Publication" p LEFT JOIN app."PublicationCollection" pc ON pc."publicationId"=p.id WHERE p.slug=$1`,
      [`uncategorised-${suffix}`],
    );
    expect(memberships.rows).toEqual([{ collectionId: null }]);
  } finally {
    await verify.end();
  }
});
