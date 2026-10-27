import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import dotenv from 'dotenv';
import pg from 'pg';

const local = dotenv.parse(readFileSync(process.env.ARATA_ENV_FILE || '.env.local', 'utf8'));
const testUrl = process.env.TEST_DATABASE_URL || local.TEST_DATABASE_URL;
if (!testUrl)
  throw new Error(
    'TEST_DATABASE_URL is required; integration tests never use the development database',
  );

type Client = pg.PoolClient;
const pool = new pg.Pool({ connectionString: testUrl, max: 4 });

async function inTransaction(run: (client: Client) => Promise<void>): Promise<void> {
  const client = await pool.connect();
  try {
    const db = await client.query<{ name: string }>('SELECT current_database() AS name');
    assert.equal(db.rows[0]?.name, 'arata_techlibrary_test');
    await client.query('BEGIN');
    await run(client);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
  }
}

async function rejectSql(
  client: Client,
  sql: string,
  values: unknown[],
  code: string,
): Promise<void> {
  await client.query('SAVEPOINT expected_failure');
  try {
    await client.query(sql, values);
    assert.fail(`Expected SQLSTATE ${code}`);
  } catch (error) {
    assert.equal((error as { code?: string }).code, code);
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT expected_failure');
    await client.query('RELEASE SAVEPOINT expected_failure');
  }
}

async function addUser(client: Client, verified = true): Promise<string> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO app."User" (id, email, status, "emailVerifiedAt", "termsAcceptedAt", "privacyVersion", "createdAt", "updatedAt")
    VALUES ($1, $2, 'ACTIVE', $3, now(), 'TEST-ONLY', now(), now())`,
    [id, `test-${id}@example.invalid`, verified ? new Date() : null],
  );
  return id;
}

async function addPublication(
  client: Client,
  ownerId: string,
  kind: 'STANDALONE' | 'SERIES' = 'STANDALONE',
): Promise<string> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO app."Publication" (id, slug, title, kind, status, "ownerId", "languageCode", "sourceRef", "licenceCode", "copyrightNotice", "createdAt", "updatedAt")
    VALUES ($1, $2, '[TEST ONLY] Unpublished book', $3, 'DRAFT', $4, 'en', 'TEST-SOURCE', 'TEST-ONLY', '[TEST ONLY] Synthetic rights', now(), now())`,
    [id, `test-${id}`, kind, ownerId],
  );
  const contributorId = randomUUID();
  await client.query(
    `INSERT INTO app."Contributor" (id,"displayName",slug) VALUES ($1,'[TEST ONLY] Author',$2)`,
    [contributorId, `test-${contributorId}`],
  );
  await client.query(
    `INSERT INTO app."PublicationContributor" ("publicationId","contributorId",role,ordinal) VALUES ($1,$2,'AUTHOR',0)`,
    [id, contributorId],
  );
  return id;
}

async function addEdition(
  client: Client,
  publicationId: string,
  volumeId: string | null = null,
): Promise<string> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO app."Edition" (id, "publicationId", "volumeId", "editionCode", label)
    VALUES ($1, $2, $3, 'E1', '[TEST ONLY] Edition')`,
    [id, publicationId, volumeId],
  );
  return id;
}

async function paidOrder(
  client: Client,
  userId: string,
): Promise<{ orderId: string; paymentId: string }> {
  const planId = randomUUID();
  const versionId = randomUUID();
  const orderId = randomUUID();
  const paymentId = randomUUID();
  await client.query('INSERT INTO app."Plan" (id, code, name) VALUES ($1, $2, $3)', [
    planId,
    `TEST-${planId}`,
    '[TEST ONLY] Plan',
  ]);
  await client.query(
    `INSERT INTO app."PlanVersion" (id, "planId", version, "currencyCode", "amountMinor", "periodMonths", "scopeKind", "termsHash", "validFrom")
    VALUES ($1, $2, 1, 'UGX', 1000, 1, 'LIBRARY', $3, now())`,
    [versionId, planId, 'a'.repeat(64)],
  );
  await client.query(
    `INSERT INTO app."Order" (id, "userId", "planVersionId", "merchantRef", "idempotencyKey", "currencyCode", "totalMinor")
    VALUES ($1, $2, $3, $4, $5, 'UGX', 1000)`,
    [orderId, userId, versionId, `merchant-${orderId}`, `order-${orderId}`],
  );
  await client.query(
    `INSERT INTO app."PaymentAttempt" (id, "orderId", provider, "idempotencyKey", "amountMinor", "currencyCode")
    VALUES ($1, $2, 'TEST_PROVIDER', $3, 1000, 'UGX')`,
    [paymentId, orderId, `attempt-${paymentId}`],
  );
  return { orderId, paymentId };
}

test('referential integrity and hierarchy reject missing or mismatched parents', async () =>
  inTransaction(async (client) => {
    const userId = await addUser(client);
    const pubId = await addPublication(client, userId, 'SERIES');
    const volumeId = randomUUID();
    await rejectSql(
      client,
      `INSERT INTO app."Volume" (id, "publicationId", ordinal, title) VALUES ($1, $2, 1, 'Invalid')`,
      [volumeId, randomUUID()],
      '23503',
    );
    await client.query(
      `INSERT INTO app."Volume" (id, "publicationId", ordinal, title) VALUES ($1, $2, 1, 'Volume')`,
      [volumeId, pubId],
    );
    await rejectSql(
      client,
      `INSERT INTO app."Edition" (id, "publicationId", "editionCode", label) VALUES ($1, $2, 'E1', 'Invalid')`,
      [randomUUID(), pubId],
      '23514',
    );
    const other = await addPublication(client, userId, 'SERIES');
    await rejectSql(
      client,
      `INSERT INTO app."Edition" (id, "publicationId", "volumeId", "editionCode", label) VALUES ($1, $2, $3, 'E1', 'Invalid')`,
      [randomUUID(), other, volumeId],
      '23503',
    );
  }));

test('duplicate identities, volume order and standalone edition codes are rejected', async () =>
  inTransaction(async (client) => {
    const userId = await addUser(client);
    const email = await client.query<{ email: string }>(
      'SELECT email FROM app."User" WHERE id = $1',
      [userId],
    );
    await rejectSql(
      client,
      `INSERT INTO app."User" (id, email, "termsAcceptedAt", "privacyVersion", "updatedAt") VALUES ($1, $2, now(), 'TEST', now())`,
      [randomUUID(), email.rows[0]?.email],
      '23505',
    );
    const pubId = await addPublication(client, userId);
    await addEdition(client, pubId);
    await rejectSql(
      client,
      `INSERT INTO app."Edition" (id, "publicationId", "editionCode", label) VALUES ($1, $2, 'E1', 'Duplicate')`,
      [randomUUID(), pubId],
      '23505',
    );
    await rejectSql(
      client,
      `INSERT INTO app."Edition" (id, "publicationId", "editionCode", label) VALUES ($1, $2, 'E2', 'Duplicate order')`,
      [randomUUID(), pubId],
      '23505',
    );
    const series = await addPublication(client, userId, 'SERIES');
    await client.query(
      `INSERT INTO app."Volume" (id, "publicationId", ordinal, title) VALUES ($1, $2, 1, 'One')`,
      [randomUUID(), series],
    );
    await rejectSql(
      client,
      `INSERT INTO app."Volume" (id, "publicationId", ordinal, title) VALUES ($1, $2, 1, 'Two')`,
      [randomUUID(), series],
      '23505',
    );
  }));

test('published revisions and their children are immutable and current pointers cannot cross editions', async () =>
  inTransaction(async (client) => {
    const author = await addUser(client);
    const reviewer = await addUser(client);
    const pubId = await addPublication(client, author);
    const editionId = await addEdition(client, pubId);
    const revisionId = randomUUID();
    const hash = 'b'.repeat(64);
    await client.query(
      `INSERT INTO app."Revision" (id, "editionId", number, status, "manifestHash", "createdById") VALUES ($1, $2, 1, 'DRAFT', $3, $4)`,
      [revisionId, editionId, hash, author],
    );
    const chapterId = randomUUID();
    await client.query(
      `INSERT INTO app."Chapter" (id, "revisionId", ordinal, slug, title) VALUES ($1, $2, 1, 'intro', 'Intro')`,
      [chapterId, revisionId],
    );
    const lessonId = randomUUID();
    await client.query(
      `INSERT INTO app."Lesson" (id, "chapterId", ordinal, title) VALUES ($1, $2, 1, 'Lesson')`,
      [lessonId, chapterId],
    );
    await rejectSql(
      client,
      `UPDATE app."Revision" SET status = 'PUBLISHED', "publishedAt" = now() WHERE id = $1`,
      [revisionId],
      '23514',
    );
    await client.query(
      `UPDATE app."Revision" SET status='IN_REVIEW',"submittedAt"=now() WHERE id=$1`,
      [revisionId],
    );
    await client.query(
      `INSERT INTO app."EditorialReview" (id, "revisionId", "reviewerId", decision, "manifestHash") VALUES ($1, $2, $3, 'APPROVED', $4)`,
      [randomUUID(), revisionId, reviewer, hash],
    );
    await client.query(`UPDATE app."Revision" SET status='APPROVED' WHERE id=$1`, [revisionId]);
    await client.query(
      `INSERT INTO app."RightsAttestation" (id,"publicationId","revisionId","actorId","manifestHash","licenceCode","sourceRef") VALUES ($1,$2,$3,$4,$5,'TEST-ONLY','TEST-SOURCE')`,
      [randomUUID(), pubId, revisionId, author, hash],
    );
    await client.query(
      `UPDATE app."Revision" SET status = 'PUBLISHED', "publishedAt" = now(),"publishedById"=$2 WHERE id = $1`,
      [revisionId, reviewer],
    );
    await rejectSql(
      client,
      `UPDATE app."Revision" SET "changeSummary" = 'changed' WHERE id = $1`,
      [revisionId],
      '23514',
    );
    await rejectSql(
      client,
      `UPDATE app."Lesson" SET title = 'changed' WHERE id = $1`,
      [lessonId],
      '23514',
    );
    await rejectSql(client, `DELETE FROM app."Chapter" WHERE id = $1`, [chapterId], '23514');
    await client.query(`UPDATE app."Edition" SET "currentRevisionId" = $1 WHERE id = $2`, [
      revisionId,
      editionId,
    ]);
    const anotherEdition = randomUUID();
    await client.query(
      `INSERT INTO app."Edition" (id, "publicationId", ordinal, "editionCode", label) VALUES ($1, $2, 2, 'E2', 'Second')`,
      [anotherEdition, pubId],
    );
    await rejectSql(
      client,
      `UPDATE app."Edition" SET "currentRevisionId" = $1 WHERE id = $2`,
      [revisionId, anotherEdition],
      '23514',
    );
  }));

test('submitted editorial metadata and manuscript rows reject direct SQL edits while new editions remain editable', async () =>
  inTransaction(async (client) => {
    const author = await addUser(client);
    const pubId = await addPublication(client, author, 'SERIES');
    const volumeId = randomUUID();
    await client.query(
      `INSERT INTO app."Volume" (id,"publicationId",ordinal,title) VALUES ($1,$2,1,'Draft volume')`,
      [volumeId, pubId],
    );
    const editionId = await addEdition(client, pubId, volumeId);
    const revisionId = randomUUID();
    await client.query(
      `INSERT INTO app."Revision" (id,"editionId",number,status,"createdById") VALUES ($1,$2,1,'DRAFT',$3)`,
      [revisionId, editionId, author],
    );
    const chapterId = randomUUID();
    await client.query(
      `INSERT INTO app."Chapter" (id,"revisionId",ordinal,slug,title) VALUES ($1,$2,1,'intro','Draft chapter')`,
      [chapterId, revisionId],
    );
    const lessonId = randomUUID();
    await client.query(
      `INSERT INTO app."Lesson" (id,"chapterId",ordinal,title) VALUES ($1,$2,1,'Draft lesson')`,
      [lessonId, chapterId],
    );
    const resourceId = randomUUID();
    await client.query(
      `INSERT INTO app."Resource" (id,title,"licenceCode","chapterId") VALUES ($1,'[TEST ONLY] Chapter resource','TEST-ONLY',$2)`,
      [resourceId, chapterId],
    );
    const referenceId = randomUUID();
    await client.query(
      `INSERT INTO app."CrossReference" (id,"sourceLessonId","targetPublicationId",label) VALUES ($1,$2,$3,'See book')`,
      [referenceId, lessonId, pubId],
    );
    await client.query(`UPDATE app."Publication" SET title='Edited draft' WHERE id=$1`, [pubId]);
    await client.query(`UPDATE app."Volume" SET title='Edited draft volume' WHERE id=$1`, [
      volumeId,
    ]);
    await client.query(`UPDATE app."Edition" SET label='Edited draft edition' WHERE id=$1`, [
      editionId,
    ]);
    await client.query(`UPDATE app."Chapter" SET title='Edited draft chapter' WHERE id=$1`, [
      chapterId,
    ]);
    await client.query(
      `UPDATE app."Revision" SET status='IN_REVIEW',"manifestHash"=$2,"submittedAt"=now() WHERE id=$1`,
      [revisionId, 'e'.repeat(64)],
    );
    await rejectSql(
      client,
      `UPDATE app."Publication" SET title='Changed after submit' WHERE id=$1`,
      [pubId],
      '23514',
    );
    await rejectSql(
      client,
      `UPDATE app."Volume" SET title='Changed after submit' WHERE id=$1`,
      [volumeId],
      '23514',
    );
    await rejectSql(
      client,
      `UPDATE app."Edition" SET label='Changed after submit' WHERE id=$1`,
      [editionId],
      '23514',
    );
    await rejectSql(
      client,
      `UPDATE app."Chapter" SET title='Changed after submit' WHERE id=$1`,
      [chapterId],
      '23514',
    );
    await rejectSql(
      client,
      `UPDATE app."Resource" SET title='Changed after submit' WHERE id=$1`,
      [resourceId],
      '23514',
    );
    await rejectSql(
      client,
      `UPDATE app."CrossReference" SET label='Changed after submit' WHERE id=$1`,
      [referenceId],
      '23514',
    );
    const contributor = await client.query<{ contributorId: string }>(
      `SELECT "contributorId" FROM app."PublicationContributor" WHERE "publicationId"=$1`,
      [pubId],
    );
    await rejectSql(
      client,
      `UPDATE app."Contributor" SET "displayName"='Changed after submit' WHERE id=$1`,
      [contributor.rows[0]!.contributorId],
      '23514',
    );
    await rejectSql(
      client,
      `UPDATE app."PublicationContributor" SET ordinal=2 WHERE "publicationId"=$1`,
      [pubId],
      '23514',
    );
    const nextEdition = await client.query<{ id: string }>(
      `INSERT INTO app."Edition" (id,"publicationId","volumeId",ordinal,"editionCode",label) VALUES (gen_random_uuid(),$1,$2,2,'E2','Next draft edition') RETURNING id`,
      [pubId, volumeId],
    );
    await client.query(`UPDATE app."Edition" SET label='Editable next edition' WHERE id=$1`, [
      nextEdition.rows[0]!.id,
    ]);
    await client.query(`UPDATE app."Revision" SET status='DRAFT' WHERE id=$1`, [revisionId]);
    await client.query(
      `UPDATE app."Chapter" SET title='Editable after review return' WHERE id=$1`,
      [chapterId],
    );
  }));

test('entitlement expiry is computed from UTC time and overlapping grants remain additive', async () =>
  inTransaction(async (client) => {
    const userId = await addUser(client);
    const endedTrial = randomUUID();
    await client.query(
      `INSERT INTO app."TrialUsage" (id, "userId", "campaignKey", "startsAt", "endsAt") VALUES ($1, $2, 'ended', now() - interval '2 days', now() - interval '1 day')`,
      [endedTrial, userId],
    );
    await client.query(
      `INSERT INTO app."Entitlement" (id, "userId", source, status, scope, "trialUsageId", "startsAt", "endsAt")
    VALUES ($1, $2, 'TRIAL', 'ACTIVE', 'LIBRARY', $3, now() - interval '2 days', now() - interval '1 day')`,
      [randomUUID(), userId, endedTrial],
    );
    const activeTrial = randomUUID();
    await client.query(
      `INSERT INTO app."TrialUsage" (id, "userId", "campaignKey", "startsAt", "endsAt") VALUES ($1, $2, 'active', now() - interval '1 hour', now() + interval '1 day')`,
      [activeTrial, userId],
    );
    const first = randomUUID();
    const second = randomUUID();
    for (const id of [first, second]) {
      const trial = id === first ? activeTrial : randomUUID();
      if (id === second)
        await client.query(
          `INSERT INTO app."TrialUsage" (id, "userId", "campaignKey", "startsAt", "endsAt") VALUES ($1, $2, 'active-2', now() - interval '1 hour', now() + interval '1 day')`,
          [trial, userId],
        );
      await client.query(
        `INSERT INTO app."Entitlement" (id, "userId", source, status, scope, "trialUsageId", "startsAt", "endsAt")
      VALUES ($1, $2, 'TRIAL', 'ACTIVE', 'LIBRARY', $3, now() - interval '1 hour', now() + interval '1 day')`,
        [id, userId, trial],
      );
    }
    const before = await client.query<{ count: string }>(
      'SELECT count(*) FROM app."EffectiveEntitlement" WHERE "userId" = $1',
      [userId],
    );
    assert.equal(Number(before.rows[0]?.count), 2);
    await client.query(
      `UPDATE app."Entitlement" SET status = 'REVOKED', "revokedAt" = now() WHERE id = $1`,
      [first],
    );
    const after = await client.query<{ count: string }>(
      'SELECT count(*) FROM app."EffectiveEntitlement" WHERE "userId" = $1',
      [userId],
    );
    assert.equal(Number(after.rows[0]?.count), 1);
  }));

test('institution benefits require approved institution, verified identity and membership', async () =>
  inTransaction(async (client) => {
    const userId = await addUser(client, false);
    const issuerId = await addUser(client);
    const approverId = await addUser(client);
    const instId = randomUUID();
    const membershipId = randomUUID();
    await client.query(
      `INSERT INTO app."Institution" (id, "legalName", status, "verificationMode", "approvedAt") VALUES ($1, '[TEST ONLY] Institution', 'APPROVED', 'MANUAL', now())`,
      [instId],
    );
    await client.query(
      `INSERT INTO app."EligibilityPolicy" (id, "institutionId", category, scope, "verificationMode", "validityDays", active)
    VALUES ($1, $2, 'STUDENT', 'LIBRARY', 'MANUAL', 30, true)`,
      [randomUUID(), instId],
    );
    await client.query(
      `INSERT INTO app."Membership" (id, "institutionId", "userId", status, "verificationMethod") VALUES ($1, $2, $3, 'PENDING', 'MANUAL')`,
      [membershipId, instId, userId],
    );
    await rejectSql(
      client,
      `UPDATE app."Membership" SET status = 'VERIFIED', "verifiedAt" = now(), "evidenceRef" = 'test-evidence' WHERE id = $1`,
      [membershipId],
      '23514',
    );
    await client.query(
      `UPDATE app."User" SET "emailVerifiedAt" = now(), "updatedAt" = now() WHERE id = $1`,
      [userId],
    );
    await client.query(
      `UPDATE app."Membership" SET status = 'VERIFIED', "verifiedAt" = now(), "evidenceRef" = 'test-evidence', "expiresAt" = now() + interval '30 days' WHERE id = $1`,
      [membershipId],
    );
    const grantId = randomUUID();
    await client.query(
      `INSERT INTO app."Entitlement" (id, "userId", source, status, scope, "membershipId", "grantedById", "startsAt", "endsAt")
    VALUES ($1, $2, 'INSTITUTION', 'PENDING', 'LIBRARY', $3, $4, now(), now() + interval '29 days')`,
      [grantId, userId, membershipId, issuerId],
    );
    await rejectSql(
      client,
      `UPDATE app."Entitlement" SET status='ACTIVE' WHERE id=$1`,
      [grantId],
      '23514',
    );
    const approvalId = randomUUID();
    await client.query(
      `INSERT INTO app."GrantApproval" (id,"entitlementId","requestedById","approvedById",status,reason,"decidedAt")
    VALUES ($1,$2,$3,$4,'APPROVED','[TEST ONLY] Independent review',now())`,
      [approvalId, grantId, issuerId, approverId],
    );
    await client.query(`UPDATE app."Entitlement" SET status='ACTIVE' WHERE id=$1`, [grantId]);
    await rejectSql(
      client,
      `INSERT INTO app."Entitlement" (id, "userId", source, status, scope, "membershipId", "startsAt", "endsAt")
    VALUES ($1, $2, 'INSTITUTION', 'ACTIVE', 'LIBRARY', $3, now(), now() + interval '31 days')`,
      [randomUUID(), userId, membershipId],
      '23514',
    );
    const cohortId = randomUUID();
    await client.query(
      `INSERT INTO app."Cohort" (id, "institutionId", name) VALUES ($1, $2, 'Test cohort')`,
      [cohortId, instId],
    );
    await rejectSql(
      client,
      `INSERT INTO app."CohortMember" ("cohortId", "userId") VALUES ($1, $2)`,
      [cohortId, await addUser(client)],
      '23514',
    );
  }));

test('verified payment and order activation require signed matching events; duplicate callbacks fail', async () =>
  inTransaction(async (client) => {
    const userId = await addUser(client);
    const { orderId, paymentId } = await paidOrder(client, userId);
    await rejectSql(
      client,
      `UPDATE app."Order" SET status = 'PAID', "paidAt" = now() WHERE id = $1`,
      [orderId],
      '23514',
    );
    await rejectSql(
      client,
      `UPDATE app."PaymentAttempt" SET status = 'VERIFIED', "verifiedAt" = now() WHERE id = $1`,
      [paymentId],
      '23514',
    );
    const eventId = randomUUID();
    await client.query(
      `INSERT INTO app."GatewayEvent" (id, provider, "providerEventId", "paymentAttemptId", "payloadHash", "signatureValid")
    VALUES ($1, 'TEST_PROVIDER', 'event-1', $2, $3, true)`,
      [eventId, paymentId, 'c'.repeat(64)],
    );
    await rejectSql(
      client,
      `INSERT INTO app."GatewayEvent" (id, provider, "providerEventId", "paymentAttemptId", "payloadHash", "signatureValid")
    VALUES ($1, 'TEST_PROVIDER', 'event-1', $2, $3, true)`,
      [randomUUID(), paymentId, 'd'.repeat(64)],
      '23505',
    );
    await rejectSql(
      client,
      `UPDATE app."PaymentAttempt" SET status = 'VERIFIED', "verifiedAt" = now() WHERE id = $1`,
      [paymentId],
      '23514',
    );
    await client.query(`UPDATE app."GatewayEvent" SET "serverVerifiedAt" = now() WHERE id = $1`, [
      eventId,
    ]);
    await client.query(
      `UPDATE app."PaymentAttempt" SET status = 'VERIFIED', "verifiedAt" = now(), "providerTransactionId" = 'TEST-TRANSACTION-1' WHERE id = $1`,
      [paymentId],
    );
    await client.query(`UPDATE app."Order" SET status = 'PAID', "paidAt" = now() WHERE id = $1`, [
      orderId,
    ]);
    await client.query(
      `INSERT INTO app."Entitlement" (id, "userId", source, status, scope, "orderId", "startsAt", "endsAt")
    VALUES ($1, $2, 'PAID', 'ACTIVE', 'LIBRARY', $3, now(), now() + interval '30 days')`,
      [randomUUID(), userId, orderId],
    );
    await rejectSql(
      client,
      `INSERT INTO app."Entitlement" (id, "userId", source, status, scope, "orderId", "startsAt", "endsAt")
    VALUES ($1, $2, 'PAID', 'ACTIVE', 'LIBRARY', $3, now(), now() + interval '30 days')`,
      [randomUUID(), userId, orderId],
      '23505',
    );
  }));

test('research events deduplicate and optional purpose requires consent version', async () =>
  inTransaction(async (client) => {
    const purposeId = randomUUID();
    await client.query(
      `INSERT INTO app."ProcessingPurpose" (id, code, description, "lawfulBasis", optional) VALUES ($1, $2, 'Test purpose', 'TEST ONLY', true)`,
      [purposeId, `TEST-${purposeId}`],
    );
    const eventId = randomUUID();
    const sql = `INSERT INTO research."ResearchEvent" (id, "eventId", pseudonym, "purposeId", "eventType", "schemaVersion", source, "eventAt", "retentionUntil", properties, "consentVersion")
    VALUES ($1, $2, 'pseudonym-test', $3, 'PAGE_VIEW', 1, 'CLIENT', now(), now() + interval '1 day', '{}'::jsonb, $4)`;
    await rejectSql(client, sql, [randomUUID(), eventId, purposeId, null], '23514');
    await client.query(sql, [randomUUID(), eventId, purposeId, 'TEST-CONSENT']);
    await rejectSql(client, sql, [randomUUID(), eventId, purposeId, 'TEST-CONSENT'], '23505');
    await rejectSql(
      client,
      sql.replace("now() + interval '1 day'", "now() - interval '1 day'"),
      [randomUUID(), randomUUID(), purposeId, 'TEST-CONSENT'],
      '23514',
    );
  }));

test('deletion preserves published evidence and audits while identity mapping can be erased', async () =>
  inTransaction(async (client) => {
    const userId = await addUser(client);
    const pubId = await addPublication(client, userId);
    await addEdition(client, pubId);
    await rejectSql(client, `DELETE FROM app."Publication" WHERE id = $1`, [pubId], '23001');
    const auditId = randomUUID();
    await client.query(
      `INSERT INTO app."AuditEvent" (id, "actorId", action, "objectType", "objectId", "correlationId")
    VALUES ($1, $2, 'TEST', 'Publication', $3, 'test-correlation')`,
      [auditId, userId, pubId],
    );
    await rejectSql(client, `DELETE FROM app."AuditEvent" WHERE id = $1`, [auditId], '23514');
    const unlinkUser = await addUser(client);
    await client.query(
      `INSERT INTO research_private."PseudonymLink" (id, "userId", pseudonym, "keyVersion") VALUES ($1, $2, $3, 'TEST')`,
      [randomUUID(), unlinkUser, `p-${unlinkUser}`],
    );
    await client.query(`DELETE FROM app."User" WHERE id = $1`, [unlinkUser]);
    const link = await client.query<{ count: string }>(
      'SELECT count(*) FROM research_private."PseudonymLink" WHERE "userId" = $1',
      [unlinkUser],
    );
    assert.equal(Number(link.rows[0]?.count), 0);
  }));

test.after(async () => {
  await pool.end();
});
