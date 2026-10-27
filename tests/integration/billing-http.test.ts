import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import dotenv from 'dotenv';
import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'pg';
import { createApp } from '../../apps/api/src/app.js';
import { csrfToken, tokenHash } from '../../apps/api/src/identity/security.js';

const local = dotenv.parse(readFileSync(process.env.ARATA_ENV_FILE ?? '.env.local', 'utf8'));
if (
  !local.TEST_DATABASE_URL ||
  new URL(local.TEST_DATABASE_URL).pathname !== '/arata_techlibrary_test'
)
  throw new Error('Isolated test database required');
dotenv.config({ path: '.env.foundation.local', quiet: true });
dotenv.config({ path: '.env.redis.local', quiet: true, override: true });
process.env.DATABASE_URL = local.TEST_DATABASE_URL;
process.env.NODE_ENV = 'test';

let app: INestApplication;
let pool: Pool;
let base: string;
const actors: Record<string, { token: string; id: string }> = {};
async function request(
  actor: string | null,
  path: string,
  method = 'GET',
  body?: unknown,
  csrf = true,
) {
  const token = actor ? actors[actor]?.token : undefined;
  const response = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: {
      ...(token
        ? {
            Cookie: `arata_session=${token}; arata_csrf=${csrfToken(token, process.env.AUTH_SESSION_SECRET!)}`,
          }
        : {}),
      Origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
      ...(token && csrf
        ? { 'X-CSRF-Token': csrfToken(token, process.env.AUTH_SESSION_SECRET!) }
        : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return response;
}

beforeAll(async () => {
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
  pool = app.get<Pool>('DB_POOL');
  for (const role of ['reader', 'finance', 'finance-no-mfa']) {
    const id = randomUUID();
    const token = randomBytes(36).toString('base64url');
    actors[role] = { id, token };
    await pool.query(
      `INSERT INTO app."User" (id,email,status,"emailVerifiedAt","termsAcceptedAt","privacyVersion","createdAt","updatedAt")
      VALUES ($1,$2,'ACTIVE',now(),now(),'TEST-ONLY',now(),now())`,
      [id, `billing-http-${role}-${id}@example.invalid`],
    );
    await pool.query(
      `INSERT INTO app."AuthSession" (id,"userId","tokenHash","expiresAt","mfaVerifiedAt","createdAt")
      VALUES ($1,$2,$3,now()+interval '2 hours',$4,now())`,
      [randomUUID(), id, tokenHash(token), role === 'finance-no-mfa' ? null : new Date()],
    );
    if (role !== 'reader')
      await pool.query(
        `INSERT INTO app."RoleAssignment" (id,"userId","roleId","scopeType","startsAt")
      SELECT $1,$2,id,'PLATFORM',now() FROM app."Role" WHERE code='FINANCE'`,
        [randomUUID(), id],
      );
  }
}, 30_000);
afterAll(async () => {
  if (app) await app.close();
});

describe('billing HTTP authorization', () => {
  it('keeps free pricing public and subscription history private', async () => {
    expect((await request(null, '/plans')).status).toBe(200);
    expect((await request(null, '/me/subscriptions')).status).toBe(401);
    expect((await request('reader', '/me/subscriptions')).status).toBe(200);
  });
  it('requires finance role, permission and MFA for finance data', async () => {
    expect((await request(null, '/admin/finance/report')).status).toBe(401);
    expect((await request('reader', '/admin/finance/report')).status).toBe(403);
    expect((await request('finance-no-mfa', '/admin/finance/report')).status).toBe(403);
    expect((await request('finance', '/admin/finance/report')).status).toBe(200);
    expect((await request('reader', '/admin/reconciliation-runs')).status).toBe(403);
    expect((await request('finance', '/admin/reconciliation-runs')).status).toBe(200);
  });
  it('enforces CSRF and independent permissions on finance mutations', async () => {
    const body = {
      paymentAttemptId: randomUUID(),
      amountMinor: 1000,
      reason: 'TEST ONLY finance request',
    };
    expect((await request('reader', '/admin/refunds', 'POST', body)).status).toBe(403);
    expect((await request('finance', '/admin/refunds', 'POST', body, false)).status).toBe(403);
  });
  it('does not disclose another account’s invoices', async () => {
    expect((await request('reader', `/me/invoices/${randomUUID()}`)).status).toBe(404);
    expect((await request(null, `/me/invoices/${randomUUID()}/statement`)).status).toBe(401);
  });
});
