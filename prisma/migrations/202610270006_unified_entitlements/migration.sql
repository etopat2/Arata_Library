-- AlterEnum
ALTER TYPE "app"."EntitlementScope" ADD VALUE 'COLLECTION';

-- AlterEnum
ALTER TYPE "app"."EntitlementSource" ADD VALUE 'PROMOTION';

-- AlterEnum
ALTER TYPE "app"."EntitlementStatus" ADD VALUE 'SUSPENDED';

-- AlterTable
ALTER TABLE "app"."Entitlement" ADD COLUMN     "campaignId" UUID,
ADD COLUMN     "cohortId" UUID,
ADD COLUMN     "collectionId" UUID,
ADD COLUMN     "grantedById" UUID;

-- AlterTable
ALTER TABLE "app"."Membership" ADD COLUMN     "category" VARCHAR(32) NOT NULL DEFAULT 'ORGANIZATION_MEMBER';

-- CreateTable
CREATE TABLE "app"."GrantCampaign" (
    "id" UUID NOT NULL,
    "kind" VARCHAR(24) NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'PENDING',
    "name" VARCHAR(160) NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "scope" "app"."EntitlementScope" NOT NULL,
    "collectionId" UUID,
    "publicationId" UUID,
    "volumeId" UUID,
    "editionId" UUID,
    "startsAt" TIMESTAMPTZ(6) NOT NULL,
    "endsAt" TIMESTAMPTZ(6) NOT NULL,
    "maxClaims" INTEGER NOT NULL,
    "codeHash" VARCHAR(64),
    "createdById" UUID NOT NULL,
    "approvedById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMPTZ(6),

    CONSTRAINT "GrantCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."GrantCampaignClaim" (
    "campaignId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "entitlementId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMPTZ(6),

    CONSTRAINT "GrantCampaignClaim_pkey" PRIMARY KEY ("campaignId","userId")
);

-- CreateTable
CREATE TABLE "app"."InstitutionAgreement" (
    "id" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'PENDING',
    "scope" "app"."EntitlementScope" NOT NULL,
    "publicationId" UUID,
    "volumeId" UUID,
    "memberLimit" INTEGER NOT NULL,
    "permittedCategories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "startsAt" TIMESTAMPTZ(6) NOT NULL,
    "endsAt" TIMESTAMPTZ(6) NOT NULL,
    "approvedById" UUID,
    "approvedAt" TIMESTAMPTZ(6),

    CONSTRAINT "InstitutionAgreement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."AccessDecisionLog" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "action" VARCHAR(32) NOT NULL,
    "targetKind" VARCHAR(32) NOT NULL,
    "targetId" UUID NOT NULL,
    "decision" VARCHAR(12) NOT NULL,
    "reasonCode" VARCHAR(48) NOT NULL,
    "entitlementId" UUID,
    "requestId" VARCHAR(80),
    "occurredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessDecisionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GrantCampaign_codeHash_key" ON "app"."GrantCampaign"("codeHash");

-- CreateIndex
CREATE INDEX "GrantCampaign_status_endsAt_idx" ON "app"."GrantCampaign"("status", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "GrantCampaignClaim_entitlementId_key" ON "app"."GrantCampaignClaim"("entitlementId");

-- CreateIndex
CREATE INDEX "InstitutionAgreement_institutionId_status_endsAt_idx" ON "app"."InstitutionAgreement"("institutionId", "status", "endsAt");

-- CreateIndex
CREATE INDEX "AccessDecisionLog_userId_occurredAt_idx" ON "app"."AccessDecisionLog"("userId", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "AccessDecisionLog_occurredAt_idx" ON "app"."AccessDecisionLog"("occurredAt");

-- CreateIndex
CREATE INDEX "entitlement_user_expiry" ON "app"."Entitlement"("userId", "status", "endsAt");

-- AddForeignKey
ALTER TABLE "app"."Entitlement" ADD CONSTRAINT "Entitlement_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "app"."User"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "app"."Entitlement" ADD CONSTRAINT "Entitlement_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "app"."Collection"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "app"."Entitlement" ADD CONSTRAINT "Entitlement_cohortId_fkey" FOREIGN KEY ("cohortId") REFERENCES "app"."Cohort"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "app"."Entitlement" ADD CONSTRAINT "Entitlement_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "app"."GrantCampaign"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "app"."GrantCampaign" ADD CONSTRAINT "GrantCampaign_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "app"."User"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "app"."GrantCampaign" ADD CONSTRAINT "GrantCampaign_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "app"."User"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "app"."GrantCampaignClaim" ADD CONSTRAINT "GrantCampaignClaim_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "app"."GrantCampaign"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "app"."GrantCampaignClaim" ADD CONSTRAINT "GrantCampaignClaim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app"."User"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "app"."GrantCampaignClaim" ADD CONSTRAINT "GrantCampaignClaim_entitlementId_fkey" FOREIGN KEY ("entitlementId") REFERENCES "app"."Entitlement"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "app"."InstitutionAgreement" ADD CONSTRAINT "InstitutionAgreement_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "app"."Institution"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "app"."InstitutionAgreement" ADD CONSTRAINT "InstitutionAgreement_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "app"."User"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "app"."AccessDecisionLog" ADD CONSTRAINT "AccessDecisionLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app"."User"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- Reconcile the original scope check with the platform policy's COLLECTION option.
-- Existing rows satisfy the stricter one-target invariant; no data is removed.
ALTER TABLE app."Entitlement" DROP CONSTRAINT entitlement_scope_target;
ALTER TABLE app."Entitlement" ADD CONSTRAINT entitlement_scope_target CHECK (
  (scope='LIBRARY' AND num_nonnulls("collectionId","publicationId","volumeId","editionId","resourceId")=0) OR
  (scope='COLLECTION' AND "collectionId" IS NOT NULL AND num_nonnulls("publicationId","volumeId","editionId","resourceId")=0) OR
  (scope='PUBLICATION' AND "publicationId" IS NOT NULL AND num_nonnulls("collectionId","volumeId","editionId","resourceId")=0) OR
  (scope='VOLUME' AND "volumeId" IS NOT NULL AND num_nonnulls("collectionId","publicationId","editionId","resourceId")=0) OR
  (scope='EDITION' AND "editionId" IS NOT NULL AND num_nonnulls("collectionId","publicationId","volumeId","resourceId")=0) OR
  (scope='RESOURCE' AND "resourceId" IS NOT NULL AND num_nonnulls("collectionId","publicationId","volumeId","editionId")=0));
ALTER TABLE app."Entitlement" ADD CONSTRAINT promotion_campaign_required CHECK (source<>'PROMOTION' OR "campaignId" IS NOT NULL);
ALTER TABLE app."Membership" ADD CONSTRAINT membership_category_valid CHECK (category IN
  ('STUDENT','ACADEMIC_STAFF','ORGANIZATION_MEMBER','SCHOLARSHIP','SPONSORED_COHORT'));
ALTER TABLE app."GrantCampaign" ADD CONSTRAINT campaign_kind_valid CHECK (kind IN ('BULK','PROMOTION'));
ALTER TABLE app."GrantCampaign" ADD CONSTRAINT campaign_status_valid CHECK (status IN ('PENDING','ACTIVE','SUSPENDED','CLOSED'));
ALTER TABLE app."GrantCampaign" ADD CONSTRAINT campaign_window_valid CHECK ("endsAt">"startsAt" AND "maxClaims" BETWEEN 1 AND 1000);
ALTER TABLE app."GrantCampaign" ADD CONSTRAINT campaign_code_shape CHECK (
  (kind='PROMOTION' AND "codeHash" IS NOT NULL) OR (kind='BULK' AND "codeHash" IS NULL));
ALTER TABLE app."GrantCampaign" ADD CONSTRAINT campaign_approval_valid CHECK (
  (status='PENDING' AND "approvedById" IS NULL AND "approvedAt" IS NULL) OR
  (status<>'PENDING' AND "approvedById" IS NOT NULL AND "approvedAt" IS NOT NULL AND "approvedById"<>"createdById"));
ALTER TABLE app."GrantCampaign" ADD CONSTRAINT campaign_scope_target CHECK (
  (scope='LIBRARY' AND num_nonnulls("collectionId","publicationId","volumeId","editionId")=0) OR
  (scope='COLLECTION' AND "collectionId" IS NOT NULL AND num_nonnulls("publicationId","volumeId","editionId")=0) OR
  (scope='PUBLICATION' AND "publicationId" IS NOT NULL AND num_nonnulls("collectionId","volumeId","editionId")=0) OR
  (scope='VOLUME' AND "volumeId" IS NOT NULL AND num_nonnulls("collectionId","publicationId","editionId")=0) OR
  (scope='EDITION' AND "editionId" IS NOT NULL AND num_nonnulls("collectionId","publicationId","volumeId")=0));
ALTER TABLE app."GrantCampaignClaim" ADD CONSTRAINT claim_issued_at_valid CHECK (
  ("entitlementId" IS NULL AND "claimedAt" IS NULL) OR ("entitlementId" IS NOT NULL AND "claimedAt" IS NOT NULL));
ALTER TABLE app."InstitutionAgreement" ADD CONSTRAINT agreement_valid CHECK (
  status IN ('PENDING','APPROVED','SUSPENDED','EXPIRED') AND "memberLimit">0 AND "endsAt">"startsAt"
  AND ((status='PENDING' AND "approvedById" IS NULL AND "approvedAt" IS NULL)
    OR (status<>'PENDING' AND "approvedById" IS NOT NULL AND "approvedAt" IS NOT NULL))
  AND ((scope='LIBRARY' AND "publicationId" IS NULL AND "volumeId" IS NULL)
    OR (scope='PUBLICATION' AND "publicationId" IS NOT NULL AND "volumeId" IS NULL)
    OR (scope='VOLUME' AND "volumeId" IS NOT NULL AND "publicationId" IS NULL)));
ALTER TABLE app."AccessDecisionLog" ADD CONSTRAINT access_decision_valid CHECK (
  decision IN ('ALLOW','DENY') AND action IN ('READ','PREVIEW','DOWNLOAD','EXPORT','OFFLINE')
  AND "targetKind" IN ('LESSON','RESOURCE','ASSET','EDITION'));

-- Manual grants and campaigns cannot silently mutate their target or history.
CREATE FUNCTION app.entitlement_identity_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."userId",NEW.source,NEW.scope,NEW."collectionId",NEW."publicationId",NEW."volumeId",
      NEW."editionId",NEW."resourceId",NEW."orderId",NEW."subscriptionId",NEW."trialUsageId",
      NEW."membershipId",NEW."cohortId",NEW."campaignId",NEW."grantedById",NEW."startsAt",NEW."endsAt")
    IS DISTINCT FROM
     (OLD."userId",OLD.source,OLD.scope,OLD."collectionId",OLD."publicationId",OLD."volumeId",
      OLD."editionId",OLD."resourceId",OLD."orderId",OLD."subscriptionId",OLD."trialUsageId",
      OLD."membershipId",OLD."cohortId",OLD."campaignId",OLD."grantedById",OLD."startsAt",OLD."endsAt") THEN
    RAISE EXCEPTION 'entitlement source, scope and dates are immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.status='REVOKED' AND NEW.status<>'REVOKED' THEN
    RAISE EXCEPTION 'revoked entitlement cannot be restored' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER entitlement_identity_immutable BEFORE UPDATE ON app."Entitlement"
  FOR EACH ROW EXECUTE FUNCTION app.entitlement_identity_immutable();

CREATE FUNCTION app.entitlement_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'entitlement history is append-only' USING ERRCODE='23514'; END $$;
CREATE TRIGGER entitlement_event_immutable BEFORE UPDATE OR DELETE ON app."EntitlementEvent"
  FOR EACH ROW EXECUTE FUNCTION app.entitlement_history_immutable();

CREATE OR REPLACE FUNCTION app.guard_entitlement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE order_row record; membership_row record; trial_row record;
BEGIN
  IF NEW.status='ACTIVE' THEN
    IF NEW.source='PAID' THEN
      SELECT "userId",status INTO order_row FROM app."Order" WHERE id=NEW."orderId";
      IF NEW."orderId" IS NULL OR order_row."userId" IS DISTINCT FROM NEW."userId" OR order_row.status<>'PAID' THEN
        RAISE EXCEPTION 'paid entitlement requires matching paid order' USING ERRCODE='23514'; END IF;
    ELSIF NEW.source='TRIAL' THEN
      SELECT "userId","startsAt","endsAt" INTO trial_row FROM app."TrialUsage" WHERE id=NEW."trialUsageId";
      IF NEW."trialUsageId" IS NULL OR trial_row."userId" IS DISTINCT FROM NEW."userId"
        OR NEW."startsAt"<trial_row."startsAt" OR NEW."endsAt">trial_row."endsAt" THEN
        RAISE EXCEPTION 'trial entitlement must fit matching trial' USING ERRCODE='23514'; END IF;
    ELSIF NEW.source IN ('INSTITUTION','SPONSORED') THEN
      SELECT m."userId",m.status,m."expiresAt",i.status AS institution_status INTO membership_row
        FROM app."Membership" m JOIN app."Institution" i ON i.id=m."institutionId" WHERE m.id=NEW."membershipId";
      IF NEW."membershipId" IS NULL OR membership_row."userId" IS DISTINCT FROM NEW."userId"
        OR membership_row.status<>'VERIFIED' OR membership_row.institution_status<>'APPROVED'
        OR (membership_row."expiresAt" IS NOT NULL AND (membership_row."expiresAt"<=now() OR NEW."endsAt">membership_row."expiresAt")) THEN
        RAISE EXCEPTION 'institution entitlement requires valid approved membership' USING ERRCODE='23514'; END IF;
      IF NEW.source='SPONSORED' AND (NEW."cohortId" IS NULL OR NOT EXISTS (
        SELECT 1 FROM app."CohortMember" cm JOIN app."Cohort" c ON c.id=cm."cohortId"
        JOIN app."Membership" m ON m."institutionId"=c."institutionId" AND m."userId"=cm."userId"
        WHERE cm."cohortId"=NEW."cohortId" AND cm."userId"=NEW."userId" AND cm."leftAt" IS NULL
          AND m.id=NEW."membershipId")) THEN
        RAISE EXCEPTION 'sponsored entitlement requires active cohort membership' USING ERRCODE='23514'; END IF;
    END IF;
    IF NEW.source IN ('COMPLIMENTARY','SPONSORED') AND NOT EXISTS (
      SELECT 1 FROM app."GrantApproval" WHERE "entitlementId"=NEW.id AND status='APPROVED'
        AND "approvedById" IS NOT NULL AND "approvedById"<>NEW."grantedById") THEN
      RAISE EXCEPTION 'manual grant requires independent approval' USING ERRCODE='23514';
    END IF;
    IF NEW.source='PROMOTION' AND NOT EXISTS (
      SELECT 1 FROM app."GrantCampaign" c JOIN app."GrantCampaignClaim" cc ON cc."campaignId"=c.id
      WHERE c.id=NEW."campaignId" AND c.kind='PROMOTION' AND c.status='ACTIVE'
        AND cc."userId"=NEW."userId" AND cc."entitlementId"=NEW.id
        AND c.scope=NEW.scope AND c."collectionId" IS NOT DISTINCT FROM NEW."collectionId"
        AND c."publicationId" IS NOT DISTINCT FROM NEW."publicationId"
        AND c."volumeId" IS NOT DISTINCT FROM NEW."volumeId"
        AND c."editionId" IS NOT DISTINCT FROM NEW."editionId") THEN
      RAISE EXCEPTION 'promotion requires an approved matching campaign claim' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- The view is a current-source filter. Reader action and content policy are evaluated separately.
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
  AND (e.source<>'PROMOTION' OR (gc.status='ACTIVE' AND gc."startsAt"<=now() AND gc."endsAt">now()))
  AND (e.source NOT IN ('INSTITUTION','SPONSORED') OR (
    m.status='VERIFIED' AND m."userId"=e."userId" AND i.status='APPROVED'
    AND u."emailVerifiedAt" IS NOT NULL AND (m."expiresAt" IS NULL OR m."expiresAt">now())
    AND EXISTS (SELECT 1 FROM app."InstitutionDomain" d WHERE d."institutionId"=i.id
      AND d.domain=split_part(lower(u.email),'@',2) AND d."verifiedAt" IS NOT NULL
      AND d."approvedAt" IS NOT NULL AND d."suspendedAt" IS NULL
      AND (d."reviewDueAt" IS NULL OR d."reviewDueAt">now()))
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
      AND co."institutionId"=i.id AND cm."userId"=e."userId" AND cm."leftAt" IS NULL))
    AND COALESCE((SELECT (settings->'institutional'->>'benefitsEnabled')::boolean
      FROM app."PlatformPolicyVersion" WHERE status='ACTIVE' LIMIT 1),false)));

INSERT INTO app."Permission" (id,code,description) VALUES
  (gen_random_uuid(),'ENTITLEMENT_READ','Read scoped entitlement and access history'),
  (gen_random_uuid(),'ENTITLEMENT_GRANT','Request scoped individual or bulk access'),
  (gen_random_uuid(),'ENTITLEMENT_APPROVE','Independently approve access grants and campaigns'),
  (gen_random_uuid(),'ENTITLEMENT_REVOKE','Suspend or revoke manual access with reason'),
  (gen_random_uuid(),'ENTITLEMENT_INSTITUTION','Issue verified institutional and sponsored benefits')
ON CONFLICT (code) DO NOTHING;
INSERT INTO app."RolePermission" ("roleId","permissionId")
SELECT r.id,p.id FROM app."Role" r CROSS JOIN app."Permission" p
WHERE r.code='SYSTEM_ADMIN' AND p.code LIKE 'ENTITLEMENT_%' ON CONFLICT DO NOTHING;
