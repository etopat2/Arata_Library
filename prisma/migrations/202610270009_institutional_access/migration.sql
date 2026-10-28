-- AlterTable
ALTER TABLE "app"."Cohort" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "app"."EligibilityPolicy" ADD COLUMN     "approvalStatus" VARCHAR(24) NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "approvedAt" TIMESTAMPTZ(6),
ADD COLUMN     "approvedById" UUID,
ADD COLUMN     "requestedById" UUID;

-- AlterTable
ALTER TABLE "app"."Institution" ADD COLUMN     "approvedById" UUID,
ADD COLUMN     "decisionReason" TEXT,
ADD COLUMN     "evidenceRef" VARCHAR(500),
ADD COLUMN     "kind" VARCHAR(24) NOT NULL DEFAULT 'EDUCATIONAL',
ADD COLUMN     "registrationRef" VARCHAR(160),
ADD COLUMN     "requestedById" UUID;

-- AlterTable
ALTER TABLE "app"."InstitutionDomain" ADD COLUMN     "requestedById" UUID;

-- AlterTable
ALTER TABLE "app"."Membership" ADD COLUMN     "optedOutAt" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "app"."InstitutionDomainChallenge" (
    "id" UUID NOT NULL,
    "domainId" UUID NOT NULL,
    "requestedById" UUID NOT NULL,
    "method" VARCHAR(32) NOT NULL DEFAULT 'DNS_TXT',
    "tokenHash" VARCHAR(128) NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "verifiedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstitutionDomainChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."InstitutionRosterImport" (
    "id" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'PREVIEW',
    "contentHash" VARCHAR(128) NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "acceptedCount" INTEGER NOT NULL DEFAULT 0,
    "rejectedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMPTZ(6),

    CONSTRAINT "InstitutionRosterImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."InstitutionSsoProvider" (
    "id" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "issuerUrl" VARCHAR(500) NOT NULL,
    "clientId" VARCHAR(300) NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'PENDING',
    "requestedById" UUID NOT NULL,
    "approvedById" UUID,
    "approvedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstitutionSsoProvider_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InstitutionDomainChallenge_domainId_expiresAt_idx" ON "app"."InstitutionDomainChallenge"("domainId", "expiresAt");

-- CreateIndex
CREATE INDEX "InstitutionRosterImport_institutionId_createdAt_idx" ON "app"."InstitutionRosterImport"("institutionId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "InstitutionRosterImport_institutionId_contentHash_key" ON "app"."InstitutionRosterImport"("institutionId", "contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "InstitutionSsoProvider_institutionId_issuerUrl_key" ON "app"."InstitutionSsoProvider"("institutionId", "issuerUrl");

-- AddForeignKey
ALTER TABLE "app"."Institution" ADD CONSTRAINT "Institution_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "app"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."Institution" ADD CONSTRAINT "Institution_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "app"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."InstitutionDomain" ADD CONSTRAINT "InstitutionDomain_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "app"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."EligibilityPolicy" ADD CONSTRAINT "EligibilityPolicy_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "app"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."EligibilityPolicy" ADD CONSTRAINT "EligibilityPolicy_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "app"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."InstitutionDomainChallenge" ADD CONSTRAINT "InstitutionDomainChallenge_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "app"."InstitutionDomain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."InstitutionDomainChallenge" ADD CONSTRAINT "InstitutionDomainChallenge_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "app"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."InstitutionRosterImport" ADD CONSTRAINT "InstitutionRosterImport_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "app"."Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."InstitutionRosterImport" ADD CONSTRAINT "InstitutionRosterImport_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "app"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."InstitutionSsoProvider" ADD CONSTRAINT "InstitutionSsoProvider_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "app"."Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."InstitutionSsoProvider" ADD CONSTRAINT "InstitutionSsoProvider_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "app"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."InstitutionSsoProvider" ADD CONSTRAINT "InstitutionSsoProvider_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "app"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Existing active policy rows must be reviewed before this migration. Never silently
-- turn an unreviewed policy into an approved eligibility route.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM app."EligibilityPolicy" WHERE active) THEN
    RAISE EXCEPTION 'review active legacy eligibility policies before migration';
  END IF;
END $$;

ALTER TABLE app."Institution" ADD CONSTRAINT institution_kind_valid
  CHECK (kind IN ('EDUCATIONAL','ORGANIZATION'));
ALTER TABLE app."Institution" ADD CONSTRAINT institution_independent_approval
  CHECK (status<>'APPROVED' OR ("requestedById" IS NOT NULL AND "approvedById" IS NOT NULL
    AND "requestedById"<>"approvedById" AND "approvedAt" IS NOT NULL
    AND "evidenceRef" IS NOT NULL));
ALTER TABLE app."InstitutionDomain" ADD CONSTRAINT institution_domain_shape
  CHECK (domain=lower(domain) AND domain LIKE '%.%' AND domain NOT LIKE '% %'
    AND domain NOT LIKE '%*%' AND domain NOT LIKE '%/%');
ALTER TABLE app."EligibilityPolicy" ADD CONSTRAINT eligibility_policy_approval
  CHECK ("approvalStatus" IN ('PENDING','APPROVED','REJECTED','SUSPENDED')
    AND (NOT active OR ("approvalStatus"='APPROVED' AND "requestedById" IS NOT NULL
      AND "approvedById" IS NOT NULL AND "requestedById"<>"approvedById"
      AND "approvedAt" IS NOT NULL)));
ALTER TABLE app."EligibilityPolicy" ADD CONSTRAINT eligibility_policy_mode
  CHECK ("verificationMode" IN ('MANUAL','ROSTER','DOMAIN_ONLY','SSO')
    AND scope IN ('LIBRARY','PUBLICATION','VOLUME') AND "validityDays">0);
CREATE UNIQUE INDEX eligibility_one_active_category_scope
  ON app."EligibilityPolicy" ("institutionId",category,scope,COALESCE("scopeId",'00000000-0000-0000-0000-000000000000'::uuid))
  WHERE active;
ALTER TABLE app."Membership" ADD CONSTRAINT membership_optout_not_verified
  CHECK ("optedOutAt" IS NULL OR status<>'VERIFIED');
ALTER TABLE app."InstitutionDomainChallenge" ADD CONSTRAINT domain_challenge_valid
  CHECK (method='DNS_TXT' AND "expiresAt">"createdAt");
ALTER TABLE app."InstitutionRosterImport" ADD CONSTRAINT roster_import_valid
  CHECK (status IN ('PREVIEW','APPLIED','REJECTED') AND "rowCount">=0
    AND "acceptedCount">=0 AND "rejectedCount">=0
    AND "acceptedCount"+"rejectedCount"<="rowCount");
ALTER TABLE app."InstitutionSsoProvider" ADD CONSTRAINT sso_metadata_only
  CHECK ("issuerUrl" LIKE 'https://%' AND status IN ('PENDING','APPROVED','SUSPENDED')
    AND (status<>'APPROVED' OR ("approvedById" IS NOT NULL
      AND "approvedById"<>"requestedById" AND "approvedAt" IS NOT NULL)));
ALTER TABLE app."RoleAssignment" ADD CONSTRAINT institution_manager_scope_required
  CHECK ("scopeType"<>'INSTITUTION' OR "scopeId" IS NOT NULL);

CREATE OR REPLACE FUNCTION app.guard_institution_domain() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."verifiedAt" IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM app."Institution" i WHERE i.id=NEW."institutionId" AND i.status='APPROVED')
      OR NEW."ownershipProofHash" IS NULL
      OR NOT EXISTS (SELECT 1 FROM app."InstitutionDomainChallenge" c WHERE c."domainId"=NEW.id
        AND c."tokenHash"=NEW."ownershipProofHash" AND c."verifiedAt" IS NOT NULL
        AND c."verifiedAt"<=c."expiresAt") THEN
      RAISE EXCEPTION 'domain ownership requires current verified proof' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NEW."approvedAt" IS NOT NULL AND
     (NEW."verifiedAt" IS NULL OR NEW."requestedById" IS NULL OR NEW."approvedById" IS NULL
      OR NEW."requestedById"=NEW."approvedById" OR NEW."reviewDueAt" IS NULL
      OR NOT EXISTS (SELECT 1 FROM app."RoleAssignment" a JOIN app."Role" r ON r.id=a."roleId"
        WHERE a."userId"=NEW."approvedById" AND a."scopeType"='PLATFORM' AND a."scopeId" IS NULL
          AND r.code='SYSTEM_ADMIN' AND a."revokedAt" IS NULL AND a."startsAt"<=now()
          AND (a."endsAt" IS NULL OR a."endsAt">now()))) THEN
    RAISE EXCEPTION 'domain requires independent central approval' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND OLD."approvedAt" IS NOT NULL AND
     (NEW."domain",NEW."institutionId",NEW."requestedById",NEW."approvedById",NEW."approvedAt") IS DISTINCT FROM
     (OLD."domain",OLD."institutionId",OLD."requestedById",OLD."approvedById",OLD."approvedAt") THEN
    RAISE EXCEPTION 'approved domain identity is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app.guard_membership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status='VERIFIED' THEN
    IF NEW."verifiedAt" IS NULL OR NEW."expiresAt" IS NULL OR NEW."expiresAt"<=now()
      OR NEW."optedOutAt" IS NOT NULL
      OR NOT EXISTS (SELECT 1 FROM app."User" u JOIN app."InstitutionDomain" d
        ON d.domain=split_part(lower(u.email),'@',2) AND d."institutionId"=NEW."institutionId"
        WHERE u.id=NEW."userId" AND u.status='ACTIVE' AND u."emailVerifiedAt" IS NOT NULL
          AND d."verifiedAt" IS NOT NULL AND d."approvedAt" IS NOT NULL
          AND d."suspendedAt" IS NULL AND d."reviewDueAt">now())
      OR NOT EXISTS (SELECT 1 FROM app."Institution" i WHERE i.id=NEW."institutionId" AND i.status='APPROVED')
      OR NOT EXISTS (SELECT 1 FROM app."EligibilityPolicy" p WHERE p."institutionId"=NEW."institutionId"
        AND p.category=NEW.category AND p.active AND p."approvalStatus"='APPROVED'
        AND p."verificationMode"=NEW."verificationMethod"
        AND p."validityDays">=EXTRACT(EPOCH FROM (NEW."expiresAt"-NEW."verifiedAt"))/86400) THEN
      RAISE EXCEPTION 'membership lacks approved domain, identity, policy or bounded validity' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION app.guard_institution_manager_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."scopeType"='INSTITUTION' AND NOT EXISTS (
    SELECT 1 FROM app."Institution" i JOIN app."Role" r ON r.id=NEW."roleId"
    WHERE i.id=NEW."scopeId" AND i.status='APPROVED' AND r.code='INSTITUTION_MANAGER') THEN
    RAISE EXCEPTION 'institution scope requires approved institution manager role' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER institution_manager_scope_guard BEFORE INSERT OR UPDATE ON app."RoleAssignment"
  FOR EACH ROW EXECUTE FUNCTION app.guard_institution_manager_scope();

INSERT INTO app."Role" (id,code,description)
  VALUES (gen_random_uuid(),'INSTITUTION_MANAGER','Scoped institution roster and cohort manager')
  ON CONFLICT (code) DO NOTHING;
INSERT INTO app."Permission" (id,code,description) VALUES
  (gen_random_uuid(),'INSTITUTION_READ','Read scoped institution dashboard and membership'),
  (gen_random_uuid(),'INSTITUTION_ROSTER','Request and review scoped memberships and roster'),
  (gen_random_uuid(),'INSTITUTION_COHORT','Manage scoped learner cohorts'),
  (gen_random_uuid(),'INSTITUTION_APPROVE','Approve institution, domain and eligibility policy centrally'),
  (gen_random_uuid(),'INSTITUTION_SSO','Request and approve institutional SSO metadata')
  ON CONFLICT (code) DO NOTHING;
INSERT INTO app."RolePermission" ("roleId","permissionId")
  SELECT r.id,p.id FROM app."Role" r CROSS JOIN app."Permission" p
  WHERE r.code='SYSTEM_ADMIN' AND p.code LIKE 'INSTITUTION_%' ON CONFLICT DO NOTHING;
INSERT INTO app."RolePermission" ("roleId","permissionId")
  SELECT r.id,p.id FROM app."Role" r CROSS JOIN app."Permission" p
  WHERE r.code='INSTITUTION_MANAGER' AND p.code IN ('INSTITUTION_READ','INSTITUTION_ROSTER','INSTITUTION_COHORT')
  ON CONFLICT DO NOTHING;

-- An institutional grant remains effective only while its specific category,
-- verification method, scope, domain, agreement and current policy all remain valid.
CREATE OR REPLACE VIEW app."EffectiveEntitlement" AS
SELECT e.* FROM app."Entitlement" e
JOIN app."User" u ON u.id=e."userId"
LEFT JOIN app."Order" o ON o.id=e."orderId"
LEFT JOIN app."TrialUsage" t ON t.id=e."trialUsageId"
LEFT JOIN app."Membership" m ON m.id=e."membershipId"
LEFT JOIN app."Institution" i ON i.id=m."institutionId"
LEFT JOIN app."GrantCampaign" gc ON gc.id=e."campaignId"
WHERE e.status='ACTIVE' AND e."revokedAt" IS NULL AND e."startsAt"<=now()
  AND (e."endsAt" IS NULL OR e."endsAt">now()) AND u.status='ACTIVE'
  AND (e.source<>'PAID' OR (o.status='PAID' AND o."userId"=e."userId"))
  AND (e.source<>'TRIAL' OR (t."userId"=e."userId" AND t."startsAt"<=now() AND t."endsAt">now()))
  AND (e.source<>'PROMOTION' OR (gc.status='ACTIVE' AND gc."startsAt"<=now() AND gc."endsAt">now()
    AND EXISTS (SELECT 1 FROM app."GrantCampaignClaim" cc WHERE cc."campaignId"=gc.id
      AND cc."userId"=e."userId" AND cc."entitlementId"=e.id)))
  AND (e.source NOT IN ('INSTITUTION','SPONSORED') OR (
    m.status='VERIFIED' AND m."optedOutAt" IS NULL AND m."userId"=e."userId" AND i.status='APPROVED'
    AND u."emailVerifiedAt" IS NOT NULL AND m."verifiedAt" IS NOT NULL
    AND (m."expiresAt" IS NULL OR m."expiresAt">now())
    AND (SELECT rev.decision FROM app."EligibilityReview" rev WHERE rev."membershipId"=m.id
      ORDER BY rev."reviewedAt" DESC,rev.id DESC LIMIT 1)='APPROVED'
    AND EXISTS (SELECT 1 FROM app."InstitutionDomain" d WHERE d."institutionId"=i.id
      AND d.domain=split_part(lower(u.email),'@',2) AND d."verifiedAt" IS NOT NULL
      AND d."approvedAt" IS NOT NULL AND d."suspendedAt" IS NULL AND d."reviewDueAt">now())
    AND EXISTS (SELECT 1 FROM app."EligibilityPolicy" p WHERE p."institutionId"=i.id
      AND p.category=m.category AND p.active AND p."approvalStatus"='APPROVED'
      AND p."verificationMode"=m."verificationMethod"
      AND (p.scope='LIBRARY' OR (p.scope=e.scope AND p."scopeId" IS NOT DISTINCT FROM
        COALESCE(e."publicationId",e."volumeId")))
      AND m."verifiedAt"+(p."validityDays"*interval '1 day')>now())
    AND EXISTS (SELECT 1 FROM app."InstitutionAgreement" a WHERE a."institutionId"=i.id
      AND a.status='APPROVED' AND a."startsAt"<=now() AND a."endsAt">now()
      AND m.category=ANY(a."permittedCategories")
      AND (a.scope='LIBRARY' OR (a.scope=e.scope AND
        a."publicationId" IS NOT DISTINCT FROM e."publicationId" AND
        a."volumeId" IS NOT DISTINCT FROM e."volumeId"))
      AND (SELECT count(*) FROM app."Membership" am WHERE am."institutionId"=i.id
        AND am.status='VERIFIED' AND (am."expiresAt" IS NULL OR am."expiresAt">now()))<=a."memberLimit")
    AND (e.source<>'SPONSORED' OR EXISTS (SELECT 1 FROM app."CohortMember" cm
      JOIN app."Cohort" co ON co.id=cm."cohortId" WHERE cm."cohortId"=e."cohortId"
      AND co."institutionId"=i.id AND co.active AND cm."userId"=e."userId" AND cm."leftAt" IS NULL))
    AND COALESCE((SELECT (settings->'institutional'->>'benefitsEnabled')::boolean
      FROM app."PlatformPolicyVersion" WHERE status='ACTIVE' LIMIT 1),false)));
