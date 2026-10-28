import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  HttpException,
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import {
  resolveEffectiveEntitlement,
  type EntitlementFact,
  type EntitlementScope,
  type EntitlementTarget,
} from '@arata/access-policy';
import { complimentaryEndsAt, trialEligible } from '@arata/validation';
import type { PolicyPath } from '@arata/access-policy';
import { PlatformPolicyService } from '../platform-policy/platform-policy.service.js';

type ScopeInput = { scope: Exclude<EntitlementScope, 'RESOURCE'>; scopeId?: string | undefined };
type RequestGrant = ScopeInput & {
  userId: string;
  reason: string;
  startsAt?: Date | undefined;
  durationDays?: number | undefined;
  endsAt?: Date | undefined;
  permanent?: boolean | undefined;
  source?: 'COMPLIMENTARY' | 'INSTITUTION' | 'SPONSORED' | undefined;
  membershipId?: string | undefined;
  cohortId?: string | undefined;
};
type CampaignInput = ScopeInput & {
  kind: 'BULK' | 'PROMOTION';
  name: string;
  reason: string;
  startsAt: Date;
  endsAt: Date;
  maxClaims: number;
  userIds?: string[] | undefined;
};
type GrantRow = {
  id: string;
  userId: string;
  source: string;
  status: string;
  scope: EntitlementScope;
  collectionId: string | null;
  publicationId: string | null;
  volumeId: string | null;
  editionId: string | null;
  resourceId: string | null;
  membershipId: string | null;
  cohortId: string | null;
  grantedById: string | null;
  startsAt: Date;
  endsAt: Date | null;
};
const scopeColumns = ['collectionId', 'publicationId', 'volumeId', 'editionId'] as const;
const hashCode = (code: string) => createHash('sha256').update(code).digest('hex');
const reasonLength = (reason: string) => reason.trim().length >= 10 && reason.length <= 1000;

@Injectable()
export class EntitlementService implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(
    @Inject('DB_POOL') private readonly pool: Pool,
    @Inject(PlatformPolicyService) private readonly policy: PlatformPolicyService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || process.env.ENTITLEMENT_JOBS_ENABLED === '0') return;
    this.timer = setInterval(
      () =>
        void this.sweep().catch((error: unknown) =>
          console.error(
            JSON.stringify({
              event: 'entitlement.sweep_failed',
              errorName: error instanceof Error ? error.name : 'UnknownError',
            }),
          ),
        ),
      15 * 60_000,
    );
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tx<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await run(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async audit(
    client: PoolClient,
    actorId: string,
    action: string,
    objectId: string,
    requestId: string,
    reason: string,
  ) {
    await client.query(
      `INSERT INTO app."AuditEvent" (id,"actorId",action,"objectType","objectId","correlationId",reason)
      VALUES ($1,$2,$3,'Entitlement',$4,$5,$6)`,
      [randomUUID(), actorId, action, objectId, requestId, reason],
    );
  }
  private async event(
    client: PoolClient,
    entitlementId: string,
    actorId: string | null,
    action: string,
    reason: string,
  ) {
    await client.query(
      `INSERT INTO app."EntitlementEvent" (id,"entitlementId",action,reason,"actorId")
      VALUES ($1,$2,$3,$4,$5)`,
      [randomUUID(), entitlementId, action, reason, actorId],
    );
  }

  /** The only server-side match function used by reader, resource and asset delivery. */
  async effective(userId: string | null, path: PolicyPath) {
    if (!userId) return resolveEffectiveEntitlement([], {}, new Date());
    const collectionIds = path.publicationId
      ? (
          await this.pool.query<{ collectionId: string }>(
            `SELECT "collectionId" FROM app."PublicationCollection" WHERE "publicationId"=$1`,
            [path.publicationId],
          )
        ).rows.map((r) => r.collectionId)
      : [];
    const target: EntitlementTarget = {
      collectionIds,
      ...(path.publicationId ? { publicationId: path.publicationId } : {}),
      ...(path.volumeId ? { volumeId: path.volumeId } : {}),
      ...(path.editionId ? { editionId: path.editionId } : {}),
      ...(path.resourceId ? { resourceId: path.resourceId } : {}),
    };
    const rows = await this.pool.query<EntitlementFact>(
      `SELECT id,source,status,scope,"collectionId","publicationId","volumeId","editionId","resourceId",
        "startsAt","endsAt","revokedAt",true AS "sourceValid"
       FROM app."EffectiveEntitlement" WHERE "userId"=$1 AND (
         scope='LIBRARY' OR (scope='COLLECTION' AND "collectionId"=ANY($2::uuid[]))
         OR (scope='PUBLICATION' AND "publicationId"=$3)
         OR (scope='VOLUME' AND "volumeId"=$4)
         OR (scope='EDITION' AND "editionId"=$5)
         OR (scope='RESOURCE' AND "resourceId"=$6))`,
      [
        userId,
        collectionIds,
        path.publicationId ?? null,
        path.volumeId ?? null,
        path.editionId ?? null,
        path.resourceId ?? null,
      ],
    );
    return resolveEffectiveEntitlement(rows.rows, target, new Date());
  }

  async logDecision(input: {
    userId: string | null;
    action: 'READ' | 'PREVIEW' | 'DOWNLOAD' | 'EXPORT' | 'OFFLINE';
    targetKind: 'LESSON' | 'RESOURCE' | 'ASSET' | 'EDITION';
    targetId: string;
    decision: 'ALLOW' | 'DENY';
    reasonCode: string;
    entitlementId?: string;
    requestId?: string;
  }) {
    await this.pool.query(
      `INSERT INTO app."AccessDecisionLog"
      (id,"userId",action,"targetKind","targetId",decision,"reasonCode","entitlementId","requestId")
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        randomUUID(),
        input.userId,
        input.action,
        input.targetKind,
        input.targetId,
        input.decision,
        input.reasonCode,
        input.entitlementId ?? null,
        input.requestId ?? null,
      ],
    );
  }

  async mine(userId: string) {
    return (
      await this.pool.query(
        `SELECT id,source,status,scope,"collectionId","publicationId","volumeId",
      "editionId","resourceId","startsAt","endsAt","revokedAt","createdAt",
      CASE WHEN status='REVOKED' THEN 'REVOKED' WHEN status='SUSPENDED' THEN 'SUSPENDED'
        WHEN "startsAt">now() THEN 'UPCOMING' WHEN "endsAt" IS NOT NULL AND "endsAt"<=now()
        THEN 'EXPIRED' ELSE status::text END AS "effectiveStatus"
      FROM app."Entitlement" WHERE "userId"=$1 ORDER BY "createdAt" DESC LIMIT 200`,
        [userId],
      )
    ).rows;
  }
  async users(search: string) {
    if (search.trim().length < 3)
      throw new HttpException('At least 3 search characters required', 400);
    const escaped = search
      .trim()
      .toLowerCase()
      .replace(/[\\%_]/g, '\\$&');
    return (
      await this.pool.query(
        `SELECT u.id,u.email,u.status,u."emailVerifiedAt",
      (SELECT count(*)::int FROM app."EffectiveEntitlement" e WHERE e."userId"=u.id) AS "activeGrants"
      FROM app."User" u WHERE lower(u.email) LIKE $1 ESCAPE '\\' ORDER BY u.email LIMIT 30`,
        [`%${escaped}%`],
      )
    ).rows;
  }
  async adminList(userId?: string, limit = 100) {
    return (
      await this.pool.query(
        `SELECT e.id,e."userId",e.source,e.status,e.scope,e."collectionId",
      e."publicationId",e."volumeId",e."editionId",e."resourceId",e."grantedById",
      e."startsAt",e."endsAt",e."revokedAt",e.reason,e."createdAt",a.status AS "approvalStatus"
      FROM app."Entitlement" e LEFT JOIN LATERAL (SELECT status FROM app."GrantApproval" g
        WHERE g."entitlementId"=e.id ORDER BY "requestedAt" DESC LIMIT 1) a ON true
      WHERE ($1::uuid IS NULL OR e."userId"=$1) ORDER BY e."createdAt" DESC LIMIT $2`,
        [userId ?? null, limit],
      )
    ).rows;
  }
  async history(id: string) {
    const grant = await this.pool.query(
      `SELECT id,"userId",source,status,scope,"startsAt","endsAt",reason
      FROM app."Entitlement" WHERE id=$1`,
      [id],
    );
    if (!grant.rows[0]) throw new HttpException('Grant not found', 404);
    const events = await this.pool.query(
      `SELECT id,action,reason,"actorId","occurredAt"
      FROM app."EntitlementEvent" WHERE "entitlementId"=$1 ORDER BY "occurredAt",id`,
      [id],
    );
    return { grant: grant.rows[0], events: events.rows };
  }
  async expirations(days: number) {
    return (
      await this.pool.query(
        `SELECT id,"userId",source,scope,"endsAt" FROM app."EffectiveEntitlement"
      WHERE "endsAt" IS NOT NULL AND "endsAt"<=now()+($1::int * interval '1 day')
      ORDER BY "endsAt" LIMIT 200`,
        [days],
      )
    ).rows;
  }

  private async target(
    client: PoolClient,
    scope: ScopeInput,
  ): Promise<Record<string, string | null>> {
    const columns: Record<string, string | null> = Object.fromEntries(
      scopeColumns.map((key) => [key, null]),
    );
    if (scope.scope === 'LIBRARY') {
      if (scope.scopeId) throw new HttpException('Library scope has no ID', 400);
      return columns;
    }
    if (!scope.scopeId) throw new HttpException('Scope ID required', 400);
    const tables: Record<string, string> = {
      COLLECTION: 'Collection',
      PUBLICATION: 'Publication',
      VOLUME: 'Volume',
      EDITION: 'Edition',
    };
    const table = tables[scope.scope];
    const found = await client.query(`SELECT 1 FROM app."${table}" WHERE id=$1`, [scope.scopeId]);
    if (!found.rowCount) throw new HttpException('Scope not found', 404);
    columns[`${scope.scope.toLowerCase()}Id`] = scope.scopeId;
    return columns;
  }

  private async institutionEligible(
    client: PoolClient,
    userId: string,
    membershipId: string,
    scope: ScopeInput,
    cohortId?: string,
  ): Promise<Date> {
    const settings = (await this.policy.current()).settings;
    if (!settings.institutional.benefitsEnabled)
      throw new HttpException('Institutional benefits unavailable', 409);
    const result = await client.query<{
      category: string;
      expiresAt: Date | null;
      verifiedAt: Date;
      agreementEnd: Date;
      policyDays: number;
      domainReviewDueAt: Date;
    }>(
      `SELECT m.category,m."expiresAt",m."verifiedAt",a."endsAt" AS "agreementEnd",
        p."validityDays" AS "policyDays",d."reviewDueAt" AS "domainReviewDueAt"
       FROM app."Membership" m JOIN app."Institution" i ON i.id=m."institutionId"
       JOIN app."User" u ON u.id=m."userId"
       JOIN app."InstitutionDomain" d ON d."institutionId"=i.id AND d.domain=split_part(lower(u.email),'@',2)
       JOIN app."InstitutionAgreement" a ON a."institutionId"=i.id
       JOIN app."EligibilityPolicy" p ON p."institutionId"=i.id
         AND p.category=m.category AND p."verificationMode"=m."verificationMethod"
         AND p.active AND p."approvalStatus"='APPROVED'
       WHERE m.id=$1 AND m."userId"=$2 AND m.status='VERIFIED' AND i.status='APPROVED'
         AND m."optedOutAt" IS NULL
         AND (SELECT rev.decision FROM app."EligibilityReview" rev WHERE rev."membershipId"=m.id
           ORDER BY rev."reviewedAt" DESC,rev.id DESC LIMIT 1)='APPROVED'
         AND u.status='ACTIVE' AND u."emailVerifiedAt" IS NOT NULL AND m."verifiedAt" IS NOT NULL
         AND (m."expiresAt" IS NULL OR m."expiresAt">now())
         AND d."verifiedAt" IS NOT NULL AND d."approvedAt" IS NOT NULL AND d."suspendedAt" IS NULL
         AND d."reviewDueAt">now()
         AND (p.scope='LIBRARY' OR (p.scope=$3::app."EntitlementScope"
           AND p."scopeId" IS NOT DISTINCT FROM $7::uuid))
         AND m."verifiedAt"+(p."validityDays"*interval '1 day')>now()
         AND a.status='APPROVED' AND a."startsAt"<=now() AND a."endsAt">now()
         AND m.category=ANY(a."permittedCategories")
         AND (a.scope='LIBRARY' OR (a.scope=$3::app."EntitlementScope" AND
           a."publicationId" IS NOT DISTINCT FROM $4::uuid AND a."volumeId" IS NOT DISTINCT FROM $5::uuid))
         AND (SELECT count(*) FROM app."Membership" x WHERE x."institutionId"=i.id
           AND x.status='VERIFIED' AND (x."expiresAt" IS NULL OR x."expiresAt">now()))<=a."memberLimit"
         AND ($6::uuid IS NULL OR EXISTS (SELECT 1 FROM app."CohortMember" cm JOIN app."Cohort" c
           ON c.id=cm."cohortId" WHERE cm."cohortId"=$6 AND cm."userId"=m."userId"
           AND c."institutionId"=i.id AND cm."leftAt" IS NULL))
       ORDER BY a."endsAt" LIMIT 1`,
      [
        membershipId,
        userId,
        scope.scope,
        scope.scope === 'PUBLICATION' ? scope.scopeId : null,
        scope.scope === 'VOLUME' ? scope.scopeId : null,
        cohortId ?? null,
        scope.scope === 'LIBRARY' ? null : scope.scopeId,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new HttpException('Verified institution eligibility required', 403);
    const validity =
      row.category === 'STUDENT' || row.category === 'SCHOLARSHIP'
        ? settings.institutional.studentValidityDays
        : row.category === 'SPONSORED_COHORT'
          ? settings.institutional.cohortValidityDays
          : settings.institutional.staffValidityDays;
    const limits = [
      row.agreementEnd,
      row.domainReviewDueAt,
      new Date(row.verifiedAt.getTime() + row.policyDays * 86_400_000),
      new Date(row.verifiedAt.getTime() + validity * 86_400_000),
      new Date(row.verifiedAt.getTime() + settings.institutional.reverifyDays * 86_400_000),
    ];
    if (row.expiresAt) limits.push(row.expiresAt);
    const end = new Date(Math.min(...limits.map((date) => date.getTime())));
    if (end <= new Date()) throw new HttpException('Membership re-verification required', 403);
    return end;
  }

  async requestGrant(input: RequestGrant, actorId: string, requestId: string) {
    if (!reasonLength(input.reason)) throw new HttpException('Reason required', 400);
    const settings = (await this.policy.current()).settings;
    if (!settings.complimentary.allowedScopes.includes(input.scope))
      throw new HttpException('Grant scope disabled', 403);
    const start = input.startsAt ?? new Date();
    if (!Number.isFinite(start.getTime()) || start.getTime() > Date.now() + 365 * 86_400_000)
      throw new HttpException('Invalid grant start', 400);
    let end: Date | null;
    if (input.permanent) end = complimentaryEndsAt(start, 'PERMANENT', settings, true);
    else if (input.endsAt) end = input.endsAt;
    else end = complimentaryEndsAt(start, input.durationDays ?? 0, settings);
    if (
      end &&
      (!Number.isFinite(end.getTime()) ||
        end <= start ||
        end.getTime() - start.getTime() > settings.complimentary.maxCustomDays * 86_400_000)
    )
      throw new HttpException('Grant duration outside policy', 400);
    const source = input.source ?? 'COMPLIMENTARY';
    if (source !== 'COMPLIMENTARY' && !input.membershipId)
      throw new HttpException('Membership required', 400);
    if (source === 'SPONSORED' && !input.cohortId) throw new HttpException('Cohort required', 400);
    return this.tx(async (client) => {
      const recipient = await client.query(
        `SELECT 1 FROM app."User" WHERE id=$1 AND status='ACTIVE'`,
        [input.userId],
      );
      if (!recipient.rowCount) throw new HttpException('Active recipient not found', 404);
      const target = await this.target(client, input);
      if (source !== 'COMPLIMENTARY') {
        const institutionalEnd = await this.institutionEligible(
          client,
          input.userId,
          input.membershipId!,
          input,
          input.cohortId,
        );
        if (!end || end > institutionalEnd) end = institutionalEnd;
        if (end <= start)
          throw new HttpException('Institution eligibility ends before grant starts', 409);
      }
      const id = randomUUID();
      await client.query(
        `INSERT INTO app."Entitlement"
        (id,"userId",source,status,scope,"collectionId","publicationId","volumeId","editionId",
         "membershipId","cohortId","grantedById","startsAt","endsAt",reason)
        VALUES ($1,$2,$3,'PENDING',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          id,
          input.userId,
          source,
          input.scope,
          target.collectionId,
          target.publicationId,
          target.volumeId,
          target.editionId,
          input.membershipId ?? null,
          input.cohortId ?? null,
          actorId,
          start,
          end,
          input.reason,
        ],
      );
      await client.query(
        `INSERT INTO app."GrantApproval" (id,"entitlementId","requestedById",reason)
        VALUES ($1,$2,$3,$4)`,
        [randomUUID(), id, actorId, input.reason],
      );
      await this.event(client, id, actorId, 'REQUESTED', input.reason);
      await this.audit(client, actorId, 'entitlement.requested', id, requestId, input.reason);
      return { id, status: 'PENDING', startsAt: start, endsAt: end };
    });
  }

  async approve(id: string, actorId: string, requestId: string, reason: string) {
    if (!reasonLength(reason)) throw new HttpException('Reason required', 400);
    return this.tx(async (client) => {
      const row = (
        await client.query<GrantRow>(`SELECT * FROM app."Entitlement" WHERE id=$1 FOR UPDATE`, [id])
      ).rows[0];
      if (
        !row ||
        row.status !== 'PENDING' ||
        !['COMPLIMENTARY', 'INSTITUTION', 'SPONSORED'].includes(row.source)
      )
        throw new HttpException('Pending grant not found', 404);
      const approval = (
        await client.query<{ id: string; requestedById: string }>(
          `SELECT id,"requestedById" FROM app."GrantApproval" WHERE "entitlementId"=$1 AND status='PENDING' FOR UPDATE`,
          [id],
        )
      ).rows[0];
      if (!approval || approval.requestedById === actorId || row.grantedById === actorId)
        throw new HttpException('Independent approver required', 403);
      if (row.endsAt && row.endsAt <= new Date())
        throw new HttpException('Grant already expired', 409);
      if (row.source !== 'COMPLIMENTARY') {
        const eligibleUntil = await this.institutionEligible(
          client,
          row.userId,
          row.membershipId!,
          {
            scope: row.scope as ScopeInput['scope'],
            scopeId:
              row.collectionId ?? row.publicationId ?? row.volumeId ?? row.editionId ?? undefined,
          },
          row.cohortId ?? undefined,
        );
        if (!row.endsAt || row.endsAt > eligibleUntil)
          throw new HttpException('Institution eligibility no longer covers grant', 409);
      }
      await client.query(
        `UPDATE app."GrantApproval" SET status='APPROVED',"approvedById"=$2,"decidedAt"=now() WHERE id=$1`,
        [approval.id, actorId],
      );
      await client.query(`UPDATE app."Entitlement" SET status='ACTIVE' WHERE id=$1`, [id]);
      await this.event(client, id, actorId, 'APPROVED', reason);
      await this.audit(client, actorId, 'entitlement.approved', id, requestId, reason);
      await client.query(
        `INSERT INTO app."Notification" (id,"userId",kind,"templateCode")
        VALUES ($1,$2,'ENTITLEMENT','ACCESS_GRANTED')`,
        [randomUUID(), row.userId],
      );
      return { id, status: 'ACTIVE' };
    });
  }

  async extend(id: string, days: number, actorId: string, requestId: string, reason: string) {
    const row = (
      await this.pool.query<GrantRow>(`SELECT * FROM app."Entitlement" WHERE id=$1`, [id])
    ).rows[0];
    if (
      !row ||
      !['COMPLIMENTARY', 'INSTITUTION', 'SPONSORED'].includes(row.source) ||
      row.status === 'REVOKED' ||
      !row.endsAt
    )
      throw new HttpException('Grant cannot be extended', 409);
    const start = new Date(Math.max(Date.now(), row.endsAt.getTime()));
    const created = await this.requestGrant(
      {
        userId: row.userId,
        source: row.source as RequestGrant['source'],
        scope: row.scope as ScopeInput['scope'],
        scopeId:
          row.collectionId ?? row.publicationId ?? row.volumeId ?? row.editionId ?? undefined,
        membershipId: row.membershipId ?? undefined,
        cohortId: row.cohortId ?? undefined,
        startsAt: start,
        durationDays: days,
        reason,
      },
      actorId,
      requestId,
    );
    await this.pool.query(
      `INSERT INTO app."EntitlementEvent" (id,"entitlementId",action,reason,"actorId")
      VALUES ($1,$2,'EXTENSION_REQUESTED',$3,$4)`,
      [randomUUID(), id, reason, actorId],
    );
    return created;
  }

  async changeStatus(
    id: string,
    action: 'SUSPEND' | 'RESUME' | 'REVOKE',
    actorId: string,
    requestId: string,
    reason: string,
  ) {
    if (!reasonLength(reason)) throw new HttpException('Reason required', 400);
    return this.tx(async (client) => {
      const row = (
        await client.query<GrantRow>(`SELECT * FROM app."Entitlement" WHERE id=$1 FOR UPDATE`, [id])
      ).rows[0];
      if (!row || !['COMPLIMENTARY', 'INSTITUTION', 'SPONSORED', 'PROMOTION'].includes(row.source))
        throw new HttpException('Revocable grant not found', 404);
      const valid =
        action === 'SUSPEND'
          ? row.status === 'ACTIVE'
          : action === 'RESUME'
            ? row.status === 'SUSPENDED'
            : row.status !== 'REVOKED';
      if (!valid) throw new HttpException('Invalid grant transition', 409);
      if (action === 'RESUME' && row.endsAt && row.endsAt <= new Date())
        throw new HttpException('Grant expired', 409);
      const status =
        action === 'REVOKE' ? 'REVOKED' : action === 'SUSPEND' ? 'SUSPENDED' : 'ACTIVE';
      await client.query(
        `UPDATE app."Entitlement" SET status=$2::app."EntitlementStatus",
        "revokedAt"=CASE WHEN $2::app."EntitlementStatus"='REVOKED' THEN now() ELSE "revokedAt" END
        WHERE id=$1`,
        [id, status],
      );
      await this.event(client, id, actorId, action, reason);
      await this.audit(
        client,
        actorId,
        `entitlement.${action.toLowerCase()}`,
        id,
        requestId,
        reason,
      );
      return { id, status };
    });
  }

  async startTrial(userId: string, requestId: string) {
    const settings = (await this.policy.current()).settings;
    return this.tx(async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('trial:' || $1::text))`, [userId]);
      const user = (
        await client.query<{ emailVerifiedAt: Date | null; status: string }>(
          `SELECT "emailVerifiedAt",status FROM app."User" WHERE id=$1 FOR UPDATE`,
          [userId],
        )
      ).rows[0];
      const prior = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM app."TrialUsage" WHERE "userId"=$1`,
        [userId],
      );
      if (
        !user ||
        !trialEligible(settings, {
          emailVerified: !!user.emailVerifiedAt,
          priorTrialCount: Number(prior.rows[0]?.count ?? 0),
          accountActive: user.status === 'ACTIVE',
        })
      )
        throw new HttpException('Trial unavailable', 403);
      const start = new Date(),
        end = new Date(start.getTime() + settings.subscriptions.trialDays * 86_400_000);
      const trialId = randomUUID(),
        id = randomUUID();
      await client.query(
        `INSERT INTO app."TrialUsage" (id,"userId","campaignKey","startsAt","endsAt")
        VALUES ($1,$2,'standard',$3,$4)`,
        [trialId, userId, start, end],
      );
      await client.query(
        `INSERT INTO app."Entitlement" (id,"userId",source,status,scope,"trialUsageId","startsAt","endsAt",reason)
        VALUES ($1,$2,'TRIAL','ACTIVE','LIBRARY',$3,$4,$5,'Approved standard trial')`,
        [id, userId, trialId, start, end],
      );
      await this.event(client, id, userId, 'TRIAL_STARTED', 'Verified single-use trial');
      await this.audit(
        client,
        userId,
        'entitlement.trial_started',
        id,
        requestId,
        'Verified single-use trial',
      );
      return { id, startsAt: start, endsAt: end, status: 'ACTIVE' };
    });
  }

  async createCampaign(input: CampaignInput, actorId: string, requestId: string) {
    const settings = (await this.policy.current()).settings;
    if (
      !reasonLength(input.reason) ||
      !settings.complimentary.allowedScopes.includes(input.scope) ||
      input.endsAt <= input.startsAt ||
      input.maxClaims > settings.complimentary.bulkLimit ||
      input.endsAt.getTime() - input.startsAt.getTime() >
        settings.complimentary.maxCustomDays * 86_400_000
    )
      throw new HttpException('Campaign outside policy', 400);
    if (
      input.kind === 'BULK' &&
      (!input.userIds?.length ||
        input.userIds.length > input.maxClaims ||
        new Set(input.userIds).size !== input.userIds.length)
    )
      throw new HttpException('Invalid recipient list', 400);
    const code = input.kind === 'PROMOTION' ? randomBytes(32).toString('base64url') : null;
    return this.tx(async (client) => {
      const target = await this.target(client, input),
        id = randomUUID();
      await client.query(
        `INSERT INTO app."GrantCampaign" (id,kind,name,reason,scope,"collectionId",
        "publicationId","volumeId","editionId","startsAt","endsAt","maxClaims","codeHash","createdById")
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          id,
          input.kind,
          input.name,
          input.reason,
          input.scope,
          target.collectionId,
          target.publicationId,
          target.volumeId,
          target.editionId,
          input.startsAt,
          input.endsAt,
          input.maxClaims,
          code ? hashCode(code) : null,
          actorId,
        ],
      );
      if (input.kind === 'BULK')
        for (const userId of input.userIds!) {
          const exists = await client.query(
            `SELECT 1 FROM app."User" WHERE id=$1 AND status='ACTIVE'`,
            [userId],
          );
          if (!exists.rowCount) throw new HttpException('Inactive bulk recipient', 400);
          await client.query(
            `INSERT INTO app."GrantCampaignClaim" ("campaignId","userId") VALUES ($1,$2)`,
            [id, userId],
          );
        }
      await this.audit(
        client,
        actorId,
        'entitlement.campaign_requested',
        id,
        requestId,
        input.reason,
      );
      return { id, status: 'PENDING', kind: input.kind, code };
    });
  }

  async approveCampaign(id: string, actorId: string, requestId: string, reason: string) {
    if (!reasonLength(reason)) throw new HttpException('Approval reason required', 400);
    return this.tx(async (client) => {
      const campaign = (
        await client.query<{
          id: string;
          kind: string;
          createdById: string;
          scope: ScopeInput['scope'];
          collectionId: string | null;
          publicationId: string | null;
          volumeId: string | null;
          editionId: string | null;
          startsAt: Date;
          endsAt: Date;
          reason: string;
        }>(`SELECT * FROM app."GrantCampaign" WHERE id=$1 AND status='PENDING' FOR UPDATE`, [id])
      ).rows[0];
      if (!campaign || campaign.createdById === actorId || campaign.endsAt <= new Date())
        throw new HttpException('Independent campaign approval required', 403);
      await client.query(
        `UPDATE app."GrantCampaign" SET status='ACTIVE',"approvedById"=$2,"approvedAt"=now() WHERE id=$1`,
        [id, actorId],
      );
      if (campaign.kind === 'BULK') {
        const recipients = await client.query<{ userId: string }>(
          `SELECT "userId" FROM app."GrantCampaignClaim" WHERE "campaignId"=$1 FOR UPDATE`,
          [id],
        );
        for (const { userId } of recipients.rows) {
          const entitlementId = randomUUID();
          await client.query(
            `INSERT INTO app."Entitlement" (id,"userId",source,status,scope,"collectionId",
            "publicationId","volumeId","editionId","campaignId","grantedById","startsAt","endsAt",reason)
            VALUES ($1,$2,'COMPLIMENTARY','PENDING',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [
              entitlementId,
              userId,
              campaign.scope,
              campaign.collectionId,
              campaign.publicationId,
              campaign.volumeId,
              campaign.editionId,
              id,
              campaign.createdById,
              campaign.startsAt,
              campaign.endsAt,
              campaign.reason,
            ],
          );
          await client.query(
            `INSERT INTO app."GrantApproval" (id,"entitlementId","requestedById","approvedById",
            status,reason,"decidedAt") VALUES ($1,$2,$3,$4,'APPROVED',$5,now())`,
            [randomUUID(), entitlementId, campaign.createdById, actorId, campaign.reason],
          );
          await client.query(
            `UPDATE app."GrantCampaignClaim" SET "entitlementId"=$3,"claimedAt"=now()
            WHERE "campaignId"=$1 AND "userId"=$2`,
            [id, userId, entitlementId],
          );
          await client.query(`UPDATE app."Entitlement" SET status='ACTIVE' WHERE id=$1`, [
            entitlementId,
          ]);
          await this.event(client, entitlementId, actorId, 'BULK_APPROVED', campaign.reason);
          await client.query(
            `INSERT INTO app."Notification" (id,"userId",kind,"templateCode")
            VALUES ($1,$2,'ENTITLEMENT','ACCESS_GRANTED')`,
            [randomUUID(), userId],
          );
        }
      }
      await this.audit(client, actorId, 'entitlement.campaign_approved', id, requestId, reason);
      return { id, status: 'ACTIVE', issued: campaign.kind === 'BULK' };
    });
  }

  async redeem(userId: string, code: string, requestId: string) {
    const digest = hashCode(code);
    return this.tx(async (client) => {
      const campaign = (
        await client.query<{
          id: string;
          status: string;
          scope: ScopeInput['scope'];
          collectionId: string | null;
          publicationId: string | null;
          volumeId: string | null;
          editionId: string | null;
          startsAt: Date;
          endsAt: Date;
          maxClaims: number;
          reason: string;
          createdById: string;
        }>(
          `SELECT * FROM app."GrantCampaign" WHERE "codeHash"=$1 AND kind='PROMOTION' FOR UPDATE`,
          [digest],
        )
      ).rows[0];
      if (
        !campaign ||
        campaign.status !== 'ACTIVE' ||
        campaign.startsAt > new Date() ||
        campaign.endsAt <= new Date()
      )
        throw new HttpException('Code unavailable', 404);
      const user = (
        await client.query<{ status: string; emailVerifiedAt: Date | null }>(
          `SELECT status,"emailVerifiedAt" FROM app."User" WHERE id=$1`,
          [userId],
        )
      ).rows[0];
      if (!user || user.status !== 'ACTIVE' || !user.emailVerifiedAt)
        throw new HttpException('Verified account required', 403);
      const count = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM app."GrantCampaignClaim"
        WHERE "campaignId"=$1 AND "entitlementId" IS NOT NULL`,
        [campaign.id],
      );
      if (Number(count.rows[0]?.n) >= campaign.maxClaims)
        throw new HttpException('Code limit reached', 409);
      const existing = await client.query(
        `SELECT 1 FROM app."GrantCampaignClaim" WHERE "campaignId"=$1 AND "userId"=$2`,
        [campaign.id, userId],
      );
      if (existing.rowCount) throw new HttpException('Code already redeemed', 409);
      const id = randomUUID();
      await client.query(
        `INSERT INTO app."Entitlement" (id,"userId",source,status,scope,"collectionId",
        "publicationId","volumeId","editionId","campaignId","grantedById","startsAt","endsAt",reason)
        VALUES ($1,$2,'PROMOTION','PENDING',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          id,
          userId,
          campaign.scope,
          campaign.collectionId,
          campaign.publicationId,
          campaign.volumeId,
          campaign.editionId,
          campaign.id,
          campaign.createdById,
          campaign.startsAt,
          campaign.endsAt,
          campaign.reason,
        ],
      );
      await client.query(
        `INSERT INTO app."GrantCampaignClaim" ("campaignId","userId","entitlementId","claimedAt")
        VALUES ($1,$2,$3,now())`,
        [campaign.id, userId, id],
      );
      await client.query(`UPDATE app."Entitlement" SET status='ACTIVE' WHERE id=$1`, [id]);
      await this.event(client, id, userId, 'PROMOTION_REDEEMED', 'Approved campaign redemption');
      await this.audit(
        client,
        userId,
        'entitlement.promotion_redeemed',
        id,
        requestId,
        'Approved campaign redemption',
      );
      return { id, status: 'ACTIVE', endsAt: campaign.endsAt };
    });
  }

  async campaigns(limit = 100) {
    return (
      await this.pool.query(
        `SELECT c.id,c.kind,c.status,c.name,c.scope,c."collectionId",c."publicationId",
      c."volumeId",c."editionId",c."startsAt",c."endsAt",c."maxClaims",c."createdAt",
      (SELECT count(*)::int FROM app."GrantCampaignClaim" cc WHERE cc."campaignId"=c.id
        AND cc."entitlementId" IS NOT NULL) AS "claimCount"
      FROM app."GrantCampaign" c ORDER BY c."createdAt" DESC LIMIT $1`,
        [limit],
      )
    ).rows;
  }

  async agreements(institutionId?: string) {
    return (
      await this.pool.query(
        `SELECT id,"institutionId",status,scope,"publicationId","volumeId",
      "memberLimit","reportingEnabled","permittedCategories","startsAt","endsAt","createdById","approvedById","approvedAt"
      FROM app."InstitutionAgreement" WHERE ($1::uuid IS NULL OR "institutionId"=$1)
      ORDER BY "startsAt" DESC LIMIT 100`,
        [institutionId ?? null],
      )
    ).rows;
  }

  async requestAgreement(
    input: {
      institutionId: string;
      scope: 'LIBRARY' | 'PUBLICATION' | 'VOLUME';
      scopeId?: string | undefined;
      memberLimit: number;
      reportingEnabled?: boolean | undefined;
      permittedCategories: string[];
      startsAt: Date;
      endsAt: Date;
    },
    actorId: string,
    requestId: string,
    reason: string,
  ) {
    if (!reasonLength(reason)) throw new HttpException('Agreement reason required', 400);
    const settings = (await this.policy.current()).settings.institutional;
    if (
      input.endsAt <= input.startsAt ||
      input.endsAt <= new Date() ||
      input.startsAt.getTime() > Date.now() + 365 * 86_400_000 ||
      input.memberLimit < 1 ||
      (settings.defaultMemberLimit !== null && input.memberLimit > settings.defaultMemberLimit) ||
      !input.permittedCategories.length ||
      new Set(input.permittedCategories).size !== input.permittedCategories.length
    )
      throw new HttpException('Agreement outside institutional policy', 400);
    return this.tx(async (client) => {
      const institution = await client.query(
        `SELECT 1 FROM app."Institution" WHERE id=$1 AND status='APPROVED'`,
        [input.institutionId],
      );
      if (!institution.rowCount) throw new HttpException('Approved institution required', 403);
      const target = await this.target(client, input);
      const id = randomUUID();
      await client.query(
        `INSERT INTO app."InstitutionAgreement"
        (id,"institutionId","createdById",scope,"publicationId","volumeId","memberLimit",
         "reportingEnabled","permittedCategories","startsAt","endsAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          id,
          input.institutionId,
          actorId,
          input.scope,
          target.publicationId,
          target.volumeId,
          input.memberLimit,
          input.reportingEnabled ?? false,
          input.permittedCategories,
          input.startsAt,
          input.endsAt,
        ],
      );
      await this.audit(client, actorId, 'institution.agreement_requested', id, requestId, reason);
      return { id, status: 'PENDING' };
    });
  }

  async approveAgreement(id: string, actorId: string, requestId: string, reason: string) {
    if (!reasonLength(reason)) throw new HttpException('Approval reason required', 400);
    const settings = (await this.policy.current()).settings.institutional;
    if (!settings.benefitsEnabled)
      throw new HttpException('Institutional benefits unavailable', 409);
    return this.tx(async (client) => {
      const agreement = (
        await client.query<{ createdById: string | null; endsAt: Date; institutionId: string }>(
          `SELECT "createdById","endsAt","institutionId" FROM app."InstitutionAgreement"
         WHERE id=$1 AND status='PENDING' FOR UPDATE`,
          [id],
        )
      ).rows[0];
      if (
        !agreement ||
        !agreement.createdById ||
        agreement.createdById === actorId ||
        agreement.endsAt <= new Date()
      )
        throw new HttpException('Independent agreement approval required', 403);
      const institution = await client.query(
        `SELECT 1 FROM app."Institution" WHERE id=$1 AND status='APPROVED'`,
        [agreement.institutionId],
      );
      if (!institution.rowCount) throw new HttpException('Institution approval expired', 409);
      await client.query(
        `UPDATE app."InstitutionAgreement" SET status='APPROVED',"approvedById"=$2,
        "approvedAt"=now() WHERE id=$1`,
        [id, actorId],
      );
      await this.audit(client, actorId, 'institution.agreement_approved', id, requestId, reason);
      return { id, status: 'APPROVED' };
    });
  }

  async sweep() {
    const settings = (await this.policy.current()).settings;
    const days = settings.complimentary.expiryNoticeDays;
    return this.tx(async (client) => {
      const rows = await client.query<{ id: string; userId: string }>(
        `SELECT e.id,e."userId" FROM app."Entitlement" e
        WHERE e.id IN (SELECT x.id FROM app."EffectiveEntitlement" x)
          AND e.source IN ('COMPLIMENTARY','PROMOTION','SPONSORED','TRIAL','INSTITUTION')
          AND e."endsAt" IS NOT NULL AND e."endsAt"<=now()+($1::int * interval '1 day')
          AND NOT EXISTS (SELECT 1 FROM app."EntitlementEvent" ev WHERE ev."entitlementId"=e.id
            AND ev.action='EXPIRY_NOTICE') ORDER BY e."endsAt" LIMIT 100 FOR UPDATE OF e SKIP LOCKED`,
        [days],
      );
      for (const row of rows.rows) {
        await this.event(client, row.id, null, 'EXPIRY_NOTICE', 'Upcoming access expiry');
        await client.query(
          `INSERT INTO app."Notification" (id,"userId",kind,"templateCode")
          VALUES ($1,$2,'ENTITLEMENT','ACCESS_EXPIRING')`,
          [randomUUID(), row.userId],
        );
      }
      await client.query(
        `DELETE FROM app."AccessDecisionLog" WHERE "occurredAt"<
        now()-($1::int * interval '1 day')`,
        [settings.security.auditRetentionDays],
      );
      return { notified: rows.rowCount };
    });
  }
}
