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
const actors: Record<string, { id: string; token: string }> = {};
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
  return {
    status: response.status,
    json: (await response.json()) as {
      data?: { id?: string; status?: string; events?: unknown[]; code?: string };
    },
  };
}
beforeAll(async () => {
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
  pool = app.get<Pool>('DB_POOL');
  for (const role of ['reader', 'issuer', 'approver', 'admin-no-mfa']) {
    const id = randomUUID(),
      token = randomBytes(36).toString('base64url');
    actors[role] = { id, token };
    await pool.query(
      `INSERT INTO app."User" (id,email,status,"emailVerifiedAt","termsAcceptedAt","privacyVersion","createdAt","updatedAt")
      VALUES ($1,$2,'ACTIVE',now(),now(),'TEST-ONLY',now(),now())`,
      [id, `entitlement-http-${role}-${id}@example.invalid`],
    );
    await pool.query(
      `INSERT INTO app."AuthSession" (id,"userId","tokenHash","expiresAt","mfaVerifiedAt","createdAt")
      VALUES ($1,$2,$3,now()+interval '2 hours',$4,now())`,
      [randomUUID(), id, tokenHash(token), role === 'admin-no-mfa' ? null : new Date()],
    );
    if (role !== 'reader')
      await pool.query(
        `INSERT INTO app."RoleAssignment" (id,"userId","roleId","scopeType","startsAt")
      SELECT $1,$2,id,'PLATFORM',now() FROM app."Role" WHERE code='SYSTEM_ADMIN'`,
        [randomUUID(), id],
      );
  }
}, 30_000);
afterAll(async () => {
  if (app) await app.close();
});

describe('entitlement HTTP authorization and lifecycle', () => {
  let grantId: string;
  it('keeps own access private and admin data behind role and MFA', async () => {
    expect((await request(null, '/me/entitlements')).status).toBe(401);
    expect((await request('reader', '/me/entitlements')).status).toBe(200);
    expect((await request('reader', '/admin/entitlements')).status).toBe(403);
    expect((await request('admin-no-mfa', '/admin/entitlements')).status).toBe(403);
    expect((await request('issuer', '/admin/entitlements')).status).toBe(200);
    expect(
      (await request('issuer', '/admin/entitlement-users?q=entitlement-http-reader')).status,
    ).toBe(200);
  });
  it('requires CSRF and denies self approval', async () => {
    const input = {
      userId: actors.reader!.id,
      scope: 'LIBRARY',
      durationDays: 7,
      reason: '[TEST ONLY] Approved access for recipient',
    };
    expect((await request('issuer', '/admin/entitlements', 'POST', input, false)).status).toBe(403);
    expect((await request('reader', '/admin/entitlements', 'POST', input)).status).toBe(403);
    const created = await request('issuer', '/admin/entitlements', 'POST', input);
    expect(created.status).toBe(201);
    grantId = created.json.data?.id ?? '';
    expect(grantId).toMatch(/^[a-f0-9-]{36}$/);
    expect(
      (
        await request('issuer', `/admin/entitlements/${grantId}/approve`, 'POST', {
          reason: '[TEST ONLY] Self approval',
        })
      ).status,
    ).toBe(403);
  });
  it('activates only after independent review and preserves owner-only history', async () => {
    const approved = await request('approver', `/admin/entitlements/${grantId}/approve`, 'POST', {
      reason: '[TEST ONLY] Independent approval',
    });
    expect(approved.status).toBe(201);
    expect(approved.json.data?.status).toBe('ACTIVE');
    const mine = await request('reader', '/me/entitlements');
    expect(mine.status).toBe(200);
    expect(JSON.stringify(mine.json)).toContain(grantId);
    expect((await request('reader', `/admin/entitlements/${grantId}/history`)).status).toBe(403);
    const history = await request('approver', `/admin/entitlements/${grantId}/history`);
    expect(history.status).toBe(200);
    expect(history.json.data?.events?.length).toBeGreaterThan(1);
  });
  it('revokes a manual source without deleting its history', async () => {
    const changed = await request('approver', `/admin/entitlements/${grantId}/revoke`, 'POST', {
      reason: '[TEST ONLY] Grant recalled',
    });
    expect(changed.status).toBe(201);
    expect(changed.json.data?.status).toBe('REVOKED');
    expect((await request('approver', `/admin/entitlements/${grantId}/history`)).status).toBe(200);
  });
  it('does not activate a trial when the policy disables trials', async () => {
    expect((await request('reader', '/me/trials', 'POST')).status).toBe(403);
  });
  it('issues bulk access only after independent campaign review', async () => {
    const start = new Date(Date.now() - 60_000),
      end = new Date(Date.now() + 86_400_000);
    const created = await request('issuer', '/admin/grant-campaigns', 'POST', {
      kind: 'BULK',
      name: '[TEST ONLY] Bulk access',
      reason: '[TEST ONLY] Cohort campaign',
      scope: 'LIBRARY',
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      maxClaims: 1,
      userIds: [actors.reader!.id],
    });
    expect(created.status).toBe(201);
    const id = created.json.data?.id;
    expect(
      (
        await request('issuer', `/admin/grant-campaigns/${id}/approve`, 'POST', {
          reason: '[TEST ONLY] Self review',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request('approver', `/admin/grant-campaigns/${id}/approve`, 'POST', {
          reason: '[TEST ONLY] Independent campaign review',
        })
      ).status,
    ).toBe(201);
    const mine = await request('reader', '/me/entitlements');
    expect(JSON.stringify(mine.json)).toContain('COMPLIMENTARY');
  });
  it('redeems a single-use approved free promotion and rejects repeats', async () => {
    const start = new Date(Date.now() - 60_000),
      end = new Date(Date.now() + 86_400_000);
    const created = await request('issuer', '/admin/grant-campaigns', 'POST', {
      kind: 'PROMOTION',
      name: '[TEST ONLY] Promotional access',
      reason: '[TEST ONLY] Free campaign',
      scope: 'LIBRARY',
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      maxClaims: 1,
    });
    expect(created.status).toBe(201);
    const id = created.json.data?.id,
      code = created.json.data?.code;
    expect(code?.length).toBeGreaterThanOrEqual(40);
    expect(
      (
        await request('approver', `/admin/grant-campaigns/${id}/approve`, 'POST', {
          reason: '[TEST ONLY] Independent campaign review',
        })
      ).status,
    ).toBe(201);
    const attempts = await Promise.all([
      request('reader', '/me/promotion-redemptions', 'POST', { code }),
      request('reader', '/me/promotion-redemptions', 'POST', { code }),
    ]);
    expect(attempts.map((attempt) => attempt.status).sort()).toEqual([201, 409]);
  });
  it('retains recent access decisions and prunes records beyond the configured retention', async () => {
    const oldId = randomUUID(),
      recentId = randomUUID();
    await pool.query(
      `INSERT INTO app."AccessDecisionLog" (id,"userId",action,"targetKind","targetId",decision,"reasonCode","occurredAt")
      VALUES ($1,$3,'READ','EDITION',$4,'DENY','TEST_OLD',now()-interval '100 years'),
        ($2,$3,'READ','EDITION',$4,'ALLOW','TEST_RECENT',now())`,
      [oldId, recentId, actors.reader!.id, randomUUID()],
    );
    expect((await request('approver', '/admin/entitlements/maintenance', 'POST')).status).toBe(201);
    const records = await pool.query<{ id: string }>(
      `SELECT id FROM app."AccessDecisionLog" WHERE id=ANY($1::uuid[])`,
      [[oldId, recentId]],
    );
    expect(records.rows.map((row) => row.id)).toEqual([recentId]);
  });
});
