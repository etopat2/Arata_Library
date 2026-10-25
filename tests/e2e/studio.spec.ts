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
    await client.query(
      `INSERT INTO app."RoleAssignment" (id,"userId","roleId","scopeType") VALUES (gen_random_uuid(),$1,(SELECT id FROM app."Role" WHERE code='PUBLISHER'),'PLATFORM')`,
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
  const metadataForm = page.getByRole('heading', { name: 'Edit draft metadata' }).locator('..');
  await metadataForm.getByLabel('Subtitle').fill('[TEST] Editable subtitle');
  await metadataForm.getByLabel('Subject').fill('Computer systems');
  await metadataForm.getByRole('button', { name: 'Save metadata' }).click();
  await expect(page.getByRole('status')).toContainText('Publication metadata saved');
  const client = new pg.Client({ connectionString: env.TEST_DATABASE_URL });
  await client.connect();
  let browserPublicationId = '';
  let browserRevisionId = '';
  const browserEditionIds: string[] = [];
  const browserChapterIds: string[] = [];
  try {
    const rows = await client.query<{ id: string; subtitle: string; subject: string }>(
      `SELECT id,subtitle,subject FROM app."Publication" WHERE slug=$1`,
      [`studio-browser-book-${suffix}`],
    );
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0]!.subtitle).toBe('[TEST] Editable subtitle');
    expect(rows.rows[0]!.subject).toBe('Computer systems');
    const publicationId = rows.rows[0]!.id;
    browserPublicationId = publicationId;
    const edition = await client.query<{ id: string }>(
      `INSERT INTO app."Edition" (id,"publicationId","editionCode",label,"isDefault") VALUES (gen_random_uuid(),$1,'1',$2,true) RETURNING id`,
      [publicationId, `[TEST] Browser edition ${suffix}`],
    );
    browserEditionIds.push(edition.rows[0]!.id);
    const laterEdition = await client.query<{ id: string }>(
      `INSERT INTO app."Edition" (id,"publicationId",ordinal,"editionCode",label) VALUES (gen_random_uuid(),$1,2,'2',$2) RETURNING id`,
      [publicationId, `[TEST] Later edition ${suffix}`],
    );
    browserEditionIds.push(laterEdition.rows[0]!.id);
    const revision = await client.query<{ id: string }>(
      `INSERT INTO app."Revision" (id,"editionId",number,status) VALUES (gen_random_uuid(),$1,1,'DRAFT') RETURNING id`,
      [edition.rows[0]!.id],
    );
    browserRevisionId = revision.rows[0]!.id;
    for (const [ordinal, title] of [
      [2, 'Alpha'],
      [7, 'Beta'],
    ] as const) {
      const chapter = await client.query<{ id: string }>(
        `INSERT INTO app."Chapter" (id,"revisionId",ordinal,slug,title) VALUES (gen_random_uuid(),$1,$2,$3,$4) RETURNING id`,
        [browserRevisionId, ordinal, title.toLowerCase(), title],
      );
      browserChapterIds.push(chapter.rows[0]!.id);
    }
  } finally {
    await client.end();
  }
  await page.reload();
  await page.getByRole('button', { name: `[TEST] Browser publication ${suffix}` }).click();
  await expect(page.getByRole('heading', { name: 'Edition order' })).toBeVisible();
  await page.getByRole('button', { name: `Move [TEST] Later edition ${suffix} up` }).click();
  await expect(page.getByRole('status')).toContainText('Edition order saved');
  await page
    .getByRole('button', { name: `1. [TEST] Later edition ${suffix}`, exact: true })
    .click();
  const defaultForm = page.getByRole('heading', { name: 'Set default edition' }).locator('..');
  await defaultForm.getByLabel('Reason').fill('[TEST] Switch the default edition');
  await defaultForm.getByLabel('Confirm default edition change').check();
  await defaultForm.getByRole('button', { name: 'Set as default' }).click();
  await expect(page.getByRole('status')).toContainText('Default edition changed');
  const editionNode = page.getByRole('button', {
    name: `2. [TEST] Browser edition ${suffix}`,
    exact: true,
  });
  await editionNode.click();
  await editionNode.locator('..').getByRole('button', { name: 'Revision 1 · DRAFT' }).click();
  await expect(page.getByRole('heading', { name: 'Chapter order' })).toBeVisible();
  await page.getByRole('button', { name: 'Move Beta up' }).click();
  await expect(page.getByRole('status')).toContainText('Chapter order saved');
  const ordered = new pg.Client({ connectionString: env.TEST_DATABASE_URL });
  await ordered.connect();
  try {
    const editions = await ordered.query<{ id: string; ordinal: number; isDefault: boolean }>(
      `SELECT id,ordinal,"isDefault" FROM app."Edition" WHERE "publicationId"=$1 ORDER BY ordinal`,
      [browserPublicationId],
    );
    expect(editions.rows.map((row) => row.id)).toEqual([...browserEditionIds].reverse());
    expect(editions.rows.map((row) => row.ordinal)).toEqual([1, 2]);
    expect(editions.rows.map((row) => row.isDefault)).toEqual([true, false]);
    const rows = await ordered.query<{ id: string; ordinal: number }>(
      `SELECT id,ordinal FROM app."Chapter" WHERE "revisionId"=$1 ORDER BY ordinal`,
      [browserRevisionId],
    );
    expect(rows.rows.map((row) => row.id)).toEqual([...browserChapterIds].reverse());
    expect(rows.rows.map((row) => row.ordinal)).toEqual([1, 2]);
  } finally {
    await ordered.end();
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
