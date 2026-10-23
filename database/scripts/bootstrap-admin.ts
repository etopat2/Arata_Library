import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import dotenv from 'dotenv';
import pg from 'pg';

const email = process.argv[2]?.trim().toLowerCase();
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
  throw new Error('Usage: npm run identity:bootstrap-admin -- verified@example.org');
const local = dotenv.parse(readFileSync(process.env.ARATA_ENV_FILE || '.env.local', 'utf8'));
const url = process.env.MIGRATION_DATABASE_URL || local.MIGRATION_DATABASE_URL;
if (!url) throw new Error('MIGRATION_DATABASE_URL is required');
const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
try {
  await client.connect();
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(784801, 1)');
  const database = await client.query<{ name: string }>('SELECT current_database() AS name');
  if (database.rows[0]?.name !== 'arata_techlibrary_dev')
    throw new Error('Bootstrap is restricted to the development database');
  const existing = await client.query(
    'SELECT 1 FROM app."RoleAssignment" a JOIN app."Role" r ON r.id=a."roleId" WHERE r.code=\'SYSTEM_ADMIN\' AND a."revokedAt" IS NULL AND (a."endsAt" IS NULL OR a."endsAt">now()) LIMIT 1',
  );
  if (existing.rowCount) throw new Error('An administrator already exists; bootstrap refused');
  const user = await client.query<{ id: string }>(
    'SELECT id FROM app."User" WHERE email=$1 AND status=\'ACTIVE\' AND "emailVerifiedAt" IS NOT NULL AND "termsAcceptedAt" IS NOT NULL FOR UPDATE',
    [email],
  );
  if (!user.rows[0]) throw new Error('Verified, active account required');
  const mfa = await client.query(
    'SELECT 1 FROM app."Authenticator" WHERE "userId"=$1 AND "confirmedAt" IS NOT NULL AND "revokedAt" IS NULL AND kind IN (\'TOTP\',\'PASSKEY\') LIMIT 1',
    [user.rows[0].id],
  );
  if (!mfa.rowCount) throw new Error('Confirmed MFA required before administrator bootstrap');
  const role = await client.query<{ id: string }>(
    'SELECT id FROM app."Role" WHERE code=\'SYSTEM_ADMIN\'',
  );
  if (!role.rows[0]) throw new Error('Identity role catalogue migration is missing');
  const assignmentId = randomUUID();
  await client.query(
    'INSERT INTO app."RoleAssignment" (id,"userId","roleId","scopeType","startsAt") VALUES ($1,$2,$3,\'PLATFORM\',now())',
    [assignmentId, user.rows[0].id, role.rows[0].id],
  );
  await client.query(
    'INSERT INTO app."AuditEvent" (id,"actorId",action,"objectType","objectId","correlationId",reason,"occurredAt") VALUES ($1,NULL,\'identity.admin_bootstrapped\',\'RoleAssignment\',$2,$3,\'Initial development administrator bootstrap\',now())',
    [randomUUID(), assignmentId, randomUUID()],
  );
  await client.query('COMMIT');
  console.info('Development administrator bootstrapped for the verified MFA account.');
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
