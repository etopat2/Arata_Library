import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import dotenv from 'dotenv';
import pg from 'pg';
import type { INestApplication } from '@nestjs/common';
import { createApp } from '../../apps/api/src/app.js';
import { tokenHash } from '../../apps/api/src/identity/security.js';

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
const fixture = new pg.Client({ connectionString: local.TEST_DATABASE_URL });
const suffix = randomUUID().slice(0, 8);
const seriesSlug = `test-series-${suffix}`;
const draftSlug = `test-draft-${suffix}`;
const collectionSlug = `test-collection-${suffix}`;
const privatePhrase = `PREMIUM_PRIVATE_${suffix}`;
const draftPhrase = `DRAFT_PRIVATE_${suffix}`;
let app: INestApplication;
let base: string;
let editionId: string;
let volumeId: string;
let sampleId: string;
let lockedId: string;
let freeId: string;
let premiumId: string;
let registeredId: string;
let withdrawnId: string;
let freeLessonId: string;
let lockedLessonId: string;
const sessionToken = randomBytes(36).toString('base64url');
const adminToken = randomBytes(36).toString('base64url');
let policyLibraryId: string;

async function get(path: string) {
  const response = await fetch(`${base}/api/v1${path}`);
  return { response, text: await response.text() };
}

beforeAll(async () => {
  await fixture.connect();
  await fixture.query('BEGIN');
  try {
    const user = await fixture.query<{ id: string }>(
      `INSERT INTO app."User" (id,email,status,"emailVerifiedAt","termsAcceptedAt","privacyVersion","createdAt","updatedAt")
       VALUES (gen_random_uuid(),$1,'ACTIVE',now(),now(),'TEST-ONLY',now(),now()) RETURNING id`,
      [`catalogue-${suffix}@example.invalid`],
    );
    const userId = user.rows[0]!.id;
    await fixture.query(
      `INSERT INTO app."AuthSession" (id,"userId","tokenHash","expiresAt") VALUES (gen_random_uuid(),$1,$2,now()+interval '1 hour')`,
      [userId, tokenHash(sessionToken)],
    );
    const admin = await fixture.query<{ id: string }>(
      `INSERT INTO app."User" (id,email,status,"emailVerifiedAt","termsAcceptedAt","privacyVersion","createdAt","updatedAt")
       VALUES (gen_random_uuid(),$1,'ACTIVE',now(),now(),'TEST-ONLY',now(),now()) RETURNING id`,
      [`reader-admin-${suffix}@example.invalid`],
    );
    await fixture.query(
      `INSERT INTO app."AuthSession" (id,"userId","tokenHash","expiresAt","mfaVerifiedAt")
       VALUES (gen_random_uuid(),$1,$2,now()+interval '1 hour',now())`,
      [admin.rows[0]!.id, tokenHash(adminToken)],
    );
    await fixture.query(
      `INSERT INTO app."RoleAssignment" (id,"userId","roleId","scopeType")
       VALUES (gen_random_uuid(),$1,(SELECT id FROM app."Role" WHERE code='SYSTEM_ADMIN'),'PLATFORM')`,
      [admin.rows[0]!.id],
    );
    const policyLibrary = await fixture.query<{ id: string }>(
      `INSERT INTO app."Library" (id,slug,title) VALUES (gen_random_uuid(),$1,'[TEST] Isolated policy library') RETURNING id`,
      [`reader-policy-${suffix}`],
    );
    policyLibraryId = policyLibrary.rows[0]!.id;
    const collection = await fixture.query<{ id: string }>(
      `INSERT INTO app."Collection" (id,"libraryId",slug,title,description) VALUES (gen_random_uuid(),(SELECT id FROM app."Library" WHERE slug='arata-techlibrary'),$1,'[TEST] Web collection','Synthetic test topic') RETURNING id`,
      [collectionSlug],
    );
    const contributor = await fixture.query<{ id: string }>(
      `INSERT INTO app."Contributor" (id,slug,"displayName") VALUES (gen_random_uuid(),$1,'[TEST] Ada Author') RETURNING id`,
      [`test-ada-${suffix}`],
    );
    const book = await fixture.query<{ id: string }>(
      `INSERT INTO app."Publication" (id,slug,title,description,subject,keywords,kind,status,"ownerId","featuredAt","licenceCode","languageCode","sourceRef","copyrightNotice","createdAt","updatedAt")
       VALUES (gen_random_uuid(),$1,'[TEST] Web Systems Series','Synthetic public description','Web systems',ARRAY['TypeScript','accessibility']::text[],'SERIES','DRAFT',$2,now(),'TEST-LICENCE','en','TEST-SOURCE','[TEST] Synthetic rights',now(),now()) RETURNING id`,
      [seriesSlug, userId],
    );
    const bookId = book.rows[0]!.id;
    await fixture.query(
      `INSERT INTO app."PublicationCollection" ("publicationId","collectionId") VALUES ($1,$2)`,
      [bookId, collection.rows[0]!.id],
    );
    await fixture.query(
      `INSERT INTO app."PublicationContributor" ("publicationId","contributorId",role,ordinal) VALUES ($1,$2,'AUTHOR',0)`,
      [bookId, contributor.rows[0]!.id],
    );
    const volume = await fixture.query<{ id: string }>(
      `INSERT INTO app."Volume" (id,"publicationId",ordinal,title) VALUES (gen_random_uuid(),$1,1,'[TEST] First Volume') RETURNING id`,
      [bookId],
    );
    volumeId = volume.rows[0]!.id;
    const edition = await fixture.query<{ id: string }>(
      `INSERT INTO app."Edition" (id,"publicationId","volumeId","editionCode",label,"isDefault") VALUES (gen_random_uuid(),$1,$2,'TEST-1','[TEST] First Edition',true) RETURNING id`,
      [bookId, volume.rows[0]!.id],
    );
    editionId = edition.rows[0]!.id;
    const revision = await fixture.query<{ id: string }>(
      `INSERT INTO app."Revision" (id,"editionId",number,status,"manifestHash") VALUES (gen_random_uuid(),$1,1,'DRAFT',$2) RETURNING id`,
      [editionId, 'c'.repeat(64)],
    );
    const sample = await fixture.query<{ id: string }>(
      `INSERT INTO app."Chapter" (id,"revisionId",ordinal,slug,title,"previewText") VALUES (gen_random_uuid(),$1,1,'sample','[TEST] Open sample','[TEST] Public preview text') RETURNING id`,
      [revision.rows[0]!.id],
    );
    sampleId = sample.rows[0]!.id;
    const locked = await fixture.query<{ id: string }>(
      `INSERT INTO app."Chapter" (id,"revisionId",ordinal,slug,title,"previewText") VALUES (gen_random_uuid(),$1,2,'locked','[TEST] Locked chapter',$2) RETURNING id`,
      [revision.rows[0]!.id, privatePhrase],
    );
    lockedId = locked.rows[0]!.id;
    const freeLesson = await fixture.query<{ id: string }>(
      `INSERT INTO app."Lesson" (id,"chapterId",ordinal,title,"bodyMarkdown")
       VALUES (gen_random_uuid(),$1,1,'[TEST] Free lesson',$2) RETURNING id`,
      [sampleId, `[TEST] Public reader lesson ${suffix}`],
    );
    freeLessonId = freeLesson.rows[0]!.id;
    const lockedLesson = await fixture.query<{ id: string }>(
      `INSERT INTO app."Lesson" (id,"chapterId",ordinal,title,"bodyMarkdown")
       VALUES (gen_random_uuid(),$1,1,'[TEST] Premium lesson',$2) RETURNING id`,
      [lockedId, privatePhrase],
    );
    lockedLessonId = lockedLesson.rows[0]!.id;
    await fixture.query(
      `INSERT INTO app."ContentPolicy" (id,"chapterId","accessClass","allowRead",version,"isActive","approvedAt") VALUES (gen_random_uuid(),$1,'PUBLIC_FREE',true,1,true,now())`,
      [sampleId],
    );
    await fixture.query(
      `INSERT INTO app."ContentPolicy" (id,"chapterId","accessClass","allowRead",version,"isActive","approvedAt") VALUES (gen_random_uuid(),$1,'PREMIUM',true,1,true,now())`,
      [lockedId],
    );
    await fixture.query(
      `INSERT INTO app."ContentPolicy" (id,"publicationId","accessClass","allowRead",version,"isActive","approvedAt") VALUES (gen_random_uuid(),$1,'PREMIUM',true,1,true,now())`,
      [bookId],
    );
    const reviewer = await fixture.query<{ id: string }>(
      `INSERT INTO app."User" (id,email,status,"termsAcceptedAt","privacyVersion","createdAt","updatedAt") VALUES (gen_random_uuid(),$1,'ACTIVE',now(),'TEST-ONLY',now(),now()) RETURNING id`,
      [`catalogue-reviewer-${suffix}@example.invalid`],
    );
    await fixture.query(
      `UPDATE app."Revision" SET status='IN_REVIEW',"submittedAt"=now() WHERE id=$1`,
      [revision.rows[0]!.id],
    );
    await fixture.query(
      `INSERT INTO app."EditorialReview" (id,"revisionId","reviewerId",decision,"manifestHash") VALUES (gen_random_uuid(),$1,$2,'APPROVED',$3)`,
      [revision.rows[0]!.id, reviewer.rows[0]!.id, 'c'.repeat(64)],
    );
    await fixture.query(`UPDATE app."Revision" SET status='APPROVED' WHERE id=$1`, [
      revision.rows[0]!.id,
    ]);
    await fixture.query(
      `INSERT INTO app."RightsAttestation" (id,"publicationId","revisionId","actorId","manifestHash","licenceCode","sourceRef") VALUES (gen_random_uuid(),$1,$2,$3,$4,'TEST-LICENCE','TEST-SOURCE')`,
      [bookId, revision.rows[0]!.id, userId, 'c'.repeat(64)],
    );
    await fixture.query(
      `UPDATE app."Revision" SET status='PUBLISHED',"publishedAt"=now(),"publishedById"=$2 WHERE id=$1`,
      [revision.rows[0]!.id, reviewer.rows[0]!.id],
    );
    await fixture.query(`UPDATE app."Edition" SET "currentRevisionId"=$1 WHERE id=$2`, [
      revision.rows[0]!.id,
      editionId,
    ]);
    await fixture.query(`UPDATE app."Publication" SET status='PUBLISHED' WHERE id=$1`, [bookId]);
    await fixture.query(
      `INSERT INTO app."Publication" (id,slug,title,description,kind,status,"ownerId","createdAt","updatedAt") VALUES (gen_random_uuid(),$1,'[TEST] Hidden Draft',$2,'STANDALONE','DRAFT',$3,now(),now())`,
      [draftSlug, draftPhrase, userId],
    );
    for (const item of [
      {
        access: 'PUBLIC_FREE',
        title: `[TEST] Open resource ${suffix}`,
        body: `[TEST] Open searchable lesson ${suffix}`,
        withdrawn: false,
      },
      {
        access: 'REGISTERED_FREE',
        title: `[TEST] Registered resource ${suffix}`,
        body: `[TEST] Registered lesson ${suffix}`,
        withdrawn: false,
      },
      {
        access: 'PREMIUM',
        title: `[TEST] Premium resource ${suffix}`,
        body: privatePhrase,
        withdrawn: false,
      },
      {
        access: 'PUBLIC_FREE',
        title: `[TEST] Withdrawn resource ${suffix}`,
        body: `[TEST] Withdrawn ${suffix}`,
        withdrawn: true,
      },
    ]) {
      const result = await fixture.query<{ id: string }>(
        `INSERT INTO app."Resource" (id,title,description,format,"bodyText","accessClass","licenceCode","publishedAt","withdrawnAt")
         VALUES (gen_random_uuid(),$1,'Synthetic public summary','TEXT',$2,$3,'TEST-LICENCE',now()-interval '1 day',CASE WHEN $4 THEN now() ELSE NULL END) RETURNING id`,
        [item.title, item.body, item.access, item.withdrawn],
      );
      const id = result.rows[0]!.id;
      await fixture.query(
        `INSERT INTO app."ContentPolicy" (id,"resourceId","accessClass","allowRead",version,"isActive","approvedAt") VALUES (gen_random_uuid(),$1,$2,true,1,true,now())`,
        [id, item.access],
      );
      if (item.access === 'PREMIUM') premiumId = id;
      else if (item.access === 'REGISTERED_FREE') registeredId = id;
      else if (item.withdrawn) withdrawnId = id;
      else freeId = id;
    }
    await fixture.query('COMMIT');
  } catch (error) {
    await fixture.query('ROLLBACK');
    throw error;
  }
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
}, 30_000);

afterAll(async () => {
  await app?.close();
  await fixture.end();
});

describe('public catalogue and policy boundaries', () => {
  it('navigates published series, volumes, edition and public table of contents', async () => {
    const list = await get(`/catalogue/publications?kind=SERIES&collection=${collectionSlug}`);
    expect(list.response.status).toBe(200);
    const books = JSON.parse(list.text).data.items;
    expect(books).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slug: seriesSlug, accessState: 'LOCKED' }),
      ]),
    );
    const facets = await get('/catalogue/facets');
    expect(facets.response.status).toBe(200);
    expect(JSON.parse(facets.text).data.authors).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: '[TEST] Ada Author' })]),
    );
    expect((await get(`/catalogue/publications?volume=${volumeId}`)).text).toContain(seriesSlug);
    expect((await get(`/catalogue/publications?edition=${editionId}`)).text).toContain(seriesSlug);
    const detail = await get(`/catalogue/publications/${seriesSlug}`);
    expect(detail.response.status).toBe(200);
    expect(detail.text).toContain('[TEST] Ada Author');
    expect(detail.text).toContain(editionId);
    const edition = await get(`/catalogue/editions/${editionId}`);
    expect(edition.response.status).toBe(200);
    expect(edition.text).toContain('[TEST] Open sample');
    expect(edition.text).not.toContain(privatePhrase);
    expect(JSON.parse(edition.text).data.chapters).toContainEqual(
      expect.objectContaining({ id: sampleId, previewAvailable: true }),
    );
    expect(JSON.parse(edition.text).data.chapters).toContainEqual(
      expect.objectContaining({ id: lockedId, previewAvailable: false }),
    );
    const preview = await get(`/catalogue/chapters/${sampleId}/preview`);
    expect(preview.response.status).toBe(200);
    expect(preview.text).toContain('Public preview text');
    expect((await get(`/catalogue/chapters/${lockedId}/preview`)).response.status).toBe(404);
  });

  it('searches approved metadata and public resource text without premium or draft leakage', async () => {
    const search = await get(`/catalogue/search?q=Web%20Systems`);
    expect(search.response.status).toBe(200);
    expect(search.text).toContain(seriesSlug);
    expect(search.text).not.toContain(privatePhrase);
    expect((await get(`/catalogue/search?q=${privatePhrase}`)).text).not.toContain(premiumId);
    expect((await get(`/catalogue/search?q=${draftPhrase}`)).text).not.toContain(draftSlug);
    const publicText = await get(
      `/catalogue/search?q=${encodeURIComponent(`Open searchable lesson ${suffix}`)}`,
    );
    expect(publicText.text).toContain(freeId);
    expect(publicText.text).not.toContain(privatePhrase);
  });

  it('opens public-free text without a session while denying premium and withdrawn direct URLs', async () => {
    const listing = await get(`/resources?access=PUBLIC_FREE&q=${suffix}`);
    expect(listing.response.status).toBe(200);
    expect(listing.text).toContain(freeId);
    expect(listing.text).not.toContain(withdrawnId);
    const open = await get(`/resources/${freeId}/open`);
    expect(open.response.status).toBe(200);
    expect(open.text).toContain('Open searchable lesson');
    const premium = await get(`/resources/${premiumId}`);
    expect(premium.response.status).toBe(200);
    expect(premium.text).not.toContain(privatePhrase);
    expect((await get(`/resources/${premiumId}/open`)).response.status).toBe(401);
    expect((await get(`/resources/${withdrawnId}/open`)).response.status).toBe(404);
    expect((await get(`/resources/${registeredId}/open`)).response.status).toBe(401);
    const signedIn = await fetch(`${base}/api/v1/resources/${registeredId}/open`, {
      headers: { Cookie: `arata_session=${sessionToken}` },
    });
    expect(signedIn.status).toBe(200);
    expect(await signedIn.text()).toContain('Registered lesson');
  });

  it('rejects malformed filters and renders crawlable, metadata-only social preview', async () => {
    expect((await get('/catalogue/publications?sort=sql')).response.status).toBe(400);
    expect(
      (await get('/catalogue/publications?kind=&access=&author=&volume=')).response.status,
    ).toBe(200);
    const share = await get(`/share/publications/${seriesSlug}`);
    expect(share.response.status).toBe(200);
    expect(share.text).toContain('property="og:title"');
    expect(share.text).toContain('rel="canonical"');
    expect(share.text).not.toContain(privatePhrase);
  });

  it('authorizes each reader lesson and suppresses premium search snippets', async () => {
    const manifest = await get(`/reader/editions/${editionId}/manifest`);
    expect(manifest.response.status).toBe(200);
    expect(JSON.parse(manifest.text).data.lessons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: freeLessonId, available: true }),
        expect.objectContaining({ id: lockedLessonId, available: false }),
      ]),
    );
    const free = await get(`/reader/lessons/${freeLessonId}`);
    expect(free.response.status).toBe(200);
    expect(free.text).toContain(`Public reader lesson ${suffix}`);
    expect(JSON.parse(free.text).data.policy.allowDownload).toBe(false);
    expect((await get(`/reader/lessons/${freeLessonId}/asset-grant`)).response.status).toBe(404);
    expect((await get(`/reader/assets/${freeLessonId}?grant=invalid`)).response.status).toBe(403);
    expect(
      (await get(`/reader/resources/${freeId}/assets/${freeLessonId}/grant`)).response.status,
    ).toBe(403);
    expect((await get(`/reader/lessons/${lockedLessonId}`)).response.status).toBe(401);
    const hidden = await get(`/reader/editions/${editionId}/search?q=${privatePhrase}`);
    expect(hidden.response.status).toBe(200);
    expect(hidden.text).not.toContain(privatePhrase);
    const accessible = await get(`/reader/editions/${editionId}/search?q=Public%20reader`);
    expect(accessible.text).toContain(freeLessonId);
  });

  it('requires administrator MFA, CSRF and a reason for versioned policy approval', async () => {
    const endpoint = `${base}/api/v1/admin/content-policies`;
    const body = JSON.stringify({
      scope: 'libraryId',
      scopeId: policyLibraryId,
      allowRead: false,
      accessClass: 'RESTRICTED',
      reason: 'Restrict synthetic test library',
    });
    const denied = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    expect(denied.status).toBe(401);
    const ordinary = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `arata_session=${sessionToken}`,
      },
      body,
    });
    expect(ordinary.status).toBe(403);
    const { csrfToken } = await import('../../apps/api/src/identity/security.js');
    const csrf = csrfToken(adminToken, process.env.AUTH_SESSION_SECRET!);
    const headers = {
      'Content-Type': 'application/json',
      Cookie: `arata_session=${adminToken}; arata_csrf=${csrf}`,
      Origin: process.env.WEB_ORIGIN!,
      'X-CSRF-Token': csrf,
    };
    const approved = await fetch(endpoint, { method: 'POST', headers, body });
    expect(approved.status).toBe(201);
    expect((await approved.json()).data.version).toBe(1);
    const revised = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        scope: 'libraryId',
        scopeId: policyLibraryId,
        allowRead: true,
        reason: 'Allow synthetic test library reading',
      }),
    });
    expect(revised.status).toBe(201);
    expect((await revised.json()).data.version).toBe(2);
    const history = await fetch(`${endpoint}/libraryId/${policyLibraryId}`, {
      headers: { Cookie: `arata_session=${adminToken}` },
    });
    expect(history.status).toBe(200);
    const records = (await history.json()).data;
    expect(records).toHaveLength(2);
    expect(records[0].isActive).toBe(true);
    expect(records[1].isActive).toBe(false);
    expect(records[0].accessClass).toBe('RESTRICTED');
  });

  it('stores private annotations encrypted and keeps progress explicit', async () => {
    const { csrfToken } = await import('../../apps/api/src/identity/security.js');
    const csrf = csrfToken(sessionToken, process.env.AUTH_SESSION_SECRET!);
    const headers = {
      'Content-Type': 'application/json',
      Cookie: `arata_session=${sessionToken}; arata_csrf=${csrf}`,
      Origin: process.env.WEB_ORIGIN!,
      'X-CSRF-Token': csrf,
    };
    const progressBefore = await fetch(`${base}/api/v1/reader/editions/${editionId}/progress`, {
      headers: { Cookie: `arata_session=${sessionToken}` },
    });
    expect(
      (await progressBefore.json()).data.some(
        (item: { lessonId: string }) => item.lessonId === freeLessonId,
      ),
    ).toBe(false);
    const saved = await fetch(`${base}/api/v1/reader/lessons/${freeLessonId}/progress`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ percent: 50, completed: false }),
    });
    expect(saved.status).toBe(201);
    expect((await saved.json()).data.completedAt).toBeNull();
    const note = await fetch(`${base}/api/v1/reader/lessons/${freeLessonId}/annotations`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        anchor: 'quote:Public reader',
        kind: 'NOTE',
        quote: 'Public reader',
        note: 'Private synthetic note',
      }),
    });
    expect(note.status).toBe(201);
    const annotationId = (await note.json()).data.id;
    const stored = await fixture.query<{ encryptedBodyRef: string }>(
      `SELECT "encryptedBodyRef" FROM app."Annotation" WHERE id=$1`,
      [annotationId],
    );
    expect(stored.rows[0]!.encryptedBodyRef).not.toContain('Private synthetic note');
    const own = await fetch(`${base}/api/v1/reader/lessons/${freeLessonId}/annotations`, {
      headers: { Cookie: `arata_session=${sessionToken}` },
    });
    expect((await own.json()).data[0].note).toBe('Private synthetic note');
    const anotherUser = await fetch(`${base}/api/v1/reader/lessons/${freeLessonId}/annotations`, {
      headers: { Cookie: `arata_session=${adminToken}` },
    });
    expect((await anotherUser.json()).data).toEqual([]);
    expect((await get(`/reader/lessons/${freeLessonId}/annotations`)).response.status).toBe(401);
    const removed = await fetch(`${base}/api/v1/reader/annotations/${annotationId}`, {
      method: 'DELETE',
      headers,
    });
    expect(removed.status).toBe(200);
  });
});
