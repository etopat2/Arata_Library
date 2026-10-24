import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import dotenv from 'dotenv';
import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'pg';
import { createApp } from '../../apps/api/src/app.js';
import { IdentityMailer } from '../../apps/api/src/identity/identity.service.js';
import { totpAt, tokenHash } from '../../apps/api/src/identity/security.js';

const local = dotenv.parse(readFileSync(process.env.ARATA_ENV_FILE ?? '.env.local', 'utf8'));
dotenv.config({ path: '.env.foundation.local', quiet: true });
dotenv.config({ path: '.env.redis.local', quiet: true, override: true });
if (
  !local.TEST_DATABASE_URL ||
  new URL(local.TEST_DATABASE_URL).pathname !== '/arata_techlibrary_test'
)
  throw new Error('Isolated test database required');
process.env.DATABASE_URL = local.TEST_DATABASE_URL;
process.env.NODE_ENV = 'test';
process.env.AUTH_TERMS_VERSION = 'TEST-1';
process.env.AUTH_PRIVACY_VERSION = 'TEST-1';
process.env.AUTH_TERMS_URL = 'https://example.invalid/terms-test-only';
process.env.AUTH_PRIVACY_URL = 'https://example.invalid/privacy-test-only';
process.env.AUTH_RATE_PREFIX = `test-${randomUUID()}`;

let app: INestApplication;
let base: string;
let pool: Pool;
let mail: IdentityMailer;
const email = `identity-${randomUUID()}@example.invalid`;
const password = 'SecureTestPassphrase#45';
let cookies = '';
let csrf = '';
let sessionId = '';

function readCookies(response: Response) {
  const parts = response.headers.getSetCookie().map((value) => value.split(';')[0]);
  cookies = parts.join('; ');
  csrf = parts.find((part) => part.startsWith('arata_csrf='))?.split('=')[1] ?? '';
}
async function call(path: string, method = 'GET', body?: unknown, auth = false, csrfValue = csrf) {
  return fetch(`${base}/api/v1${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(auth
        ? { Cookie: cookies, Origin: process.env.WEB_ORIGIN!, 'X-CSRF-Token': csrfValue }
        : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

beforeAll(async () => {
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
  pool = app.get<Pool>('DB_POOL');
  mail = app.get(IdentityMailer);
});
afterAll(async () => {
  await pool.end();
  await app.close();
});

describe('identity lifecycle and access boundaries', () => {
  it('acknowledges registration without disclosing duplicate identity and stores only a hash', async () => {
    const input = { email, password, termsVersion: 'TEST-1', privacyVersion: 'TEST-1' };
    const first = await call('/auth/register', 'POST', input);
    expect(first.status).toBe(201);
    const duplicate = await call('/auth/register', 'POST', input);
    expect(duplicate.status).toBe(201);
    expect(((await duplicate.json()) as { data: unknown }).data).toEqual(
      ((await first.json()) as { data: unknown }).data,
    );
    expect(mail.captured).toHaveLength(1);
    const result = await pool.query<{
      passwordHash: string;
      emailVerifiedAt: Date | null;
      termsVersion: string;
    }>('SELECT "passwordHash","emailVerifiedAt","termsVersion" FROM app."User" WHERE email=$1', [
      email,
    ]);
    expect(result.rows[0]?.passwordHash).toMatch(/^scrypt-v1:/);
    expect(result.rows[0]?.passwordHash).not.toContain(password);
    expect(result.rows[0]?.emailVerifiedAt).toBeNull();
    expect(result.rows[0]?.termsVersion).toBe('TEST-1');
  });

  it('denies sign-in until one-use email verification', async () => {
    expect((await call('/auth/login', 'POST', { email, password })).status).toBe(401);
    const token = new URL(mail.captured[0]!.text.match(/https?:\/\/\S+/)![0]).searchParams.get(
      'token',
    )!;
    expect((await call('/auth/verify-email', 'POST', { token })).status).toBe(200);
    expect((await call('/auth/verify-email', 'POST', { token })).status).toBe(400);
    const response = await call('/auth/login', 'POST', { email, password });
    expect(response.status).toBe(201);
    readCookies(response);
    const body = (await response.json()) as { data: { id: string } };
    sessionId = body.data.id;
    expect(cookies).not.toContain(password);
    expect(response.headers.getSetCookie()[0]).toContain('HttpOnly');
  });

  it('enforces session ownership and CSRF, then revokes the current session', async () => {
    expect((await call('/me/profile')).status).toBe(401);
    expect(
      (await call('/me/profile', 'PATCH', { displayName: 'Test Reader' }, true, 'wrong')).status,
    ).toBe(403);
    const update = await call('/me/profile', 'PATCH', { displayName: 'Test Reader' }, true);
    expect(update.status).toBe(200);
    const profile = await call('/me/profile', 'GET', undefined, true);
    const data = ((await profile.json()) as { data: Record<string, unknown> }).data;
    expect(data.displayName).toBe('Test Reader');
    expect(JSON.stringify(data)).not.toContain('passwordHash');
    const listing = await call('/auth/sessions', 'GET', undefined, true);
    expect(((await listing.json()) as { data: { id: string }[] }).data).toContainEqual(
      expect.objectContaining({ id: sessionId }),
    );
    expect((await call(`/auth/sessions/${randomUUID()}`, 'DELETE', undefined, true)).status).toBe(
      404,
    );
    expect((await call(`/auth/sessions/${sessionId}`, 'DELETE', undefined, true)).status).toBe(200);
    expect((await call('/me/profile', 'GET', undefined, true)).status).toBe(401);
  });

  it('uses generic recovery acknowledgement and invalidates existing sessions on reset', async () => {
    const unknown = await call('/auth/password/reset-request', 'POST', {
      email: `missing-${randomUUID()}@example.invalid`,
    });
    const known = await call('/auth/password/reset-request', 'POST', { email });
    expect(unknown.status).toBe(200);
    expect(((await known.json()) as { data: unknown }).data).toEqual(
      ((await unknown.json()) as { data: unknown }).data,
    );
    const token = new URL(mail.captured.at(-1)!.text.match(/https?:\/\/\S+/)![0]).searchParams.get(
      'token',
    )!;
    const nextPassword = 'DifferentPassphrase#87';
    expect(
      (await call('/auth/password/reset', 'POST', { token, newPassword: nextPassword })).status,
    ).toBe(200);
    expect(
      (await call('/auth/password/reset', 'POST', { token, newPassword: nextPassword })).status,
    ).toBe(400);
    expect((await call('/auth/login', 'POST', { email, password })).status).toBe(401);
    const login = await call('/auth/login', 'POST', { email, password: nextPassword });
    expect(login.status).toBe(201);
    readCookies(login);
  });

  it('denies role escalation and requires MFA and recent step-up for administrator access', async () => {
    expect((await call('/admin/users', 'GET', undefined, true)).status).toBe(403);
    const user = await pool.query<{ id: string }>('SELECT id FROM app."User" WHERE email=$1', [
      email,
    ]);
    const userId = user.rows[0]!.id;
    await pool.query(
      'INSERT INTO app."RoleAssignment" (id,"userId","roleId","scopeType","startsAt") SELECT $1,$2,id,\'PLATFORM\',now() FROM app."Role" WHERE code=\'SYSTEM_ADMIN\'',
      [randomUUID(), userId],
    );
    expect((await call('/admin/users', 'GET', undefined, true)).status).toBe(403);
    const enroll = await call(
      '/auth/mfa/enroll',
      'POST',
      { password: 'DifferentPassphrase#87' },
      true,
    );
    expect(enroll.status).toBe(201);
    const enrollment = ((await enroll.json()) as { data: { id: string; secret: string } }).data;
    const oldCookies = cookies;
    const confirm = await call(
      '/auth/mfa/confirm',
      'POST',
      { id: enrollment.id, code: totpAt(enrollment.secret, Date.now()) },
      true,
    );
    expect(confirm.status).toBe(201);
    readCookies(confirm);
    expect(
      (await fetch(`${base}/api/v1/admin/users`, { headers: { Cookie: oldCookies } })).status,
    ).toBe(401);
    expect((await call('/admin/users', 'GET', undefined, true)).status).toBe(200);
    expect(
      (
        await call(
          '/admin/role-assignments',
          'POST',
          { userId, role: 'SYSTEM_ADMIN', reason: 'Test escalation' },
          true,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          `/admin/users/${userId}/status`,
          'PATCH',
          { status: 'suspended', reason: 'Test self suspension' },
          true,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          '/admin/users',
          'POST',
          { email: `invite-${randomUUID()}@example.invalid` },
          true,
          'incorrect',
        )
      ).status,
    ).toBe(403);
    await pool.query(
      'UPDATE app."AuthSession" SET "mfaVerifiedAt"=now()-interval \'10 minutes\' WHERE "tokenHash"=$1',
      [tokenHash(cookies.match(/arata_session=([^;]+)/)![1]!)],
    );
    expect(
      (
        await call(
          '/admin/users',
          'POST',
          { email: `invite-${randomUUID()}@example.invalid` },
          true,
        )
      ).status,
    ).toBe(403);
    await pool.query(
      'UPDATE app."Authenticator" SET "lastUsedAt"=now()-interval \'1 minute\' WHERE id=$1',
      [enrollment.id],
    );
    const challenge = await call(
      '/auth/mfa/challenge',
      'POST',
      { method: 'totp', action: 'admin.users.create' },
      true,
    );
    expect(challenge.status).toBe(201);
    const challengeId = ((await challenge.json()) as { data: { challengeId: string } }).data
      .challengeId;
    const verified = await call(
      '/auth/mfa/verify',
      'POST',
      { challengeId, code: totpAt(enrollment.secret, Date.now()) },
      true,
    );
    expect(verified.status).toBe(201);
    readCookies(verified);
    expect(
      (
        await call(
          '/auth/mfa/verify',
          'POST',
          { challengeId, code: totpAt(enrollment.secret, Date.now()) },
          true,
        )
      ).status,
    ).toBe(401);
  });

  it('stores optional privacy and notification choices without exposing other accounts', async () => {
    const privacy = await call(
      '/me/privacy-preferences',
      'PUT',
      {
        analyticsConsent: false,
        researchConsent: true,
        personalizationConsent: false,
        aiAssistanceConsent: false,
        policyVersion: 'TEST-1',
      },
      true,
    );
    expect(privacy.status).toBe(200);
    expect(
      ((await privacy.json()) as { data: { researchConsent: boolean } }).data.researchConsent,
    ).toBe(true);
    const withdrawn = await pool.query<{ exact: boolean }>(
      'SELECT bool_and("withdrawnAt"="effectiveAt") AS exact FROM app."PrivacyPreference" WHERE "userId"=(SELECT id FROM app."User" WHERE email=$1) AND granted=false',
      [email],
    );
    expect(withdrawn.rows[0]?.exact).toBe(true);
    const notification = await call(
      '/me/notification-preferences',
      'PUT',
      { email: false, inApp: true },
      true,
    );
    expect(notification.status).toBe(200);
    expect(
      ((await notification.json()) as { data: { email: boolean; securityMandatory: boolean } })
        .data,
    ).toMatchObject({ email: false, securityMandatory: true });
  });

  it('rejects expired verification tokens and locks repeated password failures', async () => {
    const lockedEmail = `locked-${randomUUID()}@example.invalid`;
    expect(
      (
        await call('/auth/register', 'POST', {
          email: lockedEmail,
          password,
          termsVersion: 'TEST-1',
          privacyVersion: 'TEST-1',
        })
      ).status,
    ).toBe(201);
    const expired = new URL(
      mail.captured.at(-1)!.text.match(/https?:\/\/\S+/)![0],
    ).searchParams.get('token')!;
    await pool.query(
      'UPDATE app."VerificationToken" SET "expiresAt"=now()-interval \'1 second\' WHERE "tokenHash"=$1',
      [tokenHash(expired)],
    );
    expect((await call('/auth/verify-email', 'POST', { token: expired })).status).toBe(400);
    expect((await call('/auth/verify-email/resend', 'POST', { email: lockedEmail })).status).toBe(
      200,
    );
    const fresh = new URL(mail.captured.at(-1)!.text.match(/https?:\/\/\S+/)![0]).searchParams.get(
      'token',
    )!;
    expect((await call('/auth/verify-email', 'POST', { token: fresh })).status).toBe(200);
    for (let attempt = 0; attempt < 5; attempt++)
      expect(
        (
          await call('/auth/login', 'POST', {
            email: lockedEmail,
            password: 'IncorrectPassphrase#12',
          })
        ).status,
      ).toBe(401);
    expect((await call('/auth/login', 'POST', { email: lockedEmail, password })).status).toBe(401);
    const row = await pool.query<{ failedLoginCount: number; lockedUntil: Date }>(
      'SELECT "failedLoginCount","lockedUntil" FROM app."User" WHERE email=$1',
      [lockedEmail],
    );
    expect(row.rows[0]!.failedLoginCount).toBe(5);
    expect(row.rows[0]!.lockedUntil.getTime()).toBeGreaterThan(Date.now());
  });

  it('lets an MFA verified administrator invite and suspend another user, then records deletion without purging retained records', async () => {
    const invitedEmail = `invited-${randomUUID()}@example.invalid`;
    const invite = await call('/admin/users', 'POST', { email: invitedEmail }, true);
    expect(invite.status).toBe(201);
    const inviteToken = new URL(
      mail.captured.at(-1)!.text.match(/https?:\/\/\S+/)![0],
    ).searchParams.get('token')!;
    const accepted = await call('/auth/invitations/accept', 'POST', {
      token: inviteToken,
      password: 'InvitePassphrase#123',
      termsVersion: 'TEST-1',
      privacyVersion: 'TEST-1',
    });
    expect(accepted.status).toBe(200);
    expect(
      (
        await call('/auth/invitations/accept', 'POST', {
          token: inviteToken,
          password: 'InvitePassphrase#123',
          termsVersion: 'TEST-1',
          privacyVersion: 'TEST-1',
        })
      ).status,
    ).toBe(400);
    const row = await pool.query<{ id: string }>('SELECT id FROM app."User" WHERE email=$1', [
      invitedEmail,
    ]);
    const invitedId = row.rows[0]!.id;
    const assignment = await call(
      '/admin/role-assignments',
      'POST',
      { userId: invitedId, role: 'AUTHOR', reason: 'Test author assignment' },
      true,
    );
    expect(assignment.status).toBe(201);
    const assignmentId = ((await assignment.json()) as { data: { id: string } }).data.id;
    const assignmentAudit = await pool.query<{ reason: string }>(
      'SELECT reason FROM app."AuditEvent" WHERE "objectId"=$1 AND action=\'identity.role_assigned\'',
      [assignmentId],
    );
    expect(assignmentAudit.rows[0]?.reason).toBe('Test author assignment');
    expect(
      (await call(`/admin/role-assignments/${assignmentId}`, 'DELETE', undefined, true)).status,
    ).toBe(200);
    expect(
      (
        await call(
          `/admin/users/${invitedId}/status`,
          'PATCH',
          { status: 'suspended', reason: 'Test account suspension' },
          true,
        )
      ).status,
    ).toBe(200);
    const suspensionAudit = await pool.query<{ reason: string }>(
      'SELECT reason FROM app."AuditEvent" WHERE "objectType"=\'User\' AND "objectId"=$1 AND action=\'identity.user_suspended\' ORDER BY "occurredAt" DESC LIMIT 1',
      [invitedId],
    );
    expect(suspensionAudit.rows[0]?.reason).toBe('Test account suspension');
    expect(
      (await call('/auth/login', 'POST', { email: invitedEmail, password: 'InvitePassphrase#123' }))
        .status,
    ).toBe(401);
    const deleted = await call(
      '/me/account/deletion',
      'POST',
      { password: 'DifferentPassphrase#87' },
      true,
    );
    expect(deleted.status).toBe(201);
    expect((await call('/me/profile', 'GET', undefined, true)).status).toBe(401);
    const request = await pool.query<{ status: string }>(
      'SELECT status FROM app."SubjectRequest" WHERE "userId"=(SELECT id FROM app."User" WHERE email=$1) AND "requestType"=\'ACCOUNT_DELETION\' ORDER BY "requestedAt" DESC LIMIT 1',
      [email],
    );
    expect(request.rows[0]?.status).toBe('OPEN');
  });
});
