-- Additive hardening for independent institutional approvals and source-state changes.
ALTER TABLE app."InstitutionAgreement" ADD COLUMN "createdById" uuid;
ALTER TABLE app."InstitutionAgreement" ADD CONSTRAINT "InstitutionAgreement_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES app."User"(id) ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE app."InstitutionAgreement" ADD CONSTRAINT agreement_independent_approval CHECK
  (status='PENDING' OR ("createdById" IS NOT NULL AND "approvedById"<>"createdById"));

CREATE FUNCTION app.lock_grant_approval() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'grant approval history is append only' USING ERRCODE='23514'; END IF;
  IF OLD.status<>'PENDING' OR NEW.id<>OLD.id OR NEW."entitlementId"<>OLD."entitlementId"
     OR NEW."requestedById"<>OLD."requestedById" OR NEW.reason<>OLD.reason
     OR NEW."requestedAt"<>OLD."requestedAt" OR NEW.status NOT IN ('APPROVED','REJECTED')
     OR NEW."approvedById" IS NULL OR NEW."approvedById"=OLD."requestedById" THEN
    RAISE EXCEPTION 'invalid grant approval transition' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER grant_approval_history BEFORE UPDATE OR DELETE ON app."GrantApproval"
  FOR EACH ROW EXECUTE FUNCTION app.lock_grant_approval();

CREATE FUNCTION app.lock_campaign_core() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'campaign history is retained' USING ERRCODE='23514'; END IF;
  IF (NEW.id,NEW.kind,NEW.name,NEW.reason,NEW.scope,NEW."collectionId",NEW."publicationId",
      NEW."volumeId",NEW."editionId",NEW."startsAt",NEW."endsAt",NEW."maxClaims",
      NEW."codeHash",NEW."createdById") IS DISTINCT FROM
     (OLD.id,OLD.kind,OLD.name,OLD.reason,OLD.scope,OLD."collectionId",OLD."publicationId",
      OLD."volumeId",OLD."editionId",OLD."startsAt",OLD."endsAt",OLD."maxClaims",
      OLD."codeHash",OLD."createdById") THEN
    RAISE EXCEPTION 'approved campaign core is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.status<>'PENDING' AND (NEW."approvedById",NEW."approvedAt") IS DISTINCT FROM
    (OLD."approvedById",OLD."approvedAt") THEN
    RAISE EXCEPTION 'campaign approval is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.status='PENDING' AND NEW.status='ACTIVE' AND NEW."approvedById"=OLD."createdById" THEN
    RAISE EXCEPTION 'campaign requires independent approver' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER campaign_core_guard BEFORE UPDATE OR DELETE ON app."GrantCampaign"
  FOR EACH ROW EXECUTE FUNCTION app.lock_campaign_core();

CREATE FUNCTION app.lock_claim_core() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'campaign claim history is retained' USING ERRCODE='23514'; END IF;
  IF NEW."campaignId"<>OLD."campaignId" OR NEW."userId"<>OLD."userId" OR
     (OLD."entitlementId" IS NOT NULL AND NEW."entitlementId" IS DISTINCT FROM OLD."entitlementId") THEN
    RAISE EXCEPTION 'campaign claim identity is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER campaign_claim_guard BEFORE UPDATE OR DELETE ON app."GrantCampaignClaim"
  FOR EACH ROW EXECUTE FUNCTION app.lock_claim_core();

CREATE FUNCTION app.guard_institution_grant_approval() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status='ACTIVE' AND NEW.source='INSTITUTION' AND NOT EXISTS (
    SELECT 1 FROM app."GrantApproval" ga WHERE ga."entitlementId"=NEW.id
      AND ga.status='APPROVED' AND ga."approvedById" IS NOT NULL
      AND ga."approvedById"<>NEW."grantedById") THEN
    RAISE EXCEPTION 'institution grant requires independent approval' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER institution_grant_approval_guard BEFORE INSERT OR UPDATE ON app."Entitlement"
  FOR EACH ROW EXECUTE FUNCTION app.guard_institution_grant_approval();

CREATE FUNCTION app.lock_agreement_core() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'institution agreement history is retained' USING ERRCODE='23514'; END IF;
  IF (NEW.id,NEW."institutionId",NEW."createdById",NEW.scope,NEW."publicationId",NEW."volumeId",
      NEW."memberLimit",NEW."permittedCategories",NEW."startsAt",NEW."endsAt") IS DISTINCT FROM
     (OLD.id,OLD."institutionId",OLD."createdById",OLD.scope,OLD."publicationId",OLD."volumeId",
      OLD."memberLimit",OLD."permittedCategories",OLD."startsAt",OLD."endsAt") THEN
    RAISE EXCEPTION 'institution agreement core is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.status<>'PENDING' AND (NEW."approvedById",NEW."approvedAt") IS DISTINCT FROM
    (OLD."approvedById",OLD."approvedAt") THEN
    RAISE EXCEPTION 'institution approval is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER agreement_core_guard BEFORE UPDATE OR DELETE ON app."InstitutionAgreement"
  FOR EACH ROW EXECUTE FUNCTION app.lock_agreement_core();

-- Every institutional read uses the latest review, not any historical approval.
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
    m.status='VERIFIED' AND m."userId"=e."userId" AND i.status='APPROVED'
    AND u."emailVerifiedAt" IS NOT NULL AND (m."expiresAt" IS NULL OR m."expiresAt">now())
    AND (SELECT rev.decision FROM app."EligibilityReview" rev WHERE rev."membershipId"=m.id
      ORDER BY rev."reviewedAt" DESC,rev.id DESC LIMIT 1)='APPROVED'
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
