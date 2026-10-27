import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import dotenv from 'dotenv';
import pg from 'pg';
import { csrfToken, tokenHash } from '../../apps/api/src/identity/security.js';

const local = dotenv.parse(readFileSync(process.env.ARATA_ENV_FILE ?? '.env.local', 'utf8'));
const foundation = dotenv.parse(readFileSync('.env.foundation.local', 'utf8'));

test('administrator can search recipients and inspect access screens at desktop and phone widths', async ({
  page,
}) => {
  if (
    !local.MIGRATION_DATABASE_URL ||
    new URL(local.MIGRATION_DATABASE_URL).pathname !== '/arata_techlibrary_dev'
  )
    throw new Error('Entitlement browser test requires the isolated development database');
  const secret = process.env.AUTH_SESSION_SECRET ?? foundation.AUTH_SESSION_SECRET;
  if (!secret) throw new Error('Session signing key required');
  const db = new pg.Client({ connectionString: local.MIGRATION_DATABASE_URL });
  const id = randomUUID(),
    sessionId = randomUUID(),
    assignmentId = randomUUID();
  const token = randomBytes(36).toString('base64url');
  await db.connect();
  try {
    await db.query(
      `INSERT INTO app."User" (id,email,status,"emailVerifiedAt","termsAcceptedAt","privacyVersion","createdAt","updatedAt")
      VALUES ($1,$2,'ACTIVE',now(),now(),'TEST-ONLY',now(),now())`,
      [id, `entitlement-browser-${id}@example.invalid`],
    );
    await db.query(
      `INSERT INTO app."AuthSession" (id,"userId","tokenHash","expiresAt","mfaVerifiedAt")
      VALUES ($1,$2,$3,now()+interval '1 hour',now())`,
      [sessionId, id, tokenHash(token)],
    );
    await db.query(
      `INSERT INTO app."RoleAssignment" (id,"userId","roleId","scopeType","startsAt")
      SELECT $1,$2,id,'PLATFORM',now() FROM app."Role" WHERE code='SYSTEM_ADMIN'`,
      [assignmentId, id],
    );
    await page.context().addCookies([
      { name: 'arata_session', value: token, url: 'http://127.0.0.1:5188' },
      { name: 'arata_csrf', value: csrfToken(token, secret), url: 'http://127.0.0.1:5188' },
    ]);
    await page.goto('/?screen=access-grants');
    await expect(page.getByRole('heading', { name: 'Access grants', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Find a recipient' })).toBeVisible();
    await page.getByLabel('Email search').fill('entitlement-browser-');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByText(`entitlement-browser-${id}@example.invalid`)).toBeVisible();
    await page.getByRole('button', { name: 'Select recipient' }).click();
    await expect(page.getByLabel('Recipient ID')).toHaveValue(id);
    const audit = await new AxeBuilder({ page }).analyze();
    expect(audit.violations).toEqual([]);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Access grants', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.goto('/?screen=entitlements');
    await expect(page.getByRole('heading', { name: 'My library access' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start eligible trial' })).toBeVisible();
  } finally {
    await db
      .query(`DELETE FROM app."RoleAssignment" WHERE id=$1`, [assignmentId])
      .catch(() => undefined);
    await db.query(`DELETE FROM app."AuthSession" WHERE id=$1`, [sessionId]).catch(() => undefined);
    await db.query(`DELETE FROM app."User" WHERE id=$1`, [id]).catch(() => undefined);
    await db.end();
  }
});
