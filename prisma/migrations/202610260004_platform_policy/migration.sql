-- Additive configuration history. No existing table or data is removed.
CREATE TABLE app."PlatformPolicyVersion" (
  id uuid PRIMARY KEY,
  version integer NOT NULL UNIQUE,
  status varchar(24) NOT NULL DEFAULT 'DRAFT',
  settings jsonb NOT NULL,
  reason varchar(1000) NOT NULL,
  "sourceVersion" integer,
  "baseVersion" integer NOT NULL DEFAULT 0,
  "createdById" uuid NOT NULL REFERENCES app."User"(id) ON DELETE RESTRICT,
  "lastEditedById" uuid NOT NULL REFERENCES app."User"(id) ON DELETE RESTRICT,
  "approvedById" uuid REFERENCES app."User"(id) ON DELETE RESTRICT,
  "createdAt" timestamptz(6) NOT NULL DEFAULT now(),
  "approvedAt" timestamptz(6),
  "effectiveAt" timestamptz(6),
  "activatedAt" timestamptz(6),
  "supersededAt" timestamptz(6),
  CONSTRAINT "PlatformPolicyVersion_version_check" CHECK (version > 0),
  CONSTRAINT "PlatformPolicyVersion_baseVersion_check" CHECK ("baseVersion" >= 0 AND "baseVersion" < version),
  CONSTRAINT "PlatformPolicyVersion_status_check" CHECK (status IN ('DRAFT','PENDING','APPROVED','ACTIVE','SUPERSEDED','REJECTED')),
  CONSTRAINT "PlatformPolicyVersion_state_check" CHECK (
    (status IN ('DRAFT','PENDING','REJECTED') AND "approvedAt" IS NULL AND "approvedById" IS NULL AND "effectiveAt" IS NULL AND "activatedAt" IS NULL AND "supersededAt" IS NULL)
    OR (status='APPROVED' AND "approvedAt" IS NOT NULL AND "approvedById" IS NOT NULL AND "effectiveAt" IS NOT NULL AND "activatedAt" IS NULL AND "supersededAt" IS NULL)
    OR (status='ACTIVE' AND "approvedAt" IS NOT NULL AND "approvedById" IS NOT NULL AND "effectiveAt" IS NOT NULL AND "activatedAt" IS NOT NULL AND "supersededAt" IS NULL)
    OR (status='SUPERSEDED' AND "approvedAt" IS NOT NULL AND "approvedById" IS NOT NULL AND "activatedAt" IS NOT NULL AND "supersededAt" IS NOT NULL)
  ),
  CONSTRAINT "PlatformPolicyVersion_independent_approval_check" CHECK ("approvedById" IS NULL OR ("approvedById" <> "createdById" AND "approvedById" <> "lastEditedById"))
);
CREATE UNIQUE INDEX "PlatformPolicyVersion_one_active" ON app."PlatformPolicyVersion" (status) WHERE status='ACTIVE';
CREATE INDEX "PlatformPolicyVersion_status_effectiveAt_idx" ON app."PlatformPolicyVersion" (status,"effectiveAt");

CREATE TABLE app."PlatformPolicyEvent" (
  id uuid PRIMARY KEY,
  "policyId" uuid NOT NULL REFERENCES app."PlatformPolicyVersion"(id) ON DELETE RESTRICT,
  "actorId" uuid NOT NULL REFERENCES app."User"(id) ON DELETE RESTRICT,
  action varchar(32) NOT NULL,
  reason varchar(1000) NOT NULL,
  "beforeHash" varchar(64),
  "afterHash" varchar(64),
  "correlationId" varchar(120) NOT NULL,
  "occurredAt" timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "PlatformPolicyEvent_action_check" CHECK (action IN ('CREATE','EDIT','SUBMIT','APPROVE','REJECT','ACTIVATE','ROLLBACK'))
);
CREATE INDEX "PlatformPolicyEvent_policy_time_idx" ON app."PlatformPolicyEvent" ("policyId","occurredAt");

CREATE FUNCTION app.platform_policy_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Platform policy history cannot be deleted'; END IF;
  IF OLD.status <> 'DRAFT' AND OLD.settings IS DISTINCT FROM NEW.settings THEN
    RAISE EXCEPTION 'Submitted platform policy settings are immutable';
  END IF;
  IF OLD.status <> 'DRAFT' AND OLD."lastEditedById" IS DISTINCT FROM NEW."lastEditedById" THEN
    RAISE EXCEPTION 'Submitted platform policy editor is immutable';
  END IF;
  IF OLD.id IS DISTINCT FROM NEW.id OR OLD.version IS DISTINCT FROM NEW.version
    OR OLD."createdById" IS DISTINCT FROM NEW."createdById" OR OLD."createdAt" IS DISTINCT FROM NEW."createdAt"
    OR OLD.reason IS DISTINCT FROM NEW.reason OR OLD."sourceVersion" IS DISTINCT FROM NEW."sourceVersion"
    OR OLD."baseVersion" IS DISTINCT FROM NEW."baseVersion" THEN
    RAISE EXCEPTION 'Platform policy identity and origin are immutable';
  END IF;
  IF NOT (
    (OLD.status='DRAFT' AND NEW.status IN ('DRAFT','PENDING')) OR
    (OLD.status='PENDING' AND NEW.status IN ('APPROVED','REJECTED')) OR
    (OLD.status='APPROVED' AND NEW.status='ACTIVE') OR
    (OLD.status='ACTIVE' AND NEW.status='SUPERSEDED')
  ) THEN RAISE EXCEPTION 'Invalid platform policy transition'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "PlatformPolicyVersion_immutable" BEFORE UPDATE OR DELETE ON app."PlatformPolicyVersion"
  FOR EACH ROW EXECUTE FUNCTION app.platform_policy_immutable();
CREATE FUNCTION app.platform_policy_event_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Platform policy events are append-only'; END $$;
CREATE TRIGGER "PlatformPolicyEvent_immutable" BEFORE UPDATE OR DELETE ON app."PlatformPolicyEvent"
  FOR EACH ROW EXECUTE FUNCTION app.platform_policy_event_immutable();

INSERT INTO app."Permission" (id,code,description) VALUES
  (gen_random_uuid(),'PLATFORM_POLICY_READ','Read platform policy and history'),
  (gen_random_uuid(),'PLATFORM_POLICY_MANAGE','Draft and submit platform policy'),
  (gen_random_uuid(),'PLATFORM_POLICY_APPROVE','Independently approve and activate platform policy')
ON CONFLICT (code) DO NOTHING;
INSERT INTO app."RolePermission" ("roleId","permissionId")
SELECT r.id,p.id FROM app."Role" r CROSS JOIN app."Permission" p
WHERE r.code='SYSTEM_ADMIN' AND p.code LIKE 'PLATFORM_POLICY_%'
ON CONFLICT DO NOTHING;
