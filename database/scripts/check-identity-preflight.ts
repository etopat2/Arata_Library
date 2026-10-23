import { readFileSync } from 'node:fs';
import dotenv from 'dotenv';
import pg from 'pg';

const local = dotenv.parse(readFileSync(process.env.ARATA_ENV_FILE || '.env.local', 'utf8'));
const url = process.env.MIGRATION_DATABASE_URL || local.MIGRATION_DATABASE_URL;
if (!url) throw new Error('MIGRATION_DATABASE_URL is required');
const client = new pg.Client({ connectionString: url });
try {
  await client.connect();
  const database = await client.query<{ name: string }>('SELECT current_database() AS name');
  if (!['arata_techlibrary_dev', 'arata_techlibrary_test'].includes(database.rows[0]?.name ?? '')) throw new Error('Unexpected database');
  const result = await client.query<{ duplicate_groups: number; noncanonical: number }>(`SELECT
    (SELECT count(*)::int FROM (SELECT lower(email) FROM app."User" GROUP BY lower(email) HAVING count(*)>1) duplicates) AS duplicate_groups,
    (SELECT count(*)::int FROM app."User" WHERE email<>lower(email)) AS noncanonical`);
  const { duplicate_groups, noncanonical } = result.rows[0]!;
  if (duplicate_groups || noncanonical) throw new Error('Identity email normalization needs manual review before unique index');
  console.info(`Identity preflight passed for ${database.rows[0]!.name}; no duplicate or noncanonical email rows.`);
} finally { await client.end(); }
