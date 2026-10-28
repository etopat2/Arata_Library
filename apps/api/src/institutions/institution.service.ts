import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { resolveTxt } from 'node:dns/promises';
import { HttpException, Inject, Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { PlatformPolicyService } from '../platform-policy/platform-policy.service.js';
import {
  canonicalDomain,
  emailDomain,
  membershipDays,
  parseRosterCsv,
  type BenefitCategory,
  type VerificationMode,
} from './rules.js';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
function fail(message: string, status = 409): never {
  throw new HttpException(message, status);
}
function databaseConflict(error: unknown): never {
  const code = (error as { code?: string })?.code;
  if (code === '23505') fail('Institution record already exists');
  if (code === '23503' || code === '23514')
    fail('Institution data violates an approved constraint');
  throw error;
}
type Scope = 'LIBRARY' | 'PUBLICATION' | 'VOLUME';
type PolicyInput = {
  category: BenefitCategory;
  scope: Scope;
  scopeId?: string | undefined;
  verificationMode: VerificationMode;
  validityDays: number;
};
type InstitutionInput = {
  legalName: string;
  kind: 'EDUCATIONAL' | 'ORGANIZATION';
  registrationRef: string;
  evidenceRef: string;
};
type MembershipRow = {
  id: string;
  institutionId: string;
  userId: string;
  category: BenefitCategory;
  status: string;
  verificationMethod: VerificationMode;
  evidenceRef: string | null;
  verifiedAt: Date | null;
  expiresAt: Date | null;
};

@Injectable()
export class InstitutionService {
  /** Replaced only by isolated tests; production uses the system DNS resolver. */
  dnsLookup: typeof resolveTxt = resolveTxt;
  constructor(
    @Inject('DB_POOL') private readonly pool: Pool,
    @Inject(PlatformPolicyService) private readonly platform: PlatformPolicyService,
  ) {}

  private async tx<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const value = await run(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      databaseConflict(error);
    } finally {
      client.release();
    }
  }
  private async audit(
    client: PoolClient,
    actorId: string,
    action: string,
    objectType: string,
    objectId: string,
    requestId: string,
    reason: string,
  ) {
    await client.query(
      `INSERT INTO app."AuditEvent" (id,"actorId",action,"objectType","objectId","correlationId",reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [randomUUID(), actorId, action, objectType, objectId, requestId, reason],
    );
  }
  async manager(userId: string, institutionId: string, permission: string): Promise<boolean> {
    const rows = await this.pool.query(
      `SELECT 1 FROM app."RoleAssignment" a JOIN app."Role" r ON r.id=a."roleId"
       JOIN app."RolePermission" rp ON rp."roleId"=r.id
       JOIN app."Permission" p ON p.id=rp."permissionId"
       JOIN app."Institution" i ON i.id=a."scopeId"
       WHERE a."userId"=$1 AND a."scopeType"='INSTITUTION' AND a."scopeId"=$2
         AND r.code='INSTITUTION_MANAGER' AND p.code=$3 AND i.status='APPROVED'
         AND a."startsAt"<=now() AND (a."endsAt" IS NULL OR a."endsAt">now())
         AND a."revokedAt" IS NULL`,
      [userId, institutionId, permission],
    );
    return !!rows.rowCount;
  }
  async institutions(onlyId?: string) {
    return (
      await this.pool.query(
        `SELECT id,"legalName",kind,"registrationRef",status,"verificationMode",
       "approvedAt","createdAt" FROM app."Institution"
       WHERE ($1::uuid IS NULL OR id=$1) ORDER BY "createdAt" DESC LIMIT 200`,
        [onlyId ?? null],
      )
    ).rows;
  }
  async createInstitution(input: InstitutionInput, actorId: string, requestId: string) {
    return this.tx(async (client) => {
      const id = randomUUID();
      await client.query(
        `INSERT INTO app."Institution" (id,"legalName",kind,"registrationRef","evidenceRef",
         "requestedById",status,"verificationMode")
         VALUES ($1,$2,$3,$4,$5,$6,'PENDING','MANUAL')`,
        [id, input.legalName, input.kind, input.registrationRef, input.evidenceRef, actorId],
      );
      await this.audit(
        client,
        actorId,
        'institution.requested',
        'Institution',
        id,
        requestId,
        'Legal identity submitted for independent central review',
      );
      return { id, status: 'PENDING' };
    });
  }
  async decideInstitution(
    id: string,
    decision: 'APPROVED' | 'REJECTED' | 'SUSPENDED',
    actorId: string,
    requestId: string,
    reason: string,
  ) {
    return this.tx(async (client) => {
      const row = (
        await client.query<{ status: string; requestedById: string | null }>(
          `SELECT status,"requestedById" FROM app."Institution" WHERE id=$1 FOR UPDATE`,
          [id],
        )
      ).rows[0];
      if (
        !row ||
        row.requestedById === actorId ||
        (decision === 'SUSPENDED' ? row.status !== 'APPROVED' : row.status !== 'PENDING')
      )
        fail('Independent institution decision unavailable', 403);
      await client.query(
        `UPDATE app."Institution" SET status=$2::app."InstitutionStatus",
         "approvedById"=CASE WHEN $2='APPROVED' THEN $3 ELSE "approvedById" END,
         "approvedAt"=CASE WHEN $2='APPROVED' THEN now() ELSE "approvedAt" END,
         "decisionReason"=$4 WHERE id=$1`,
        [id, decision, actorId, reason],
      );
      await this.audit(
        client,
        actorId,
        `institution.${decision.toLowerCase()}`,
        'Institution',
        id,
        requestId,
        reason,
      );
      return { id, status: decision };
    });
  }
  async assignManager(institutionId: string, userId: string, actorId: string, requestId: string) {
    return this.tx(async (client) => {
      const inst = await client.query(
        `SELECT 1 FROM app."Institution" WHERE id=$1 AND status='APPROVED' FOR UPDATE`,
        [institutionId],
      );
      const user = await client.query(
        `SELECT 1 FROM app."User" WHERE id=$1 AND status='ACTIVE' AND "emailVerifiedAt" IS NOT NULL`,
        [userId],
      );
      if (!inst.rowCount || !user.rowCount)
        fail('Approved institution and verified manager required');
      const existing = await client.query(
        `SELECT id FROM app."RoleAssignment" WHERE "userId"=$1 AND "scopeType"='INSTITUTION' AND "scopeId"=$2 AND "revokedAt" IS NULL AND ("endsAt" IS NULL OR "endsAt">now())`,
        [userId, institutionId],
      );
      if (existing.rowCount) fail('Manager already assigned');
      const id = randomUUID();
      await client.query(
        `INSERT INTO app."RoleAssignment" (id,"userId","roleId","scopeType","scopeId","startsAt")
         SELECT $1,$2,r.id,'INSTITUTION',$3,now() FROM app."Role" r WHERE r.code='INSTITUTION_MANAGER'`,
        [id, userId, institutionId],
      );
      await this.audit(
        client,
        actorId,
        'institution.manager_assigned',
        'Institution',
        institutionId,
        requestId,
        'Scoped manager assignment',
      );
      return { id, institutionId, userId };
    });
  }
  async revokeManager(
    institutionId: string,
    userId: string,
    actorId: string,
    requestId: string,
    reason: string,
  ) {
    return this.tx(async (client) => {
      const result = await client.query(
        `UPDATE app."RoleAssignment" a SET "revokedAt"=now()
         FROM app."Role" r WHERE a."roleId"=r.id AND r.code='INSTITUTION_MANAGER'
         AND a."scopeType"='INSTITUTION' AND a."scopeId"=$1 AND a."userId"=$2
         AND a."revokedAt" IS NULL RETURNING a.id`,
        [institutionId, userId],
      );
      if (!result.rowCount) fail('Active manager not found', 404);
      await this.audit(
        client,
        actorId,
        'institution.manager_revoked',
        'Institution',
        institutionId,
        requestId,
        reason,
      );
      return { revoked: true };
    });
  }

  async domains(institutionId: string) {
    return (
      await this.pool.query(
        `SELECT id,domain,"verifiedAt","approvedAt","suspendedAt","reviewDueAt","createdAt"
       FROM app."InstitutionDomain" WHERE "institutionId"=$1 ORDER BY domain`,
        [institutionId],
      )
    ).rows;
  }
  async requestDomain(
    institutionId: string,
    rawDomain: string,
    actorId: string,
    requestId: string,
  ) {
    const domain = canonicalDomain(rawDomain);
    const settings = (await this.platform.current()).settings;
    if (!settings.institutional.domainMethods.includes('DNS_TXT'))
      fail('DNS verification disabled by policy', 403);
    return this.tx(async (client) => {
      const inst = await client.query(
        `SELECT 1 FROM app."Institution" WHERE id=$1 AND status='APPROVED' FOR UPDATE`,
        [institutionId],
      );
      if (!inst.rowCount) fail('Approved institution required', 403);
      const id = randomUUID();
      await client.query(
        `INSERT INTO app."InstitutionDomain" (id,"institutionId",domain,"requestedById") VALUES ($1,$2,$3,$4)`,
        [id, institutionId, domain, actorId],
      );
      const challenge = await this.newChallenge(client, id, actorId);
      await this.audit(
        client,
        actorId,
        'institution.domain_requested',
        'InstitutionDomain',
        id,
        requestId,
        'DNS ownership challenge issued',
      );
      return { id, domain, ...challenge, dnsName: `_arata-techlibrary.${domain}` };
    });
  }
  private async newChallenge(client: PoolClient, domainId: string, actorId: string) {
    const token = randomBytes(32).toString('base64url');
    const id = randomUUID();
    await client.query(
      `INSERT INTO app."InstitutionDomainChallenge" (id,"domainId","requestedById",method,"tokenHash","expiresAt")
       VALUES ($1,$2,$3,'DNS_TXT',$4,now()+interval '24 hours')`,
      [id, domainId, actorId, digest(token)],
    );
    return {
      challengeId: id,
      dnsName: null as string | null,
      dnsValue: `arata-techlibrary=${token}`,
      expiresInHours: 24,
    };
  }
  async renewDomainChallenge(
    institutionId: string,
    domainId: string,
    actorId: string,
    requestId: string,
  ) {
    return this.tx(async (client) => {
      const row = (
        await client.query<{ domain: string }>(
          `SELECT domain FROM app."InstitutionDomain" WHERE id=$1 AND "institutionId"=$2 FOR UPDATE`,
          [domainId, institutionId],
        )
      ).rows[0];
      if (!row) fail('Domain not found', 404);
      const challenge = await this.newChallenge(client, domainId, actorId);
      await this.audit(
        client,
        actorId,
        'institution.domain_rechallenge',
        'InstitutionDomain',
        domainId,
        requestId,
        'DNS ownership challenge renewed',
      );
      return { ...challenge, dnsName: `_arata-techlibrary.${row.domain}` };
    });
  }
  async verifyDomain(
    institutionId: string,
    domainId: string,
    token: string,
    actorId: string,
    requestId: string,
  ) {
    const row = (
      await this.pool.query<{
        domain: string;
        tokenHash: string;
        challengeId: string;
        expiresAt: Date;
      }>(
        `SELECT d.domain,c."tokenHash",c.id AS "challengeId",c."expiresAt"
       FROM app."InstitutionDomain" d JOIN LATERAL (
         SELECT id,"tokenHash","expiresAt" FROM app."InstitutionDomainChallenge"
         WHERE "domainId"=d.id ORDER BY "createdAt" DESC,id DESC LIMIT 1) c ON true
       WHERE d.id=$1 AND d."institutionId"=$2`,
        [domainId, institutionId],
      )
    ).rows[0];
    if (
      !row ||
      row.expiresAt <= new Date() ||
      !timingSafeEqual(Buffer.from(row.tokenHash, 'hex'), Buffer.from(digest(token), 'hex'))
    )
      fail('Current domain challenge required', 403);
    let records: string[][] = [];
    try {
      records = await this.dnsLookup(`_arata-techlibrary.${row.domain}`);
    } catch {
      fail('DNS proof not found', 409);
    }
    if (!records.some((parts) => parts.join('') === `arata-techlibrary=${token}`))
      fail('DNS proof mismatch', 409);
    return this.tx(async (client) => {
      const changed = await client.query(
        `UPDATE app."InstitutionDomainChallenge" SET "verifiedAt"=now()
         WHERE id=$1 AND "verifiedAt" IS NULL AND "expiresAt">now() RETURNING id`,
        [row.challengeId],
      );
      if (!changed.rowCount) fail('Challenge already used or expired');
      await client.query(
        `UPDATE app."InstitutionDomain" SET "verifiedAt"=now(),"ownershipProofHash"=$3
         WHERE id=$1 AND "institutionId"=$2`,
        [domainId, institutionId, row.tokenHash],
      );
      await this.audit(
        client,
        actorId,
        'institution.domain_verified',
        'InstitutionDomain',
        domainId,
        requestId,
        'Exact DNS TXT ownership proof verified',
      );
      return { id: domainId, verified: true };
    });
  }
  async approveDomain(
    institutionId: string,
    domainId: string,
    actorId: string,
    requestId: string,
    reason: string,
  ) {
    const settings = (await this.platform.current()).settings;
    return this.tx(async (client) => {
      const row = (
        await client.query<{
          requestedById: string | null;
          verifiedAt: Date | null;
          freshProof: boolean;
        }>(
          `SELECT d."requestedById",d."verifiedAt",EXISTS (
            SELECT 1 FROM app."InstitutionDomainChallenge" c WHERE c."domainId"=d.id
              AND c."tokenHash"=d."ownershipProofHash" AND c."verifiedAt" IS NOT NULL
              AND c."verifiedAt">now()-interval '24 hours'
              AND c.id=(SELECT id FROM app."InstitutionDomainChallenge" latest
                WHERE latest."domainId"=d.id ORDER BY "createdAt" DESC,id DESC LIMIT 1)
          ) AS "freshProof" FROM app."InstitutionDomain" d
         WHERE d.id=$1 AND d."institutionId"=$2 FOR UPDATE`,
          [domainId, institutionId],
        )
      ).rows[0];
      if (!row || !row.verifiedAt || !row.freshProof || row.requestedById === actorId)
        fail('Independent verified domain approval required', 403);
      await client.query(
        `UPDATE app."InstitutionDomain" SET "approvedById"=COALESCE("approvedById",$3),
         "approvedAt"=COALESCE("approvedAt",now()),"suspendedAt"=NULL,
         "reviewDueAt"=now()+($4::int*interval '1 day')
         WHERE id=$1 AND "institutionId"=$2`,
        [domainId, institutionId, actorId, settings.institutional.reverifyDays],
      );
      await this.audit(
        client,
        actorId,
        'institution.domain_approved',
        'InstitutionDomain',
        domainId,
        requestId,
        reason,
      );
      return { id: domainId, approved: true };
    });
  }
  async suspendDomain(
    institutionId: string,
    domainId: string,
    actorId: string,
    requestId: string,
    reason: string,
  ) {
    return this.tx(async (client) => {
      const changed = await client.query(
        `UPDATE app."InstitutionDomain" SET "suspendedAt"=now()
         WHERE id=$1 AND "institutionId"=$2 AND "approvedAt" IS NOT NULL AND "suspendedAt" IS NULL RETURNING id`,
        [domainId, institutionId],
      );
      if (!changed.rowCount) fail('Approved active domain not found', 404);
      await this.audit(
        client,
        actorId,
        'institution.domain_suspended',
        'InstitutionDomain',
        domainId,
        requestId,
        reason,
      );
      return { id: domainId, suspended: true };
    });
  }

  async policies(institutionId: string) {
    return (
      await this.pool.query(
        `SELECT id,category,scope,"scopeId","verificationMode","validityDays",active,
       "approvalStatus","approvedAt" FROM app."EligibilityPolicy"
       WHERE "institutionId"=$1 ORDER BY category,scope,id`,
        [institutionId],
      )
    ).rows;
  }
  async requestPolicy(
    institutionId: string,
    input: PolicyInput,
    actorId: string,
    requestId: string,
  ) {
    const settings = (await this.platform.current()).settings;
    if (
      input.validityDays > settings.institutional.reverifyDays ||
      (input.scope === 'LIBRARY' ? !!input.scopeId : !input.scopeId)
    )
      fail('Eligibility policy exceeds configured validity or scope', 400);
    if (input.verificationMode === 'SSO')
      fail('SSO evidence cannot be activated before federated login verification');
    return this.tx(async (client) => {
      const inst = await client.query(
        `SELECT 1 FROM app."Institution" WHERE id=$1 AND status='APPROVED'`,
        [institutionId],
      );
      if (!inst.rowCount) fail('Approved institution required', 403);
      const id = randomUUID();
      await client.query(
        `INSERT INTO app."EligibilityPolicy" (id,"institutionId",category,scope,"scopeId",
         "verificationMode","validityDays",active,"approvalStatus","requestedById")
         VALUES ($1,$2,$3,$4,$5,$6,$7,false,'PENDING',$8)`,
        [
          id,
          institutionId,
          input.category,
          input.scope,
          input.scopeId ?? null,
          input.verificationMode,
          input.validityDays,
          actorId,
        ],
      );
      await this.audit(
        client,
        actorId,
        'institution.policy_requested',
        'EligibilityPolicy',
        id,
        requestId,
        'Eligibility method and scope submitted for central review',
      );
      return { id, status: 'PENDING' };
    });
  }
  async approvePolicy(
    institutionId: string,
    policyId: string,
    actorId: string,
    requestId: string,
    reason: string,
  ) {
    return this.tx(async (client) => {
      const row = (
        await client.query<{
          requestedById: string | null;
          category: string;
          scope: Scope;
          scopeId: string | null;
          verificationMode: VerificationMode;
        }>(
          `SELECT "requestedById",category,scope,"scopeId","verificationMode"
         FROM app."EligibilityPolicy" WHERE id=$1 AND "institutionId"=$2
         AND "approvalStatus"='PENDING' FOR UPDATE`,
          [policyId, institutionId],
        )
      ).rows[0];
      if (!row || row.requestedById === actorId) fail('Independent policy approval required', 403);
      if (row.verificationMode === 'SSO') fail('SSO assertion validation is not active');
      await client.query(
        `UPDATE app."EligibilityPolicy" SET active=false,"approvalStatus"='SUSPENDED'
         WHERE "institutionId"=$1 AND category=$2 AND scope=$3
         AND "scopeId" IS NOT DISTINCT FROM $4::uuid AND active`,
        [institutionId, row.category, row.scope, row.scopeId],
      );
      await client.query(
        `UPDATE app."EligibilityPolicy" SET active=true,"approvalStatus"='APPROVED',
         "approvedById"=$2,"approvedAt"=now() WHERE id=$1`,
        [policyId, actorId],
      );
      await this.audit(
        client,
        actorId,
        'institution.policy_approved',
        'EligibilityPolicy',
        policyId,
        requestId,
        reason,
      );
      return { id: policyId, status: 'APPROVED' };
    });
  }
  async suspendPolicy(
    institutionId: string,
    policyId: string,
    actorId: string,
    requestId: string,
    reason: string,
  ) {
    return this.tx(async (client) => {
      const changed = await client.query(
        `UPDATE app."EligibilityPolicy" SET active=false,"approvalStatus"='SUSPENDED'
         WHERE id=$1 AND "institutionId"=$2 AND active RETURNING id`,
        [policyId, institutionId],
      );
      if (!changed.rowCount) fail('Active eligibility policy not found', 404);
      await this.audit(
        client,
        actorId,
        'institution.policy_suspended',
        'EligibilityPolicy',
        policyId,
        requestId,
        reason,
      );
      return { id: policyId, suspended: true };
    });
  }

  async myMemberships(userId: string) {
    return (
      await this.pool.query(
        `SELECT m.id,m."institutionId",i."legalName",m.category,m.status,m."verificationMethod",
       m."verifiedAt",m."expiresAt",m."optedOutAt",
       CASE WHEN m.status='VERIFIED' AND m."expiresAt"<=now() THEN 'EXPIRED'
         ELSE m.status::text END AS "effectiveStatus" FROM app."Membership" m
       JOIN app."Institution" i ON i.id=m."institutionId" WHERE m."userId"=$1
       ORDER BY m."createdAt" DESC`,
        [userId],
      )
    ).rows;
  }
  async eligibleInstitutions(userId: string) {
    return (
      await this.pool.query(
        `SELECT DISTINCT i.id,i."legalName",i.kind
         FROM app."User" u JOIN app."InstitutionDomain" d
           ON d.domain=split_part(lower(u.email),'@',2)
         JOIN app."Institution" i ON i.id=d."institutionId"
         JOIN app."EligibilityPolicy" p ON p."institutionId"=i.id
         WHERE u.id=$1 AND u.status='ACTIVE' AND u."emailVerifiedAt" IS NOT NULL
           AND i.status='APPROVED' AND d."verifiedAt" IS NOT NULL
           AND d."approvedAt" IS NOT NULL AND d."suspendedAt" IS NULL
           AND d."reviewDueAt">now() AND p.active AND p."approvalStatus"='APPROVED'
         ORDER BY i."legalName" LIMIT 50`,
        [userId],
      )
    ).rows;
  }
  async memberships(institutionId: string, limit = 100) {
    return (
      await this.pool.query(
        `SELECT m.id,m."userId",u.email,m.category,m.status,m."verificationMethod",
       m."verifiedAt",m."expiresAt",m."createdAt"
       FROM app."Membership" m JOIN app."User" u ON u.id=m."userId"
       WHERE m."institutionId"=$1 ORDER BY m."createdAt" DESC LIMIT $2`,
        [institutionId, limit],
      )
    ).rows;
  }
  async requestMembership(
    institutionId: string,
    userId: string,
    category: BenefitCategory,
    evidenceRef: string | undefined,
    requestId: string,
  ) {
    return this.tx(async (client) => {
      const row = (
        await client.query<{ email: string; emailVerifiedAt: Date | null; mode: VerificationMode }>(
          `SELECT u.email,u."emailVerifiedAt",p."verificationMode" AS mode
         FROM app."User" u JOIN app."InstitutionDomain" d
           ON d.domain=split_part(lower(u.email),'@',2) AND d."institutionId"=$1
         JOIN app."Institution" i ON i.id=d."institutionId"
         JOIN app."EligibilityPolicy" p ON p."institutionId"=i.id AND p.category=$3
           AND p."verificationMode" IN ('MANUAL','DOMAIN_ONLY')
         WHERE u.id=$2 AND u.status='ACTIVE' AND i.status='APPROVED'
           AND d."verifiedAt" IS NOT NULL AND d."approvedAt" IS NOT NULL
           AND d."suspendedAt" IS NULL AND d."reviewDueAt">now()
           AND p.active AND p."approvalStatus"='APPROVED'
         ORDER BY p.id LIMIT 1`,
          [institutionId, userId, category],
        )
      ).rows[0];
      if (!row?.emailVerifiedAt || !['MANUAL', 'DOMAIN_ONLY'].includes(row.mode))
        fail('Verified institutional address and approved enrollment method required', 403);
      const prior = (
        await client.query<{ id: string; status: string; expiresAt: Date | null }>(
          `SELECT id,status,"expiresAt" FROM app."Membership" WHERE "institutionId"=$1 AND "userId"=$2 FOR UPDATE`,
          [institutionId, userId],
        )
      ).rows[0];
      if (
        prior &&
        (prior.status === 'PENDING' ||
          (prior.status === 'VERIFIED' && (!prior.expiresAt || prior.expiresAt > new Date())))
      )
        fail('Membership already requested');
      const id = prior?.id ?? randomUUID();
      if (prior)
        await client.query(
          `UPDATE app."Membership" SET status='PENDING',category=$2,
          "verificationMethod"=$3,"evidenceRef"=$4,"verifiedAt"=NULL,"expiresAt"=NULL,
          "optedOutAt"=NULL WHERE id=$1`,
          [id, category, row.mode, evidenceRef ?? null],
        );
      else
        await client.query(
          `INSERT INTO app."Membership" (id,"institutionId","userId",status,
          category,"verificationMethod","evidenceRef") VALUES ($1,$2,$3,'PENDING',$4,$5,$6)`,
          [id, institutionId, userId, category, row.mode, evidenceRef ?? null],
        );
      await this.audit(
        client,
        userId,
        'institution.membership_requested',
        'Membership',
        id,
        requestId,
        'Verified account requested institution eligibility',
      );
      return { id, status: 'PENDING' };
    });
  }
  async reviewMembership(
    institutionId: string,
    membershipId: string,
    decision: 'APPROVED' | 'REJECTED' | 'SUSPENDED',
    actorId: string,
    requestId: string,
    reason: string,
    evidenceRef?: string,
  ) {
    const settings = (await this.platform.current()).settings;
    return this.tx(async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1::text))`, [institutionId]);
      const m = (
        await client.query<MembershipRow>(
          `SELECT * FROM app."Membership" WHERE id=$1 AND "institutionId"=$2 FOR UPDATE`,
          [membershipId, institutionId],
        )
      ).rows[0];
      if (
        !m ||
        m.userId === actorId ||
        (decision === 'SUSPENDED' ? m.status !== 'VERIFIED' : m.status !== 'PENDING')
      )
        fail('Membership review unavailable', 403);
      if (decision === 'APPROVED') {
        const policy = (
          await client.query<{ validityDays: number; scope: Scope; scopeId: string | null }>(
            `SELECT "validityDays",scope,"scopeId" FROM app."EligibilityPolicy"
           WHERE "institutionId"=$1 AND category=$2 AND "verificationMode"=$3
             AND active AND "approvalStatus"='APPROVED' ORDER BY id LIMIT 1`,
            [institutionId, m.category, m.verificationMethod],
          )
        ).rows[0];
        if (!policy || m.verificationMethod === 'SSO')
          fail('Approved verification policy required', 403);
        const identity = (
          await client.query<{ email: string; emailVerifiedAt: Date | null }>(
            `SELECT email,"emailVerifiedAt" FROM app."User" WHERE id=$1 AND status='ACTIVE'`,
            [m.userId],
          )
        ).rows[0];
        if (!identity?.emailVerifiedAt) fail('Confirmed institutional email required', 403);
        const domain = emailDomain(identity.email);
        const verifiedDomain = (
          await client.query<{ reviewDueAt: Date }>(
            `SELECT "reviewDueAt" FROM app."InstitutionDomain" WHERE "institutionId"=$1
           AND domain=$2 AND "verifiedAt" IS NOT NULL AND "approvedAt" IS NOT NULL
           AND "suspendedAt" IS NULL AND "reviewDueAt">now()`,
            [institutionId, domain],
          )
        ).rows[0];
        if (!verifiedDomain) fail('Exact approved domain required', 403);
        const proof = evidenceRef ?? m.evidenceRef;
        if (m.verificationMethod === 'MANUAL' && (!proof || proof.length < 8))
          fail('Opaque manual evidence reference required', 400);
        if (
          m.verificationMethod === 'ROSTER' &&
          (!proof?.startsWith('roster:') ||
            !(
              await client.query(
                `SELECT 1 FROM app."InstitutionRosterImport" WHERE id=$1 AND "institutionId"=$2 AND status='APPLIED'`,
                [proof.slice(7), institutionId],
              )
            ).rowCount)
        )
          fail('Applied roster proof required', 403);
        const agreement = (
          await client.query<{ endsAt: Date; memberLimit: number }>(
            `SELECT "endsAt","memberLimit" FROM app."InstitutionAgreement"
           WHERE "institutionId"=$1 AND status='APPROVED' AND "startsAt"<=now()
             AND "endsAt">now() AND $2=ANY("permittedCategories")
             AND (scope='LIBRARY' OR (scope=$3::app."EntitlementScope" AND
               "publicationId" IS NOT DISTINCT FROM $4::uuid AND
               "volumeId" IS NOT DISTINCT FROM $5::uuid))
           ORDER BY "endsAt" LIMIT 1`,
            [
              institutionId,
              m.category,
              policy.scope,
              policy.scope === 'PUBLICATION' ? policy.scopeId : null,
              policy.scope === 'VOLUME' ? policy.scopeId : null,
            ],
          )
        ).rows[0];
        if (!agreement) fail('Approved institution agreement required', 403);
        const count = await client.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM app."Membership" WHERE "institutionId"=$1
           AND status='VERIFIED' AND ("expiresAt" IS NULL OR "expiresAt">now())`,
          [institutionId],
        );
        const cap = Math.min(
          agreement.memberLimit,
          settings.institutional.defaultMemberLimit ?? agreement.memberLimit,
        );
        if (Number(count.rows[0]?.n ?? 0) >= cap) fail('Institution member limit reached');
        const now = new Date();
        const days = membershipDays(m.category, policy.validityDays, settings.institutional);
        const expires = new Date(
          Math.min(
            now.getTime() + days * 86_400_000,
            verifiedDomain.reviewDueAt.getTime(),
            agreement.endsAt.getTime(),
          ),
        );
        if (expires <= now) fail('Verification or agreement has expired');
        await client.query(
          `INSERT INTO app."EligibilityReview" (id,"membershipId","reviewerId",decision,reason)
          VALUES ($1,$2,$3,'APPROVED',$4)`,
          [randomUUID(), membershipId, actorId, reason],
        );
        await client.query(
          `UPDATE app."Membership" SET status='VERIFIED',"verifiedAt"=$2,
          "expiresAt"=$3,"evidenceRef"=$4,"optedOutAt"=NULL WHERE id=$1`,
          [membershipId, now, expires, proof],
        );
        await this.audit(
          client,
          actorId,
          'institution.membership_approved',
          'Membership',
          membershipId,
          requestId,
          reason,
        );
        return { id: membershipId, status: 'VERIFIED', expiresAt: expires };
      }
      const status = decision === 'REJECTED' ? 'REJECTED' : 'SUSPENDED';
      if (decision === 'REJECTED')
        await client.query(
          `INSERT INTO app."EligibilityReview" (id,"membershipId","reviewerId",decision,reason)
          VALUES ($1,$2,$3,'REJECTED',$4)`,
          [randomUUID(), membershipId, actorId, reason],
        );
      await client.query(
        `UPDATE app."Membership" SET status=$2::app."MembershipStatus" WHERE id=$1`,
        [membershipId, status],
      );
      await this.audit(
        client,
        actorId,
        `institution.membership_${status.toLowerCase()}`,
        'Membership',
        membershipId,
        requestId,
        reason,
      );
      return { id: membershipId, status };
    });
  }
  async optOut(membershipId: string, userId: string, requestId: string) {
    return this.tx(async (client) => {
      const changed = await client.query(
        `UPDATE app."Membership" SET status='SUSPENDED',"optedOutAt"=now()
        WHERE id=$1 AND "userId"=$2 AND status IN ('PENDING','VERIFIED') RETURNING id`,
        [membershipId, userId],
      );
      if (!changed.rowCount) fail('Membership not found', 404);
      await this.audit(
        client,
        userId,
        'institution.membership_opted_out',
        'Membership',
        membershipId,
        requestId,
        'Reader withdrew institutional eligibility',
      );
      return { id: membershipId, status: 'SUSPENDED' };
    });
  }

  async roster(
    institutionId: string,
    csv: string,
    actorId: string,
    requestId: string,
    apply: boolean,
  ) {
    let rows;
    try {
      rows = parseRosterCsv(csv);
    } catch (error) {
      throw new HttpException(error instanceof Error ? error.message : 'Invalid roster', 400);
    }
    const errors: { row: number; code: string }[] = [];
    const checked: {
      row: number;
      userId: string;
      category: BenefitCategory;
      action: 'UPSERT' | 'REVOKE';
    }[] = [];
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1::text))`, [institutionId]);
      const inst = await client.query(
        `SELECT 1 FROM app."Institution" WHERE id=$1 AND status='APPROVED' FOR UPDATE`,
        [institutionId],
      );
      if (!inst.rowCount) fail('Approved institution required', 403);
      const domains = (
        await client.query<{ domain: string }>(
          `SELECT domain FROM app."InstitutionDomain"
        WHERE "institutionId"=$1 AND "verifiedAt" IS NOT NULL AND "approvedAt" IS NOT NULL
        AND "suspendedAt" IS NULL AND "reviewDueAt">now()`,
          [institutionId],
        )
      ).rows;
      const allowed = new Set(domains.map((x) => x.domain));
      for (const item of rows) {
        let domain: string;
        try {
          domain = emailDomain(item.email);
        } catch {
          errors.push({ row: item.row, code: 'INVALID_EMAIL' });
          continue;
        }
        if (!allowed.has(domain)) {
          errors.push({ row: item.row, code: 'DOMAIN_UNAPPROVED' });
          continue;
        }
        const user = (
          await client.query<{ id: string }>(
            `SELECT id FROM app."User" WHERE lower(email)=$1
          AND status='ACTIVE' AND "emailVerifiedAt" IS NOT NULL`,
            [item.email],
          )
        ).rows[0];
        if (!user) {
          errors.push({ row: item.row, code: 'ACCOUNT_NOT_VERIFIED' });
          continue;
        }
        const current = (
          await client.query<{
            status: string;
            category: string;
            optedOutAt: Date | null;
            expiresAt: Date | null;
          }>(
            `SELECT status,category,"optedOutAt","expiresAt" FROM app."Membership" WHERE "institutionId"=$1 AND "userId"=$2`,
            [institutionId, user.id],
          )
        ).rows[0];
        if (item.action === 'UPSERT') {
          const policy = await client.query(
            `SELECT 1 FROM app."EligibilityPolicy" WHERE "institutionId"=$1
            AND category=$2 AND "verificationMode"='ROSTER' AND active AND "approvalStatus"='APPROVED'`,
            [institutionId, item.category],
          );
          if (
            !policy.rowCount ||
            current?.optedOutAt ||
            (current?.status === 'VERIFIED' &&
              (!current.expiresAt || current.expiresAt > new Date())) ||
            (current && current.category !== item.category && current.status === 'PENDING')
          ) {
            errors.push({ row: item.row, code: 'POLICY_OR_MEMBERSHIP_CONFLICT' });
            continue;
          }
        } else if (!current || current.category !== item.category) {
          errors.push({ row: item.row, code: 'MEMBERSHIP_NOT_FOUND' });
          continue;
        }
        checked.push({
          row: item.row,
          userId: user.id,
          category: item.category,
          action: item.action,
        });
      }
      const summary = {
        rowCount: rows.length,
        acceptedCount: checked.length,
        rejectedCount: errors.length,
        errors,
      };
      if (!apply || errors.length) {
        await client.query('ROLLBACK');
        return { status: errors.length ? 'REJECTED' : 'PREVIEW', ...summary };
      }
      const contentHash = digest(csv),
        id = randomUUID();
      const exists = await client.query(
        `SELECT 1 FROM app."InstitutionRosterImport" WHERE "institutionId"=$1 AND "contentHash"=$2`,
        [institutionId, contentHash],
      );
      if (exists.rowCount) fail('Roster already applied');
      await client.query(
        `INSERT INTO app."InstitutionRosterImport"
        (id,"institutionId","actorId",status,"contentHash","rowCount","acceptedCount","appliedAt")
        VALUES ($1,$2,$3,'APPLIED',$4,$5,$5,now())`,
        [id, institutionId, actorId, contentHash, rows.length],
      );
      for (const item of checked) {
        if (item.action === 'REVOKE') {
          await client.query(
            `UPDATE app."Membership" SET status='SUSPENDED'
            WHERE "institutionId"=$1 AND "userId"=$2`,
            [institutionId, item.userId],
          );
        } else {
          await client.query(
            `INSERT INTO app."Membership"
            (id,"institutionId","userId",status,category,"verificationMethod","evidenceRef")
            VALUES ($1,$2,$3,'PENDING',$4,'ROSTER',$5)
            ON CONFLICT ("institutionId","userId") DO UPDATE SET status='PENDING',
              category=EXCLUDED.category,"verificationMethod"='ROSTER',"evidenceRef"=EXCLUDED."evidenceRef",
              "verifiedAt"=NULL,"expiresAt"=NULL`,
            [randomUUID(), institutionId, item.userId, item.category, `roster:${id}`],
          );
        }
      }
      await this.audit(
        client,
        actorId,
        'institution.roster_applied',
        'InstitutionRosterImport',
        id,
        requestId,
        `Roster ${rows.length} rows applied; no raw roster retained`,
      );
      await client.query('COMMIT');
      return { id, status: 'APPLIED', ...summary };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      databaseConflict(error);
    } finally {
      client.release();
    }
  }

  async cohorts(institutionId: string) {
    return (
      await this.pool.query(
        `SELECT c.id,c.name,c.active,c."createdAt",
      count(cm."userId") FILTER (WHERE cm."leftAt" IS NULL)::int AS "memberCount"
      FROM app."Cohort" c LEFT JOIN app."CohortMember" cm ON cm."cohortId"=c.id
      WHERE c."institutionId"=$1 GROUP BY c.id ORDER BY c."createdAt" DESC`,
        [institutionId],
      )
    ).rows;
  }
  async createCohort(institutionId: string, name: string, actorId: string, requestId: string) {
    return this.tx(async (client) => {
      const inst = await client.query(
        `SELECT 1 FROM app."Institution" WHERE id=$1 AND status='APPROVED'`,
        [institutionId],
      );
      if (!inst.rowCount) fail('Approved institution required', 403);
      const id = randomUUID();
      await client.query(`INSERT INTO app."Cohort" (id,"institutionId",name) VALUES ($1,$2,$3)`, [
        id,
        institutionId,
        name,
      ]);
      await this.audit(
        client,
        actorId,
        'institution.cohort_created',
        'Cohort',
        id,
        requestId,
        'Scoped learner cohort',
      );
      return { id, name, active: true };
    });
  }
  async cohortMember(
    institutionId: string,
    cohortId: string,
    userId: string,
    join: boolean,
    actorId: string,
    requestId: string,
  ) {
    return this.tx(async (client) => {
      const cohort = await client.query(
        `SELECT 1 FROM app."Cohort" WHERE id=$1 AND "institutionId"=$2 AND active FOR UPDATE`,
        [cohortId, institutionId],
      );
      if (!cohort.rowCount) fail('Active cohort not found', 404);
      if (join) {
        const eligible = await client.query(
          `SELECT 1 FROM app."Membership" WHERE "institutionId"=$1 AND "userId"=$2
           AND status='VERIFIED' AND "expiresAt">now() AND "optedOutAt" IS NULL`,
          [institutionId, userId],
        );
        if (!eligible.rowCount) fail('Current verified institution membership required', 403);
      }
      if (join)
        await client.query(
          `INSERT INTO app."CohortMember" ("cohortId","userId","joinedAt","leftAt")
        VALUES ($1,$2,now(),NULL) ON CONFLICT ("cohortId","userId") DO UPDATE
        SET "joinedAt"=now(),"leftAt"=NULL`,
          [cohortId, userId],
        );
      else {
        const changed = await client.query(
          `UPDATE app."CohortMember" SET "leftAt"=now()
          WHERE "cohortId"=$1 AND "userId"=$2 AND "leftAt" IS NULL RETURNING "userId"`,
          [cohortId, userId],
        );
        if (!changed.rowCount) fail('Active cohort member not found', 404);
      }
      await this.audit(
        client,
        actorId,
        join ? 'institution.cohort_joined' : 'institution.cohort_left',
        'Cohort',
        cohortId,
        requestId,
        'Scoped cohort membership change',
      );
      return { cohortId, userId, active: join };
    });
  }
  async suspendCohort(
    institutionId: string,
    cohortId: string,
    actorId: string,
    requestId: string,
    reason: string,
  ) {
    return this.tx(async (client) => {
      const changed = await client.query(
        `UPDATE app."Cohort" SET active=false WHERE id=$1
        AND "institutionId"=$2 AND active RETURNING id`,
        [cohortId, institutionId],
      );
      if (!changed.rowCount) fail('Active cohort not found', 404);
      await this.audit(
        client,
        actorId,
        'institution.cohort_suspended',
        'Cohort',
        cohortId,
        requestId,
        reason,
      );
      return { id: cohortId, active: false };
    });
  }
  async ssoProviders(institutionId: string) {
    return (
      await this.pool.query(
        `SELECT id,"issuerUrl","clientId",status,"approvedAt","createdAt"
      FROM app."InstitutionSsoProvider" WHERE "institutionId"=$1 ORDER BY "createdAt" DESC`,
        [institutionId],
      )
    ).rows;
  }
  async requestSso(
    institutionId: string,
    issuerUrl: string,
    clientId: string,
    actorId: string,
    requestId: string,
  ) {
    const url = new URL(issuerUrl);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.hash ||
      ['localhost', '127.0.0.1'].includes(url.hostname)
    )
      fail('Public HTTPS issuer URL required', 400);
    return this.tx(async (client) => {
      const inst = await client.query(
        `SELECT 1 FROM app."Institution" WHERE id=$1 AND status='APPROVED'`,
        [institutionId],
      );
      if (!inst.rowCount) fail('Approved institution required', 403);
      const id = randomUUID();
      await client.query(
        `INSERT INTO app."InstitutionSsoProvider"
        (id,"institutionId","issuerUrl","clientId",status,"requestedById")
        VALUES ($1,$2,$3,$4,'PENDING',$5)`,
        [id, institutionId, url.toString(), clientId, actorId],
      );
      await this.audit(
        client,
        actorId,
        'institution.sso_requested',
        'InstitutionSsoProvider',
        id,
        requestId,
        'Metadata only; authentication remains disabled',
      );
      return { id, status: 'PENDING', authenticationEnabled: false };
    });
  }
  async approveSso(
    institutionId: string,
    id: string,
    actorId: string,
    requestId: string,
    reason: string,
  ) {
    return this.tx(async (client) => {
      const changed = await client.query(
        `UPDATE app."InstitutionSsoProvider" SET status='APPROVED',
        "approvedById"=$3,"approvedAt"=now() WHERE id=$1 AND "institutionId"=$2
        AND status='PENDING' AND "requestedById"<>$3 RETURNING id`,
        [id, institutionId, actorId],
      );
      if (!changed.rowCount) fail('Independent SSO metadata review required', 403);
      await this.audit(
        client,
        actorId,
        'institution.sso_metadata_approved',
        'InstitutionSsoProvider',
        id,
        requestId,
        reason,
      );
      return { id, status: 'APPROVED', authenticationEnabled: false };
    });
  }
  async dashboard(institutionId: string) {
    const settings = (await this.platform.current()).settings;
    const rows = await this.pool.query(
      `SELECT i.id,i."legalName",i.status,
      (SELECT count(*)::int FROM app."Membership" m WHERE m."institutionId"=i.id AND m.status='VERIFIED'
        AND m."expiresAt">now()) AS "activeMembers",
      (SELECT count(*)::int FROM app."Membership" m WHERE m."institutionId"=i.id AND m.status='PENDING') AS "pendingMembers",
      (SELECT count(*)::int FROM app."Cohort" c WHERE c."institutionId"=i.id AND c.active) AS "activeCohorts"
      FROM app."Institution" i WHERE i.id=$1`,
      [institutionId],
    );
    if (!rows.rows[0]) fail('Institution not found', 404);
    const reporting = await this.pool.query(
      `SELECT 1 FROM app."InstitutionAgreement" WHERE "institutionId"=$1
       AND status='APPROVED' AND "reportingEnabled" AND "startsAt"<=now()
       AND "endsAt">now() LIMIT 1`,
      [institutionId],
    );
    if (!reporting.rowCount)
      return {
        ...rows.rows[0],
        engagement: null,
        engagementReason: 'Aggregate reporting requires a separately approved agreement scope',
      };
    const activity = await this.pool.query<{ readers: number }>(
      `SELECT count(DISTINCT l."userId")::int AS readers
       FROM app."AccessDecisionLog" l JOIN app."Entitlement" e ON e.id=l."entitlementId"
       JOIN app."Membership" m ON m.id=e."membershipId"
       WHERE m."institutionId"=$1 AND l.action='READ' AND l.decision='ALLOW'
         AND l."occurredAt">=now()-interval '30 days'`,
      [institutionId],
    );
    const readers = activity.rows[0]?.readers ?? 0;
    const threshold = settings.research.publicMinimumSubjects;
    return {
      ...rows.rows[0],
      engagement: readers >= threshold ? { uniqueReaders30d: readers, periodDays: 30 } : null,
      engagementReason: readers >= threshold ? null : `Suppressed below ${threshold} readers`,
    };
  }
}
