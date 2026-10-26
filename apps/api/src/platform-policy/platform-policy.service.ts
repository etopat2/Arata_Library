import { createHash, randomUUID } from 'node:crypto';
import { HttpException, Inject, Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import {
  initialPlatformSettings,
  platformSettingsSchema,
  previewPlatformSettings,
  type PlatformSettings,
} from '@arata/validation';

type PolicyRow = {
  id: string;
  version: number;
  baseVersion: number;
  status: string;
  settings: unknown;
  reason: string;
  createdById: string;
  lastEditedById: string;
  approvedById: string | null;
  effectiveAt: Date | null;
};
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

@Injectable()
export class PlatformPolicyService {
  constructor(@Inject('DB_POOL') private readonly pool: Pool) {}

  async current() {
    const result = await this.pool.query<PolicyRow>(
      `SELECT * FROM app."PlatformPolicyVersion" WHERE status='ACTIVE' LIMIT 1`,
    );
    const row = result.rows[0];
    if (!row) return { version: 0, status: 'INITIAL_PROPOSAL', settings: initialPlatformSettings };
    const parsed = platformSettingsSchema.safeParse(row.settings);
    if (!parsed.success) throw new HttpException('Active platform policy is invalid', 503);
    return { version: row.version, status: row.status, settings: parsed.data };
  }

  async history() {
    const result = await this.pool.query(
      `SELECT id,version,"baseVersion",status,reason,"sourceVersion","createdById","approvedById","createdAt","approvedAt","effectiveAt","activatedAt","supersededAt" FROM app."PlatformPolicyVersion" ORDER BY version DESC LIMIT 100`,
    );
    return result.rows;
  }

  async version(id: string) {
    const result = await this.pool.query<PolicyRow>(
      'SELECT * FROM app."PlatformPolicyVersion" WHERE id=$1',
      [id],
    );
    if (!result.rows[0]) throw new HttpException('Policy version not found', 404);
    return result.rows[0];
  }

  async events(id: string) {
    await this.version(id);
    const result = await this.pool.query(
      `SELECT id,action,"actorId",reason,"beforeHash","afterHash","correlationId","occurredAt" FROM app."PlatformPolicyEvent" WHERE "policyId"=$1 ORDER BY "occurredAt",id`,
      [id],
    );
    return result.rows;
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('platform-policy'))`);
      const value = await work(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async locked(client: PoolClient, id: string): Promise<PolicyRow> {
    const result = await client.query<PolicyRow>(
      'SELECT * FROM app."PlatformPolicyVersion" WHERE id=$1 FOR UPDATE',
      [id],
    );
    if (!result.rows[0]) throw new HttpException('Policy version not found', 404);
    return result.rows[0];
  }

  private async event(
    client: PoolClient,
    row: PolicyRow,
    actorId: string,
    action: string,
    reason: string,
    requestId: string,
    before: unknown,
    after: unknown,
  ) {
    const beforeHash = before === null ? null : digest(before);
    const afterHash = after === null ? null : digest(after);
    await client.query(
      `INSERT INTO app."PlatformPolicyEvent" (id,"policyId","actorId",action,reason,"beforeHash","afterHash","correlationId") VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [randomUUID(), row.id, actorId, action, reason, beforeHash, afterHash, requestId],
    );
    await client.query(
      `INSERT INTO app."AuditEvent" (id,"actorId",action,"objectType","objectId","beforeHash","afterHash","correlationId",reason) VALUES ($1,$2,$3,'PlatformPolicyVersion',$4,$5,$6,$7,$8)`,
      [
        randomUUID(),
        actorId,
        `platform_policy.${action.toLowerCase()}`,
        row.id,
        beforeHash,
        afterHash,
        requestId,
        reason,
      ],
    );
  }

  async preview(settings: PlatformSettings) {
    return previewPlatformSettings((await this.current()).settings, settings);
  }

  async create(
    settings: PlatformSettings,
    reason: string,
    actorId: string,
    requestId: string,
    sourceVersion?: number,
  ) {
    settings = platformSettingsSchema.parse(settings);
    return this.transaction(async (client) => {
      const next = await client.query<{ version: number }>(
        'SELECT COALESCE(MAX(version),0)+1 AS version FROM app."PlatformPolicyVersion"',
      );
      const version = Number(next.rows[0]!.version);
      const current = await client.query<{ version: number }>(
        `SELECT version FROM app."PlatformPolicyVersion" WHERE status='ACTIVE'`,
      );
      const baseVersion = current.rows[0]?.version ?? 0;
      const row: PolicyRow = {
        id: randomUUID(),
        version,
        baseVersion,
        status: 'DRAFT',
        settings,
        reason,
        createdById: actorId,
        lastEditedById: actorId,
        approvedById: null,
        effectiveAt: null,
      };
      await client.query(
        `INSERT INTO app."PlatformPolicyVersion" (id,version,"baseVersion",status,settings,reason,"sourceVersion","createdById","lastEditedById") VALUES ($1,$2,$3,'DRAFT',$4,$5,$6,$7,$7)`,
        [row.id, version, baseVersion, settings, reason, sourceVersion ?? null, actorId],
      );
      await this.event(
        client,
        row,
        actorId,
        sourceVersion ? 'ROLLBACK' : 'CREATE',
        reason,
        requestId,
        null,
        settings,
      );
      return { id: row.id, version, status: 'DRAFT' };
    });
  }

  async edit(
    id: string,
    settings: PlatformSettings,
    reason: string,
    actorId: string,
    requestId: string,
  ) {
    settings = platformSettingsSchema.parse(settings);
    return this.transaction(async (client) => {
      const row = await this.locked(client, id);
      if (row.status !== 'DRAFT') throw new HttpException('Only drafts can be edited', 409);
      await client.query(
        `UPDATE app."PlatformPolicyVersion" SET settings=$2,"lastEditedById"=$3 WHERE id=$1`,
        [id, settings, actorId],
      );
      await this.event(client, row, actorId, 'EDIT', reason, requestId, row.settings, settings);
      return { id, version: row.version, status: 'DRAFT' };
    });
  }

  async submit(id: string, reason: string, actorId: string, requestId: string) {
    return this.transaction(async (client) => {
      const row = await this.locked(client, id);
      if (row.status !== 'DRAFT') throw new HttpException('Only drafts can be submitted', 409);
      if (!platformSettingsSchema.safeParse(row.settings).success)
        throw new HttpException('Invalid settings', 400);
      await client.query(`UPDATE app."PlatformPolicyVersion" SET status='PENDING' WHERE id=$1`, [
        id,
      ]);
      await this.event(
        client,
        row,
        actorId,
        'SUBMIT',
        reason,
        requestId,
        row.settings,
        row.settings,
      );
      return { id, status: 'PENDING' };
    });
  }

  async approve(id: string, reason: string, actorId: string, requestId: string, effectiveAt: Date) {
    return this.transaction(async (client) => {
      const row = await this.locked(client, id);
      if (row.status !== 'PENDING') throw new HttpException('Policy is not pending', 409);
      if (row.createdById === actorId || row.lastEditedById === actorId)
        throw new HttpException('Independent approval required', 403);
      const active = await client.query<PolicyRow>(
        `SELECT * FROM app."PlatformPolicyVersion" WHERE status='ACTIVE'`,
      );
      const before = active.rows[0]
        ? platformSettingsSchema.parse(active.rows[0].settings)
        : initialPlatformSettings;
      const after = platformSettingsSchema.parse(row.settings);
      const changes = previewPlatformSettings(before, after).changes;
      const specialRoles = [
        ...(changes.some((change) => change.path.startsWith('subscriptions.')) ? ['FINANCE'] : []),
        ...(changes.some((change) => change.path.startsWith('research.'))
          ? ['PRIVACY_APPROVER']
          : []),
      ];
      if (specialRoles.length) {
        const roles = await client.query<{ code: string }>(
          `SELECT DISTINCT r.code FROM app."RoleAssignment" a JOIN app."Role" r ON r.id=a."roleId" WHERE a."userId"=$1 AND r.code=ANY($2::text[]) AND a."scopeType"='PLATFORM' AND a."scopeId" IS NULL AND a."revokedAt" IS NULL AND a."startsAt"<=now() AND (a."endsAt" IS NULL OR a."endsAt">now())`,
          [actorId, specialRoles],
        );
        if (specialRoles.some((role) => !roles.rows.some((item) => item.code === role)))
          throw new HttpException('Specialist approval role required', 403);
      }
      await client.query(
        `UPDATE app."PlatformPolicyVersion" SET status='APPROVED',"approvedById"=$2,"approvedAt"=now(),"effectiveAt"=$3 WHERE id=$1`,
        [id, actorId, effectiveAt],
      );
      await this.event(
        client,
        row,
        actorId,
        'APPROVE',
        reason,
        requestId,
        row.settings,
        row.settings,
      );
      return { id, status: 'APPROVED', effectiveAt };
    });
  }

  async reject(id: string, reason: string, actorId: string, requestId: string) {
    return this.transaction(async (client) => {
      const row = await this.locked(client, id);
      if (row.status !== 'PENDING') throw new HttpException('Policy is not pending', 409);
      if (row.createdById === actorId) throw new HttpException('Independent review required', 403);
      await client.query(`UPDATE app."PlatformPolicyVersion" SET status='REJECTED' WHERE id=$1`, [
        id,
      ]);
      await this.event(
        client,
        row,
        actorId,
        'REJECT',
        reason,
        requestId,
        row.settings,
        row.settings,
      );
      return { id, status: 'REJECTED' };
    });
  }

  async activate(id: string, reason: string, actorId: string, requestId: string) {
    return this.transaction(async (client) => {
      const row = await this.locked(client, id);
      if (row.status !== 'APPROVED') throw new HttpException('Approved policy required', 409);
      if (!row.effectiveAt || row.effectiveAt.getTime() > Date.now())
        throw new HttpException('Effective date has not arrived', 409);
      if (!platformSettingsSchema.safeParse(row.settings).success)
        throw new HttpException('Invalid approved policy', 409);
      const active = await client.query<PolicyRow>(
        `SELECT * FROM app."PlatformPolicyVersion" WHERE status='ACTIVE' FOR UPDATE`,
      );
      if ((active.rows[0]?.version ?? 0) !== row.baseVersion)
        throw new HttpException('Policy baseline changed; create a new draft', 409);
      if (active.rows[0]) {
        await client.query(
          `UPDATE app."PlatformPolicyVersion" SET status='SUPERSEDED',"supersededAt"=now() WHERE id=$1`,
          [active.rows[0].id],
        );
      }
      await client.query(
        `UPDATE app."PlatformPolicyVersion" SET status='ACTIVE',"activatedAt"=now() WHERE id=$1`,
        [id],
      );
      await this.event(
        client,
        row,
        actorId,
        'ACTIVATE',
        reason,
        requestId,
        active.rows[0]?.settings ?? null,
        row.settings,
      );
      return { id, version: row.version, status: 'ACTIVE' };
    });
  }

  async rollback(sourceId: string, reason: string, actorId: string, requestId: string) {
    const row = await this.version(sourceId);
    if (!['ACTIVE', 'SUPERSEDED'].includes(row.status))
      throw new HttpException('Only activated snapshots can be restored', 409);
    const settings = platformSettingsSchema.parse(row.settings);
    return this.create(settings, reason, actorId, requestId, row.version);
  }
}
