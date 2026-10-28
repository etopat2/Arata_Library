import {
  createHash,
  createHmac,
  generateKeyPairSync,
  randomUUID,
  sign as signBytes,
  timingSafeEqual,
} from 'node:crypto';
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
  type PolicyScope,
  type ReaderAction,
} from '@arata/access-policy';
import type { AuthContext } from '../identity/identity.service.js';
import type { ApiConfig } from '../app.js';
import { seal, unseal } from '../identity/security.js';
import { PlatformPolicyService } from '../platform-policy/platform-policy.service.js';
import { EntitlementService } from '../entitlements/entitlement.service.js';

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

const offlineSigningKeys = generateKeyPairSync('ed25519');
type OfflineChange = {
  id: string;
  kind: 'progress' | 'bookmark' | 'annotation';
  clientUpdatedAt: string;
  entityId: string;
  operation: 'upsert' | 'delete';
  content?: Record<string, unknown> | undefined;
  percent?: number | undefined;
};

@Injectable()
export class ReaderService {
  constructor(
    @Inject('DB_POOL') private readonly pool: Pool,
    @Inject('APP_CONFIG') private readonly config: ApiConfig,
    @Inject(PlatformPolicyService) private readonly platformPolicy: PlatformPolicyService,
    @Inject(EntitlementService) private readonly entitlements: EntitlementService,
  ) {}

  async settings(context: AuthContext) {
    const result = await this.pool.query<{
      theme: 'paper' | 'sepia' | 'night';
      fontSize: number;
      fontFamily: 'system' | 'serif' | 'mono';
      lineSpacing: number;
      reducedMotion: boolean;
    }>(
      `SELECT theme, "fontSize", "fontFamily", "lineSpacing", "reducedMotion"
        FROM app."ReaderPreference" WHERE "userId"=$1`,
      [context.user.id],
    );
    const row = result.rows[0];
    return row ? { ...row, lineSpacing: row.lineSpacing / 100 } : null;
  }

  async saveSettings(
    context: AuthContext,
    value: {
      theme: 'paper' | 'sepia' | 'night';
      fontSize: 16 | 18 | 21 | 24;
      fontFamily: 'system' | 'serif' | 'mono';
      lineSpacing: 1.5 | 1.75 | 2;
      reducedMotion: boolean;
    },
  ) {
    await this.pool.query(
      `INSERT INTO app."ReaderPreference"
        ("userId", theme, "fontSize", "fontFamily", "lineSpacing", "reducedMotion")
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT ("userId") DO UPDATE SET theme=EXCLUDED.theme,
          "fontSize"=EXCLUDED."fontSize", "fontFamily"=EXCLUDED."fontFamily",
          "lineSpacing"=EXCLUDED."lineSpacing", "reducedMotion"=EXCLUDED."reducedMotion",
          "updatedAt"=now()`,
      [
        context.user.id,
        value.theme,
        value.fontSize,
        value.fontFamily,
        Math.round(value.lineSpacing * 100),
        value.reducedMotion,
      ],
    );
    return value;
  }

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

  async effectivePath(scope: PolicyScope, id: string): Promise<PolicyPath> {
    if (scope === 'libraryId') {
      const found = await this.pool.query(`SELECT 1 FROM app."Library" WHERE id=$1`, [id]);
      if (!found.rowCount) throw new HttpException('Policy target not found', 404);
      return { libraryId: id };
    }
    const queries: Record<Exclude<PolicyScope, 'libraryId'>, string> = {
      publicationId: `SELECT p.id AS "publicationId" FROM app."Publication" p WHERE p.id=$1`,
      volumeId: `SELECT p.id AS "publicationId",v.id AS "volumeId"
        FROM app."Volume" v JOIN app."Publication" p ON p.id=v."publicationId" WHERE v.id=$1`,
      editionId: `SELECT p.id AS "publicationId",e."volumeId",e.id AS "editionId"
        FROM app."Edition" e JOIN app."Publication" p ON p.id=e."publicationId" WHERE e.id=$1`,
      revisionId: `SELECT p.id AS "publicationId",e."volumeId",e.id AS "editionId",r.id AS "revisionId"
        FROM app."Revision" r JOIN app."Edition" e ON e.id=r."editionId"
        JOIN app."Publication" p ON p.id=e."publicationId" WHERE r.id=$1`,
      chapterId: `SELECT p.id AS "publicationId",e."volumeId",e.id AS "editionId",
          r.id AS "revisionId",c.id AS "chapterId"
        FROM app."Chapter" c JOIN app."Revision" r ON r.id=c."revisionId"
        JOIN app."Edition" e ON e.id=r."editionId"
        JOIN app."Publication" p ON p.id=e."publicationId" WHERE c.id=$1`,
      lessonId: `SELECT p.id AS "publicationId",e."volumeId",e.id AS "editionId",
          r.id AS "revisionId",c.id AS "chapterId",l.id AS "lessonId"
        FROM app."Lesson" l JOIN app."Chapter" c ON c.id=l."chapterId"
        JOIN app."Revision" r ON r.id=c."revisionId"
        JOIN app."Edition" e ON e.id=r."editionId"
        JOIN app."Publication" p ON p.id=e."publicationId" WHERE l.id=$1`,
      resourceId: `SELECT p.id AS "publicationId",COALESCE(res."volumeId",e."volumeId") AS "volumeId",
          e.id AS "editionId",rv.id AS "revisionId",COALESCE(res."chapterId",lc.id) AS "chapterId",
          res."lessonId",res.id AS "resourceId"
        FROM app."Resource" res LEFT JOIN app."Lesson" l ON l.id=res."lessonId"
        LEFT JOIN app."Chapter" lc ON lc.id=l."chapterId"
        LEFT JOIN app."Chapter" c ON c.id=res."chapterId"
        LEFT JOIN app."Revision" rv ON rv.id=COALESCE(res."revisionId",c."revisionId",lc."revisionId")
        LEFT JOIN app."Edition" e ON e.id=COALESCE(res."editionId",rv."editionId")
        LEFT JOIN app."Volume" v ON v.id=res."volumeId"
        LEFT JOIN app."Publication" p ON p.id=COALESCE(res."publicationId",e."publicationId",v."publicationId")
        WHERE res.id=$1`,
    };
    const result = await this.pool.query<PolicyPath>(queries[scope], [id]);
    const row = result.rows[0];
    if (!row) throw new HttpException('Policy target not found', 404);
    const path = Object.fromEntries(
      Object.entries(row).filter(([, value]) => value !== null),
    ) as PolicyPath;
    const libraries = path.publicationId
      ? await this.pool.query<{ libraryId: string }>(
          `SELECT DISTINCT co."libraryId" FROM app."PublicationCollection" pc
           JOIN app."Collection" co ON co.id=pc."collectionId" WHERE pc."publicationId"=$1`,
          [path.publicationId],
        )
      : null;
    if (libraries && libraries.rowCount! > 1)
      throw new HttpException('Ambiguous library assignment', 409);
    const fallback = libraries?.rows[0]?.libraryId
      ? libraries.rows[0].libraryId
      : (
          await this.pool.query<{ id: string }>(
            `SELECT id FROM app."Library" ORDER BY "createdAt",id LIMIT 1`,
          )
        ).rows[0]?.id;
    if (fallback) path.libraryId = fallback;
    return path;
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
    const defaults = (await this.platformPolicy.current()).settings.reader;
    return resolveContentPolicy(path, rows.rows, {
      allowCopy: defaults.defaultCopy,
      allowPrint: defaults.defaultPrint,
      allowDownload: defaults.defaultDownload,
      allowExportPdf: defaults.defaultExport,
      allowExportEpub: defaults.defaultExport,
      allowOffline: defaults.defaultOffline,
      watermark: defaults.watermarkEnabled,
      screenshotMode: defaults.screenshotNoticeEnabled ? 'RESTRICTED_NOTICE' : 'ALLOW',
    });
  }

  private async entitled(context: AuthContext | null, path: PolicyPath): Promise<boolean> {
    return (await this.entitlements.effective(context?.user.id ?? null, path)).allowed;
  }

  async authorize(
    path: PolicyPath,
    context: AuthContext | null,
    action: Extract<ReaderAction, 'read' | 'preview' | 'download' | 'offline'>,
  ) {
    const policy = await this.policy(path);
    const decision = await this.entitlements.effective(context?.user.id ?? null, path);
    const permitted = mayUseContent(policy, action, {
      authenticated: !!context,
      entitled: decision.allowed,
    });
    const log = async (allowed: boolean, reasonCode: string) => {
      if (!context || policy.accessClass === 'PUBLIC_FREE') return;
      const targetId = path.resourceId ?? path.lessonId ?? path.editionId;
      if (targetId)
        await this.entitlements.logDecision({
          userId: context.user.id,
          action: action === 'download' ? 'DOWNLOAD' : action === 'preview' ? 'PREVIEW' : 'READ',
          targetKind: path.resourceId ? 'RESOURCE' : path.lessonId ? 'LESSON' : 'EDITION',
          targetId,
          decision: allowed ? 'ALLOW' : 'DENY',
          reasonCode,
          ...(decision.matched[0] ? { entitlementId: decision.matched[0].id } : {}),
        });
    };
    if (!permitted) {
      await log(false, 'POLICY_DENIED');
      const signInMayHelp =
        !context &&
        (policy.accessClass === 'REGISTERED_FREE' || policy.accessClass === 'PREMIUM') &&
        mayUseContent(policy, action, { authenticated: true, entitled: true });
      throw new HttpException(
        signInMayHelp ? 'Authentication required' : 'Access denied',
        signInMayHelp ? 401 : 403,
      );
    }
    if (context && action !== 'preview' && policy.accessClass !== 'PUBLIC_FREE') {
      try {
        await this.reserveReaderLeases(context, policy);
      } catch (error) {
        await log(
          false,
          error instanceof HttpException && error.message === 'Licensed session limit reached'
            ? 'SESSION_LIMIT'
            : 'SESSION_DENIED',
        );
        throw error;
      }
    }
    await log(true, decision.allowed ? 'ENTITLEMENT_MATCH' : 'FREE_POLICY');
    return policy;
  }

  private deviceHash(userId: string, deviceId: string) {
    return createHmac('sha256', Buffer.from(this.config.AUTH_SESSION_SECRET, 'hex'))
      .update(`offline-device:${userId}:${deviceId}`)
      .digest('hex');
  }

  async createOfflineLicence(
    context: AuthContext,
    editionId: string,
    deviceId: string,
    idempotencyKey: string,
  ) {
    const edition = await this.pool.query<{ id: string; revisionId: string | null }>(
      `SELECT e.id,e."currentRevisionId" AS "revisionId" FROM app."Edition" e
       JOIN app."Publication" p ON p.id=e."publicationId" WHERE e.id=$1 AND p.status='PUBLISHED'`,
      [editionId],
    );
    const current = edition.rows[0];
    if (!current?.revisionId) throw new HttpException('Edition not found', 404);
    const toc = await this.manifest(editionId, context);
    const eligible: { id: string }[] = [];
    let expiryBound: Date | null = null;
    for (const item of toc.lessons) {
      if (!item.available) continue;
      const row = await this.lesson(item.id);
      const path = this.path(row);
      const entitlement = await this.entitlements.effective(context.user.id, path);
      const accessPolicy = await this.policy(path);
      if (
        !mayUseContent(accessPolicy, 'offline', {
          authenticated: true,
          entitled: entitlement.allowed,
        })
      )
        continue;
      const policy = await this.authorize(path, context, 'offline');
      if (!policy.allowOffline) continue;
      const grants = entitlement;
      const matchingEnds = grants.matched.map((grant) => grant.endsAt?.getTime() ?? null);
      const itemBound =
        grants.allowed && matchingEnds.length && matchingEnds.every(Boolean)
          ? new Date(Math.max(...matchingEnds.map((value) => value!)))
          : null;
      if (itemBound && (!expiryBound || itemBound < expiryBound)) expiryBound = itemBound;
      eligible.push({ id: item.id });
    }
    if (!eligible.length) throw new HttpException('Offline reading is not permitted', 403);
    const settings = (await this.platformPolicy.current()).settings.reader;
    const deviceHash = this.deviceHash(context.user.id, deviceId);
    const dayBound = new Date(Date.now() + settings.offlineLicenceDays * 86_400_000);
    const expiresAt = expiryBound && expiryBound < dayBound ? expiryBound : dayBound;
    const manifestHash = createHash('sha256')
      .update(JSON.stringify({ editionId, revisionId: current.revisionId, lessons: eligible }))
      .digest('hex');
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ editionId, deviceHash }))
      .digest('hex');
    const prior = await this.pool.query<{
      id: string;
      editionId: string;
      revisionId: string;
      manifestHash: string;
      issuedAt: Date;
      expiresAt: Date;
      revokedAt: Date | null;
      requestHash: string | null;
    }>(
      `SELECT id,"editionId","revisionId","manifestHash","issuedAt","expiresAt","revokedAt","requestHash"
       FROM app."OfflineLicence" WHERE "userId"=$1 AND "idempotencyKey"=$2`,
      [context.user.id, idempotencyKey],
    );
    if (prior.rows[0]) {
      if (prior.rows[0].requestHash !== requestHash)
        throw new HttpException('Idempotency key reused with a different request', 409);
      return this.signedLicence(
        prior.rows[0],
        eligible.map((item) => item.id),
      );
    }
    const client = await this.pool.connect();
    let licence: {
      id: string;
      editionId: string;
      revisionId: string;
      manifestHash: string;
      issuedAt: Date;
      expiresAt: Date;
      revokedAt: Date | null;
    };
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `offline-device:${context.user.id}`,
      ]);
      const active = await client.query<{ count: string }>(
        `SELECT count(DISTINCT "deviceHash")::text AS count FROM app."OfflineLicence"
         WHERE "userId"=$1 AND "expiresAt">now() AND "revokedAt" IS NULL`,
        [context.user.id],
      );
      const existingDevice = await client.query(
        `SELECT 1 FROM app."OfflineLicence" WHERE "userId"=$1 AND "deviceHash"=$2
         AND "expiresAt">now() AND "revokedAt" IS NULL LIMIT 1`,
        [context.user.id, deviceHash],
      );
      if (
        !existingDevice.rowCount &&
        Number(active.rows[0]?.count ?? 0) >= settings.maxLicensedDevices
      )
        throw new HttpException('Offline device limit reached', 403);
      const result = await client.query<NonNullable<typeof licence>>(
        `INSERT INTO app."OfflineLicence"
         (id,"userId","editionId","revisionId","deviceHash","manifestHash","idempotencyKey","requestHash","expiresAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,"editionId","revisionId","manifestHash","issuedAt","expiresAt","revokedAt"`,
        [
          randomUUID(),
          context.user.id,
          editionId,
          current.revisionId,
          deviceHash,
          manifestHash,
          idempotencyKey,
          requestHash,
          expiresAt,
        ],
      );
      licence = result.rows[0]!;
      await client.query(
        `INSERT INTO app."AuditEvent" (id,"actorId",action,"objectType","objectId","correlationId")
         VALUES ($1,$2,'reader.offline.issue','OfflineLicence',$3,$4)`,
        [randomUUID(), context.user.id, licence.id, context.session.id],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (error instanceof HttpException) throw error;
      const retry = await this.pool.query<{
        id: string;
        editionId: string;
        revisionId: string;
        manifestHash: string;
        issuedAt: Date;
        expiresAt: Date;
        revokedAt: Date | null;
        requestHash: string | null;
      }>(
        `SELECT id,"editionId","revisionId","manifestHash","issuedAt","expiresAt","revokedAt","requestHash"
         FROM app."OfflineLicence" WHERE "userId"=$1 AND "idempotencyKey"=$2`,
        [context.user.id, idempotencyKey],
      );
      if (retry.rows[0]?.requestHash === requestHash)
        return this.signedLicence(
          retry.rows[0],
          eligible.map((item) => item.id),
        );
      throw error;
    } finally {
      client.release();
    }
    return this.signedLicence(
      licence,
      eligible.map((item) => item.id),
    );
  }

  private signedLicence(
    row: {
      id: string;
      editionId: string;
      revisionId: string;
      manifestHash: string;
      issuedAt: Date;
      expiresAt: Date;
      revokedAt: Date | null;
    },
    lessonIds: string[],
  ) {
    const license = {
      id: row.id,
      editionId: row.editionId,
      revisionId: row.revisionId,
      manifestHash: row.manifestHash,
      lessonIds,
      issuedAt: row.issuedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      revokedAt: row.revokedAt?.toISOString() ?? null,
      serverTime: new Date().toISOString(),
      formatVersion: 1,
    };
    const payload = Buffer.from(JSON.stringify(license));
    const signature = signBytes(null, payload, offlineSigningKeys.privateKey).toString('base64url');
    const publicKey = offlineSigningKeys.publicKey
      .export({ type: 'spki', format: 'der' })
      .toString('base64url');
    return { ...license, signature, publicKey };
  }

  async offlineLicences(context: AuthContext, deviceId: string) {
    const deviceHash = this.deviceHash(context.user.id, deviceId);
    const result = await this.pool.query(
      `SELECT id,"editionId","revisionId","manifestHash","issuedAt","expiresAt","revokedAt"
       FROM app."OfflineLicence" WHERE "userId"=$1 AND "deviceHash"=$2 ORDER BY "issuedAt" DESC LIMIT 50`,
      [context.user.id, deviceHash],
    );
    return result.rows;
  }

  async revokeOfflineLicence(context: AuthContext, id: string) {
    const result = await this.pool.query<{ id: string }>(
      `UPDATE app."OfflineLicence" SET "revokedAt"=COALESCE("revokedAt",now())
       WHERE id=$1 AND "userId"=$2 RETURNING id`,
      [id, context.user.id],
    );
    if (!result.rowCount) throw new HttpException('Offline licence not found', 404);
    await this.pool.query(
      `INSERT INTO app."AuditEvent" (id,"actorId",action,"objectType","objectId","correlationId")
       VALUES ($1,$2,'reader.offline.revoke','OfflineLicence',$3,$4)`,
      [randomUUID(), context.user.id, id, context.session.id],
    );
    return { revoked: true };
  }

  async syncOfflineChanges(
    context: AuthContext,
    deviceId: string,
    licenceId: string,
    changes: OfflineChange[],
  ) {
    const deviceHash = this.deviceHash(context.user.id, deviceId);
    const outcomes = [];
    for (const change of changes) {
      if (Date.parse(change.clientUpdatedAt) > Date.now() + 5 * 60_000)
        throw new HttpException('Client change timestamp is in the future', 400);
      const payloadHash = createHash('sha256').update(JSON.stringify(change)).digest('hex');
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          `reader-sync:${context.user.id}:${change.id}`,
        ]);
        const prior = await client.query<{ payloadHash: string; result: unknown }>(
          `SELECT "payloadHash",result FROM app."SyncOperation" WHERE "userId"=$1 AND "clientOperationId"=$2`,
          [context.user.id, change.id],
        );
        if (prior.rows[0]) {
          if (prior.rows[0].payloadHash !== payloadHash)
            throw new HttpException('Sync operation ID reused with different content', 409);
          await client.query('COMMIT');
          outcomes.push(prior.rows[0].result);
          continue;
        }
        let result: unknown = { accepted: true, id: change.id };
        const lesson = await this.lesson(change.entityId ?? '');
        const path = this.path(lesson);
        const policy = await this.authorize(path, context, 'read');
        const activeLicence = await client.query(
          `SELECT 1 FROM app."OfflineLicence" WHERE id=$1 AND "userId"=$2 AND "deviceHash"=$3
           AND "editionId"=$4 AND "revisionId"=$5 AND "revokedAt" IS NULL AND "expiresAt">now()
           LIMIT 1`,
          [licenceId, context.user.id, deviceHash, lesson.editionId, lesson.revisionId],
        );
        if (!activeLicence.rowCount || !policy.allowOffline)
          throw new HttpException('Offline licence expired, revoked, or out of scope', 403);
        if (change.operation === 'delete') {
          if (change.kind === 'bookmark' && change.entityId)
            await client.query(`DELETE FROM app."Bookmark" WHERE id=$1 AND "userId"=$2`, [
              change.entityId,
              context.user.id,
            ]);
          if (change.kind === 'annotation' && change.entityId)
            await client.query(`DELETE FROM app."Annotation" WHERE id=$1 AND "userId"=$2`, [
              change.entityId,
              context.user.id,
            ]);
        } else if (change.kind === 'progress') {
          const position =
            change.content?.position && typeof change.content.position === 'object'
              ? change.content.position
              : {};
          const serverRow = await client.query<{
            updatedAt: Date;
            position: unknown;
            completedAt: Date | null;
          }>(
            `SELECT "updatedAt",position,"completedAt" FROM app."ReadingProgress" WHERE "userId"=$1 AND "lessonId"=$2`,
            [context.user.id, lesson.id],
          );
          const clientAt = Date.parse(change.clientUpdatedAt);
          if (serverRow.rows[0] && serverRow.rows[0].updatedAt.getTime() > clientAt) {
            result = {
              accepted: false,
              conflict: true,
              operationId: change.id,
              serverUpdatedAt: serverRow.rows[0].updatedAt.toISOString(),
              serverPosition: serverRow.rows[0].position,
              serverCompletedAt: serverRow.rows[0].completedAt?.toISOString() ?? null,
            };
          } else {
            await client.query(
              `INSERT INTO app."ReadingProgress" (id,"userId","editionId","lessonId",position,"completedAt","updatedAt")
             VALUES ($1,$2,$3,$4,$5::jsonb,$6,now()) ON CONFLICT ("userId","lessonId") DO UPDATE
             SET position=EXCLUDED.position,"completedAt"=CASE WHEN EXCLUDED."completedAt" IS NOT NULL THEN EXCLUDED."completedAt" ELSE app."ReadingProgress"."completedAt" END,"updatedAt"=now()`,
              [
                randomUUID(),
                context.user.id,
                lesson.editionId,
                lesson.id,
                JSON.stringify(position),
                change.percent === 100 ? new Date() : null,
              ],
            );
          }
        } else if (change.kind === 'bookmark') {
          const anchor =
            typeof change.content?.anchor === 'string' ? change.content.anchor.slice(0, 450) : '';
          if (!anchor) throw new HttpException('Sync bookmark anchor required', 400);
          await client.query(
            `INSERT INTO app."Bookmark" (id,"userId","editionId","revisionId",anchor) VALUES ($1,$2,$3,$4,$5) ON CONFLICT ("userId","revisionId",anchor) DO NOTHING`,
            [
              randomUUID(),
              context.user.id,
              lesson.editionId,
              lesson.revisionId,
              `${lesson.id}:${anchor}`,
            ],
          );
        } else if (change.kind === 'annotation') {
          const content = change.content ?? {};
          const anchor = typeof content.anchor === 'string' ? content.anchor.slice(0, 300) : '';
          const kind = content.kind === 'HIGHLIGHT' ? 'HIGHLIGHT' : 'NOTE';
          const note = typeof content.note === 'string' ? content.note.slice(0, 160) : '';
          const quote = typeof content.quote === 'string' ? content.quote.slice(0, 100) : '';
          if (!anchor) throw new HttpException('Sync annotation anchor required', 400);
          const encryptedBodyRef = seal(
            JSON.stringify({ kind, note, quote }),
            this.config.AUTH_DATA_KEY,
          );
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO app."Annotation" (id,"userId","editionId","revisionId",anchor,"encryptedBodyRef","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,now()) RETURNING id`,
            [
              randomUUID(),
              context.user.id,
              lesson.editionId,
              lesson.revisionId,
              `${lesson.id}:${anchor}`,
              encryptedBodyRef,
            ],
          );
          result = { accepted: true, id: change.id, entityId: inserted.rows[0]?.id };
        }
        await client.query(
          `INSERT INTO app."SyncOperation" (id,"userId","deviceHash","clientOperationId","operationType","payloadHash",result)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT ("userId","clientOperationId") DO NOTHING`,
          [
            randomUUID(),
            context.user.id,
            deviceHash,
            change.id,
            `${change.kind}.${change.operation}`,
            payloadHash,
            JSON.stringify(result),
          ],
        );
        await client.query('COMMIT');
        outcomes.push(result);
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }
    return { outcomes, serverTime: new Date().toISOString() };
  }

  private async reserveReaderLeases(context: AuthContext, policy: EffectiveContentPolicy) {
    if (!policy.sessionLimits.length) return;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const session = await client.query<{ expiresAt: Date }>(
        `SELECT "expiresAt" FROM app."AuthSession" WHERE id=$1 AND "userId"=$2
         AND "revokedAt" IS NULL AND "expiresAt">now()`,
        [context.session.id, context.user.id],
      );
      if (!session.rows[0]) throw new HttpException('Authentication required', 401);
      // Stable lock order makes simultaneous reads on overlapping policy scopes safe.
      for (const limit of [...policy.sessionLimits].sort((a, b) =>
        a.policyId.localeCompare(b.policyId),
      )) {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          `reader-lease:${limit.policyId}:${context.user.id}`,
        ]);
        const current = await client.query<{ isActive: boolean }>(
          `SELECT "isActive" FROM app."ContentPolicy" WHERE id=$1`,
          [limit.policyId],
        );
        if (!current.rows[0]?.isActive) throw new HttpException('Policy changed; retry', 409);
        await client.query(
          `DELETE FROM app."ReaderLease" l USING app."AuthSession" s
           WHERE l."sessionId"=s.id AND l."policyId"=$1 AND l."userId"=$2
             AND (l."expiresAt"<=now() OR s."revokedAt" IS NOT NULL OR s."expiresAt"<=now())`,
          [limit.policyId, context.user.id],
        );
        const existing = await client.query<{ expiresAt: Date }>(
          `SELECT "expiresAt" FROM app."ReaderLease" WHERE "policyId"=$1
           AND "userId"=$2 AND "sessionId"=$3`,
          [limit.policyId, context.user.id, context.session.id],
        );
        if (!existing.rows[0] || existing.rows[0].expiresAt <= new Date()) {
          const active = await client.query<{ count: string }>(
            `SELECT count(*)::text AS count FROM app."ReaderLease" l
             JOIN app."AuthSession" s ON s.id=l."sessionId" AND s."userId"=l."userId"
             WHERE l."policyId"=$1 AND l."userId"=$2 AND l."sessionId"<>$3
               AND l."expiresAt">now() AND s."revokedAt" IS NULL AND s."expiresAt">now()`,
            [limit.policyId, context.user.id, context.session.id],
          );
          if (Number(active.rows[0]?.count ?? 0) >= limit.maxSessions)
            throw new HttpException('Licensed session limit reached', 403);
        }
        await client.query(
          `INSERT INTO app."ReaderLease" (id,"policyId","userId","sessionId","expiresAt")
           VALUES ($1,$2,$3,$4,least(now()+interval '15 minutes',$5::timestamptz))
           ON CONFLICT ("policyId","userId","sessionId") DO UPDATE SET
             "expiresAt"=EXCLUDED."expiresAt","updatedAt"=now()`,
          [
            randomUUID(),
            limit.policyId,
            context.user.id,
            context.session.id,
            session.rows[0].expiresAt,
          ],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
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

  private async resourceAccess(
    id: string,
    context: AuthContext | null,
    action: Extract<ReaderAction, 'read' | 'preview' | 'download'>,
  ) {
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
