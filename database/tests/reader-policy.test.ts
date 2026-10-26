import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import dotenv from 'dotenv';
import pg from 'pg';

const local = dotenv.parse(readFileSync(process.env.ARATA_ENV_FILE || '.env.local', 'utf8'));
const url = process.env.TEST_DATABASE_URL || local.TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== '/arata_techlibrary_test')
  throw new Error('Reader policy constraints require the isolated test database');

test('one scope, version uniqueness and action limits are enforced in PostgreSQL', async () => {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('BEGIN');
    const library = randomUUID();
    await client.query(
      `INSERT INTO app."Library" (id,slug,title) VALUES ($1,$2,'[TEST] Policy library')`,
      [library, `test-policy-${library}`],
    );
    const insert = `INSERT INTO app."ContentPolicy" (id,"libraryId",version,"isActive","approvedAt","allowRead")
      VALUES ($1,$2,$3,$4,now(),true)`;
    await client.query(insert, [randomUUID(), library, 1, true]);
    async function rejects(sql: string, values: unknown[], code: string) {
      await client.query('SAVEPOINT invalid_policy');
      try {
        await assert.rejects(
          client.query(sql, values),
          (error: unknown) => (error as { code?: string }).code === code,
        );
      } finally {
        await client.query('ROLLBACK TO SAVEPOINT invalid_policy');
        await client.query('RELEASE SAVEPOINT invalid_policy');
      }
    }
    await rejects(insert, [randomUUID(), library, 1, false], '23505');
    await rejects(insert, [randomUUID(), library, 2, true], '23505');
    await rejects(
      `INSERT INTO app."ContentPolicy" (id,"libraryId","publicationId",version)
      VALUES ($1,$2,$3,2)`,
      [randomUUID(), library, randomUUID()],
      '23514',
    );
    await rejects(
      `INSERT INTO app."ContentPolicy" (id,"libraryId",version,"maxCopyChars")
      VALUES ($1,$2,2,-1)`,
      [randomUUID(), library],
      '23514',
    );
    await rejects(
      `INSERT INTO app."ContentPolicy" (id,"libraryId",version,"maxConcurrentSessions")
      VALUES ($1,$2,2,0)`,
      [randomUUID(), library],
      '23514',
    );
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
  }
});

test('reader leases reject duplicate seats, cross-user sessions and invalid expiry', async () => {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('BEGIN');
    const libraryId = randomUUID();
    const policyId = randomUUID();
    const userId = randomUUID();
    const otherUserId = randomUUID();
    const sessionId = randomUUID();
    const secondSessionId = randomUUID();
    await client.query(
      `INSERT INTO app."Library" (id,slug,title) VALUES ($1,$2,'[TEST] Lease library')`,
      [libraryId, `test-lease-${libraryId}`],
    );
    await client.query(
      `INSERT INTO app."ContentPolicy" (id,"libraryId",version,"isActive","approvedAt","allowRead","maxConcurrentSessions")
       VALUES ($1,$2,1,true,now(),true,1)`,
      [policyId, libraryId],
    );
    for (const id of [userId, otherUserId])
      await client.query(
        `INSERT INTO app."User" (id,email,"privacyVersion","createdAt","updatedAt")
         VALUES ($1,$2,'TEST-ONLY',now(),now())`,
        [id, `lease-${id}@example.invalid`],
      );
    await client.query(
      `INSERT INTO app."AuthSession" (id,"userId","tokenHash","expiresAt")
       VALUES ($1,$2,$3,now()+interval '1 hour')`,
      [sessionId, userId, randomUUID()],
    );
    await client.query(
      `INSERT INTO app."AuthSession" (id,"userId","tokenHash","expiresAt")
       VALUES ($1,$2,$3,now()+interval '1 hour')`,
      [secondSessionId, userId, randomUUID()],
    );
    const insert = `INSERT INTO app."ReaderLease" (id,"policyId","userId","sessionId","expiresAt")
      VALUES ($1,$2,$3,$4,now()+interval '15 minutes')`;
    await client.query(insert, [randomUUID(), policyId, userId, sessionId]);
    async function rejects(sql: string, values: unknown[], code: string) {
      await client.query('SAVEPOINT invalid_lease');
      try {
        await assert.rejects(
          client.query(sql, values),
          (error: unknown) => (error as { code?: string }).code === code,
        );
      } finally {
        await client.query('ROLLBACK TO SAVEPOINT invalid_lease');
        await client.query('RELEASE SAVEPOINT invalid_lease');
      }
    }
    await rejects(insert, [randomUUID(), policyId, userId, sessionId], '23505');
    await rejects(insert, [randomUUID(), policyId, otherUserId, sessionId], '23503');
    await rejects(
      `INSERT INTO app."ReaderLease" (id,"policyId","userId","sessionId","expiresAt")
       VALUES ($1,$2,$3,$4,now()-interval '1 minute')`,
      [randomUUID(), policyId, userId, secondSessionId],
      '23514',
    );
    await client.query(`DELETE FROM app."AuthSession" WHERE id=$1`, [sessionId]);
    const remaining = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM app."ReaderLease" WHERE "sessionId"=$1`,
      [sessionId],
    );
    assert.equal(Number(remaining.rows[0]!.count), 0);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
  }
});

test('reader preferences enforce allowed values and follow account deletion', async () => {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('BEGIN');
    const userId = randomUUID();
    await client.query(
      `INSERT INTO app."User" (id,email,"privacyVersion","createdAt","updatedAt")
       VALUES ($1,$2,'TEST-ONLY',now(),now())`,
      [userId, `reader-preference-${userId}@example.invalid`],
    );
    await client.query(
      `INSERT INTO app."ReaderPreference" ("userId",theme,"fontSize","fontFamily","lineSpacing")
       VALUES ($1,'sepia',21,'serif',175)`,
      [userId],
    );
    for (const [column, value] of [
      ['theme', 'invalid'],
      ['"fontSize"', 99],
      ['"fontFamily"', 'invalid'],
      ['"lineSpacing"', 120],
    ] as const) {
      await client.query('SAVEPOINT invalid_reader_preference');
      await assert.rejects(
        client.query(`UPDATE app."ReaderPreference" SET ${column}=$2 WHERE "userId"=$1`, [
          userId,
          value,
        ]),
        (error: unknown) => (error as { code?: string }).code === '23514',
      );
      await client.query('ROLLBACK TO SAVEPOINT invalid_reader_preference');
      await client.query('RELEASE SAVEPOINT invalid_reader_preference');
    }
    await client.query(`DELETE FROM app."User" WHERE id=$1`, [userId]);
    const remaining = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM app."ReaderPreference" WHERE "userId"=$1`,
      [userId],
    );
    assert.equal(Number(remaining.rows[0]!.count), 0);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
  }
});
