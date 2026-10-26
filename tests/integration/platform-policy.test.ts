import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import dotenv from 'dotenv';
import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'pg';
import { createApp } from '../../apps/api/src/app.js';
import { PlatformPolicyService } from '../../apps/api/src/platform-policy/platform-policy.service.js';
import { csrfToken, tokenHash } from '../../apps/api/src/identity/security.js';
import { platformSettingsSchema } from '../../packages/validation/src/platform-policy.js';

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
let policy: PlatformPolicyService;
let base: string;
let original: Awaited<ReturnType<PlatformPolicyService['current']>>;
const users: Record<string, string> = {};
const tokens: Record<string, string> = {};
let baseId: string;
let changedId: string;

async function request(
  actor: string | null,
  path: string,
  method = 'GET',
  body?: unknown,
  csrf = true,
) {
  const token = actor ? tokens[actor] : null;
  const response = await fetch(`${base}/api/v1/admin/platform-policy${path}`, {
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
    json: (await response.json()) as { data?: Record<string, unknown> },
  };
}

beforeAll(async () => {
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
  pool = app.get<Pool>('DB_POOL');
  policy = app.get(PlatformPolicyService);
  original = await policy.current();
  for (const role of ['first', 'second', 'reader', 'noMfa']) {
    const id = randomUUID();
    const token = randomBytes(36).toString('base64url');
    users[role] = id;
    tokens[role] = token;
    await pool.query(
      `INSERT INTO app."User" (id,email,status,"emailVerifiedAt","termsAcceptedAt","privacyVersion","createdAt","updatedAt") VALUES ($1,$2,'ACTIVE',now(),now(),'TEST-ONLY',now(),now())`,
      [id, `policy-${role.toLowerCase()}-${id}@example.invalid`],
    );
    await pool.query(
      `INSERT INTO app."AuthSession" (id,"userId","tokenHash","expiresAt","mfaVerifiedAt","createdAt") VALUES ($1,$2,$3,now()+interval '2 hours',$4,now())`,
      [randomUUID(), id, tokenHash(token), role === 'noMfa' ? null : new Date()],
    );
    if (role !== 'reader')
      await pool.query(
        `INSERT INTO app."RoleAssignment" (id,"userId","roleId","scopeType","startsAt") SELECT $1,$2,id,'PLATFORM',now() FROM app."Role" WHERE code='SYSTEM_ADMIN'`,
        [randomUUID(), id],
      );
  }
}, 30_000);

afterAll(async () => {
  if (pool) await pool.end();
  if (app) await app.close();
});

describe('versioned platform settings', () => {
  it('denies anonymous, reader, missing MFA and missing CSRF access', async () => {
    expect((await request(null, '/effective')).status).toBe(401);
    expect((await request('reader', '/effective')).status).toBe(403);
    expect((await request('noMfa', '/effective')).status).toBe(403);
    expect(
      (
        await request(
          'first',
          '/drafts',
          'POST',
          { settings: original.settings, reason: 'Test policy baseline' },
          false,
        )
      ).status,
    ).toBe(403);
  });

  it('rejects secret-bearing configuration imports and keeps the export non-secret', async () => {
    const imported = await request('first', '/import', 'POST', {
      format: 'arata-platform-policy/v1',
      settings: { ...original.settings, paymentApiKey: 'TEST-DO-NOT-STORE' },
      reason: 'Reject unknown secret field',
    });
    expect(imported.status).toBe(400);
    const exported = await request('first', '/export');
    expect(exported.status).toBe(200);
    expect(JSON.stringify(exported.json)).not.toContain('paymentApiKey');
  });

  it('creates, approves and activates a baseline with independent MFA', async () => {
    const draft = await request('first', '/drafts', 'POST', {
      settings: original.settings,
      reason: 'Test policy baseline snapshot',
    });
    expect(draft.status).toBe(201);
    baseId = draft.json.data!.id as string;
    expect(
      (
        await request('first', `/drafts/${baseId}/submit`, 'POST', {
          reason: 'Submit baseline policy',
        })
      ).status,
    ).toBe(201);
    const date = new Date(Date.now() - 1000).toISOString();
    expect(
      (
        await request('first', `/${baseId}/approve`, 'POST', {
          reason: 'Attempt self approval',
          effectiveAt: date,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request('second', `/${baseId}/approve`, 'POST', {
          reason: 'Independent baseline approval',
          effectiveAt: date,
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await request('second', `/${baseId}/activate`, 'POST', {
          reason: 'Activate baseline settings',
        })
      ).status,
    ).toBe(201);
    expect((await policy.current()).settings).toEqual(original.settings);
  });

  it('edits drafts, freezes submitted settings, activates changes and audits them', async () => {
    const modified = structuredClone(original.settings);
    modified.security.sessionHours = original.settings.security.sessionHours === 12 ? 8 : 12;
    modified.reader.defaultPrint = !original.settings.reader.defaultPrint;
    expect(platformSettingsSchema.safeParse(modified).success).toBe(true);
    const create = await request('first', '/drafts', 'POST', {
      settings: original.settings,
      reason: 'Draft test configuration',
    });
    changedId = create.json.data!.id as string;
    expect(
      (
        await request('first', `/drafts/${changedId}`, 'PATCH', {
          settings: modified,
          reason: 'Adjust session and print defaults',
        })
      ).status,
    ).toBe(200);
    const preview = await request('first', '/preview', 'POST', modified);
    expect(preview.status).toBe(201);
    expect((preview.json.data!.changes as unknown[]).length).toBeGreaterThanOrEqual(2);
    expect(
      (
        await request('first', `/drafts/${changedId}/submit`, 'POST', {
          reason: 'Submit modified settings',
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await request('first', `/drafts/${changedId}`, 'PATCH', {
          settings: original.settings,
          reason: 'Illicit submitted edit',
        })
      ).status,
    ).toBe(409);
    const approved = await request('second', `/${changedId}/approve`, 'POST', {
      reason: 'Independent change approval',
      effectiveAt: new Date(Date.now() - 1000).toISOString(),
    });
    expect(approved.status).toBe(201);
    expect(
      (
        await request('second', `/${changedId}/activate`, 'POST', {
          reason: 'Activate reviewed change',
        })
      ).status,
    ).toBe(201);
    expect((await policy.current()).settings.security.sessionHours).toBe(
      modified.security.sessionHours,
    );
    const events = await pool.query(
      `SELECT action FROM app."PlatformPolicyEvent" WHERE "policyId"=$1 ORDER BY "occurredAt"`,
      [changedId],
    );
    expect(events.rows.map((row) => row.action)).toEqual([
      'CREATE',
      'EDIT',
      'SUBMIT',
      'APPROVE',
      'ACTIVATE',
    ]);
    await expect(
      pool.query(`UPDATE app."PlatformPolicyVersion" SET settings=$2 WHERE id=$1`, [
        changedId,
        original.settings,
      ]),
    ).rejects.toThrow();
    await expect(
      pool.query(`UPDATE app."PlatformPolicyEvent" SET reason='tamper' WHERE "policyId"=$1`, [
        changedId,
      ]),
    ).rejects.toThrow();
  });

  it('restores an earlier snapshot as a new approved version', async () => {
    const draft = await request('first', `/${baseId}/rollback`, 'POST', {
      reason: 'Restore safe baseline policy',
    });
    expect(draft.status).toBe(201);
    const restoredId = draft.json.data!.id as string;
    expect(
      (
        await request('first', `/drafts/${restoredId}/submit`, 'POST', {
          reason: 'Submit restoration draft',
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await request('second', `/${restoredId}/approve`, 'POST', {
          reason: 'Approve baseline restoration',
          effectiveAt: new Date(Date.now() - 1000).toISOString(),
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await request('second', `/${restoredId}/activate`, 'POST', {
          reason: 'Activate restored baseline',
        })
      ).status,
    ).toBe(201);
    expect((await policy.current()).settings).toEqual(original.settings);
    const rows = await pool.query(
      `SELECT status FROM app."PlatformPolicyVersion" WHERE id=ANY($1::uuid[])`,
      [[baseId, changedId, restoredId]],
    );
    expect(rows.rows.filter((row) => row.status === 'ACTIVE')).toHaveLength(1);
  });

  it('blocks early activation and specialist approvals without their roles', async () => {
    const future = structuredClone(original.settings);
    future.security.sessionHours = original.settings.security.sessionHours === 12 ? 8 : 12;
    const created = await request('first', '/drafts', 'POST', {
      settings: future,
      reason: 'Future effective policy test',
    });
    const id = created.json.data!.id as string;
    expect(
      (await request('first', `/drafts/${id}/submit`, 'POST', { reason: 'Submit future policy' }))
        .status,
    ).toBe(201);
    expect(
      (
        await request('second', `/${id}/approve`, 'POST', {
          reason: 'Approve future policy',
          effectiveAt: new Date(Date.now() + 86_400_000).toISOString(),
        })
      ).status,
    ).toBe(201);
    expect(
      (await request('second', `/${id}/activate`, 'POST', { reason: 'Attempt early activation' }))
        .status,
    ).toBe(409);
    expect((await policy.current()).settings.security.sessionHours).toBe(
      original.settings.security.sessionHours,
    );

    const commerce = structuredClone(original.settings);
    commerce.subscriptions.plans.monthly.priceMinor = 50_000;
    commerce.subscriptions.plans.monthly.enabled = true;
    const priced = await request('first', '/drafts', 'POST', {
      settings: commerce,
      reason: 'Propose test plan price',
    });
    const priceId = priced.json.data!.id as string;
    expect(
      (
        await request('first', `/drafts/${priceId}/submit`, 'POST', {
          reason: 'Submit proposed price',
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await request('second', `/${priceId}/approve`, 'POST', {
          reason: 'Attempt price approval without finance role',
          effectiveAt: new Date().toISOString(),
        })
      ).status,
    ).toBe(403);

    const research = structuredClone(original.settings);
    research.research.publicMinimumSubjects += 1;
    const study = await request('first', '/drafts', 'POST', {
      settings: research,
      reason: 'Propose disclosure threshold',
    });
    const researchId = study.json.data!.id as string;
    expect(
      (
        await request('first', `/drafts/${researchId}/submit`, 'POST', {
          reason: 'Submit research threshold',
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await request('second', `/${researchId}/approve`, 'POST', {
          reason: 'Attempt approval without privacy role',
          effectiveAt: new Date().toISOString(),
        })
      ).status,
    ).toBe(403);
  });
});
