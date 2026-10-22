-- Follow-up to the additive baseline: avoid a PL/pgSQL record/table alias collision
-- and validate both ends when an attachment is reassigned.
CREATE OR REPLACE FUNCTION app.guard_entitlement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE order_row record; membership_row record; trial_row record;
BEGIN
  IF NEW.status = 'ACTIVE' THEN
    IF NEW.source = 'PAID' THEN
      SELECT "userId", status INTO order_row FROM app."Order" WHERE id = NEW."orderId";
      IF NEW."orderId" IS NULL OR order_row."userId" IS DISTINCT FROM NEW."userId" OR order_row.status <> 'PAID' THEN
        RAISE EXCEPTION 'paid entitlement requires matching paid order' USING ERRCODE = '23514';
      END IF;
    ELSIF NEW.source = 'TRIAL' THEN
      SELECT "userId", "startsAt", "endsAt" INTO trial_row FROM app."TrialUsage" WHERE id = NEW."trialUsageId";
      IF NEW."trialUsageId" IS NULL OR trial_row."userId" IS DISTINCT FROM NEW."userId" OR NEW."startsAt" < trial_row."startsAt" OR NEW."endsAt" > trial_row."endsAt" THEN
        RAISE EXCEPTION 'trial entitlement must fit matching trial' USING ERRCODE = '23514';
      END IF;
    ELSIF NEW.source = 'INSTITUTION' THEN
      SELECT member."userId", member.status, member."expiresAt", inst.status AS institution_status INTO membership_row
      FROM app."Membership" member JOIN app."Institution" inst ON inst.id = member."institutionId" WHERE member.id = NEW."membershipId";
      IF NEW."membershipId" IS NULL OR membership_row."userId" IS DISTINCT FROM NEW."userId" OR membership_row.status <> 'VERIFIED'
        OR membership_row.institution_status <> 'APPROVED'
        OR (membership_row."expiresAt" IS NOT NULL AND (membership_row."expiresAt" <= now() OR NEW."endsAt" > membership_row."expiresAt")) THEN
        RAISE EXCEPTION 'institution entitlement requires valid approved membership' USING ERRCODE = '23514';
      END IF;
    ELSIF NEW.source IN ('COMPLIMENTARY', 'SPONSORED') THEN
      IF NOT EXISTS (SELECT 1 FROM app."GrantApproval" WHERE "entitlementId" = NEW.id AND status IN ('APPROVED', 'EXCEPTION') AND "approvedById" IS NOT NULL) THEN
        RAISE EXCEPTION 'manual grant requires recorded approval' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app.guard_resource_attachment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rid uuid; rev uuid; rids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF TG_OP <> 'DELETE' THEN rids := array_append(rids, NEW."resourceId"); END IF;
  IF TG_OP <> 'INSERT' THEN rids := array_append(rids, OLD."resourceId"); END IF;
  FOREACH rid IN ARRAY rids LOOP
    SELECT COALESCE(r."revisionId", c."revisionId", lc."revisionId") INTO rev
      FROM app."Resource" r LEFT JOIN app."Chapter" c ON c.id = r."chapterId"
      LEFT JOIN app."Lesson" l ON l.id = r."lessonId" LEFT JOIN app."Chapter" lc ON lc.id = l."chapterId"
      WHERE r.id = rid;
    IF rev IS NOT NULL AND EXISTS (SELECT 1 FROM app."Revision" WHERE id = rev AND status = 'PUBLISHED') THEN
      RAISE EXCEPTION 'published revision attachment is immutable' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
