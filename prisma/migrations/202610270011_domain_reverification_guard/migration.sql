-- A later challenge supersedes older proof. A central reviewer cannot renew an
-- expired approval using a proof from a prior review cycle.
CREATE OR REPLACE FUNCTION app.guard_institution_domain() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."verifiedAt" IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM app."Institution" i WHERE i.id=NEW."institutionId" AND i.status='APPROVED')
      OR NEW."ownershipProofHash" IS NULL
      OR NOT EXISTS (SELECT 1 FROM app."InstitutionDomainChallenge" c WHERE c."domainId"=NEW.id
        AND c."tokenHash"=NEW."ownershipProofHash" AND c."verifiedAt" IS NOT NULL
        AND c."verifiedAt"<=c."expiresAt" AND c.id=(SELECT id
          FROM app."InstitutionDomainChallenge" latest WHERE latest."domainId"=NEW.id
          ORDER BY latest."createdAt" DESC,latest.id DESC LIMIT 1)) THEN
      RAISE EXCEPTION 'domain ownership requires latest verified proof' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NEW."approvedAt" IS NOT NULL AND
     (TG_OP='INSERT' OR OLD."approvedAt" IS NULL OR
      NEW."reviewDueAt" IS DISTINCT FROM OLD."reviewDueAt" OR
      (OLD."suspendedAt" IS NOT NULL AND NEW."suspendedAt" IS NULL)) AND
     (NEW."verifiedAt" IS NULL OR NEW."requestedById" IS NULL OR NEW."approvedById" IS NULL
      OR NEW."requestedById"=NEW."approvedById" OR NEW."reviewDueAt" IS NULL
      OR NEW."verifiedAt"<now()-interval '24 hours'
      OR NOT EXISTS (SELECT 1 FROM app."RoleAssignment" a JOIN app."Role" r ON r.id=a."roleId"
        WHERE a."userId"=NEW."approvedById" AND a."scopeType"='PLATFORM' AND a."scopeId" IS NULL
          AND r.code='SYSTEM_ADMIN' AND a."revokedAt" IS NULL AND a."startsAt"<=now()
          AND (a."endsAt" IS NULL OR a."endsAt">now()))) THEN
    RAISE EXCEPTION 'domain requires fresh independent central approval' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND OLD."approvedAt" IS NOT NULL AND
     (NEW."domain",NEW."institutionId",NEW."requestedById",NEW."approvedById",NEW."approvedAt") IS DISTINCT FROM
     (OLD."domain",OLD."institutionId",OLD."requestedById",OLD."approvedById",OLD."approvedAt") THEN
    RAISE EXCEPTION 'approved domain identity is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
