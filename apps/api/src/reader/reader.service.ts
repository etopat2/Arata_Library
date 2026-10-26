import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { HttpException, Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import type { Response } from 'express';
import {
  mayUseContent,
  resolveContentPolicy,
  type ContentPolicyRow,
  type EffectiveContentPolicy,
  type PolicyPath,
  type ReaderAction,
} from '@arata/access-policy';
import type { AuthContext } from '../identity/identity.service.js';
import type { ApiConfig } from '../app.js';
import { seal, unseal } from '../identity/security.js';

type Lesson = {
  id: string;
  title: string;
  ordinal: number;
  bodyMarkdown: string | null;
  blocks: unknown;
  bodyAssetId: string | null;
  chapterId: string;
  chapterTitle: string;
  chapterOrdinal: number;
  previewText: string | null;
  revisionId: string;
  revisionNumber: number;
  revisionStatus: string;
  publishedAt: Date | null;
  editionId: string;
  editionLabel: string;
  currentRevisionId: string | null;
  volumeId: string | null;
  publicationId: string;
  publicationTitle: string;
  publicationSlug: string;
  publicationStatus: string;
  libraryId: string | null;
  libraryCount: number;
};

@Injectable()
export class ReaderService {
  constructor(
    @Inject('DB_POOL') private readonly pool: Pool,
    @Inject('APP_CONFIG') private readonly config: ApiConfig,
  ) {}

  private async lesson(id: string): Promise<Lesson> {
    const result = await this.pool.query<Lesson>(
      `SELECT l.id,l.title,l.ordinal,l."bodyMarkdown",l.blocks,l."bodyAssetId",
        c.id AS "chapterId",c.title AS "chapterTitle",c.ordinal AS "chapterOrdinal",c."previewText",
        r.id AS "revisionId",r.number AS "revisionNumber",r.status AS "revisionStatus",r."publishedAt",
        e.id AS "editionId",e.label AS "editionLabel",e."currentRevisionId",e."volumeId",
        p.id AS "publicationId",p.title AS "publicationTitle",p.slug AS "publicationSlug",p.status AS "publicationStatus",
        COALESCE((SELECT co."libraryId" FROM app."PublicationCollection" pc JOIN app."Collection" co ON co.id=pc."collectionId"
          WHERE pc."publicationId"=p.id ORDER BY co."libraryId" LIMIT 1),
          (SELECT id FROM app."Library" ORDER BY "createdAt",id LIMIT 1)) AS "libraryId",
        (SELECT count(DISTINCT co."libraryId")::int FROM app."PublicationCollection" pc
          JOIN app."Collection" co ON co.id=pc."collectionId" WHERE pc."publicationId"=p.id) AS "libraryCount"
       FROM app."Lesson" l JOIN app."Chapter" c ON c.id=l."chapterId"
       JOIN app."Revision" r ON r.id=c."revisionId" JOIN app."Edition" e ON e.id=r."editionId"
       JOIN app."Publication" p ON p.id=e."publicationId" WHERE l.id=$1`,
      [id],
    );
    const row = result.rows[0];
    if (
      !row ||
      row.publicationStatus !== 'PUBLISHED' ||
      row.revisionStatus !== 'PUBLISHED' ||
      row.currentRevisionId !== row.revisionId ||
      !row.publishedAt ||
      row.publishedAt > new Date()
    )
      throw new HttpException('Lesson not found', 404);
    if (row.libraryCount > 1) throw new HttpException('Ambiguous library assignment', 409);
    return row;
  }

  private path(row: Lesson): PolicyPath {
    return {
      ...(row.libraryId ? { libraryId: row.libraryId } : {}),
      publicationId: row.publicationId,
      ...(row.volumeId ? { volumeId: row.volumeId } : {}),
      editionId: row.editionId,
      revisionId: row.revisionId,
      chapterId: row.chapterId,
      lessonId: row.id,
    };
  }

  async policy(path: PolicyPath): Promise<EffectiveContentPolicy> {
    const ids = [
      path.libraryId,
      path.publicationId,
      path.volumeId,
      path.editionId,
      path.revisionId,
      path.chapterId,
      path.lessonId,
      path.resourceId,
    ].filter(Boolean);
    const rows = await this.pool.query<ContentPolicyRow>(
      `SELECT * FROM app."ContentPolicy" WHERE "isActive" AND "approvedAt" IS NOT NULL
       AND ("libraryId"=ANY($1::uuid[]) OR "publicationId"=ANY($1::uuid[])
         OR "volumeId"=ANY($1::uuid[]) OR "editionId"=ANY($1::uuid[])
         OR "revisionId"=ANY($1::uuid[]) OR "chapterId"=ANY($1::uuid[])
         OR "lessonId"=ANY($1::uuid[]) OR "resourceId"=ANY($1::uuid[]))`,
      [ids],
    );
    return resolveContentPolicy(path, rows.rows);
  }

  private async entitled(context: AuthContext | null, path: PolicyPath): Promise<boolean> {
    if (!context) return false;
    const result = await this.pool.query(
      `SELECT 1 FROM app."EffectiveEntitlement" x WHERE x."userId"=$1 AND (
        x.scope='LIBRARY' OR (x.scope='PUBLICATION' AND x."publicationId"=$2)
        OR (x.scope='VOLUME' AND x."volumeId"=$3)
        OR (x.scope='EDITION' AND x."editionId"=$4)
        OR (x.scope='RESOURCE' AND x."resourceId"=$5)) LIMIT 1`,
      [
        context.user.id,
        path.publicationId ?? null,
        path.volumeId ?? null,
        path.editionId ?? null,
        path.resourceId ?? null,
      ],
    );
    return !!result.rowCount;
  }

  async authorize(path: PolicyPath, context: AuthContext | null, action: ReaderAction) {
    const policy = await this.policy(path);
    const entitled = await this.entitled(context, path);
    if (!mayUseContent(policy, action, { authenticated: !!context, entitled })) {
      const signInMayHelp =
        !context &&
        (policy.accessClass === 'REGISTERED_FREE' || policy.accessClass === 'PREMIUM') &&
        mayUseContent(policy, action, { authenticated: true, entitled: true });
      throw new HttpException(
        signInMayHelp ? 'Authentication required' : 'Access denied',
        signInMayHelp ? 401 : 403,
      );
    }
    if (context && policy.accessClass === 'PREMIUM' && policy.maxConcurrentSessions !== null) {
      const active = await this.pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM app."AuthSession" WHERE "userId"=$1
         AND "revokedAt" IS NULL AND "expiresAt">now()`,
        [context.user.id],
      );
      if (Number(active.rows[0]?.count ?? 0) > policy.maxConcurrentSessions)
        throw new HttpException('Licensed session limit reached', 403);
    }
    return policy;
  }

  async openLesson(id: string, context: AuthContext | null) {
    const row = await this.lesson(id);
    const policy = await this.authorize(this.path(row), context, 'read');
    const { bodyMarkdown, blocks, bodyAssetId, ...metadata } = row;
    // A body asset is delivered through a separate, rechecked short-lived grant.
    return {
      ...metadata,
      bodyMarkdown,
      blocks,
      hasBodyAsset: !!bodyAssetId,
      policy,
      watermark: policy.watermark
        ? createHmac('sha256', Buffer.from(this.config.AUTH_SESSION_SECRET, 'hex'))
            .update(context?.user.id ?? 'anonymous')
            .digest('hex')
            .slice(0, 12)
        : null,
      screenshotNotice:
        policy.screenshotMode === 'RESTRICTED_NOTICE'
          ? 'Screenshots may be restricted by the licence. Browser controls cannot block operating system screenshots.'
          : null,
    };
  }

  async previewChapter(id: string, context: AuthContext | null) {
    const result = await this.pool.query<{
      title: string;
      text: string | null;
      editionId: string;
      publicationSlug: string;
      publicationId: string;
      volumeId: string | null;
      revisionId: string;
      libraryId: string | null;
      libraryCount: number;
    }>(
      `SELECT c.title,c."previewText" AS text,e.id AS "editionId",p.slug AS "publicationSlug",
         p.id AS "publicationId",e."volumeId",r.id AS "revisionId",
         COALESCE((SELECT co."libraryId" FROM app."PublicationCollection" pc JOIN app."Collection" co ON co.id=pc."collectionId"
           WHERE pc."publicationId"=p.id ORDER BY co."libraryId" LIMIT 1),
           (SELECT id FROM app."Library" ORDER BY "createdAt",id LIMIT 1)) AS "libraryId",
         (SELECT count(DISTINCT co."libraryId")::int FROM app."PublicationCollection" pc
           JOIN app."Collection" co ON co.id=pc."collectionId" WHERE pc."publicationId"=p.id) AS "libraryCount"
       FROM app."Chapter" c JOIN app."Revision" r ON r.id=c."revisionId"
       JOIN app."Edition" e ON e.id=r."editionId" JOIN app."Publication" p ON p.id=e."publicationId"
       WHERE c.id=$1 AND c."previewText" IS NOT NULL AND p.status='PUBLISHED'
         AND e."currentRevisionId"=r.id AND r.status='PUBLISHED' AND r."publishedAt"<=now()`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw new HttpException('Preview not found', 404);
    if (row.libraryCount > 1) throw new HttpException('Ambiguous library assignment', 409);
    const path: PolicyPath = {
      publicationId: row.publicationId,
      editionId: row.editionId,
      revisionId: row.revisionId,
      chapterId: id,
      ...(row.volumeId ? { volumeId: row.volumeId } : {}),
      ...(row.libraryId ? { libraryId: row.libraryId } : {}),
    };
    const policy = await this.policy(path);
    const entitled = await this.entitled(context, path);
    if (
      !mayUseContent(policy, 'read', { authenticated: !!context, entitled }) &&
      !mayUseContent(policy, 'preview', { authenticated: !!context, entitled })
    )
      throw new HttpException('Preview not found', 404);
    return {
      title: row.title,
      text: row.text,
      editionId: row.editionId,
      publicationSlug: row.publicationSlug,
    };
  }

  private async resourceAccess(id: string, context: AuthContext | null, action: ReaderAction) {
    const result = await this.pool.query<{
      id: string;
      title: string;
      bodyText: string | null;
      licenceCode: string;
      accessClass: string;
      publicationId: string | null;
      volumeId: string | null;
      editionId: string | null;
      revisionId: string | null;
      chapterId: string | null;
      lessonId: string | null;
      libraryId: string | null;
      libraryCount: number;
    }>(
      `SELECT r.id,r.title,r."bodyText",r."licenceCode",r."accessClass",
        p.id AS "publicationId",COALESCE(r."volumeId",e."volumeId") AS "volumeId",
        e.id AS "editionId",rv.id AS "revisionId",COALESCE(r."chapterId",lc.id) AS "chapterId",
        r."lessonId",
        COALESCE((SELECT co."libraryId" FROM app."PublicationCollection" pc JOIN app."Collection" co ON co.id=pc."collectionId"
          WHERE pc."publicationId"=p.id ORDER BY co."libraryId" LIMIT 1),
          (SELECT id FROM app."Library" ORDER BY "createdAt",id LIMIT 1)) AS "libraryId",
        (SELECT count(DISTINCT co."libraryId")::int FROM app."PublicationCollection" pc
          JOIN app."Collection" co ON co.id=pc."collectionId" WHERE pc."publicationId"=p.id) AS "libraryCount"
       FROM app."Resource" r LEFT JOIN app."Lesson" l ON l.id=r."lessonId"
       LEFT JOIN app."Chapter" lc ON lc.id=l."chapterId"
       LEFT JOIN app."Chapter" c ON c.id=r."chapterId"
       LEFT JOIN app."Revision" rv ON rv.id=COALESCE(r."revisionId",c."revisionId",lc."revisionId")
       LEFT JOIN app."Edition" e ON e.id=COALESCE(r."editionId",rv."editionId")
       LEFT JOIN app."Volume" v ON v.id=r."volumeId"
       LEFT JOIN app."Publication" p ON p.id=COALESCE(r."publicationId",e."publicationId",v."publicationId")
       WHERE r.id=$1 AND r."publishedAt"<=now() AND
         (r."withdrawnAt" IS NULL OR r."withdrawnAt">now())
         AND (p.id IS NULL OR (p.status='PUBLISHED' AND EXISTS (
           SELECT 1 FROM app."Edition" ce JOIN app."Revision" cr ON cr.id=ce."currentRevisionId"
           WHERE ce."publicationId"=p.id AND cr.status='PUBLISHED' AND cr."publishedAt"<=now()
             AND (e.id IS NULL OR ce.id=e.id) AND (rv.id IS NULL OR cr.id=rv.id)
             AND (r."volumeId" IS NULL OR ce."volumeId"=r."volumeId"))))`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw new HttpException('Resource not found', 404);
    if (row.libraryCount > 1) throw new HttpException('Ambiguous library assignment', 409);
    const path: PolicyPath = {
      resourceId: id,
      ...(row.publicationId ? { publicationId: row.publicationId } : {}),
      ...(row.volumeId ? { volumeId: row.volumeId } : {}),
      ...(row.editionId ? { editionId: row.editionId } : {}),
      ...(row.revisionId ? { revisionId: row.revisionId } : {}),
      ...(row.chapterId ? { chapterId: row.chapterId } : {}),
      ...(row.lessonId ? { lessonId: row.lessonId } : {}),
      ...(row.libraryId ? { libraryId: row.libraryId } : {}),
    };
    const policy = await this.authorize(path, context, action);
    if (policy.accessClass !== row.accessClass) throw new HttpException('Access denied', 403);
    return { row, policy };
  }

  async openResource(id: string, context: AuthContext | null) {
    const { row, policy } = await this.resourceAccess(id, context, 'read');
    const attachments = policy.allowDownload
      ? await this.pool.query<{ id: string; name: string }>(
          `SELECT a.id,a."originalName" AS name FROM app."ResourceAttachment" ra
       JOIN app."Asset" a ON a.id=ra."assetId" WHERE ra."resourceId"=$1
         AND a.status='APPROVED' AND a."scannedAt" IS NOT NULL
         AND a."permissionConfirmedAt" IS NOT NULL ORDER BY ra.ordinal`,
          [id],
        )
      : null;
    return {
      id: row.id,
      title: row.title,
      text: row.bodyText ?? '',
      licenceCode: row.licenceCode,
      policy,
      assets: attachments?.rows ?? [],
    };
  }

  async manifest(editionId: string, context: AuthContext | null) {
    const rows = await this.pool.query<{ id: string }>(
      `SELECT l.id FROM app."Lesson" l JOIN app."Chapter" c ON c.id=l."chapterId"
       JOIN app."Revision" r ON r.id=c."revisionId" JOIN app."Edition" e ON e.id=r."editionId"
       JOIN app."Publication" p ON p.id=e."publicationId"
       WHERE e.id=$1 AND e."currentRevisionId"=r.id AND r.status='PUBLISHED'
       AND r."publishedAt"<=now() AND p.status='PUBLISHED'
       ORDER BY c.ordinal,l.ordinal`,
      [editionId],
    );
    const lessons = [];
    for (const item of rows.rows) {
      const row = await this.lesson(item.id);
      const path = this.path(row);
      const policy = await this.policy(path);
      const entitled = await this.entitled(context, path);
      const available = mayUseContent(policy, 'read', { authenticated: !!context, entitled });
      const preview = mayUseContent(policy, 'preview', { authenticated: !!context, entitled });
      lessons.push({
        id: row.id,
        title: row.title,
        chapterId: row.chapterId,
        chapterTitle: row.chapterTitle,
        chapterOrdinal: row.chapterOrdinal,
        ordinal: row.ordinal,
        available,
        preview,
      });
    }
    return { editionId, lessons };
  }

  async search(editionId: string, query: string, context: AuthContext | null) {
    const result = await this.pool.query<{ id: string; title: string; snippet: string }>(
      `SELECT l.id,l.title,ts_headline('english',coalesce(l."bodyMarkdown",''),
         websearch_to_tsquery('english',$2), 'MaxWords=22,MinWords=8,StartSel=,StopSel=') AS snippet
       FROM app."Lesson" l JOIN app."Chapter" c ON c.id=l."chapterId"
       JOIN app."Revision" r ON r.id=c."revisionId" JOIN app."Edition" e ON e.id=r."editionId"
       JOIN app."Publication" p ON p.id=e."publicationId"
       WHERE e.id=$1 AND e."currentRevisionId"=r.id AND r.status='PUBLISHED'
         AND r."publishedAt"<=now() AND p.status='PUBLISHED'
         AND to_tsvector('english',coalesce(l."bodyMarkdown",'')) @@ websearch_to_tsquery('english',$2)
       ORDER BY c.ordinal,l.ordinal LIMIT 100`,
      [editionId, query],
    );
    const matches = [];
    for (const item of result.rows) {
      const row = await this.lesson(item.id);
      try {
        await this.authorize(this.path(row), context, 'read');
        matches.push(item);
      } catch (error) {
        if (!(error instanceof HttpException) || ![401, 403].includes(error.getStatus()))
          throw error;
      }
    }
    return matches;
  }

  async saveProgress(
    id: string,
    context: AuthContext,
    position: { anchor?: string; percent?: number },
    completed: boolean,
  ) {
    const row = await this.lesson(id);
    await this.authorize(this.path(row), context, 'read');
    const result = await this.pool.query(
      `INSERT INTO app."ReadingProgress" (id,"userId","editionId","lessonId",position,"completedAt","updatedAt")
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,now())
       ON CONFLICT ("userId","lessonId") DO UPDATE SET position=EXCLUDED.position,
         "completedAt"=CASE WHEN $7 THEN now() ELSE app."ReadingProgress"."completedAt" END,"updatedAt"=now()
       RETURNING id,position,"completedAt","updatedAt"`,
      [
        randomUUID(),
        context.user.id,
        row.editionId,
        id,
        JSON.stringify(position),
        completed ? new Date() : null,
        completed,
      ],
    );
    return result.rows[0];
  }

  async bookmark(id: string, context: AuthContext, anchor: string) {
    const row = await this.lesson(id);
    await this.authorize(this.path(row), context, 'read');
    const result = await this.pool.query(
      `INSERT INTO app."Bookmark" (id,"userId","editionId","revisionId",anchor)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT ("userId","revisionId",anchor) DO NOTHING RETURNING id`,
      [randomUUID(), context.user.id, row.editionId, row.revisionId, `${id}:${anchor}`],
    );
    return { id: result.rows[0]?.id ?? null };
  }

  async bookmarks(context: AuthContext, editionId: string) {
    const result = await this.pool.query(
      `SELECT b.id,b.anchor,b."createdAt" FROM app."Bookmark" b WHERE b."userId"=$1 AND b."editionId"=$2
       ORDER BY b."createdAt" DESC LIMIT 200`,
      [context.user.id, editionId],
    );
    return result.rows;
  }

  async progress(context: AuthContext, editionId: string) {
    const rows = await this.pool.query(
      `SELECT p."lessonId",p.position,p."completedAt",p."updatedAt" FROM app."ReadingProgress" p
       WHERE p."userId"=$1 AND p."editionId"=$2 ORDER BY p."updatedAt" DESC LIMIT 500`,
      [context.user.id, editionId],
    );
    return rows.rows;
  }

  async addAnnotation(
    id: string,
    context: AuthContext,
    data: {
      anchor: string;
      kind: 'NOTE' | 'HIGHLIGHT';
      quote?: string | undefined;
      note?: string | undefined;
    },
  ) {
    const row = await this.lesson(id);
    await this.authorize(this.path(row), context, 'read');
    const body = seal(
      JSON.stringify({ kind: data.kind, quote: data.quote ?? '', note: data.note ?? '' }),
      this.config.AUTH_DATA_KEY,
    );
    if (body.length > 500) throw new HttpException('Annotation is too long', 400);
    const result = await this.pool.query<{ id: string }>(
      `INSERT INTO app."Annotation" (id,"userId","editionId","revisionId",anchor,"encryptedBodyRef","updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,now()) RETURNING id`,
      [randomUUID(), context.user.id, row.editionId, row.revisionId, `${id}:${data.anchor}`, body],
    );
    return { id: result.rows[0]!.id };
  }

  async annotations(id: string, context: AuthContext) {
    const row = await this.lesson(id);
    await this.authorize(this.path(row), context, 'read');
    const result = await this.pool.query<{
      id: string;
      anchor: string;
      encryptedBodyRef: string;
      createdAt: Date;
    }>(
      `SELECT id,anchor,"encryptedBodyRef","createdAt" FROM app."Annotation"
       WHERE "userId"=$1 AND "revisionId"=$2 AND anchor LIKE $3
       ORDER BY "createdAt" DESC LIMIT 200`,
      [context.user.id, row.revisionId, `${id}:%`],
    );
    return result.rows.map((item) => ({
      id: item.id,
      anchor: item.anchor.slice(id.length + 1),
      createdAt: item.createdAt,
      ...JSON.parse(unseal(item.encryptedBodyRef, this.config.AUTH_DATA_KEY)),
    }));
  }

  async deleteAnnotation(id: string, context: AuthContext) {
    const result = await this.pool.query(
      `DELETE FROM app."Annotation" WHERE id=$1 AND "userId"=$2 RETURNING id`,
      [id, context.user.id],
    );
    if (!result.rowCount) throw new HttpException('Annotation not found', 404);
    return { deleted: true };
  }

  private signature(payload: string): string {
    return createHmac('sha256', Buffer.from(this.config.AUTH_SESSION_SECRET, 'hex'))
      .update(`reader-asset:${payload}`)
      .digest('base64url');
  }

  async lessonAssetGrant(id: string, context: AuthContext | null) {
    const row = await this.lesson(id);
    if (!row.bodyAssetId) throw new HttpException('Download unavailable', 404);
    await this.authorize(this.path(row), context, 'download');
    const asset = await this.pool.query(
      `SELECT 1 FROM app."Asset" WHERE id=$1 AND status='APPROVED' AND "scannedAt" IS NOT NULL
       AND "permissionConfirmedAt" IS NOT NULL`,
      [row.bodyAssetId],
    );
    if (!asset.rowCount) throw new HttpException('Download unavailable', 404);
    return this.assetGrant({ lessonId: id, assetId: row.bodyAssetId }, context);
  }

  async resourceAssetGrant(id: string, assetId: string, context: AuthContext | null) {
    await this.resourceAccess(id, context, 'download');
    const asset = await this.pool.query(
      `SELECT 1 FROM app."ResourceAttachment" ra JOIN app."Asset" a ON a.id=ra."assetId"
       WHERE ra."resourceId"=$1 AND ra."assetId"=$2 AND a.status='APPROVED'
         AND a."scannedAt" IS NOT NULL AND a."permissionConfirmedAt" IS NOT NULL`,
      [id, assetId],
    );
    if (!asset.rowCount) throw new HttpException('Download unavailable', 404);
    return this.assetGrant({ resourceId: id, assetId }, context);
  }

  private assetGrant(
    source: { lessonId?: string; resourceId?: string; assetId: string },
    context: AuthContext | null,
  ) {
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const payload = Buffer.from(
      JSON.stringify({
        ...source,
        userId: context?.user.id ?? null,
        sessionId: context?.session.id ?? null,
        expiresAt,
      }),
    ).toString('base64url');
    return { assetId: source.assetId, token: `${payload}.${this.signature(payload)}`, expiresAt };
  }

  async deliverLessonAsset(
    assetId: string,
    token: string,
    context: AuthContext | null,
    response: Response,
    requestId: string,
  ) {
    const [payload, signature] = token.split('.');
    if (!payload || !signature) throw new HttpException('Download grant invalid', 403);
    const expected = Buffer.from(this.signature(payload));
    const provided = Buffer.from(signature);
    if (expected.length !== provided.length || !timingSafeEqual(expected, provided))
      throw new HttpException('Download grant invalid', 403);
    let grant: {
      lessonId?: string;
      resourceId?: string;
      assetId: string;
      userId: string | null;
      sessionId: string | null;
      expiresAt: string;
    };
    try {
      grant = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
      throw new HttpException('Download grant invalid', 403);
    }
    if (
      grant.assetId !== assetId ||
      !Number.isFinite(Date.parse(grant.expiresAt)) ||
      Date.parse(grant.expiresAt) <= Date.now() ||
      Date.parse(grant.expiresAt) > Date.now() + 60_000 ||
      grant.userId !== (context?.user.id ?? null) ||
      grant.sessionId !== (context?.session.id ?? null)
    )
      throw new HttpException('Download grant expired or invalid', 403);
    if (grant.lessonId && !grant.resourceId) {
      const row = await this.lesson(grant.lessonId);
      if (row.bodyAssetId !== assetId) throw new HttpException('Download unavailable', 404);
      await this.authorize(this.path(row), context, 'download');
    } else if (grant.resourceId && !grant.lessonId) {
      await this.resourceAccess(grant.resourceId, context, 'download');
      const attachment = await this.pool.query(
        `SELECT 1 FROM app."ResourceAttachment" WHERE "resourceId"=$1 AND "assetId"=$2`,
        [grant.resourceId, assetId],
      );
      if (!attachment.rowCount) throw new HttpException('Download unavailable', 404);
    } else throw new HttpException('Download grant invalid', 403);
    const asset = await this.pool.query<{
      storageKey: string;
      originalName: string;
      mimeType: string;
    }>(
      `SELECT "storageKey","originalName","mimeType" FROM app."Asset" WHERE id=$1
       AND status='APPROVED' AND "scannedAt" IS NOT NULL AND "permissionConfirmedAt" IS NOT NULL`,
      [assetId],
    );
    const item = asset.rows[0];
    if (!item) throw new HttpException('Download unavailable', 404);
    const root = resolve(
      process.env.STUDIO_STORAGE_ROOT ??
        fileURLToPath(new URL('../../../../.private-objects/', import.meta.url)),
    );
    const file = resolve(root, item.storageKey);
    if (!file.startsWith(`${root}${sep}`)) throw new HttpException('Download unavailable', 404);
    await access(file).catch(() => {
      throw new HttpException('Download unavailable', 404);
    });
    await this.pool.query(
      `INSERT INTO app."AuditEvent" (id,"actorId",action,"objectType","objectId","correlationId")
       VALUES ($1,$2,'reader.asset.download','Asset',$3,$4)`,
      [randomUUID(), context?.user.id ?? null, assetId, requestId],
    );
    const safeName = item.originalName
      .replaceAll('\\', '/')
      .split('/')
      .pop()!
      .replace(/[^A-Za-z0-9._ -]/g, '_')
      .slice(0, 180);
    response.setHeader('Content-Type', item.mimeType);
    response.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    await pipeline(createReadStream(file), response);
  }
}
