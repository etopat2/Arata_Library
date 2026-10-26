-- Additive policy capabilities for reader actions. Existing policy rows retain
-- their nullable overrides; no content or entitlement data is rewritten.
DO $$
DECLARE scope_name text; duplicates integer;
BEGIN
  FOREACH scope_name IN ARRAY ARRAY['publicationId','volumeId','editionId','revisionId','chapterId','lessonId','resourceId'] LOOP
    EXECUTE format('SELECT count(*) FROM (SELECT %I, version FROM app."ContentPolicy" WHERE %I IS NOT NULL GROUP BY %I, version HAVING count(*) > 1) d', scope_name, scope_name, scope_name) INTO duplicates;
    IF duplicates > 0 THEN RAISE EXCEPTION 'Duplicate policy versions exist for %', scope_name; END IF;
  END LOOP;
END $$;
CREATE TYPE "app"."ScreenshotPolicyMode" AS ENUM ('ALLOW', 'WATERMARK', 'RESTRICTED_NOTICE');

ALTER TABLE app."ContentPolicy"
  ADD COLUMN "libraryId" uuid,
  ADD COLUMN "allowPreview" boolean,
  ADD COLUMN "allowSelect" boolean,
  ADD COLUMN "maxCopyChars" integer,
  ADD COLUMN "allowExportPdf" boolean,
  ADD COLUMN "allowExportEpub" boolean,
  ADD COLUMN "watermarkLabel" varchar(160),
  ADD COLUMN "screenshotMode" "app"."ScreenshotPolicyMode",
  ADD COLUMN "maxConcurrentSessions" integer,
  ADD COLUMN "licenceEndsAt" timestamptz(6);

ALTER TABLE app."ContentPolicy"
  ADD CONSTRAINT "ContentPolicy_libraryId_fkey" FOREIGN KEY ("libraryId")
    REFERENCES app."Library"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE app."ContentPolicy" DROP CONSTRAINT content_policy_one_scope;
ALTER TABLE app."ContentPolicy" ADD CONSTRAINT content_policy_one_scope
  CHECK (num_nonnulls("libraryId", "publicationId", "volumeId", "editionId",
    "revisionId", "chapterId", "lessonId", "resourceId") = 1);
ALTER TABLE app."ContentPolicy" ADD CONSTRAINT reader_policy_copy_limit
  CHECK ("maxCopyChars" IS NULL OR "maxCopyChars" BETWEEN 0 AND 100000);
ALTER TABLE app."ContentPolicy" ADD CONSTRAINT reader_policy_session_limit
  CHECK ("maxConcurrentSessions" IS NULL OR "maxConcurrentSessions" BETWEEN 1 AND 100);
ALTER TABLE app."ContentPolicy" ADD CONSTRAINT reader_policy_watermark_label
  CHECK ("watermarkLabel" IS NULL OR length(btrim("watermarkLabel")) > 0);

CREATE UNIQUE INDEX active_library_policy ON app."ContentPolicy" ("libraryId")
  WHERE "isActive" AND "libraryId" IS NOT NULL;
CREATE UNIQUE INDEX library_policy_version ON app."ContentPolicy" ("libraryId", version)
  WHERE "libraryId" IS NOT NULL;
CREATE UNIQUE INDEX publication_policy_version ON app."ContentPolicy" ("publicationId", version)
  WHERE "publicationId" IS NOT NULL;
CREATE UNIQUE INDEX volume_policy_version ON app."ContentPolicy" ("volumeId", version)
  WHERE "volumeId" IS NOT NULL;
CREATE UNIQUE INDEX edition_policy_version ON app."ContentPolicy" ("editionId", version)
  WHERE "editionId" IS NOT NULL;
CREATE UNIQUE INDEX revision_policy_version ON app."ContentPolicy" ("revisionId", version)
  WHERE "revisionId" IS NOT NULL;
CREATE UNIQUE INDEX chapter_policy_version ON app."ContentPolicy" ("chapterId", version)
  WHERE "chapterId" IS NOT NULL;
CREATE UNIQUE INDEX lesson_policy_version ON app."ContentPolicy" ("lessonId", version)
  WHERE "lessonId" IS NOT NULL;
CREATE UNIQUE INDEX resource_policy_version ON app."ContentPolicy" ("resourceId", version)
  WHERE "resourceId" IS NOT NULL;

INSERT INTO app."Permission" (id,code,description) VALUES
  (gen_random_uuid(),'CONTENT_POLICY_MANAGE','Approve and manage content access policies')
ON CONFLICT (code) DO NOTHING;
INSERT INTO app."RolePermission" ("roleId","permissionId")
SELECT r.id,p.id FROM app."Role" r CROSS JOIN app."Permission" p
WHERE r.code='SYSTEM_ADMIN' AND p.code='CONTENT_POLICY_MANAGE'
ON CONFLICT DO NOTHING;
