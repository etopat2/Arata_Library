import { randomUUID } from 'node:crypto';
import { HttpException, Inject, Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import type { AuthContext } from '../identity/identity.service.js';

@Injectable()
export class StudioImports {
  constructor(@Inject('DB_POOL') private readonly pool: Pool) {}
  private async authorized(client: PoolClient, context: AuthContext, editionId: string) {
    const row = (
      await client.query<{ publicationId: string }>(
        `SELECT "publicationId" FROM app."Edition" WHERE id=$1`,
        [editionId],
      )
    ).rows[0];
    if (!row) throw new HttpException('Edition not found', 404);
    const roles = await client.query(
      `SELECT 1 FROM app."RoleAssignment" a JOIN app."Role" r ON r.id=a."roleId" WHERE a."userId"=$1 AND a."revokedAt" IS NULL AND a."startsAt"<=now() AND (a."endsAt" IS NULL OR a."endsAt">now()) AND r.code IN ('AUTHOR','EDITOR','PUBLISHER') AND ((a."scopeType"='PLATFORM' AND a."scopeId" IS NULL) OR (a."scopeType"='PUBLICATION' AND a."scopeId"=$2))`,
      [context.user.id, row.publicationId],
    );
    if (!roles.rowCount) throw new HttpException('Publishing authority required', 403);
    return row.publicationId;
  }
  async start(
    context: AuthContext,
    data: { assetId: string; editionId: string; idempotencyKey: string },
    requestId: string,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const publicationId = await this.authorized(client, context, data.editionId);
      const asset = await client.query(
        `SELECT 1 FROM app."Asset" a JOIN app."UploadSession" u ON u."assetId"=a.id WHERE a.id=$1 AND u."publicationId"=$2 AND a.status='APPROVED' AND a."mimeType" IN ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/epub+zip','application/zip')`,
        [data.assetId, publicationId],
      );
      if (!asset.rowCount) throw new HttpException('Approved import source required', 409);
      const existing = (
        await client.query<{ id: string; assetId: string; editionId: string }>(
          `SELECT id,"assetId","editionId" FROM app."ImportJob" WHERE "actorId"=$1 AND "idempotencyKey"=$2`,
          [context.user.id, data.idempotencyKey],
        )
      ).rows[0];
      if (existing) {
        if (existing.assetId !== data.assetId || existing.editionId !== data.editionId)
          throw new HttpException('Idempotency key conflict', 409);
        await client.query('COMMIT');
        return { id: existing.id };
      }
      const id = randomUUID();
      await client.query(
        `INSERT INTO app."ImportJob" (id,"assetId","editionId","actorId","idempotencyKey") VALUES ($1,$2,$3,$4,$5)`,
        [id, data.assetId, data.editionId, context.user.id, data.idempotencyKey],
      );
      await client.query(
        `INSERT INTO app."AuditEvent" (id,"actorId",action,"objectType","objectId","correlationId") VALUES (gen_random_uuid(),$1,'studio.import_started','ImportJob',$2,$3)`,
        [context.user.id, id, requestId],
      );
      await client.query('COMMIT');
      return { id, status: 'PREVIEWING' };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  async status(context: AuthContext, id: string) {
    const client = await this.pool.connect();
    try {
      const job = (
        await client.query(
          `SELECT id,"assetId","editionId","revisionId",status,preview,progress,"failureCode","confirmedAt","createdAt" FROM app."ImportJob" WHERE id=$1`,
          [id],
        )
      ).rows[0];
      if (!job) throw new HttpException('Import not found', 404);
      await this.authorized(client, context, job.editionId);
      return job;
    } finally {
      client.release();
    }
  }
  async confirm(context: AuthContext, id: string, requestId: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const job = (
        await client.query<{ editionId: string; status: string }>(
          `SELECT "editionId",status FROM app."ImportJob" WHERE id=$1 FOR UPDATE`,
          [id],
        )
      ).rows[0];
      if (!job) throw new HttpException('Import not found', 404);
      await this.authorized(client, context, job.editionId);
      if (job.status !== 'READY') throw new HttpException('Validated preview required', 409);
      await client.query(
        `UPDATE app."ImportJob" SET status='CONFIRMED',"confirmedAt"=now(),"updatedAt"=now() WHERE id=$1`,
        [id],
      );
      await client.query(
        `INSERT INTO app."AuditEvent" (id,"actorId",action,"objectType","objectId","correlationId") VALUES (gen_random_uuid(),$1,'studio.import_confirmed','ImportJob',$2,$3)`,
        [context.user.id, id, requestId],
      );
      await client.query('COMMIT');
      return { id, status: 'CONFIRMED' };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  async retry(context: AuthContext, id: string, requestId: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const job = (
        await client.query<{
          editionId: string;
          status: string;
          revisionId: string | null;
          confirmedAt: Date | null;
        }>(
          `SELECT "editionId",status,"revisionId","confirmedAt" FROM app."ImportJob" WHERE id=$1 FOR UPDATE`,
          [id],
        )
      ).rows[0];
      if (!job) throw new HttpException('Import not found', 404);
      await this.authorized(client, context, job.editionId);
      if (job.status !== 'FAILED' || job.revisionId)
        throw new HttpException('Import is not retryable', 409);
      const status = job.confirmedAt ? 'CONFIRMED' : 'PREVIEWING';
      await client.query(
        `UPDATE app."ImportJob" SET status=$2,progress=0,"failureCode"=NULL,"updatedAt"=now() WHERE id=$1`,
        [id, status],
      );
      await client.query(
        `INSERT INTO app."AuditEvent" (id,"actorId",action,"objectType","objectId","correlationId") VALUES (gen_random_uuid(),$1,'studio.import_retry','ImportJob',$2,$3)`,
        [context.user.id, id, requestId],
      );
      await client.query('COMMIT');
      return { id, status };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
