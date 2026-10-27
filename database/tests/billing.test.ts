import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import dotenv from 'dotenv';
import pg from 'pg';

const local = dotenv.parse(readFileSync(process.env.ARATA_ENV_FILE || '.env.local', 'utf8'));
const url = process.env.TEST_DATABASE_URL || local.TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== '/arata_techlibrary_test')
  throw new Error('Billing constraints require the isolated test database');

test('PostgreSQL rejects duplicate orders and unverified paid state', async () => {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('BEGIN');
    const userId = randomUUID();
    const planId = randomUUID();
    const planVersionId = randomUUID();
    const subscriptionId = randomUUID();
    const orderId = randomUUID();
    const attemptId = randomUUID();
    await client.query(
      `INSERT INTO app."User" (id,email,"privacyVersion","createdAt","updatedAt") VALUES ($1,$2,'TEST-ONLY',now(),now())`,
      [userId, `billing-sql-${userId}@example.invalid`],
    );
    await client.query(
      `INSERT INTO app."Plan" (id,code,name,active) VALUES ($1,$2,'[TEST ONLY] SQL billing',true)`,
      [planId, `TEST:${planId}`],
    );
    await client.query(
      `INSERT INTO app."PlanVersion" (id,"planId",version,"currencyCode","amountMinor","periodMonths","scopeKind","termsHash","validFrom")
      VALUES ($1,$2,1,'UGX',2000,1,'LIBRARY',$3,now())`,
      [planVersionId, planId, randomUUID()],
    );
    await client.query(
      `INSERT INTO app."Subscription" (id,"userId","planVersionId") VALUES ($1,$2,$3)`,
      [subscriptionId, userId, planVersionId],
    );
    await client.query(
      `INSERT INTO app."Order" (id,"userId","planVersionId","subscriptionId","merchantRef","idempotencyKey","currencyCode","totalMinor")
      VALUES ($1,$2,$3,$4,$5,$6,'UGX',2000)`,
      [orderId, userId, planVersionId, subscriptionId, `ATL-TEST-${orderId}`, randomUUID()],
    );
    await client.query(
      `INSERT INTO app."PaymentAttempt" (id,"orderId",provider,"providerRef","idempotencyKey","amountMinor","currencyCode")
      VALUES ($1,$2,'FLUTTERWAVE_V3',$3,$4,2000,'UGX')`,
      [attemptId, orderId, `ATL-TEST-${orderId}`, randomUUID()],
    );
    async function rejects(sql: string, params: unknown[], code: string) {
      await client.query('SAVEPOINT invalid_billing');
      try {
        await assert.rejects(
          client.query(sql, params),
          (error: unknown) => (error as { code?: string }).code === code,
        );
      } finally {
        await client.query('ROLLBACK TO SAVEPOINT invalid_billing');
        await client.query('RELEASE SAVEPOINT invalid_billing');
      }
    }
    await rejects(
      `UPDATE app."Order" SET status='PAID',"paidAt"=now() WHERE id=$1`,
      [orderId],
      '23514',
    );
    await rejects(
      `UPDATE app."PaymentAttempt" SET status='VERIFIED',"verifiedAt"=now(),"providerTransactionId"='123' WHERE id=$1`,
      [attemptId],
      '23514',
    );
    await rejects(
      `UPDATE app."PaymentAttempt" SET "amountMinor"=1 WHERE id=$1`,
      [attemptId],
      '23514',
    );
    await rejects(
      `INSERT INTO app."Order" (id,"userId","planVersionId","subscriptionId","merchantRef","idempotencyKey","currencyCode","totalMinor")
      SELECT $1,"userId","planVersionId","subscriptionId","merchantRef","idempotencyKey","currencyCode","totalMinor" FROM app."Order" WHERE id=$2`,
      [randomUUID(), orderId],
      '23505',
    );
    await rejects(
      `INSERT INTO app."PlanVersion" (id,"planId",version,"currencyCode","amountMinor","periodMonths","scopeKind","scopeId","termsHash","validFrom")
      VALUES ($1,$2,2,'UGX',2000,1,'VOLUME',$3,$4,now())`,
      [randomUUID(), planId, randomUUID(), randomUUID()],
      '23503',
    );
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
  }
});
