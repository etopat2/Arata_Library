import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, mkdir, open, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpException, Inject, Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import type { Request, Response } from 'express';
import type { AuthContext } from '../identity/identity.service.js';

const root = resolve(
  process.env.STUDIO_STORAGE_ROOT ??
    fileURLToPath(new URL('../../../../.private-objects/', import.meta.url)),
);
const allowed = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/epub+zip',
  'application/zip',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/markdown',
  'text/plain',
  'image/png',
  'image/jpeg',
  'image/webp',
  'audio/mpeg',
  'video/mp4',
]);
const cleanName = (name: string) =>
  basename(name.replaceAll('\\', '/'))
    .replace(/[^A-Za-z0-9._ -]/g, '_')
    .slice(0, 180);

@Injectable()
export class StudioUploads {
  constructor(@Inject('DB_POOL') private readonly pool: Pool) {
    if (process.env.NODE_ENV === 'production' && !process.env.STUDIO_STORAGE_ROOT)
      throw new Error('Private Studio storage root required');
  }
  private path(id: string) {
    return join(root, 'quarantine', id);
  }
  private async authority(
    client: PoolClient,
    context: AuthContext,
    publicationId: string,
    roles: string[] = ['AUTHOR', 'EDITOR', 'PUBLISHER'],
  ) {
    const result = await client.query(
      `SELECT 1 FROM app."RoleAssignment" a JOIN app."Role" r ON r.id=a."roleId" WHERE a."userId"=$1 AND a."revokedAt" IS NULL AND a."startsAt"<=now() AND (a."endsAt" IS NULL OR a."endsAt">now()) AND r.code=ANY($3::text[]) AND ((a."scopeType"='PLATFORM' AND a."scopeId" IS NULL) OR (a."scopeType"='PUBLICATION' AND a."scopeId"=$2))`,
      [context.user.id, publicationId, roles],
    );
    if (!result.rowCount) throw new HttpException('Publishing authority required', 403);
  }
  async initiate(
    context: AuthContext,
    data: {
      publicationId: string;
      originalName: string;
      mimeType: string;
      sizeBytes: number;
      sha256: string;
      idempotencyKey: string;
    },
    requestId: string,
  ) {
    if (!allowed.has(data.mimeType)) throw new HttpException('Unsupported media type', 415);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.authority(client, context, data.publicationId);
      const existing = await client.query(
        `SELECT id,"publicationId","expectedSize","expectedSha256","declaredMime" FROM app."UploadSession" WHERE "actorId"=$1 AND "idempotencyKey"=$2`,
        [context.user.id, data.idempotencyKey],
      );
      if (existing.rows[0]) {
        const old = existing.rows[0];
        if (
          old.publicationId !== data.publicationId ||
          Number(old.expectedSize) !== data.sizeBytes ||
          old.expectedSha256 !== data.sha256 ||
          old.declaredMime !== data.mimeType
        )
          throw new HttpException('Idempotency key already used for another upload', 409);
        await client.query('COMMIT');
        return { id: old.id };
      }
      const id = randomUUID();
      await client.query(
        `INSERT INTO app."UploadSession" (id,"actorId","publicationId","originalName","declaredMime","expectedSize","expectedSha256","privateKey","idempotencyKey","expiresAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now()+interval '24 hours')`,
        [
          id,
          context.user.id,
          data.publicationId,
          cleanName(data.originalName),
          data.mimeType,
          data.sizeBytes,
          data.sha256,
          `quarantine/${id}`,
          data.idempotencyKey,
        ],
      );
      await client.query(
        `INSERT INTO app."AuditEvent" (id,"actorId",action,"objectType","objectId","correlationId") VALUES (gen_random_uuid(),$1,'studio.upload_started','UploadSession',$2,$3)`,
        [context.user.id, id, requestId],
      );
      await client.query('COMMIT');
      return { id, chunkSize: 8 * 1024 * 1024, expiresInSeconds: 86400 };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  async status(context: AuthContext, id: string) {
    const record = await this.pool.query(
      `SELECT id,"publicationId","originalName","expectedSize","receivedSize",status,"assetId","failureCode","expiresAt" FROM app."UploadSession" WHERE id=$1 AND "actorId"=$2`,
      [id, context.user.id],
    );
    if (!record.rows[0]) throw new HttpException('Upload not found', 404);
    const job = record.rows[0].assetId
      ? (
          await this.pool.query(
            `SELECT status,progress,attempts,"failureCode" FROM app."AssetProcessingJob" WHERE "assetId"=$1`,
            [record.rows[0].assetId],
          )
        ).rows[0]
      : null;
    return { ...record.rows[0], processing: job };
  }
  async chunk(context: AuthContext, id: string, offset: number, request: Request) {
    if (request.header('content-type')?.split(';')[0] !== 'application/octet-stream')
      throw new HttpException('Binary chunk required', 415);
    const length = Number(request.header('content-length'));
    if (!Number.isSafeInteger(length) || length < 1 || length > 8 * 1024 * 1024)
      throw new HttpException('Invalid chunk size', 413);
    const client = await this.pool.connect();
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      await client.query('BEGIN');
      const row = (
        await client.query<{
          actorId: string;
          publicationId: string;
          expectedSize: string;
          receivedSize: string;
          status: string;
          expiresAt: Date;
        }>(
          `SELECT "actorId","publicationId","expectedSize","receivedSize",status,"expiresAt" FROM app."UploadSession" WHERE id=$1 FOR UPDATE`,
          [id],
        )
      ).rows[0];
      if (!row || row.actorId !== context.user.id) throw new HttpException('Upload not found', 404);
      await this.authority(client, context, row.publicationId);
      if (!['INITIATED', 'RECEIVING'].includes(row.status) || row.expiresAt < new Date())
        throw new HttpException('Upload is not writable', 409);
      const received = Number(row.receivedSize);
      if (offset !== received || offset + length > Number(row.expectedSize))
        throw new HttpException('Chunk offset or declared size mismatch', 409);
      await mkdir(join(root, 'quarantine'), { recursive: true, mode: 0o700 });
      handle = await open(this.path(id), received === 0 ? 'wx' : 'r+');
      if (received !== 0 && (await handle.stat()).size !== received)
        throw new HttpException('Upload storage needs recovery', 503);
      let written = 0;
      for await (const part of request) {
        const buffer = Buffer.isBuffer(part) ? part : Buffer.from(part as Uint8Array);
        written += buffer.length;
        if (written > length) throw new HttpException('Chunk exceeds declared length', 413);
        await handle.write(buffer, 0, buffer.length, received + written - buffer.length);
      }
      if (written !== length) throw new HttpException('Incomplete chunk', 400);
      await handle.sync();
      await client.query(
        `UPDATE app."UploadSession" SET "receivedSize"=$2,status='RECEIVING',"updatedAt"=now() WHERE id=$1`,
        [id, received + written],
      );
      await client.query('COMMIT');
      return { id, receivedSize: received + written };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (handle) {
        const row = await this.pool
          .query<{ receivedSize: string }>(
            `SELECT "receivedSize" FROM app."UploadSession" WHERE id=$1`,
            [id],
          )
          .catch(() => null);
        await handle.truncate(Number(row?.rows[0]?.receivedSize ?? 0)).catch(() => undefined);
      }
      throw error;
    } finally {
      await handle?.close().catch(() => undefined);
      client.release();
    }
  }
  async complete(context: AuthContext, id: string, requestId: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const row = (
        await client.query<{
          actorId: string;
          publicationId: string;
          expectedSize: string;
          receivedSize: string;
          expectedSha256: string;
          declaredMime: string;
          originalName: string;
          status: string;
          assetId: string | null;
        }>(
          `SELECT "actorId","publicationId","expectedSize","receivedSize","expectedSha256","declaredMime","originalName",status,"assetId" FROM app."UploadSession" WHERE id=$1 FOR UPDATE`,
          [id],
        )
      ).rows[0];
      if (!row || row.actorId !== context.user.id) throw new HttpException('Upload not found', 404);
      await this.authority(client, context, row.publicationId);
      if (row.assetId) {
        await client.query('COMMIT');
        return { id, assetId: row.assetId };
      }
      if (!['INITIATED', 'RECEIVING'].includes(row.status) || row.expectedSize !== row.receivedSize)
        throw new HttpException('Upload incomplete', 409);
      const path = this.path(id);
      if ((await stat(path)).size !== Number(row.expectedSize))
        throw new HttpException('Upload storage mismatch', 503);
      const digest = createHash('sha256');
      for await (const part of createReadStream(path)) digest.update(part as Buffer);
      if (digest.digest('hex') !== row.expectedSha256)
        throw new HttpException('Upload checksum mismatch', 409);
      const file = await open(path, 'r');
      const first = Buffer.alloc(16);
      try {
        await file.read(first, 0, 16, 0);
      } finally {
        await file.close();
      }
      const pdf = first.subarray(0, 5).toString() === '%PDF-';
      const zip = first.subarray(0, 4).toString('hex') === '504b0304';
      const png = first.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
      const jpg = first.subarray(0, 3).toString('hex') === 'ffd8ff';
      const webp =
        first.subarray(0, 4).toString() === 'RIFF' && first.subarray(8, 12).toString() === 'WEBP';
      const text = !first.includes(0);
      const media = row.declaredMime;
      const okay =
        media === 'application/pdf'
          ? pdf
          : media === 'image/png'
            ? png
            : media === 'image/jpeg'
              ? jpg
              : media === 'image/webp'
                ? webp
                : media.startsWith('text/')
                  ? text
                  : media === 'audio/mpeg'
                    ? first.subarray(0, 3).toString() === 'ID3' || first[0] === 0xff
                    : media === 'video/mp4'
                      ? first.subarray(4, 8).toString() === 'ftyp'
                      : zip;
      if (!okay) throw new HttpException('File signature does not match declared type', 415);
      const assetId = randomUUID();
      await client.query(
        `INSERT INTO app."Asset" (id,"uploadedById","storageKey","originalName","mimeType","sizeBytes",sha256,status) VALUES ($1,$2,$3,$4,$5,$6,$7,'QUARANTINED')`,
        [
          assetId,
          context.user.id,
          `quarantine/${id}`,
          row.originalName,
          media,
          row.expectedSize,
          row.expectedSha256,
        ],
      );
      await client.query(
        `INSERT INTO app."AssetProcessingJob" (id,"assetId") VALUES (gen_random_uuid(),$1)`,
        [assetId],
      );
      await client.query(
        `UPDATE app."UploadSession" SET status='QUEUED',"assetId"=$2,"updatedAt"=now() WHERE id=$1`,
        [id, assetId],
      );
      await client.query(
        `INSERT INTO app."AuditEvent" (id,"actorId",action,"objectType","objectId","correlationId") VALUES (gen_random_uuid(),$1,'studio.upload_queued','Asset',$2,$3)`,
        [context.user.id, assetId, requestId],
      );
      await client.query('COMMIT');
      return { id, assetId, status: 'QUEUED' };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  async retry(context: AuthContext, assetId: string, requestId: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const row = (
        await client.query<{ publicationId: string }>(
          `SELECT u."publicationId" FROM app."UploadSession" u WHERE u."assetId"=$1 AND u."actorId"=$2`,
          [assetId, context.user.id],
        )
      ).rows[0];
      if (!row) throw new HttpException('Asset not found', 404);
      await this.authority(client, context, row.publicationId);
      const changed = await client.query(
        `UPDATE app."AssetProcessingJob" j SET status='QUEUED',"nextAttemptAt"=now(),"failureCode"=NULL,"updatedAt"=now() FROM app."Asset" a WHERE j."assetId"=$1 AND a.id=j."assetId" AND a.status<>'REJECTED' AND j.status IN ('RETRY','FAILED') AND j."failureCode"<>'MALWARE' RETURNING j.id`,
        [assetId],
      );
      if (!changed.rowCount) throw new HttpException('Processing job is not retryable', 409);
      await client.query(
        `INSERT INTO app."AuditEvent" (id,"actorId",action,"objectType","objectId","correlationId") VALUES (gen_random_uuid(),$1,'studio.asset_retry','Asset',$2,$3)`,
        [context.user.id, assetId, requestId],
      );
      await client.query('COMMIT');
      return { id: assetId, status: 'QUEUED' };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  async approve(
    context: AuthContext,
    assetId: string,
    data: {
      licenceCode: string;
      provenanceRef: string;
      copyrightNotice: string;
      attribution: string;
    },
    requestId: string,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const row = (
        await client.query<{ publicationId: string }>(
          `SELECT u."publicationId" FROM app."UploadSession" u WHERE u."assetId"=$1`,
          [assetId],
        )
      ).rows[0];
      if (!row) throw new HttpException('Asset not found', 404);
      await this.authority(client, context, row.publicationId, ['EDITOR', 'PUBLISHER']);
      const changed = await client.query(
        `UPDATE app."Asset" SET status='APPROVED',"permissionConfirmedAt"=now(),"approvedAt"=now(),"licenceCode"=$2,"provenanceRef"=$3,"copyrightNotice"=$4,attribution=$5 WHERE id=$1 AND status='CLEAN' RETURNING id`,
        [assetId, data.licenceCode, data.provenanceRef, data.copyrightNotice, data.attribution],
      );
      if (!changed.rowCount)
        throw new HttpException('A clean scan is required before approval', 409);
      await client.query(
        `INSERT INTO app."AuditEvent" (id,"actorId",action,"objectType","objectId","correlationId") VALUES (gen_random_uuid(),$1,'studio.asset_approved','Asset',$2,$3)`,
        [context.user.id, assetId, requestId],
      );
      await client.query('COMMIT');
      return { id: assetId, status: 'APPROVED' };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  async download(context: AuthContext, assetId: string, response: Response) {
    const row = (
      await this.pool.query<{
        storageKey: string;
        originalName: string;
        mimeType: string;
        publicationId: string;
        status: string;
      }>(
        `SELECT a."storageKey",a."originalName",a."mimeType",u."publicationId",a.status FROM app."Asset" a JOIN app."UploadSession" u ON u."assetId"=a.id WHERE a.id=$1`,
        [assetId],
      )
    ).rows[0];
    if (!row || row.status !== 'APPROVED') throw new HttpException('Asset unavailable', 404);
    const client = await this.pool.connect();
    try {
      await this.authority(client, context, row.publicationId);
    } finally {
      client.release();
    }
    const path = join(root, row.storageKey);
    await access(path).catch(() => {
      throw new HttpException('Asset unavailable', 404);
    });
    response.setHeader('Content-Type', 'application/octet-stream');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${cleanName(row.originalName)}"`,
    );
    response.setHeader('Cache-Control', 'private, no-store');
    try {
      await pipeline(createReadStream(path), response);
    } catch (error) {
      if (response.headersSent) response.destroy(error as Error);
      else throw new HttpException('Asset unavailable', 404);
    }
  }
}
