import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { once } from 'node:events';
import yazl from 'yazl';
import { readFileSync } from 'node:fs';
import dotenv from 'dotenv';
import pg from 'pg';
import type { INestApplication } from '@nestjs/common';
import { createApp } from '../../apps/api/src/app.js';
import { csrfToken, tokenHash } from '../../apps/api/src/identity/security.js';
import { processNextAsset } from '../../apps/worker/src/asset-worker.js';
import { processNextImport } from '../../apps/worker/src/import-worker.js';

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
const tokens = Object.fromEntries(
  ['author', 'editor', 'publisher', 'outsider'].map((role) => [
    role,
    randomBytes(36).toString('base64url'),
  ]),
) as Record<'author' | 'editor' | 'publisher' | 'outsider', string>;
const users = {} as Record<'author' | 'editor' | 'publisher' | 'outsider', string>;
let app: INestApplication;
let base: string;
let collectionId: string;
let publicationId: string;
let editionId: string;
let revisionId: string;
let chapterId: string;
let uploadAssetId: string;

async function call(
  role: keyof typeof tokens,
  path: string,
  method = 'GET',
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const token = tokens[role];
  const response = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: {
      Cookie: `arata_session=${token}; arata_csrf=${csrfToken(token, process.env.AUTH_SESSION_SECRET!)}`,
      Origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
      'X-CSRF-Token': csrfToken(token, process.env.AUTH_SESSION_SECRET!),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = await response.json().catch(() => null);
  return { status: response.status, data: json?.data, problem: json };
}

beforeAll(async () => {
  await fixture.connect();
  await fixture.query('BEGIN');
  try {
    for (const role of Object.keys(tokens) as (keyof typeof tokens)[]) {
      const user = (
        await fixture.query<{ id: string }>(
          `INSERT INTO app."User" (id,email,status,"emailVerifiedAt","termsAcceptedAt","privacyVersion","createdAt","updatedAt") VALUES (gen_random_uuid(),$1,'ACTIVE',now(),now(),'TEST-ONLY',now(),now()) RETURNING id`,
          [`studio-${role}-${suffix}@example.invalid`],
        )
      ).rows[0]!;
      users[role] = user.id;
      await fixture.query(
        `INSERT INTO app."AuthSession" (id,"userId","tokenHash","expiresAt") VALUES (gen_random_uuid(),$1,$2,now()+interval '1 hour')`,
        [user.id, tokenHash(tokens[role])],
      );
    }
    const role = (
      await fixture.query<{ id: string }>(`SELECT id FROM app."Role" WHERE code='AUTHOR'`)
    ).rows[0]!;
    await fixture.query(
      `INSERT INTO app."RoleAssignment" (id,"userId","roleId","scopeType") VALUES (gen_random_uuid(),$1,$2,'PLATFORM')`,
      [users.author, role.id],
    );
    const collection = (
      await fixture.query<{ id: string }>(
        `INSERT INTO app."Collection" (id,"libraryId",slug,title) VALUES (gen_random_uuid(),(SELECT id FROM app."Library" WHERE slug='arata-techlibrary'),$1,'[TEST] Studio collection') RETURNING id`,
        [`studio-${suffix}`],
      )
    ).rows[0]!;
    collectionId = collection.id;
    await fixture.query('COMMIT');
  } catch (error) {
    await fixture.query('ROLLBACK');
    throw error;
  }
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
}, 30000);
afterAll(async () => {
  await app?.close();
  await fixture.end();
});

describe('Publishing Studio editorial boundaries', () => {
  it('denies unauthenticated, unassigned and CSRF-free writes', async () => {
    const anonymous = await fetch(`${base}/api/v1/studio/tree`);
    expect(anonymous.status).toBe(401);
    const denied = await call('outsider', '/studio/publications', 'POST', {
      slug: `denied-${suffix}`,
      title: 'No authority',
      kind: 'STANDALONE',
      collectionId,
      languageCode: 'en',
      licenceCode: 'TEST',
      sourceRef: 'TEST',
      copyrightNotice: 'TEST',
    });
    expect(denied.status).toBe(403);
    const response = await fetch(`${base}/api/v1/studio/publications`, {
      method: 'POST',
      headers: {
        Cookie: `arata_session=${tokens.author}`,
        'Content-Type': 'application/json',
        Origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
      },
      body: '{}',
    });
    expect(response.status).toBe(403);
  });

  it('creates a standalone hierarchy and protects review and publication authority', async () => {
    const created = await call('author', '/studio/publications', 'POST', {
      slug: `studio-book-${suffix}`,
      title: '[TEST] Studio book',
      kind: 'STANDALONE',
      collectionId,
      languageCode: 'en',
      licenceCode: 'TEST-ONLY',
      sourceRef: 'TEST-SOURCE',
      copyrightNotice: '[TEST] Synthetic rights',
    });
    expect(created.status).toBe(201);
    publicationId = created.data.id;
    for (const role of ['editor', 'publisher'] as const) {
      const r = (
        await fixture.query<{ id: string }>(`SELECT id FROM app."Role" WHERE code=$1`, [
          role.toUpperCase(),
        ])
      ).rows[0]!;
      await fixture.query(
        `INSERT INTO app."RoleAssignment" (id,"userId","roleId","scopeType","scopeId") VALUES (gen_random_uuid(),$1,$2,'PUBLICATION',$3)`,
        [users[role], r.id, publicationId],
      );
    }
    expect((await call('outsider', `/studio/publications/${publicationId}`)).status).toBe(403);
    expect(
      (
        await call('author', `/studio/publications/${publicationId}/volumes`, 'POST', {
          ordinal: 1,
          title: 'Invalid standalone volume',
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await call('author', `/studio/publications/${publicationId}/contributors`, 'POST', {
          displayName: '[TEST] Author',
          slug: `studio-author-${suffix}`,
          role: 'AUTHOR',
          ordinal: 0,
        })
      ).status,
    ).toBe(201);
    const edition = await call('author', `/studio/publications/${publicationId}/editions`, 'POST', {
      editionCode: '1',
      label: 'First edition',
      volumeId: null,
      isDefault: true,
    });
    expect(edition.status).toBe(201);
    editionId = edition.data.id;
    const revision = await call('author', `/studio/editions/${editionId}/revisions`, 'POST', {
      changeSummary: '[TEST] Initial edition',
    });
    expect(revision.status).toBe(201);
    revisionId = revision.data.id;
    const chapter = await call('author', `/studio/revisions/${revisionId}/chapters`, 'POST', {
      ordinal: 1,
      slug: 'intro',
      title: 'Introduction',
    });
    expect(chapter.status).toBe(201);
    chapterId = chapter.data.id;
    const lesson = await call('author', `/studio/chapters/${chapterId}/lessons`, 'POST', {
      ordinal: 1,
      title: 'Safe lesson',
      bodyMarkdown: 'Synthetic lesson text',
    });
    expect(lesson.status).toBe(201);
    const sourceResource = await call(
      'author',
      `/studio/revisions/${revisionId}/resources`,
      'POST',
      {
        title: '[TEST] Published source resource',
        format: 'TEXT',
        bodyText: 'Synthetic reference material',
        accessClass: 'PUBLIC_FREE',
        licenceCode: 'TEST-ONLY',
        attribution: '[TEST] Author',
        copyrightNotice: '[TEST] Synthetic rights',
      },
    );
    expect(sourceResource.status).toBe(201);
    expect(
      (
        await call('author', `/studio/lessons/${lesson.data.id}/references`, 'POST', {
          targetLessonId: lesson.data.id,
          label: 'See this lesson',
        })
      ).status,
    ).toBe(201);
    const submitted = await call('author', `/studio/revisions/${revisionId}/submit`, 'POST');
    expect(submitted.status).toBe(201);
    expect(
      (
        await call('author', `/studio/revisions/${revisionId}/review`, 'POST', {
          decision: 'APPROVED',
          comment: 'Self review',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call('author', `/studio/revisions/${revisionId}/chapters`, 'POST', {
          ordinal: 2,
          slug: 'late',
          title: 'Late',
        })
      ).status,
    ).toBe(409);
    const approved = await call('editor', `/studio/revisions/${revisionId}/review`, 'POST', {
      decision: 'APPROVED',
      comment: 'Reviewed synthetic manuscript',
    });
    expect(approved.status).toBe(201);
    expect((await call('author', `/studio/revisions/${revisionId}/publish`, 'POST')).status).toBe(
      403,
    );
    expect(
      (await call('publisher', `/studio/revisions/${revisionId}/publish`, 'POST')).status,
    ).toBe(409);
    expect(
      (
        await call('publisher', `/studio/revisions/${revisionId}/rights`, 'POST', {
          licenceCode: 'TEST-ONLY',
          sourceRef: 'TEST-SOURCE',
        })
      ).status,
    ).toBe(201);
    expect(
      (await call('publisher', `/studio/revisions/${revisionId}/publish`, 'POST')).status,
    ).toBe(201);
    expect(
      (
        await call('author', `/studio/chapters/${chapterId}/lessons`, 'POST', {
          ordinal: 2,
          title: 'Tamper',
          bodyMarkdown: 'No',
        })
      ).status,
    ).toBe(409);
    const exported = await call('author', `/studio/revisions/${revisionId}/export`);
    expect(exported.status).toBe(200);
    expect(exported.data.content.lessons[0].bodyMarkdown).toBe('Synthetic lesson text');
    const cloned = await call('author', `/studio/editions/${editionId}/revisions`, 'POST', {
      changeSummary: '[TEST] Correction draft',
      fromRevisionId: revisionId,
    });
    expect(cloned.status).toBe(201);
    const clonedExport = await call('author', `/studio/revisions/${cloned.data.id}/export`);
    expect(clonedExport.status).toBe(200);
    expect(clonedExport.data.content.resources).toHaveLength(1);
    expect(clonedExport.data.content.references).toHaveLength(1);
    expect(clonedExport.data.content.references[0].sourceLessonId).toBe(
      clonedExport.data.content.lessons[0].id,
    );
    expect(clonedExport.data.content.references[0].targetLessonId).toBe(
      clonedExport.data.content.lessons[0].id,
    );
    const clonedPolicy = await fixture.query(
      `SELECT 1 FROM app."ContentPolicy" WHERE "resourceId"=$1 AND "isActive"=true`,
      [clonedExport.data.content.resources[0].id],
    );
    expect(clonedPolicy.rowCount).toBe(1);
    const resource = await call('author', `/studio/revisions/${cloned.data.id}/resources`, 'POST', {
      title: '[TEST] Private draft resource',
      format: 'TEXT',
      bodyText: 'DRAFT_RESOURCE_SECRET',
      accessClass: 'PUBLIC_FREE',
      licenceCode: 'TEST-ONLY',
      attribution: '[TEST] Author',
      copyrightNotice: '[TEST] Synthetic rights',
    });
    expect(resource.status).toBe(201);
    const publicResource = await fetch(`${base}/api/v1/resources/${resource.data.id}`);
    expect(publicResource.status).toBe(404);
    const erratum = await call('editor', `/studio/revisions/${revisionId}/errata`, 'POST', {
      notice: '[TEST] Correction notice',
    });
    expect(erratum.status).toBe(201);
  }, 30000);

  it('supports zero or multiple collection memberships with scoped authorization', async () => {
    const secondCollection = (
      await fixture.query<{ id: string }>(
        `INSERT INTO app."Collection" (id,"libraryId",slug,title) VALUES (gen_random_uuid(),(SELECT id FROM app."Library" WHERE slug='arata-techlibrary'),$1,'[TEST] Second Studio collection') RETURNING id`,
        [`studio-second-${suffix}`],
      )
    ).rows[0]!;
    const uncategorised = await call('author', '/studio/publications', 'POST', {
      slug: `studio-uncategorised-${suffix}`,
      title: '[TEST] Uncategorized publication',
      kind: 'STANDALONE',
      languageCode: 'en',
      licenceCode: 'TEST-ONLY',
      sourceRef: 'TEST-SOURCE',
      copyrightNotice: '[TEST] Synthetic rights',
    });
    expect(uncategorised.status).toBe(201);
    const targetId = uncategorised.data.id;
    const tree = await call('author', '/studio/tree');
    expect(tree.data.publications).toContainEqual(
      expect.objectContaining({ id: targetId, collectionId: null }),
    );
    expect(
      (
        await call('author', `/studio/publications/${publicationId}/collections`, 'PUT', {
          collectionIds: [collectionId, secondCollection.id],
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call('publisher', `/studio/publications/${publicationId}/collections`, 'PUT', {
          collectionIds: [collectionId],
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call('outsider', `/studio/publications/${targetId}/collections`, 'PUT', {
          collectionIds: [collectionId],
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call('author', `/studio/publications/${targetId}/collections`, 'PUT', {
          collectionIds: [collectionId, collectionId],
        })
      ).status,
    ).toBe(400);
    const assigned = await call('author', `/studio/publications/${targetId}/collections`, 'PUT', {
      collectionIds: [collectionId, secondCollection.id],
    });
    expect(assigned.status).toBe(200);
    const detail = await call('author', `/studio/publications/${targetId}`);
    expect(detail.data.collections.map((item: { id: string }) => item.id).sort()).toEqual(
      [collectionId, secondCollection.id].sort(),
    );
    expect(
      (
        await call('author', `/studio/publications/${targetId}/collections`, 'PUT', {
          collectionIds: [],
        })
      ).status,
    ).toBe(200);
    expect((await call('author', `/studio/publications/${targetId}`)).data.collections).toEqual([]);
    expect(
      (
        await call('author', `/studio/publications/${targetId}/collections`, 'PUT', {
          collectionIds: [collectionId],
        })
      ).status,
    ).toBe(200);
  });

  it('quarantines uploaded originals and rejects author rights approval', async () => {
    const bytes = Buffer.from('synthetic test attachment');
    const digest = createHash('sha256').update(bytes).digest('hex');
    const upload = await call('author', '/studio/uploads', 'POST', {
      publicationId,
      originalName: '../../unsafe.txt',
      mimeType: 'text/plain',
      sizeBytes: bytes.length,
      sha256: digest,
      idempotencyKey: randomUUID(),
    });
    expect(upload.status).toBe(201);
    const id = upload.data.id;
    const token = tokens.author;
    const part = await fetch(`${base}/api/v1/studio/uploads/${id}/chunk`, {
      method: 'PUT',
      headers: {
        Cookie: `arata_session=${token}; arata_csrf=${csrfToken(token, process.env.AUTH_SESSION_SECRET!)}`,
        Origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
        'X-CSRF-Token': csrfToken(token, process.env.AUTH_SESSION_SECRET!),
        'X-Upload-Offset': '0',
        'Content-Type': 'application/octet-stream',
      },
      body: bytes,
    });
    expect(part.status).toBe(200);
    const completed = await call('author', `/studio/uploads/${id}/complete`, 'POST');
    expect(completed.status).toBe(201);
    const assetId = completed.data.assetId;
    uploadAssetId = assetId;
    expect((await call('author', `/studio/assets/${assetId}/download`)).status).toBe(404);
    expect(
      (
        await call('author', `/studio/assets/${assetId}/approve`, 'POST', {
          licenceCode: 'TEST-ONLY',
          provenanceRef: 'TEST-SOURCE',
          copyrightNotice: 'TEST',
          attribution: 'TEST',
        })
      ).status,
    ).toBe(403);
    const record = (
      await fixture.query<{ originalName: string; status: string }>(
        `SELECT "originalName",status FROM app."Asset" WHERE id=$1`,
        [assetId],
      )
    ).rows[0]!;
    expect(record.originalName).toBe('unsafe.txt');
    expect(record.status).toBe('QUARANTINED');
  });

  it('scans, rights-approves and privately serves an uploaded file', async () => {
    const server = createServer((socket) => {
      const parts: Buffer[] = [];
      let replied = false;
      socket.on('data', (part: Buffer) => {
        parts.push(part);
        const received = Buffer.concat(parts);
        if (!replied && received.length > 20 && received.subarray(-4).equals(Buffer.alloc(4))) {
          replied = true;
          socket.end('stream: OK\0');
        }
      });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No scan port');
    const pool = new pg.Pool({ connectionString: local.TEST_DATABASE_URL, max: 2 });
    try {
      expect(await processNextAsset(pool, '127.0.0.1', address.port, uploadAssetId)).toBe(true);
    } finally {
      await pool.end();
      server.close();
    }
    expect(
      (
        await call('author', `/studio/assets/${uploadAssetId}/approve`, 'POST', {
          licenceCode: 'TEST-ONLY',
          provenanceRef: 'TEST-SOURCE',
          copyrightNotice: 'TEST',
          attribution: 'TEST',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call('editor', `/studio/assets/${uploadAssetId}/approve`, 'POST', {
          licenceCode: 'TEST-ONLY',
          provenanceRef: 'TEST-SOURCE',
          copyrightNotice: 'TEST',
          attribution: 'TEST',
        })
      ).status,
    ).toBe(201);
    const token = tokens.author;
    const download = await fetch(`${base}/api/v1/studio/assets/${uploadAssetId}/download`, {
      headers: { Cookie: `arata_session=${token}` },
    });
    expect(download.status).toBe(200);
    expect(await download.text()).toBe('synthetic test attachment');
    expect((await call('outsider', `/studio/assets/${uploadAssetId}/download`)).status).toBe(403);
  }, 30000);

  it('previews and confirms a structured ZIP into a new draft', async () => {
    const archive = new yazl.ZipFile();
    archive.addBuffer(
      Buffer.from(
        JSON.stringify({
          format: 'arata-structured-v1',
          chapters: [
            {
              slug: 'imported',
              title: 'Imported chapter',
              lessons: [{ title: 'Imported lesson', file: 'content/imported.md' }],
            },
          ],
        }),
      ),
      'manifest.json',
    );
    archive.addBuffer(Buffer.from('# Imported\nSynthetic content'), 'content/imported.md');
    const parts: Buffer[] = [];
    archive.outputStream.on('data', (part: Buffer) => parts.push(part));
    archive.end();
    await once(archive.outputStream, 'end');
    const bytes = Buffer.concat(parts);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const started = await call('author', '/studio/uploads', 'POST', {
      publicationId,
      originalName: 'sample.zip',
      mimeType: 'application/zip',
      sizeBytes: bytes.length,
      sha256,
      idempotencyKey: randomUUID(),
    });
    expect(started.status).toBe(201);
    const id = started.data.id;
    const token = tokens.author;
    const part = await fetch(`${base}/api/v1/studio/uploads/${id}/chunk`, {
      method: 'PUT',
      headers: {
        Cookie: `arata_session=${token}; arata_csrf=${csrfToken(token, process.env.AUTH_SESSION_SECRET!)}`,
        Origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
        'X-CSRF-Token': csrfToken(token, process.env.AUTH_SESSION_SECRET!),
        'X-Upload-Offset': '0',
        'Content-Type': 'application/octet-stream',
      },
      body: bytes,
    });
    expect(part.status).toBe(200);
    const completed = await call('author', `/studio/uploads/${id}/complete`, 'POST');
    expect(completed.status).toBe(201);
    const assetId = completed.data.assetId;
    const server = createServer((socket) => {
      const chunks: Buffer[] = [];
      let replied = false;
      socket.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
        const received = Buffer.concat(chunks);
        if (!replied && received.length > 20 && received.subarray(-4).equals(Buffer.alloc(4))) {
          replied = true;
          socket.end('stream: OK\0');
        }
      });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No scan port');
    const pool = new pg.Pool({ connectionString: local.TEST_DATABASE_URL, max: 2 });
    try {
      expect(await processNextAsset(pool, '127.0.0.1', address.port, assetId)).toBe(true);
    } finally {
      server.close();
    }
    expect(
      (
        await call('editor', `/studio/assets/${assetId}/approve`, 'POST', {
          licenceCode: 'TEST-ONLY',
          provenanceRef: 'TEST-SOURCE',
          copyrightNotice: 'TEST',
          attribution: 'TEST',
        })
      ).status,
    ).toBe(201);
    const importJob = await call('author', '/studio/imports', 'POST', {
      assetId,
      editionId,
      idempotencyKey: randomUUID(),
    });
    expect(importJob.status).toBe(201);
    const importId = importJob.data.id;
    try {
      expect(await processNextImport(pool, importId)).toBe(true);
      const ready = await call('author', `/studio/imports/${importId}`);
      expect(ready.data.status).toBe('READY');
      expect(ready.data.preview.chapters[0].title).toBe('Imported chapter');
      expect((await call('author', `/studio/imports/${importId}/confirm`, 'POST')).status).toBe(
        201,
      );
      expect(await processNextImport(pool, importId)).toBe(true);
      const final = await call('author', `/studio/imports/${importId}`);
      expect(final.data.status).toBe('COMPLETE');
      expect(final.data.revisionId).toBeTruthy();
      const draft = await call('author', `/studio/revisions/${final.data.revisionId}`);
      expect(draft.data.lessons[0].bodyMarkdown).toContain('Synthetic content');
    } finally {
      await pool.end();
    }
  }, 30000);
});
