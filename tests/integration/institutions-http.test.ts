import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import dotenv from 'dotenv';
import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'pg';
import { createApp } from '../../apps/api/src/app.js';
import { InstitutionService } from '../../apps/api/src/institutions/institution.service.js';
import { csrfToken, tokenHash } from '../../apps/api/src/identity/security.js';

const local = dotenv.parse(readFileSync(process.env.ARATA_ENV_FILE ?? '.env.local', 'utf8'));
if (
  !local.TEST_DATABASE_URL ||
  new URL(local.TEST_DATABASE_URL).pathname !== '/arata_techlibrary_test'
)
  throw new Error('Institution HTTP checks require the isolated test database');
dotenv.config({ path: '.env.foundation.local', quiet: true });
dotenv.config({ path: '.env.redis.local', quiet: true, override: true });
process.env.DATABASE_URL = local.TEST_DATABASE_URL;
process.env.NODE_ENV = 'test';
let app: INestApplication, pool: Pool, base: string;
const actors: Record<string, { id: string; token: string }> = {};
const suffix = randomUUID().slice(0, 8);
const domain = `school-${suffix}.example.invalid`;
const altDomain = `school-${suffix}.example.invalid.attacker.invalid`;
let institutionId = '',
  domainId = '',
  policyId = '',
  studentMembership = '',
  rosterMembership = '';
let dnsValue = '',
  dnsName = '';
// Responses span distinct route DTOs; assertions validate each concrete shape below.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Reply = { status: number; data: any };
async function request(
  actor: string | null,
  path: string,
  method = 'GET',
  body?: unknown,
  csrf = true,
): Promise<Reply> {
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
  const json = (await response.json()) as { data?: unknown };
  return { status: response.status, data: json.data ?? json };
}
async function addActor(name: string, email: string, verified = true, admin = false) {
  const id = randomUUID(),
    token = randomBytes(36).toString('base64url');
  actors[name] = { id, token };
  await pool.query(
    `INSERT INTO app."User" (id,email,status,"emailVerifiedAt","termsAcceptedAt",
    "privacyVersion","createdAt","updatedAt") VALUES ($1,$2,'ACTIVE',$3,now(),'TEST-ONLY',now(),now())`,
    [id, email, verified ? new Date() : null],
  );
  await pool.query(
    `INSERT INTO app."AuthSession" (id,"userId","tokenHash","expiresAt","mfaVerifiedAt")
    VALUES ($1,$2,$3,now()+interval '2 hours',now())`,
    [randomUUID(), id, tokenHash(token)],
  );
  if (admin)
    await pool.query(
      `INSERT INTO app."RoleAssignment" (id,"userId","roleId","scopeType","startsAt")
    SELECT $1,$2,id,'PLATFORM',now() FROM app."Role" WHERE code='SYSTEM_ADMIN'`,
      [randomUUID(), id],
    );
}
beforeAll(async () => {
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
  pool = app.get<Pool>('DB_POOL');
  await addActor('issuer', `issuer-${suffix}@example.invalid`, true, true);
  await addActor('approver', `approver-${suffix}@example.invalid`, true, true);
  await addActor('manager', `manager-${suffix}@example.invalid`);
  await addActor('sso-manager', `sso-manager-${suffix}@example.invalid`);
  await addActor('student', `student-${suffix}@${domain}`);
  await addActor('roster', `roster-${suffix}@${domain}`);
  await addActor('forged', `forged-${suffix}@${altDomain}`);
  await addActor('unverified', `unverified-${suffix}@${domain}`, false);
  const service = app.get(InstitutionService);
  service.dnsLookup = async (name) => (name === dnsName ? [[dnsValue]] : []);
}, 30_000);
afterAll(async () => {
  if (app) await app.close();
});

describe('institution onboarding and tenant isolation', () => {
  it('requires central independent registration approval and scoped manager assignment', async () => {
    expect((await request(null, '/admin/institutions')).status).toBe(401);
    expect((await request('manager', '/admin/institutions')).status).toBe(403);
    const created = await request('issuer', '/admin/institutions', 'POST', {
      legalName: `[TEST ONLY] Institution ${suffix}`,
      kind: 'EDUCATIONAL',
      registrationRef: `TEST-REG-${suffix}`,
      evidenceRef: `TEST-CASE-${suffix}`,
    });
    expect(created.status).toBe(201);
    institutionId = created.data.id;
    expect(
      (
        await request('issuer', `/admin/institutions/${institutionId}/approve`, 'POST', {
          reason: '[TEST ONLY] self review',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request('approver', `/admin/institutions/${institutionId}/approve`, 'POST', {
          reason: '[TEST ONLY] legal identity verified',
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await request('issuer', `/admin/institutions/${institutionId}/managers`, 'POST', {
          userId: actors.manager!.id,
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await request('issuer', `/admin/institutions/${institutionId}/managers`, 'POST', {
          userId: actors['sso-manager']!.id,
        })
      ).status,
    ).toBe(201);
    expect(
      (await request('manager', `/admin/institutions/${institutionId}/dashboard`)).status,
    ).toBe(200);
    expect((await request('manager', `/admin/institutions/${randomUUID()}/dashboard`)).status).toBe(
      403,
    );
  });
  it('requires exact DNS proof and central domain approval before any membership request', async () => {
    const created = await request(
      'manager',
      `/admin/institutions/${institutionId}/domains`,
      'POST',
      { domain },
    );
    expect(created.status).toBe(201);
    domainId = created.data.id;
    dnsName = created.data.dnsName;
    dnsValue = created.data.dnsValue;
    expect(dnsName).toBe(`_arata-techlibrary.${domain}`);
    expect(
      (
        await request(
          'manager',
          `/admin/institutions/${institutionId}/domains/${domainId}/approve`,
          'POST',
          { reason: '[TEST ONLY] manager self approval' },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          'issuer',
          `/admin/institutions/${institutionId}/domains/${domainId}/verify`,
          'POST',
          { token: 'B'.repeat(43) },
        )
      ).status,
    ).toBe(403);
    const verified = await request(
      'manager',
      `/admin/institutions/${institutionId}/domains/${domainId}/verify`,
      'POST',
      { token: dnsValue.split('=')[1] },
    );
    expect(verified).toMatchObject({ status: 201 });
    expect(
      (
        await request(
          'approver',
          `/admin/institutions/${institutionId}/domains/${domainId}/approve`,
          'POST',
          { reason: '[TEST ONLY] exact DNS ownership confirmed' },
        )
      ).status,
    ).toBe(201);
    expect((await request('forged', '/institutional/eligible-institutions')).data).toEqual([]);
    expect((await request('unverified', '/institutional/eligible-institutions')).status).toBe(401);
  });
  it('requires independently approved category policy, reviewed membership and approved agreement', async () => {
    const input = {
      category: 'STUDENT',
      scope: 'LIBRARY',
      verificationMode: 'MANUAL',
      validityDays: 30,
    };
    const created = await request(
      'manager',
      `/admin/institutions/${institutionId}/eligibility-policies`,
      'POST',
      input,
    );
    expect(created.status).toBe(201);
    policyId = created.data.id;
    expect(
      (
        await request(
          'manager',
          `/admin/institutions/${institutionId}/eligibility-policies/${policyId}/approve`,
          'POST',
          { reason: '[TEST ONLY] manager cannot approve policy' },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          'approver',
          `/admin/institutions/${institutionId}/eligibility-policies/${policyId}/approve`,
          'POST',
          { reason: '[TEST ONLY] manual student proof required' },
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await request('forged', '/institutional/memberships', 'POST', {
          institutionId,
          category: 'STUDENT',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request('unverified', '/institutional/memberships', 'POST', {
          institutionId,
          category: 'STUDENT',
        })
      ).status,
    ).toBe(401);
    const requested = await request('student', '/institutional/memberships', 'POST', {
      institutionId,
      category: 'STUDENT',
    });
    expect(requested.status).toBe(201);
    studentMembership = requested.data.id;
    expect(
      (
        await request(
          'manager',
          `/admin/institutions/${institutionId}/memberships/${studentMembership}/review`,
          'POST',
          {
            decision: 'APPROVED',
            reason: '[TEST ONLY] reviewed student evidence',
            evidenceRef: 'TEST-CASE-STUDENT',
          },
        )
      ).status,
    ).toBe(403);
    await pool.query(
      `INSERT INTO app."InstitutionAgreement" (id,"institutionId","createdById",
      "approvedById","approvedAt",status,scope,"memberLimit","permittedCategories",
      "startsAt","endsAt") VALUES ($1,$2,$3,$4,now(),'APPROVED','LIBRARY',10,
      ARRAY['STUDENT','ACADEMIC_STAFF'],now(),now()+interval '60 days')`,
      [randomUUID(), institutionId, actors.issuer!.id, actors.approver!.id],
    );
    const approved = await request(
      'manager',
      `/admin/institutions/${institutionId}/memberships/${studentMembership}/review`,
      'POST',
      {
        decision: 'APPROVED',
        reason: '[TEST ONLY] reviewed student evidence',
        evidenceRef: 'TEST-CASE-STUDENT',
      },
    );
    expect(approved.status).toBe(201);
    expect(approved.data.status).toBe('VERIFIED');
    expect((await request('student', '/institutional/memberships')).data[0].expiresAt).toBeTruthy();
  });
  it('previews roster conflicts, applies validated rows once, and allows private opt-out', async () => {
    const created = await request(
      'issuer',
      `/admin/institutions/${institutionId}/eligibility-policies`,
      'POST',
      {
        category: 'ACADEMIC_STAFF',
        scope: 'LIBRARY',
        verificationMode: 'ROSTER',
        validityDays: 30,
      },
    );
    expect(created.status).toBe(201);
    expect(
      (
        await request(
          'approver',
          `/admin/institutions/${institutionId}/eligibility-policies/${created.data.id}/approve`,
          'POST',
          { reason: '[TEST ONLY] approved roster verification' },
        )
      ).status,
    ).toBe(201);
    const bad = `email,category,action\nroster-${suffix}@${domain},ACADEMIC_STAFF,UPSERT\nforged-${suffix}@${altDomain},STUDENT,UPSERT`;
    const preview = await request(
      'manager',
      `/admin/institutions/${institutionId}/roster-imports`,
      'POST',
      { csv: bad, apply: false },
    );
    expect(preview.status).toBe(201);
    expect(preview.data.errors).toEqual([{ row: 3, code: 'DOMAIN_UNAPPROVED' }]);
    expect(JSON.stringify(preview.data)).not.toContain(`forged-${suffix}`);
    const good = `email,category,action\nroster-${suffix}@${domain},ACADEMIC_STAFF,UPSERT`;
    expect(
      (
        await request('manager', `/admin/institutions/${institutionId}/roster-imports`, 'POST', {
          csv: good,
          apply: true,
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await request('manager', `/admin/institutions/${institutionId}/roster-imports`, 'POST', {
          csv: good,
          apply: true,
        })
      ).status,
    ).toBe(409);
    const member = (
      await pool.query<{ id: string }>(
        `SELECT id FROM app."Membership" WHERE "institutionId"=$1
      AND "userId"=$2`,
        [institutionId, actors.roster!.id],
      )
    ).rows[0];
    rosterMembership = member?.id ?? '';
    expect(rosterMembership).toBeTruthy();
    expect(
      (await request('student', `/admin/institutions/${institutionId}/memberships`)).status,
    ).toBe(403);
    expect(
      (await request('student', `/institutional/memberships/${studentMembership}/opt-out`, 'POST'))
        .status,
    ).toBe(201);
    expect((await request('student', '/institutional/memberships')).data[0].status).toBe(
      'SUSPENDED',
    );
  });
  it('rejects foreign and opted-out learners from institution cohorts', async () => {
    const created = await request(
      'manager',
      `/admin/institutions/${institutionId}/cohorts`,
      'POST',
      {
        name: '[TEST ONLY] Learner cohort',
      },
    );
    expect(created.status).toBe(201);
    for (const actor of ['forged', 'student', 'roster']) {
      const joined = await request(
        'manager',
        `/admin/institutions/${institutionId}/cohorts/${created.data.id}/members`,
        'POST',
        { userId: actors[actor]!.id, join: true },
      );
      expect(joined.status).toBe(403);
    }
  });
  it('keeps reviewed SSO metadata unable to authenticate or issue eligibility', async () => {
    const proposed = await request(
      'sso-manager',
      `/admin/institutions/${institutionId}/sso-providers`,
      'POST',
      { issuerUrl: 'https://idp.example.invalid/', clientId: '[TEST ONLY] client' },
    );
    expect(proposed.status).toBe(201);
    expect(proposed.data.authenticationEnabled).toBe(false);
    const approved = await request(
      'approver',
      `/admin/institutions/${institutionId}/sso-providers/${proposed.data.id}/approve`,
      'POST',
      { reason: '[TEST ONLY] metadata reviewed' },
    );
    expect(approved.status).toBe(201);
    expect(approved.data.authenticationEnabled).toBe(false);
    expect(
      (
        await request(
          'sso-manager',
          `/admin/institutions/${institutionId}/eligibility-policies`,
          'POST',
          {
            category: 'STUDENT',
            scope: 'LIBRARY',
            verificationMode: 'SSO',
            validityDays: 30,
          },
        )
      ).status,
    ).toBe(409);
  });
});
