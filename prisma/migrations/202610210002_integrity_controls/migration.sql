-- SRS business invariants that Prisma cannot express. This migration is additive.
-- No production threshold, price, lawful basis or retention period is seeded here.

ALTER TABLE app."User" ADD CONSTRAINT user_email_canonical CHECK (email = lower(btrim(email)) AND position('@' in email) > 1);
ALTER TABLE app."RoleAssignment" ADD CONSTRAINT role_assignment_window CHECK ("endsAt" IS NULL OR "endsAt" > "startsAt");
ALTER TABLE app."RoleAssignment" ADD CONSTRAINT role_assignment_scope CHECK (("scopeType" = 'PLATFORM' AND "scopeId" IS NULL) OR ("scopeType" <> 'PLATFORM' AND "scopeId" IS NOT NULL));
ALTER TABLE app."PrivacyPreference" ADD CONSTRAINT privacy_preference_window CHECK ("withdrawnAt" IS NULL OR "withdrawnAt" >= "effectiveAt");
ALTER TABLE app."RetentionPolicy" ADD CONSTRAINT retention_days_positive CHECK (days IS NULL OR days > 0);
ALTER TABLE app."Volume" ADD CONSTRAINT volume_ordinal_positive CHECK (ordinal > 0);
ALTER TABLE app."Revision" ADD CONSTRAINT revision_number_positive CHECK (number > 0);
ALTER TABLE app."Chapter" ADD CONSTRAINT chapter_ordinal_positive CHECK (ordinal > 0);
ALTER TABLE app."Lesson" ADD CONSTRAINT lesson_ordinal_positive CHECK (ordinal > 0);
ALTER TABLE app."Asset" ADD CONSTRAINT asset_size_positive CHECK ("sizeBytes" > 0);
ALTER TABLE app."Asset" ADD CONSTRAINT asset_sha256_format CHECK (sha256 ~ '^[0-9a-f]{64}$');
ALTER TABLE app."Resource" ADD CONSTRAINT resource_one_or_no_parent CHECK (num_nonnulls("publicationId", "volumeId", "editionId", "revisionId", "chapterId", "lessonId") <= 1);
ALTER TABLE app."Resource" ADD CONSTRAINT resource_publication_window CHECK ("withdrawnAt" IS NULL OR ("publishedAt" IS NOT NULL AND "withdrawnAt" >= "publishedAt"));
ALTER TABLE app."ContentPolicy" ADD CONSTRAINT content_policy_one_scope CHECK (num_nonnulls("publicationId", "volumeId", "editionId", "revisionId", "chapterId", "lessonId", "resourceId") = 1);
ALTER TABLE app."ContentPolicy" ADD CONSTRAINT content_policy_version CHECK (version > 0);
ALTER TABLE app."ContentPolicy" ADD CONSTRAINT content_policy_active_approved CHECK (NOT "isActive" OR "approvedAt" IS NOT NULL);
ALTER TABLE app."PlanVersion" ADD CONSTRAINT plan_amount_nonnegative CHECK ("amountMinor" >= 0);
ALTER TABLE app."PlanVersion" ADD CONSTRAINT plan_currency_format CHECK ("currencyCode" ~ '^[A-Z]{3}$');
ALTER TABLE app."PlanVersion" ADD CONSTRAINT plan_period_positive CHECK ("periodMonths" IS NULL OR "periodMonths" > 0);
ALTER TABLE app."PlanVersion" ADD CONSTRAINT plan_validity_window CHECK ("validUntil" IS NULL OR "validUntil" > "validFrom");
ALTER TABLE app."Subscription" ADD CONSTRAINT subscription_period_window CHECK ("currentPeriodEnd" IS NULL OR ("currentPeriodStart" IS NOT NULL AND "currentPeriodEnd" > "currentPeriodStart"));
ALTER TABLE app."TrialUsage" ADD CONSTRAINT trial_window CHECK ("endsAt" > "startsAt");
ALTER TABLE app."Order" ADD CONSTRAINT order_amount_nonnegative CHECK ("totalMinor" >= 0);
ALTER TABLE app."Order" ADD CONSTRAINT order_currency_format CHECK ("currencyCode" ~ '^[A-Z]{3}$');
ALTER TABLE app."PaymentAttempt" ADD CONSTRAINT payment_amount_nonnegative CHECK ("amountMinor" >= 0);
ALTER TABLE app."PaymentAttempt" ADD CONSTRAINT payment_currency_format CHECK ("currencyCode" ~ '^[A-Z]{3}$');
ALTER TABLE app."Invoice" ADD CONSTRAINT invoice_amount_nonnegative CHECK ("totalMinor" >= 0);
ALTER TABLE app."Refund" ADD CONSTRAINT refund_amount_positive CHECK ("amountMinor" > 0);
ALTER TABLE app."ReconciliationRun" ADD CONSTRAINT reconciliation_window CHECK ("periodTo" > "periodFrom");
ALTER TABLE app."Entitlement" ADD CONSTRAINT entitlement_window CHECK ("endsAt" IS NULL OR "endsAt" > "startsAt");
ALTER TABLE app."Entitlement" ADD CONSTRAINT entitlement_lifetime_source CHECK ("endsAt" IS NOT NULL OR source = 'COMPLIMENTARY');
ALTER TABLE app."Entitlement" ADD CONSTRAINT entitlement_scope_target CHECK (
  (scope = 'LIBRARY' AND num_nonnulls("publicationId", "volumeId", "editionId", "resourceId") = 0) OR
  (scope = 'PUBLICATION' AND "publicationId" IS NOT NULL AND num_nonnulls("volumeId", "editionId", "resourceId") = 0) OR
  (scope = 'VOLUME' AND "volumeId" IS NOT NULL AND num_nonnulls("publicationId", "editionId", "resourceId") = 0) OR
  (scope = 'EDITION' AND "editionId" IS NOT NULL AND num_nonnulls("publicationId", "volumeId", "resourceId") = 0) OR
  (scope = 'RESOURCE' AND "resourceId" IS NOT NULL AND num_nonnulls("publicationId", "volumeId", "editionId") = 0));
ALTER TABLE app."GrantApproval" ADD CONSTRAINT grant_approval_decision CHECK ((status = 'PENDING' AND "decidedAt" IS NULL) OR (status <> 'PENDING' AND "decidedAt" IS NOT NULL));
ALTER TABLE app."InstitutionDomain" ADD CONSTRAINT institution_domain_canonical CHECK (domain = lower(btrim(domain)) AND domain LIKE '%.%' AND domain NOT LIKE '%..%' AND left(domain, 1) <> '.' AND right(domain, 1) <> '.');
ALTER TABLE app."InstitutionDomain" ADD CONSTRAINT institution_domain_verified_evidence CHECK ("verifiedAt" IS NULL OR ("ownershipProofHash" IS NOT NULL AND "approvedById" IS NOT NULL AND "approvedAt" IS NOT NULL));
ALTER TABLE app."Membership" ADD CONSTRAINT membership_verified_evidence CHECK (status <> 'VERIFIED' OR ("verifiedAt" IS NOT NULL AND "evidenceRef" IS NOT NULL));
ALTER TABLE app."Membership" ADD CONSTRAINT membership_valid_window CHECK ("expiresAt" IS NULL OR ("verifiedAt" IS NOT NULL AND "expiresAt" > "verifiedAt"));
ALTER TABLE app."EligibilityPolicy" ADD CONSTRAINT eligibility_validity_positive CHECK ("validityDays" > 0);
ALTER TABLE app."ReadingProgress" ADD CONSTRAINT progress_completed_after_update CHECK ("completedAt" IS NULL OR "completedAt" <= now());
ALTER TABLE app."Quiz" ADD CONSTRAINT quiz_version_positive CHECK (version > 0);
ALTER TABLE app."QuizQuestion" ADD CONSTRAINT quiz_question_values CHECK (ordinal > 0 AND points >= 0);
ALTER TABLE app."QuizAttempt" ADD CONSTRAINT quiz_attempt_score CHECK (score IS NULL OR score >= 0);
ALTER TABLE app."Project" ADD CONSTRAINT project_version_positive CHECK (version > 0);
ALTER TABLE app."OfflineLicence" ADD CONSTRAINT offline_window CHECK ("expiresAt" > "issuedAt");
ALTER TABLE app."OutboxEvent" ADD CONSTRAINT outbox_attempt_nonnegative CHECK ("attemptCount" >= 0);
ALTER TABLE research."ResearchSession" ADD CONSTRAINT research_session_duration CHECK ("visibleSeconds" >= 0 AND "engagedSeconds" >= 0 AND "engagedSeconds" <= "visibleSeconds");
ALTER TABLE research."ResearchSession" ADD CONSTRAINT research_session_window CHECK ("endedAt" IS NULL OR "endedAt" >= "startedAt");
ALTER TABLE research."ResearchEvent" ADD CONSTRAINT research_event_schema_positive CHECK ("schemaVersion" > 0);
ALTER TABLE research."ResearchEvent" ADD CONSTRAINT research_event_retention_window CHECK ("retentionUntil" > "receivedAt");
ALTER TABLE research."ResearchEvent" ADD CONSTRAINT research_event_properties_object CHECK (jsonb_typeof(properties) = 'object');
ALTER TABLE research."ResearchMetric" ADD CONSTRAINT research_metric_version_positive CHECK (version > 0);
ALTER TABLE research."ResearchAggregate" ADD CONSTRAINT research_aggregate_bounds CHECK ("periodEnd" > "periodStart" AND "sampleSize" >= 0);
ALTER TABLE research."DisclosureReview" ADD CONSTRAINT disclosure_review_group_positive CHECK ("minimumGroupSize" > 0);
ALTER TABLE research."ResearchDisclosurePolicy" ADD CONSTRAINT disclosure_policy_group_positive CHECK ("minimumGroupSize" > 0 AND version > 0);
ALTER TABLE research."PublicInsight" ADD CONSTRAINT insight_group_positive CHECK ("minimumGroupSize" > 0);

CREATE UNIQUE INDEX edition_standalone_code ON app."Edition" ("publicationId", "editionCode") WHERE "volumeId" IS NULL;
CREATE UNIQUE INDEX edition_volume_code ON app."Edition" ("volumeId", "editionCode") WHERE "volumeId" IS NOT NULL;
CREATE UNIQUE INDEX edition_default_standalone ON app."Edition" ("publicationId") WHERE "volumeId" IS NULL AND "isDefault";
CREATE UNIQUE INDEX edition_default_volume ON app."Edition" ("volumeId") WHERE "volumeId" IS NOT NULL AND "isDefault";
CREATE UNIQUE INDEX entitlement_one_paid_order ON app."Entitlement" ("orderId") WHERE source = 'PAID';
CREATE UNIQUE INDEX entitlement_one_trial_scope ON app."Entitlement" ("trialUsageId", scope, COALESCE("publicationId", "volumeId", "editionId", "resourceId", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE source = 'TRIAL';
CREATE INDEX research_event_received_brin ON research."ResearchEvent" USING BRIN ("receivedAt");

CREATE UNIQUE INDEX active_publication_policy ON app."ContentPolicy" ("publicationId") WHERE "isActive" AND "publicationId" IS NOT NULL;
CREATE UNIQUE INDEX active_volume_policy ON app."ContentPolicy" ("volumeId") WHERE "isActive" AND "volumeId" IS NOT NULL;
CREATE UNIQUE INDEX active_edition_policy ON app."ContentPolicy" ("editionId") WHERE "isActive" AND "editionId" IS NOT NULL;
CREATE UNIQUE INDEX active_revision_policy ON app."ContentPolicy" ("revisionId") WHERE "isActive" AND "revisionId" IS NOT NULL;
CREATE UNIQUE INDEX active_chapter_policy ON app."ContentPolicy" ("chapterId") WHERE "isActive" AND "chapterId" IS NOT NULL;
CREATE UNIQUE INDEX active_lesson_policy ON app."ContentPolicy" ("lessonId") WHERE "isActive" AND "lessonId" IS NOT NULL;
CREATE UNIQUE INDEX active_resource_policy ON app."ContentPolicy" ("resourceId") WHERE "isActive" AND "resourceId" IS NOT NULL;

-- Publication hierarchy and current pointer must agree with the series type.
CREATE FUNCTION app.guard_publication_hierarchy() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE k app."PublicationKind"; r record;
BEGIN
  IF TG_TABLE_NAME = 'Volume' THEN
    SELECT kind INTO k FROM app."Publication" WHERE id = NEW."publicationId";
    IF k <> 'SERIES' THEN RAISE EXCEPTION 'volumes require a series publication' USING ERRCODE = '23514'; END IF;
  ELSIF TG_TABLE_NAME = 'Edition' THEN
    SELECT kind INTO k FROM app."Publication" WHERE id = NEW."publicationId";
    IF (k = 'SERIES' AND NEW."volumeId" IS NULL) OR (k = 'STANDALONE' AND NEW."volumeId" IS NOT NULL) THEN
      RAISE EXCEPTION 'edition volume does not match publication kind' USING ERRCODE = '23514';
    END IF;
    IF NEW."currentRevisionId" IS NOT NULL THEN
      SELECT id, "editionId", status INTO r FROM app."Revision" WHERE id = NEW."currentRevisionId";
      IF r.id IS NULL OR r."editionId" <> NEW.id OR r.status <> 'PUBLISHED' THEN
        RAISE EXCEPTION 'current revision must be published and belong to edition' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER volume_hierarchy BEFORE INSERT OR UPDATE ON app."Volume" FOR EACH ROW EXECUTE FUNCTION app.guard_publication_hierarchy();
CREATE TRIGGER edition_hierarchy BEFORE INSERT OR UPDATE ON app."Edition" FOR EACH ROW EXECUTE FUNCTION app.guard_publication_hierarchy();

CREATE FUNCTION app.guard_publication_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.kind <> OLD.kind AND EXISTS (SELECT 1 FROM app."Edition" WHERE "publicationId" = OLD.id) THEN
    RAISE EXCEPTION 'publication kind cannot change after editions exist' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'PUBLISHED' AND NOT EXISTS (SELECT 1 FROM app."Edition" WHERE "publicationId" = NEW.id AND "currentRevisionId" IS NOT NULL) THEN
    RAISE EXCEPTION 'published publication requires a current published revision' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER publication_state BEFORE INSERT OR UPDATE ON app."Publication" FOR EACH ROW EXECUTE FUNCTION app.guard_publication_state();

-- An approved exact manifest is required; published revisions and their children are immutable.
CREATE FUNCTION app.guard_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' AND OLD.status = 'PUBLISHED' THEN
    RAISE EXCEPTION 'published revision is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.status = 'PUBLISHED' THEN
    IF NEW."manifestHash" IS NULL OR NEW."publishedAt" IS NULL OR NOT EXISTS (
      SELECT 1 FROM app."EditorialReview" er
      WHERE er."revisionId" = NEW.id AND er.decision = 'APPROVED' AND er."manifestHash" = NEW."manifestHash") THEN
      RAISE EXCEPTION 'publication requires approved exact manifest' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
      SELECT 1 FROM app."Lesson" l JOIN app."Chapter" c ON c.id = l."chapterId"
      JOIN app."Asset" a ON a.id = l."bodyAssetId"
      WHERE c."revisionId" = NEW.id AND a.status <> 'CLEAN') THEN
      RAISE EXCEPTION 'publication contains unscanned lesson asset' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER revision_guard BEFORE INSERT OR UPDATE OR DELETE ON app."Revision" FOR EACH ROW EXECUTE FUNCTION app.guard_revision();

CREATE FUNCTION app.guard_revision_child() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_revision uuid; prior_revision uuid;
BEGIN
  IF TG_TABLE_NAME = 'Chapter' THEN
    IF TG_OP <> 'DELETE' THEN target_revision := NEW."revisionId"; END IF;
    IF TG_OP <> 'INSERT' THEN prior_revision := OLD."revisionId"; END IF;
  ELSIF TG_TABLE_NAME = 'Lesson' THEN
    IF TG_OP <> 'DELETE' THEN SELECT "revisionId" INTO target_revision FROM app."Chapter" WHERE id = NEW."chapterId"; END IF;
    IF TG_OP <> 'INSERT' THEN SELECT "revisionId" INTO prior_revision FROM app."Chapter" WHERE id = OLD."chapterId"; END IF;
  ELSIF TG_TABLE_NAME = 'EditorialReview' THEN
    IF TG_OP <> 'DELETE' THEN target_revision := NEW."revisionId"; END IF;
    IF TG_OP <> 'INSERT' THEN prior_revision := OLD."revisionId"; END IF;
  ELSIF TG_TABLE_NAME = 'Resource' THEN
    IF TG_OP <> 'DELETE' THEN
      target_revision := NEW."revisionId";
      IF target_revision IS NULL AND NEW."chapterId" IS NOT NULL THEN SELECT "revisionId" INTO target_revision FROM app."Chapter" WHERE id = NEW."chapterId"; END IF;
      IF target_revision IS NULL AND NEW."lessonId" IS NOT NULL THEN SELECT c."revisionId" INTO target_revision FROM app."Lesson" l JOIN app."Chapter" c ON c.id = l."chapterId" WHERE l.id = NEW."lessonId"; END IF;
    END IF;
    IF TG_OP <> 'INSERT' THEN
      prior_revision := OLD."revisionId";
      IF prior_revision IS NULL AND OLD."chapterId" IS NOT NULL THEN SELECT "revisionId" INTO prior_revision FROM app."Chapter" WHERE id = OLD."chapterId"; END IF;
      IF prior_revision IS NULL AND OLD."lessonId" IS NOT NULL THEN SELECT c."revisionId" INTO prior_revision FROM app."Lesson" l JOIN app."Chapter" c ON c.id = l."chapterId" WHERE l.id = OLD."lessonId"; END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'Quiz' THEN
    IF TG_OP <> 'DELETE' THEN target_revision := NEW."revisionId"; END IF;
    IF TG_OP <> 'INSERT' THEN prior_revision := OLD."revisionId"; END IF;
  ELSIF TG_TABLE_NAME = 'QuizQuestion' THEN
    IF TG_OP <> 'DELETE' THEN SELECT "revisionId" INTO target_revision FROM app."Quiz" WHERE id = NEW."quizId"; END IF;
    IF TG_OP <> 'INSERT' THEN SELECT "revisionId" INTO prior_revision FROM app."Quiz" WHERE id = OLD."quizId"; END IF;
  ELSIF TG_TABLE_NAME = 'Project' THEN
    IF TG_OP <> 'DELETE' THEN SELECT c."revisionId" INTO target_revision FROM app."Lesson" l JOIN app."Chapter" c ON c.id = l."chapterId" WHERE l.id = NEW."lessonId"; END IF;
    IF TG_OP <> 'INSERT' THEN SELECT c."revisionId" INTO prior_revision FROM app."Lesson" l JOIN app."Chapter" c ON c.id = l."chapterId" WHERE l.id = OLD."lessonId"; END IF;
  END IF;
  IF (target_revision IS NOT NULL AND EXISTS (SELECT 1 FROM app."Revision" WHERE id = target_revision AND status = 'PUBLISHED'))
    OR (prior_revision IS NOT NULL AND EXISTS (SELECT 1 FROM app."Revision" WHERE id = prior_revision AND status = 'PUBLISHED')) THEN
    RAISE EXCEPTION 'published revision child is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER chapter_revision_guard BEFORE INSERT OR UPDATE OR DELETE ON app."Chapter" FOR EACH ROW EXECUTE FUNCTION app.guard_revision_child();
CREATE TRIGGER lesson_revision_guard BEFORE INSERT OR UPDATE OR DELETE ON app."Lesson" FOR EACH ROW EXECUTE FUNCTION app.guard_revision_child();
CREATE TRIGGER review_revision_guard BEFORE INSERT OR UPDATE OR DELETE ON app."EditorialReview" FOR EACH ROW EXECUTE FUNCTION app.guard_revision_child();
CREATE TRIGGER resource_revision_guard BEFORE INSERT OR UPDATE OR DELETE ON app."Resource" FOR EACH ROW EXECUTE FUNCTION app.guard_revision_child();
CREATE TRIGGER quiz_revision_guard BEFORE INSERT OR UPDATE OR DELETE ON app."Quiz" FOR EACH ROW EXECUTE FUNCTION app.guard_revision_child();
CREATE TRIGGER question_revision_guard BEFORE INSERT OR UPDATE OR DELETE ON app."QuizQuestion" FOR EACH ROW EXECUTE FUNCTION app.guard_revision_child();
CREATE TRIGGER project_revision_guard BEFORE INSERT OR UPDATE OR DELETE ON app."Project" FOR EACH ROW EXECUTE FUNCTION app.guard_revision_child();

CREATE FUNCTION app.guard_resource_attachment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rid uuid; rev uuid;
BEGIN
  IF TG_OP <> 'DELETE' THEN rid := NEW."resourceId"; ELSE rid := OLD."resourceId"; END IF;
  SELECT COALESCE(r."revisionId", c."revisionId", lc."revisionId") INTO rev
    FROM app."Resource" r LEFT JOIN app."Chapter" c ON c.id = r."chapterId"
    LEFT JOIN app."Lesson" l ON l.id = r."lessonId" LEFT JOIN app."Chapter" lc ON lc.id = l."chapterId"
    WHERE r.id = rid;
  IF rev IS NOT NULL AND EXISTS (SELECT 1 FROM app."Revision" WHERE id = rev AND status = 'PUBLISHED') THEN
    RAISE EXCEPTION 'published revision attachment is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER resource_attachment_guard BEFORE INSERT OR UPDATE OR DELETE ON app."ResourceAttachment" FOR EACH ROW EXECUTE FUNCTION app.guard_resource_attachment();

CREATE FUNCTION app.guard_published_asset() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM app."Lesson" l JOIN app."Chapter" c ON c.id = l."chapterId"
    JOIN app."Revision" r ON r.id = c."revisionId"
    WHERE l."bodyAssetId" = OLD.id AND r.status = 'PUBLISHED') THEN
    RAISE EXCEPTION 'asset used by published revision is immutable' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM app."ResourceAttachment" ra JOIN app."Resource" res ON res.id = ra."resourceId"
    LEFT JOIN app."Chapter" c ON c.id = res."chapterId"
    LEFT JOIN app."Lesson" l ON l.id = res."lessonId"
    LEFT JOIN app."Chapter" lc ON lc.id = l."chapterId"
    JOIN app."Revision" rev ON rev.id = COALESCE(res."revisionId", c."revisionId", lc."revisionId")
    WHERE ra."assetId" = OLD.id AND rev.status = 'PUBLISHED') THEN
    RAISE EXCEPTION 'asset attached to published revision is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER published_asset_guard BEFORE UPDATE OR DELETE ON app."Asset" FOR EACH ROW EXECUTE FUNCTION app.guard_published_asset();

-- Membership and institution grants depend on approved identity evidence.
CREATE FUNCTION app.guard_institution_domain() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."verifiedAt" IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM app."Institution" WHERE id = NEW."institutionId" AND status = 'APPROVED') THEN
      RAISE EXCEPTION 'verified domain requires approved institution' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM app."RoleAssignment" ra JOIN app."Role" role ON role.id = ra."roleId"
      WHERE ra."userId" = NEW."approvedById" AND ra."scopeType" = 'PLATFORM'
      AND role.code IN ('SYSTEM_ADMIN', 'INSTITUTION_APPROVER') AND ra."revokedAt" IS NULL
      AND ra."startsAt" <= now() AND (ra."endsAt" IS NULL OR ra."endsAt" > now())) THEN
      RAISE EXCEPTION 'domain requires central approver' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER institution_domain_guard BEFORE INSERT OR UPDATE ON app."InstitutionDomain" FOR EACH ROW EXECUTE FUNCTION app.guard_institution_domain();

CREATE FUNCTION app.guard_membership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'VERIFIED' THEN
    IF NOT EXISTS (SELECT 1 FROM app."User" WHERE id = NEW."userId" AND "emailVerifiedAt" IS NOT NULL AND status = 'ACTIVE')
      OR NOT EXISTS (SELECT 1 FROM app."Institution" WHERE id = NEW."institutionId" AND status = 'APPROVED')
      OR NOT EXISTS (SELECT 1 FROM app."EligibilityPolicy" WHERE "institutionId" = NEW."institutionId" AND active) THEN
      RAISE EXCEPTION 'membership lacks verified identity, approved institution or active policy' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER membership_guard BEFORE INSERT OR UPDATE ON app."Membership" FOR EACH ROW EXECUTE FUNCTION app.guard_membership();

CREATE FUNCTION app.guard_cohort_member() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE inst uuid;
BEGIN
  SELECT "institutionId" INTO inst FROM app."Cohort" WHERE id = NEW."cohortId";
  IF NOT EXISTS (SELECT 1 FROM app."Membership" WHERE "institutionId" = inst AND "userId" = NEW."userId"
    AND status = 'VERIFIED' AND ("expiresAt" IS NULL OR "expiresAt" > now())) THEN
    RAISE EXCEPTION 'cohort member requires active verified institution membership' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cohort_member_guard BEFORE INSERT OR UPDATE ON app."CohortMember" FOR EACH ROW EXECUTE FUNCTION app.guard_cohort_member();

-- A gateway signature alone never grants access; amount/currency and order state are checked.
CREATE FUNCTION app.guard_payment_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o record;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW."orderId", NEW."amountMinor", NEW."currencyCode", NEW.provider, NEW."providerRef")
    IS DISTINCT FROM (OLD."orderId", OLD."amountMinor", OLD."currencyCode", OLD.provider, OLD."providerRef") THEN
    RAISE EXCEPTION 'payment identity and amount are immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'VERIFIED' THEN
    SELECT "totalMinor", "currencyCode" INTO o FROM app."Order" WHERE id = NEW."orderId";
    IF NEW."verifiedAt" IS NULL OR NEW."amountMinor" <> o."totalMinor" OR NEW."currencyCode" <> o."currencyCode"
      OR NOT EXISTS (SELECT 1 FROM app."GatewayEvent" WHERE "paymentAttemptId" = NEW.id AND "signatureValid") THEN
      RAISE EXCEPTION 'verified payment requires signed matching gateway event and amount' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payment_attempt_guard BEFORE INSERT OR UPDATE ON app."PaymentAttempt" FOR EACH ROW EXECUTE FUNCTION app.guard_payment_attempt();

CREATE FUNCTION app.guard_plan_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND EXISTS (SELECT 1 FROM app."Order" WHERE "planVersionId" = OLD.id) THEN
    RAISE EXCEPTION 'plan version referenced by orders is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' AND EXISTS (SELECT 1 FROM app."Order" WHERE "planVersionId" = OLD.id) THEN
    RAISE EXCEPTION 'plan version referenced by orders cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER plan_version_guard BEFORE UPDATE OR DELETE ON app."PlanVersion" FOR EACH ROW EXECUTE FUNCTION app.guard_plan_version();

CREATE FUNCTION app.guard_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW."merchantRef", NEW."idempotencyKey", NEW."currencyCode", NEW."totalMinor", NEW."planVersionId", NEW."userId")
    IS DISTINCT FROM (OLD."merchantRef", OLD."idempotencyKey", OLD."currencyCode", OLD."totalMinor", OLD."planVersionId", OLD."userId") THEN
    RAISE EXCEPTION 'order identity and amount are immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'PAID' AND (NEW."paidAt" IS NULL OR NOT EXISTS (
    SELECT 1 FROM app."PaymentAttempt" WHERE "orderId" = NEW.id AND status = 'VERIFIED')) THEN
    RAISE EXCEPTION 'paid order requires verified payment' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER order_guard BEFORE INSERT OR UPDATE ON app."Order" FOR EACH ROW EXECUTE FUNCTION app.guard_order();

CREATE FUNCTION app.guard_gateway_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."processedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'processed gateway event is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.provider, NEW."providerEventId", NEW."payloadHash")
    IS DISTINCT FROM (OLD.provider, OLD."providerEventId", OLD."payloadHash") THEN
    RAISE EXCEPTION 'gateway event identity is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER gateway_event_guard BEFORE UPDATE ON app."GatewayEvent" FOR EACH ROW EXECUTE FUNCTION app.guard_gateway_event();

CREATE FUNCTION app.guard_invoice() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o record;
BEGIN
  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN RAISE EXCEPTION 'issued invoice is immutable' USING ERRCODE = '23514'; END IF;
  SELECT status, "totalMinor", "currencyCode" INTO o FROM app."Order" WHERE id = NEW."orderId";
  IF o.status <> 'PAID' OR NEW."totalMinor" <> o."totalMinor" OR NEW."currencyCode" <> o."currencyCode" THEN
    RAISE EXCEPTION 'invoice must match paid order' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER invoice_guard BEFORE INSERT OR UPDATE OR DELETE ON app."Invoice" FOR EACH ROW EXECUTE FUNCTION app.guard_invoice();

CREATE FUNCTION app.guard_entitlement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o record; m record; t record;
BEGIN
  IF NEW.status = 'ACTIVE' THEN
    IF NEW.source = 'PAID' THEN
      SELECT "userId", status INTO o FROM app."Order" WHERE id = NEW."orderId";
      IF NEW."orderId" IS NULL OR o."userId" IS DISTINCT FROM NEW."userId" OR o.status <> 'PAID' THEN
        RAISE EXCEPTION 'paid entitlement requires matching paid order' USING ERRCODE = '23514';
      END IF;
    ELSIF NEW.source = 'TRIAL' THEN
      SELECT "userId", "startsAt", "endsAt" INTO t FROM app."TrialUsage" WHERE id = NEW."trialUsageId";
      IF NEW."trialUsageId" IS NULL OR t."userId" IS DISTINCT FROM NEW."userId" OR NEW."startsAt" < t."startsAt" OR NEW."endsAt" > t."endsAt" THEN
        RAISE EXCEPTION 'trial entitlement must fit matching trial' USING ERRCODE = '23514';
      END IF;
    ELSIF NEW.source = 'INSTITUTION' THEN
      SELECT m."userId", m.status, m."expiresAt", i.status AS institution_status INTO m
      FROM app."Membership" m JOIN app."Institution" i ON i.id = m."institutionId" WHERE m.id = NEW."membershipId";
      IF NEW."membershipId" IS NULL OR m."userId" IS DISTINCT FROM NEW."userId" OR m.status <> 'VERIFIED'
        OR m.institution_status <> 'APPROVED' OR (m."expiresAt" IS NOT NULL AND (m."expiresAt" <= now() OR NEW."endsAt" > m."expiresAt")) THEN
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
CREATE TRIGGER entitlement_guard BEFORE INSERT OR UPDATE ON app."Entitlement" FOR EACH ROW EXECUTE FUNCTION app.guard_entitlement();

CREATE VIEW app."EffectiveEntitlement" AS
SELECT e.* FROM app."Entitlement" e
JOIN app."User" u ON u.id = e."userId"
LEFT JOIN app."Order" o ON o.id = e."orderId"
LEFT JOIN app."Membership" m ON m.id = e."membershipId"
LEFT JOIN app."Institution" i ON i.id = m."institutionId"
WHERE e.status = 'ACTIVE' AND e."revokedAt" IS NULL AND e."startsAt" <= now()
  AND (e."endsAt" IS NULL OR e."endsAt" > now()) AND u.status = 'ACTIVE'
  AND (e.source <> 'PAID' OR o.status = 'PAID')
  AND (e.source <> 'INSTITUTION' OR (m.status = 'VERIFIED' AND i.status = 'APPROVED'
    AND (m."expiresAt" IS NULL OR m."expiresAt" > now())));

CREATE VIEW app."PublicInsightSnapshot" WITH (security_barrier = true) AS
SELECT id, "snapshotKey", "minimumGroupSize", "publishedAt"
FROM research."PublicInsight" WHERE "withdrawnAt" IS NULL;

CREATE FUNCTION app.guard_refund_total() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE paid bigint; already bigint;
BEGIN
  IF NEW.status IN ('APPROVED', 'SUBMITTED', 'SETTLED') THEN
    SELECT "amountMinor" INTO paid FROM app."PaymentAttempt" WHERE id = NEW."paymentAttemptId" AND status = 'VERIFIED' FOR UPDATE;
    SELECT COALESCE(sum("amountMinor"), 0) INTO already FROM app."Refund"
      WHERE "paymentAttemptId" = NEW."paymentAttemptId" AND id <> NEW.id AND status IN ('APPROVED', 'SUBMITTED', 'SETTLED');
    IF paid IS NULL OR already + NEW."amountMinor" > paid THEN
      RAISE EXCEPTION 'refunds exceed verified payment amount' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER refund_total_guard BEFORE INSERT OR UPDATE ON app."Refund" FOR EACH ROW EXECUTE FUNCTION app.guard_refund_total();

-- Optional analytics must name a versioned purpose; public release requires approval.
CREATE FUNCTION research.guard_event_purpose() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE optional_purpose boolean;
BEGIN
  SELECT optional INTO optional_purpose FROM app."ProcessingPurpose" WHERE id = NEW."purposeId";
  IF optional_purpose AND NEW."consentVersion" IS NULL THEN
    RAISE EXCEPTION 'optional research event requires consent version' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER research_event_purpose BEFORE INSERT OR UPDATE ON research."ResearchEvent" FOR EACH ROW EXECUTE FUNCTION research.guard_event_purpose();

CREATE FUNCTION research.guard_public_insight() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rev record; pol record; exception_ok boolean;
BEGIN
  SELECT "reportId", "reviewerId", decision, "minimumGroupSize", "suppressionProof", "differencingProof" INTO rev
    FROM research."DisclosureReview" WHERE id = NEW."reviewId";
  SELECT "minimumGroupSize", "approvedAt" INTO pol FROM research."ResearchDisclosurePolicy" WHERE id = NEW."policyId";
  SELECT EXISTS (SELECT 1 FROM app."ApprovalRequest" WHERE id = NEW."exceptionApprovalId"
    AND kind = 'PUBLIC_INSIGHT_SINGLE_APPROVER' AND status = 'EXCEPTION' AND length(btrim(reason)) > 0) INTO exception_ok;
  IF rev."reportId" IS DISTINCT FROM NEW."reportId" OR rev.decision <> 'APPROVED'
    OR pol."approvedAt" IS NULL OR NEW."minimumGroupSize" < pol."minimumGroupSize"
    OR rev."minimumGroupSize" < pol."minimumGroupSize"
    OR rev."suppressionProof"->>'passed' IS DISTINCT FROM 'true'
    OR rev."differencingProof"->>'passed' IS DISTINCT FROM 'true'
    OR (rev."reviewerId" = NEW."publishedById" AND NOT exception_ok) THEN
    RAISE EXCEPTION 'public insight lacks approved disclosure and independent release' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER public_insight_guard BEFORE INSERT OR UPDATE ON research."PublicInsight" FOR EACH ROW EXECUTE FUNCTION research.guard_public_insight();

CREATE FUNCTION app.prevent_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit/event history is append-only' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON app."AuditEvent" FOR EACH ROW EXECUTE FUNCTION app.prevent_audit_mutation();
CREATE TRIGGER entitlement_event_append_only BEFORE UPDATE OR DELETE ON app."EntitlementEvent" FOR EACH ROW EXECUTE FUNCTION app.prevent_audit_mutation();
CREATE TRIGGER research_audit_append_only BEFORE UPDATE OR DELETE ON research."ResearchAudit" FOR EACH ROW EXECUTE FUNCTION app.prevent_audit_mutation();

COMMENT ON SCHEMA research_private IS 'Direct identity to research pseudonym links; only the dedicated mapping service role may access.';
COMMENT ON VIEW app."EffectiveEntitlement" IS 'Time-aware grants only; resource status and action policy still require server-side authorization.';
COMMENT ON VIEW app."PublicInsightSnapshot" IS 'Approved, non-withdrawn public snapshot references only; never raw event data.';
