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
