import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import dotenv from 'dotenv';
import pg from 'pg';

const local = dotenv.parse(readFileSync(process.env.ARATA_ENV_FILE || '.env.local', 'utf8'));
const url = process.env.TEST_DATABASE_URL || local.TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== '/arata_techlibrary_test')
  throw new Error('Isolated entitlement test database required');
const pool = new pg.Pool({ connectionString: url, max: 2 });
async function rollback(run: (client: pg.PoolClient) => Promise<void>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await run(client);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
  }
}
async function reject(client: pg.PoolClient, sql: string, args: unknown[]) {
  await client.query('SAVEPOINT rejected');
  try {
    await client.query(sql, args);
    assert.fail('Expected database rejection');
  } catch (error) {
    assert.equal((error as { code?: string }).code, '23514');
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT rejected');
    await client.query('RELEASE SAVEPOINT rejected');
  }
}
async function user(client: pg.PoolClient) {
  const id = randomUUID();
  await client.query(
    `INSERT INTO app."User" (id,email,status,"emailVerifiedAt","termsAcceptedAt","privacyVersion","createdAt","updatedAt")
    VALUES ($1,$2,'ACTIVE',now(),now(),'TEST-ONLY',now(),now())`,
    [id, `entitlement-test-${id}@example.invalid`],
  );
  return id;
}
async function grant(client: pg.PoolClient, recipient: string, issuer: string, status = 'PENDING') {
  const id = randomUUID();
  await client.query(
    `INSERT INTO app."Entitlement" (id,"userId",source,status,scope,"grantedById","startsAt","endsAt",reason)
    VALUES ($1,$2,'COMPLIMENTARY',$3,'LIBRARY',$4,now()-interval '1 minute',now()+interval '1 day','[TEST ONLY] Access grant')`,
    [id, recipient, status, issuer],
  );
  return id;
}

test('independent grant approval, additive expiry and append-only history', async () =>
  rollback(async (client) => {
    const recipient = await user(client),
      issuer = await user(client),
      approver = await user(client);
    const first = await grant(client, recipient, issuer);
    await reject(client, `UPDATE app."Entitlement" SET status='ACTIVE' WHERE id=$1`, [first]);
    const approval = randomUUID();
    await client.query(
      `INSERT INTO app."GrantApproval" (id,"entitlementId","requestedById",reason)
    VALUES ($1,$2,$3,'[TEST ONLY] Approval')`,
      [approval, first, issuer],
    );
    await reject(
      client,
      `UPDATE app."GrantApproval" SET status='APPROVED',"approvedById"=$2,"decidedAt"=now() WHERE id=$1`,
      [approval, issuer],
    );
    await client.query(
      `UPDATE app."GrantApproval" SET status='APPROVED',"approvedById"=$2,"decidedAt"=now() WHERE id=$1`,
      [approval, approver],
    );
    await client.query(`UPDATE app."Entitlement" SET status='ACTIVE' WHERE id=$1`, [first]);
    const second = await grant(client, recipient, issuer);
    const secondApproval = randomUUID();
    await client.query(
      `INSERT INTO app."GrantApproval" (id,"entitlementId","requestedById",reason)
    VALUES ($1,$2,$3,'[TEST ONLY] Second approval')`,
      [secondApproval, second, issuer],
    );
    await client.query(
      `UPDATE app."GrantApproval" SET status='APPROVED',"approvedById"=$2,"decidedAt"=now() WHERE id=$1`,
      [secondApproval, approver],
    );
    await client.query(`UPDATE app."Entitlement" SET status='ACTIVE' WHERE id=$1`, [second]);
    await client.query(
      `UPDATE app."Entitlement" SET status='REVOKED',"revokedAt"=now() WHERE id=$1`,
      [first],
    );
    const active = await client.query<{ id: string }>(
      `SELECT id FROM app."EffectiveEntitlement" WHERE "userId"=$1`,
      [recipient],
    );
    assert.deepEqual(
      active.rows.map((row) => row.id),
      [second],
    );
    await reject(
      client,
      `UPDATE app."Entitlement" SET "endsAt"=now()+interval '2 days' WHERE id=$1`,
      [second],
    );
    await reject(client, `UPDATE app."GrantApproval" SET "approvedById"=$2 WHERE id=$1`, [
      approval,
      issuer,
    ]);
    await client.query(
      `INSERT INTO app."EntitlementEvent" (id,"entitlementId",action,reason)
    VALUES ($1,$2,'TEST_EVENT','[TEST ONLY] History')`,
      [randomUUID(), second],
    );
    await reject(client, `DELETE FROM app."EntitlementEvent" WHERE "entitlementId"=$1`, [second]);
  }));

test('campaign core and claim identity cannot change after issue', async () =>
  rollback(async (client) => {
    const issuer = await user(client),
      approver = await user(client),
      recipient = await user(client);
    const campaign = randomUUID();
    await client.query(
      `INSERT INTO app."GrantCampaign" (id,kind,name,reason,scope,"startsAt","endsAt","maxClaims","codeHash","createdById")
    VALUES ($1,'PROMOTION','[TEST ONLY] Code','[TEST ONLY] Promotion','LIBRARY',now()-interval '1 minute',now()+interval '1 day',1,$2,$3)`,
      [campaign, 'a'.repeat(64), issuer],
    );
    await reject(
      client,
      `UPDATE app."GrantCampaign" SET status='ACTIVE',"approvedById"=$2,"approvedAt"=now() WHERE id=$1`,
      [campaign, issuer],
    );
    await client.query(
      `UPDATE app."GrantCampaign" SET status='ACTIVE',"approvedById"=$2,"approvedAt"=now() WHERE id=$1`,
      [campaign, approver],
    );
    await reject(client, `UPDATE app."GrantCampaign" SET "maxClaims"=10 WHERE id=$1`, [campaign]);
    const entitlement = randomUUID();
    await client.query(
      `INSERT INTO app."Entitlement" (id,"userId",source,status,scope,"campaignId","grantedById","startsAt","endsAt",reason)
    VALUES ($1,$2,'PROMOTION','PENDING','LIBRARY',$3,$4,now()-interval '1 minute',now()+interval '1 day','[TEST ONLY] Code')`,
      [entitlement, recipient, campaign, issuer],
    );
    await reject(client, `UPDATE app."Entitlement" SET status='ACTIVE' WHERE id=$1`, [entitlement]);
    await client.query(
      `INSERT INTO app."GrantCampaignClaim" ("campaignId","userId","entitlementId","claimedAt") VALUES ($1,$2,$3,now())`,
      [campaign, recipient, entitlement],
    );
    await client.query(`UPDATE app."Entitlement" SET status='ACTIVE' WHERE id=$1`, [entitlement]);
    await reject(
      client,
      `UPDATE app."GrantCampaignClaim" SET "entitlementId"=$2 WHERE "campaignId"=$1`,
      [campaign, randomUUID()],
    );
  }));

test('institution agreements require a different approver and retain their scope', async () =>
  rollback(async (client) => {
    const issuer = await user(client),
      approver = await user(client);
    const institution = randomUUID(),
      agreement = randomUUID();
    await client.query(
      `INSERT INTO app."Institution" (id,"legalName",status,"verificationMode","approvedAt")
      VALUES ($1,'[TEST ONLY] Institution','APPROVED','MANUAL',now())`,
      [institution],
    );
    await client.query(
      `INSERT INTO app."InstitutionAgreement" (id,"institutionId","createdById",scope,
      "memberLimit","permittedCategories","startsAt","endsAt")
      VALUES ($1,$2,$3,'LIBRARY',20,ARRAY['STUDENT'],now(),now()+interval '30 days')`,
      [agreement, institution, issuer],
    );
    await reject(
      client,
      `UPDATE app."InstitutionAgreement" SET status='APPROVED',
      "approvedById"=$2,"approvedAt"=now() WHERE id=$1`,
      [agreement, issuer],
    );
    await client.query(
      `UPDATE app."InstitutionAgreement" SET status='APPROVED',
      "approvedById"=$2,"approvedAt"=now() WHERE id=$1`,
      [agreement, approver],
    );
    await reject(client, `UPDATE app."InstitutionAgreement" SET "memberLimit"=200 WHERE id=$1`, [
      agreement,
    ]);
  }));

test.after(async () => {
  await pool.end();
});
