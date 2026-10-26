import { createHash, randomUUID } from 'node:crypto';
import {
  Body,
  Controller,
  Get,
  HttpException,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { policyScopeOrder } from '@arata/access-policy';
import { IdentityService } from '../identity/identity.service.js';
import { ReaderService } from './reader.service.js';

const scope = z.enum([
  'libraryId',
  'publicationId',
  'volumeId',
  'editionId',
  'revisionId',
  'chapterId',
  'lessonId',
  'resourceId',
]);
const scopeTable: Record<z.infer<typeof scope>, string> = {
  libraryId: 'Library',
  publicationId: 'Publication',
  volumeId: 'Volume',
  editionId: 'Edition',
  revisionId: 'Revision',
  chapterId: 'Chapter',
  lessonId: 'Lesson',
  resourceId: 'Resource',
};
const policyInput = z.strictObject({
  scope: scope,
  scopeId: z.uuid(),
  reason: z.string().trim().min(10).max(1000),
  accessClass: z
    .enum(['PUBLIC_FREE', 'REGISTERED_FREE', 'PREMIUM', 'RESTRICTED'])
    .nullable()
    .optional(),
  allowRead: z.boolean().nullable().optional(),
  allowPreview: z.boolean().nullable().optional(),
  allowSelect: z.boolean().nullable().optional(),
  allowCopy: z.boolean().nullable().optional(),
  maxCopyChars: z.number().int().min(0).max(100000).nullable().optional(),
  allowPrint: z.boolean().nullable().optional(),
  allowDownload: z.boolean().nullable().optional(),
  allowExportPdf: z.boolean().nullable().optional(),
  allowExportEpub: z.boolean().nullable().optional(),
  allowOffline: z.boolean().nullable().optional(),
  allowShare: z.boolean().nullable().optional(),
  watermark: z.boolean().nullable().optional(),
  watermarkLabel: z.string().trim().min(1).max(160).nullable().optional(),
  screenshotMode: z.enum(['ALLOW', 'WATERMARK', 'RESTRICTED_NOTICE']).nullable().optional(),
  maxConcurrentSessions: z.number().int().min(1).max(100).nullable().optional(),
  licenceEndsAt: z.iso.datetime({ offset: true }).nullable().optional(),
});
const fields = [
  'accessClass',
  'allowRead',
  'allowPreview',
  'allowSelect',
  'allowCopy',
  'maxCopyChars',
  'allowPrint',
  'allowDownload',
  'allowExportPdf',
  'allowExportEpub',
  'allowOffline',
  'allowShare',
  'watermark',
  'watermarkLabel',
  'screenshotMode',
  'maxConcurrentSessions',
  'licenceEndsAt',
] as const;

@Controller('admin/content-policies')
export class PolicyAdminController {
  constructor(
    @Inject('DB_POOL') private readonly pool: Pool,
    @Inject(IdentityService) private readonly identity: IdentityService,
    @Inject(ReaderService) private readonly reader: ReaderService,
  ) {}

  private async admin(request: Request, write = false) {
    const context = await this.identity.context(request.headers.cookie);
    this.identity.requireAdmin(context, 'CONTENT_POLICY_MANAGE', write);
    if (write)
      this.identity.checkCsrf(
        context,
        request.headers.origin,
        request.header('X-CSRF-Token'),
        request.headers.cookie,
      );
    return context;
  }

  @Get('effective')
  async effective(@Req() request: Request, @Query() query: Record<string, unknown>) {
    await this.admin(request);
    const parsed = z
      .strictObject({
        libraryId: z.uuid().optional(),
        publicationId: z.uuid().optional(),
        volumeId: z.uuid().optional(),
        editionId: z.uuid().optional(),
        revisionId: z.uuid().optional(),
        chapterId: z.uuid().optional(),
        lessonId: z.uuid().optional(),
        resourceId: z.uuid().optional(),
      })
      .safeParse(query);
    if (!parsed.success || !Object.values(parsed.data).some(Boolean))
      throw new HttpException('A valid policy path is required', 400);
    const deepest = [...policyScopeOrder].reverse().find((key) => parsed.data[key]);
    if (!deepest) throw new HttpException('A valid policy path is required', 400);
    const path = await this.reader.effectivePath(deepest, parsed.data[deepest]!);
    for (const [key, value] of Object.entries(parsed.data)) {
      if (value && path[key as keyof typeof path] !== value)
        throw new HttpException('Policy path does not match the target hierarchy', 400);
    }
    return { data: await this.reader.policy(path), requestId: request.id };
  }

  @Get(':scope/:id')
  async history(
    @Req() request: Request,
    @Param('scope') scopeValue: string,
    @Param('id') idValue: string,
  ) {
    await this.admin(request);
    const key = scope.safeParse(scopeValue);
    const id = z.uuid().safeParse(idValue);
    if (!key.success || !id.success) throw new HttpException('Invalid policy scope', 400);
    const result = await this.pool.query(
      `SELECT * FROM app."ContentPolicy" WHERE "${key.data}"=$1 ORDER BY version DESC LIMIT 100`,
      [id.data],
    );
    return { data: result.rows, requestId: request.id };
  }

  @Post()
  async replace(@Req() request: Request, @Body() body: unknown) {
    const context = await this.admin(request, true);
    const parsed = policyInput.safeParse(body);
    if (!parsed.success) throw new HttpException('Invalid policy or reason', 400);
    const input = parsed.data;
    if (!fields.some((field) => input[field] !== undefined))
      throw new HttpException('At least one policy setting is required', 400);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `policy:${input.scope}:${input.scopeId}`,
      ]);
      const exists = await client.query(
        `SELECT 1 FROM app."${scopeTable[input.scope]}" WHERE id=$1`,
        [input.scopeId],
      );
      if (!exists.rowCount) throw new HttpException('Policy target not found', 404);
      const current = await client.query<{ version: number }>(
        `SELECT version FROM app."ContentPolicy" WHERE "${input.scope}"=$1 ORDER BY version DESC LIMIT 1`,
        [input.scopeId],
      );
      const active = await client.query<Record<string, unknown>>(
        `SELECT * FROM app."ContentPolicy" WHERE "${input.scope}"=$1 AND "isActive" FOR UPDATE`,
        [input.scopeId],
      );
      await client.query(
        `UPDATE app."ContentPolicy" SET "isActive"=false WHERE "${input.scope}"=$1 AND "isActive"`,
        [input.scopeId],
      );
      const id = randomUUID();
      const values: unknown[] = [id, input.scopeId, (current.rows[0]?.version ?? 0) + 1];
      values.push(
        ...fields.map((field) =>
          input[field] === undefined ? (active.rows[0]?.[field] ?? null) : input[field],
        ),
      );
      const columns = ['id', input.scope, 'version', ...fields]
        .map((field) => `"${field}"`)
        .join(',');
      const placeholders = values.map((_, index) => `$${index + 1}`).join(',');
      await client.query(
        `INSERT INTO app."ContentPolicy" (${columns},"isActive","approvedAt") VALUES (${placeholders},true,now())`,
        values,
      );
      const snapshot = Object.fromEntries(fields.map((field, index) => [field, values[index + 3]]));
      const digest = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
      const beforeHash = active.rows[0]
        ? createHash('sha256')
            .update(
              JSON.stringify(
                Object.fromEntries(fields.map((field) => [field, active.rows[0]![field]])),
              ),
            )
            .digest('hex')
        : null;
      await client.query(
        `INSERT INTO app."PolicyChange" (id,"policyId","actorId","beforeHash","afterHash",reason)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [randomUUID(), id, context.user.id, beforeHash, digest, input.reason],
      );
      await client.query(
        `INSERT INTO app."AuditEvent" (id,"actorId",action,"objectType","objectId","correlationId",reason)
         VALUES ($1,$2,'content_policy.approve','ContentPolicy',$3,$4,$5)`,
        [randomUUID(), context.user.id, id, request.id, input.reason],
      );
      await client.query('COMMIT');
      return { data: { id, version: values[2] }, requestId: request.id };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
