-- CreateEnum
CREATE TYPE "app"."UploadStatus" AS ENUM ('INITIATED', 'RECEIVING', 'QUEUED', 'PROCESSING', 'CLEAN', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "app"."ProcessingStatus" AS ENUM ('QUEUED', 'RUNNING', 'RETRY', 'COMPLETE', 'FAILED');

-- CreateEnum
CREATE TYPE "app"."ImportStatus" AS ENUM ('PREVIEWING', 'READY', 'CONFIRMED', 'PROCESSING', 'COMPLETE', 'FAILED');

-- CreateEnum
CREATE TYPE "app"."ScheduleAction" AS ENUM ('PUBLISH', 'WITHDRAW');

-- CreateEnum
CREATE TYPE "app"."ScheduleStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETE', 'FAILED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "app"."AssetStatus" ADD VALUE 'APPROVED';
ALTER TYPE "app"."AssetStatus" ADD VALUE 'ARCHIVED';
ALTER TYPE "app"."AssetStatus" ADD VALUE 'DELETED';

-- AlterTable
ALTER TABLE "app"."Asset" ADD COLUMN     "approvedAt" TIMESTAMPTZ(6),
ADD COLUMN     "attribution" TEXT,
ADD COLUMN     "copyrightNotice" TEXT,
ADD COLUMN     "licenceCode" VARCHAR(100),
ADD COLUMN     "permissionConfirmedAt" TIMESTAMPTZ(6),
ADD COLUMN     "provenanceRef" VARCHAR(500),
ADD COLUMN     "replacementOfId" UUID;

-- AlterTable
ALTER TABLE "app"."Chapter" ADD COLUMN     "learningOutcomes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "prerequisites" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "summary" TEXT;

-- AlterTable
ALTER TABLE "app"."Collection" ADD COLUMN     "libraryId" UUID;

-- AlterTable
ALTER TABLE "app"."Edition" ADD COLUMN     "isbn13" VARCHAR(13),
ADD COLUMN     "publicationDate" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "app"."Lesson" ADD COLUMN     "blocks" JSONB,
ADD COLUMN     "bodyMarkdown" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "app"."Publication" ADD COLUMN     "languageCode" VARCHAR(35),
ADD COLUMN     "sourceRef" VARCHAR(500);

-- AlterTable
ALTER TABLE "app"."Revision" ADD COLUMN     "correctionNotice" TEXT,
ADD COLUMN     "createdById" UUID,
ADD COLUMN     "publishedById" UUID,
ADD COLUMN     "scheduledAt" TIMESTAMPTZ(6),
ADD COLUMN     "submittedAt" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "app"."Library" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(200) NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Library_pkey" PRIMARY KEY ("id")
);

-- Preserve existing collections under the application library without inventing publications.
INSERT INTO "app"."Library" ("id", "slug", "title")
VALUES (gen_random_uuid(), 'arata-techlibrary', 'Arata TechLibrary');
UPDATE "app"."Collection"
SET "libraryId" = (SELECT "id" FROM "app"."Library" WHERE "slug" = 'arata-techlibrary')
WHERE "libraryId" IS NULL;
ALTER TABLE "app"."Collection" ALTER COLUMN "libraryId" SET NOT NULL;
ALTER TABLE "app"."Chapter" ALTER COLUMN "learningOutcomes" SET NOT NULL;
ALTER TABLE "app"."Chapter" ALTER COLUMN "prerequisites" SET NOT NULL;

-- CreateTable
CREATE TABLE "app"."BibliographyEntry" (
    "id" UUID NOT NULL,
    "revisionId" UUID NOT NULL,
    "citationKey" VARCHAR(120) NOT NULL,
    "citationText" TEXT NOT NULL,
    "url" VARCHAR(2000),
    "ordinal" INTEGER NOT NULL,

    CONSTRAINT "BibliographyEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."CrossReference" (
    "id" UUID NOT NULL,
    "sourceLessonId" UUID NOT NULL,
    "targetPublicationId" UUID,
    "targetChapterId" UUID,
    "targetLessonId" UUID,
    "label" VARCHAR(300) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrossReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."RightsAttestation" (
    "id" UUID NOT NULL,
    "publicationId" UUID NOT NULL,
    "revisionId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "manifestHash" VARCHAR(128) NOT NULL,
    "licenceCode" VARCHAR(100) NOT NULL,
    "sourceRef" VARCHAR(500) NOT NULL,
    "attestedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(6),

    CONSTRAINT "RightsAttestation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."RevisionErratum" (
    "id" UUID NOT NULL,
    "revisionId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "notice" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RevisionErratum_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."UploadSession" (
    "id" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "publicationId" UUID,
    "originalName" VARCHAR(400) NOT NULL,
    "declaredMime" VARCHAR(160) NOT NULL,
    "expectedSize" BIGINT NOT NULL,
    "expectedSha256" VARCHAR(64) NOT NULL,
    "receivedSize" BIGINT NOT NULL DEFAULT 0,
    "privateKey" VARCHAR(500) NOT NULL,
    "idempotencyKey" VARCHAR(160) NOT NULL,
    "status" "app"."UploadStatus" NOT NULL DEFAULT 'INITIATED',
    "assetId" UUID,
    "failureCode" VARCHAR(100),
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UploadSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."AssetProcessingJob" (
    "id" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "status" "app"."ProcessingStatus" NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMPTZ(6),
    "failureCode" VARCHAR(100),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetProcessingJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."ImportJob" (
    "id" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "editionId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "idempotencyKey" VARCHAR(160) NOT NULL,
    "status" "app"."ImportStatus" NOT NULL DEFAULT 'PREVIEWING',
    "preview" JSONB,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "failureCode" VARCHAR(100),
    "confirmedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."PublicationSchedule" (
    "id" UUID NOT NULL,
    "publicationId" UUID NOT NULL,
    "revisionId" UUID,
    "requestedById" UUID NOT NULL,
    "action" "app"."ScheduleAction" NOT NULL,
    "status" "app"."ScheduleStatus" NOT NULL DEFAULT 'PENDING',
    "scheduledAt" TIMESTAMPTZ(6) NOT NULL,
    "leaseUntil" TIMESTAMPTZ(6),
    "completedAt" TIMESTAMPTZ(6),
    "failureCode" VARCHAR(100),
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicationSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Library_slug_key" ON "app"."Library"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "BibliographyEntry_revisionId_citationKey_key" ON "app"."BibliographyEntry"("revisionId", "citationKey");

-- CreateIndex
CREATE UNIQUE INDEX "BibliographyEntry_revisionId_ordinal_key" ON "app"."BibliographyEntry"("revisionId", "ordinal");

-- CreateIndex
CREATE INDEX "CrossReference_sourceLessonId_idx" ON "app"."CrossReference"("sourceLessonId");

-- CreateIndex
CREATE INDEX "RightsAttestation_revisionId_manifestHash_revokedAt_idx" ON "app"."RightsAttestation"("revisionId", "manifestHash", "revokedAt");

-- CreateIndex
CREATE INDEX "RevisionErratum_revisionId_createdAt_idx" ON "app"."RevisionErratum"("revisionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "UploadSession_privateKey_key" ON "app"."UploadSession"("privateKey");

-- CreateIndex
CREATE UNIQUE INDEX "UploadSession_assetId_key" ON "app"."UploadSession"("assetId");

-- CreateIndex
CREATE INDEX "UploadSession_status_expiresAt_idx" ON "app"."UploadSession"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "UploadSession_actorId_idempotencyKey_key" ON "app"."UploadSession"("actorId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "AssetProcessingJob_assetId_key" ON "app"."AssetProcessingJob"("assetId");

-- CreateIndex
CREATE INDEX "AssetProcessingJob_status_nextAttemptAt_idx" ON "app"."AssetProcessingJob"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "ImportJob_status_createdAt_idx" ON "app"."ImportJob"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ImportJob_actorId_idempotencyKey_key" ON "app"."ImportJob"("actorId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "PublicationSchedule_status_scheduledAt_idx" ON "app"."PublicationSchedule"("status", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "Edition_isbn13_key" ON "app"."Edition"("isbn13");

-- AddForeignKey
ALTER TABLE "app"."Collection" ADD CONSTRAINT "Collection_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "app"."Library"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."Revision" ADD CONSTRAINT "Revision_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "app"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."Revision" ADD CONSTRAINT "Revision_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "app"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."BibliographyEntry" ADD CONSTRAINT "BibliographyEntry_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "app"."Revision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."CrossReference" ADD CONSTRAINT "CrossReference_sourceLessonId_fkey" FOREIGN KEY ("sourceLessonId") REFERENCES "app"."Lesson"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."CrossReference" ADD CONSTRAINT "CrossReference_targetPublicationId_fkey" FOREIGN KEY ("targetPublicationId") REFERENCES "app"."Publication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."CrossReference" ADD CONSTRAINT "CrossReference_targetChapterId_fkey" FOREIGN KEY ("targetChapterId") REFERENCES "app"."Chapter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."CrossReference" ADD CONSTRAINT "CrossReference_targetLessonId_fkey" FOREIGN KEY ("targetLessonId") REFERENCES "app"."Lesson"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."RightsAttestation" ADD CONSTRAINT "RightsAttestation_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "app"."Publication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."RightsAttestation" ADD CONSTRAINT "RightsAttestation_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "app"."Revision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."RightsAttestation" ADD CONSTRAINT "RightsAttestation_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "app"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."RevisionErratum" ADD CONSTRAINT "RevisionErratum_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "app"."Revision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."RevisionErratum" ADD CONSTRAINT "RevisionErratum_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "app"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."Asset" ADD CONSTRAINT "Asset_replacementOfId_fkey" FOREIGN KEY ("replacementOfId") REFERENCES "app"."Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."UploadSession" ADD CONSTRAINT "UploadSession_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "app"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."UploadSession" ADD CONSTRAINT "UploadSession_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "app"."Publication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."UploadSession" ADD CONSTRAINT "UploadSession_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "app"."Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."AssetProcessingJob" ADD CONSTRAINT "AssetProcessingJob_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "app"."Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ImportJob" ADD CONSTRAINT "ImportJob_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "app"."Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ImportJob" ADD CONSTRAINT "ImportJob_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "app"."Edition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ImportJob" ADD CONSTRAINT "ImportJob_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "app"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."PublicationSchedule" ADD CONSTRAINT "PublicationSchedule_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "app"."Publication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."PublicationSchedule" ADD CONSTRAINT "PublicationSchedule_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "app"."Revision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."PublicationSchedule" ADD CONSTRAINT "PublicationSchedule_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "app"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Prisma cannot express these cross-row publishing and upload invariants.
ALTER TABLE app."Edition" ADD CONSTRAINT publishing_isbn13_format
  CHECK ("isbn13" IS NULL OR "isbn13" ~ '^[0-9]{13}$');
ALTER TABLE app."Publication" ADD CONSTRAINT publishing_language_format
  CHECK ("languageCode" IS NULL OR "languageCode" ~ '^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$');
ALTER TABLE app."Lesson" ADD CONSTRAINT publishing_blocks_array
  CHECK (blocks IS NULL OR jsonb_typeof(blocks) = 'array');
ALTER TABLE app."CrossReference" ADD CONSTRAINT publishing_reference_target
  CHECK (num_nonnulls("targetPublicationId", "targetChapterId", "targetLessonId") = 1);
ALTER TABLE app."BibliographyEntry" ADD CONSTRAINT publishing_bibliography_order
  CHECK (ordinal > 0);
ALTER TABLE app."RightsAttestation" ADD CONSTRAINT publishing_rights_hash
  CHECK ("manifestHash" ~ '^[0-9a-f]{64}$' AND length(btrim("licenceCode")) > 0 AND length(btrim("sourceRef")) > 0);
ALTER TABLE app."UploadSession" ADD CONSTRAINT publishing_upload_limits
  CHECK ("expectedSize" > 0 AND "receivedSize" >= 0 AND "receivedSize" <= "expectedSize"
    AND "expectedSha256" ~ '^[0-9a-f]{64}$' AND "expiresAt" > "createdAt");
ALTER TABLE app."AssetProcessingJob" ADD CONSTRAINT publishing_processing_progress
  CHECK (progress BETWEEN 0 AND 100 AND attempts >= 0);
ALTER TABLE app."ImportJob" ADD CONSTRAINT publishing_import_progress
  CHECK (progress BETWEEN 0 AND 100);
ALTER TABLE app."PublicationSchedule" ADD CONSTRAINT publishing_schedule_target
  CHECK ((action = 'PUBLISH' AND "revisionId" IS NOT NULL)
    OR (action = 'WITHDRAW' AND "revisionId" IS NULL));

CREATE FUNCTION app.guard_rights_attestation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM app."Revision" r JOIN app."Edition" e ON e.id = r."editionId"
    WHERE r.id = NEW."revisionId" AND e."publicationId" = NEW."publicationId"
      AND r."manifestHash" = NEW."manifestHash"
  ) THEN RAISE EXCEPTION 'rights attestation must match exact revision and publication' USING ERRCODE = '23514'; END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW."revisionId" <> OLD."revisionId" OR NEW."publicationId" <> OLD."publicationId"
    OR NEW."manifestHash" <> OLD."manifestHash" OR NEW."actorId" <> OLD."actorId"
    OR NEW."sourceRef" <> OLD."sourceRef" OR NEW."licenceCode" <> OLD."licenceCode"
  ) THEN RAISE EXCEPTION 'rights evidence is append-only except revocation' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER rights_attestation_guard BEFORE INSERT OR UPDATE ON app."RightsAttestation"
  FOR EACH ROW EXECUTE FUNCTION app.guard_rights_attestation();

CREATE FUNCTION app.guard_publishing_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pub record;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'APPROVED' AND (
      NEW.status <> 'PUBLISHED' OR
      (to_jsonb(NEW) - 'status' - 'publishedAt' - 'publishedById') <>
      (to_jsonb(OLD) - 'status' - 'publishedAt' - 'publishedById')
    ) THEN RAISE EXCEPTION 'approved revision may only be published' USING ERRCODE = '23514'; END IF;
    IF NOT (
      (OLD.status = 'DRAFT' AND NEW.status IN ('DRAFT','IN_REVIEW')) OR
      (OLD.status = 'IN_REVIEW' AND NEW.status IN ('IN_REVIEW','DRAFT','APPROVED','REJECTED')) OR
      (OLD.status = 'APPROVED' AND NEW.status = 'PUBLISHED') OR
      (OLD.status = 'REJECTED' AND NEW.status = 'REJECTED') OR
      (OLD.status = 'PUBLISHED' AND NEW.status = 'PUBLISHED')
    ) THEN RAISE EXCEPTION 'invalid editorial state transition' USING ERRCODE = '23514'; END IF;
  END IF;
  IF NEW.status IN ('IN_REVIEW','APPROVED','PUBLISHED') AND NEW."manifestHash" IS NULL THEN
    RAISE EXCEPTION 'review requires a content manifest' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'APPROVED' AND NOT EXISTS (
    SELECT 1 FROM app."EditorialReview" er
    WHERE er."revisionId" = NEW.id AND er.decision = 'APPROVED'
      AND er."manifestHash" = NEW."manifestHash"
      AND (NEW."createdById" IS NULL OR er."reviewerId" <> NEW."createdById")
  ) THEN RAISE EXCEPTION 'approval requires a distinct exact-manifest reviewer' USING ERRCODE = '23514'; END IF;
  IF NEW.status = 'PUBLISHED' THEN
    SELECT p.id,p."languageCode",p."sourceRef",p."copyrightNotice",p."licenceCode"
      INTO pub FROM app."Edition" e JOIN app."Publication" p ON p.id=e."publicationId"
      WHERE e.id=NEW."editionId";
    IF NEW."publishedById" IS NULL OR pub."languageCode" IS NULL OR pub."sourceRef" IS NULL
       OR pub."copyrightNotice" IS NULL OR pub."licenceCode" IS NULL
       OR NOT EXISTS (SELECT 1 FROM app."PublicationContributor" pc WHERE pc."publicationId"=pub.id AND pc.role='AUTHOR')
    THEN RAISE EXCEPTION 'published revision requires publisher and bibliographic metadata' USING ERRCODE = '23514'; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM app."RightsAttestation" ra WHERE ra."revisionId"=NEW.id
        AND ra."publicationId"=pub.id AND ra."manifestHash"=NEW."manifestHash"
        AND ra."revokedAt" IS NULL
    ) THEN RAISE EXCEPTION 'published revision requires exact-manifest rights evidence' USING ERRCODE = '23514'; END IF;
    IF EXISTS (
      SELECT 1 FROM app."Lesson" l JOIN app."Chapter" c ON c.id=l."chapterId"
      JOIN app."Asset" a ON a.id=l."bodyAssetId"
      WHERE c."revisionId"=NEW.id AND (a.status <> 'APPROVED' OR a."permissionConfirmedAt" IS NULL)
    ) OR EXISTS (
      SELECT 1 FROM app."ResourceAttachment" ra JOIN app."Resource" res ON res.id=ra."resourceId"
      LEFT JOIN app."Chapter" c ON c.id=res."chapterId"
      LEFT JOIN app."Lesson" l ON l.id=res."lessonId"
      LEFT JOIN app."Chapter" lc ON lc.id=l."chapterId"
      JOIN app."Asset" a ON a.id=ra."assetId"
      WHERE COALESCE(res."revisionId",c."revisionId",lc."revisionId")=NEW.id
        AND (a.status <> 'APPROVED' OR a."permissionConfirmedAt" IS NULL)
    ) THEN RAISE EXCEPTION 'published revision references an unapproved asset' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER publishing_revision_gate BEFORE INSERT OR UPDATE ON app."Revision"
  FOR EACH ROW EXECUTE FUNCTION app.guard_publishing_revision();

CREATE FUNCTION app.guard_frozen_manuscript_child() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_revision uuid; prior_revision uuid;
BEGIN
  IF TG_TABLE_NAME IN ('Chapter','BibliographyEntry') THEN
    IF TG_OP <> 'DELETE' THEN target_revision := NEW."revisionId"; END IF;
    IF TG_OP <> 'INSERT' THEN prior_revision := OLD."revisionId"; END IF;
  ELSIF TG_TABLE_NAME = 'Lesson' THEN
    IF TG_OP <> 'DELETE' THEN SELECT "revisionId" INTO target_revision FROM app."Chapter" WHERE id=NEW."chapterId"; END IF;
    IF TG_OP <> 'INSERT' THEN SELECT "revisionId" INTO prior_revision FROM app."Chapter" WHERE id=OLD."chapterId"; END IF;
  ELSIF TG_TABLE_NAME = 'CrossReference' THEN
    IF TG_OP <> 'DELETE' THEN SELECT c."revisionId" INTO target_revision FROM app."Lesson" l JOIN app."Chapter" c ON c.id=l."chapterId" WHERE l.id=NEW."sourceLessonId"; END IF;
    IF TG_OP <> 'INSERT' THEN SELECT c."revisionId" INTO prior_revision FROM app."Lesson" l JOIN app."Chapter" c ON c.id=l."chapterId" WHERE l.id=OLD."sourceLessonId"; END IF;
  ELSIF TG_TABLE_NAME = 'Resource' THEN
    IF TG_OP <> 'DELETE' THEN
      target_revision := NEW."revisionId";
      IF target_revision IS NULL AND NEW."chapterId" IS NOT NULL THEN SELECT "revisionId" INTO target_revision FROM app."Chapter" WHERE id=NEW."chapterId"; END IF;
      IF target_revision IS NULL AND NEW."lessonId" IS NOT NULL THEN SELECT c."revisionId" INTO target_revision FROM app."Lesson" l JOIN app."Chapter" c ON c.id=l."chapterId" WHERE l.id=NEW."lessonId"; END IF;
    END IF;
    IF TG_OP <> 'INSERT' THEN
      prior_revision := OLD."revisionId";
      IF prior_revision IS NULL AND OLD."chapterId" IS NOT NULL THEN SELECT "revisionId" INTO prior_revision FROM app."Chapter" WHERE id=OLD."chapterId"; END IF;
      IF prior_revision IS NULL AND OLD."lessonId" IS NOT NULL THEN SELECT c."revisionId" INTO prior_revision FROM app."Lesson" l JOIN app."Chapter" c ON c.id=l."chapterId" WHERE l.id=OLD."lessonId"; END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'ResourceAttachment' THEN
    IF TG_OP <> 'DELETE' THEN SELECT COALESCE(res."revisionId",c."revisionId",lc."revisionId") INTO target_revision FROM app."Resource" res LEFT JOIN app."Chapter" c ON c.id=res."chapterId" LEFT JOIN app."Lesson" l ON l.id=res."lessonId" LEFT JOIN app."Chapter" lc ON lc.id=l."chapterId" WHERE res.id=NEW."resourceId"; END IF;
    IF TG_OP <> 'INSERT' THEN SELECT COALESCE(res."revisionId",c."revisionId",lc."revisionId") INTO prior_revision FROM app."Resource" res LEFT JOIN app."Chapter" c ON c.id=res."chapterId" LEFT JOIN app."Lesson" l ON l.id=res."lessonId" LEFT JOIN app."Chapter" lc ON lc.id=l."chapterId" WHERE res.id=OLD."resourceId"; END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM app."Revision" WHERE id IN (target_revision,prior_revision) AND status IN ('APPROVED','PUBLISHED')) THEN
    RAISE EXCEPTION 'approved manuscript content is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER publishing_chapter_guard BEFORE INSERT OR UPDATE OR DELETE ON app."Chapter" FOR EACH ROW EXECUTE FUNCTION app.guard_frozen_manuscript_child();
CREATE TRIGGER publishing_lesson_guard BEFORE INSERT OR UPDATE OR DELETE ON app."Lesson" FOR EACH ROW EXECUTE FUNCTION app.guard_frozen_manuscript_child();
CREATE TRIGGER publishing_bibliography_guard BEFORE INSERT OR UPDATE OR DELETE ON app."BibliographyEntry" FOR EACH ROW EXECUTE FUNCTION app.guard_frozen_manuscript_child();
CREATE TRIGGER publishing_cross_reference_guard BEFORE INSERT OR UPDATE OR DELETE ON app."CrossReference" FOR EACH ROW EXECUTE FUNCTION app.guard_frozen_manuscript_child();
CREATE TRIGGER publishing_resource_guard BEFORE INSERT OR UPDATE OR DELETE ON app."Resource" FOR EACH ROW EXECUTE FUNCTION app.guard_frozen_manuscript_child();
CREATE TRIGGER publishing_resource_attachment_guard BEFORE INSERT OR UPDATE OR DELETE ON app."ResourceAttachment" FOR EACH ROW EXECUTE FUNCTION app.guard_frozen_manuscript_child();

CREATE FUNCTION app.guard_revision_erratum() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'errata are append-only' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS (SELECT 1 FROM app."Revision" WHERE id=NEW."revisionId" AND status='PUBLISHED') THEN
    RAISE EXCEPTION 'errata require a published revision' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER revision_erratum_guard BEFORE INSERT OR UPDATE OR DELETE ON app."RevisionErratum"
  FOR EACH ROW EXECUTE FUNCTION app.guard_revision_erratum();

CREATE FUNCTION app.guard_asset_binary_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."storageKey" <> OLD."storageKey" OR NEW.sha256 <> OLD.sha256 OR
     NEW."sizeBytes" <> OLD."sizeBytes" OR NEW."mimeType" <> OLD."mimeType" OR
     NEW."uploadedById" <> OLD."uploadedById" THEN
    RAISE EXCEPTION 'asset binary identity is immutable; create a replacement asset' USING ERRCODE='23514';
  END IF;
  IF NEW.status='APPROVED' AND (NEW."scannedAt" IS NULL OR NEW."scanEvidence" IS NULL
    OR NEW."permissionConfirmedAt" IS NULL OR NEW."licenceCode" IS NULL OR NEW."provenanceRef" IS NULL)
  THEN RAISE EXCEPTION 'asset approval requires scan and rights evidence' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER asset_binary_identity_guard BEFORE UPDATE ON app."Asset"
  FOR EACH ROW EXECUTE FUNCTION app.guard_asset_binary_identity();

-- The baseline guard accepted scanned CLEAN assets. Studio release additionally
-- accepts rights-approved assets, while preserving exact-review and immutability checks.
CREATE OR REPLACE FUNCTION app.guard_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' AND OLD.status = 'PUBLISHED' THEN
    RAISE EXCEPTION 'published revision is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.status = 'PUBLISHED' THEN
    IF NEW."manifestHash" IS NULL OR NEW."publishedAt" IS NULL OR NOT EXISTS (
      SELECT 1 FROM app."EditorialReview" er
      WHERE er."revisionId" = NEW.id AND er.decision = 'APPROVED'
        AND er."manifestHash" = NEW."manifestHash"
    ) THEN RAISE EXCEPTION 'publication requires approved exact manifest' USING ERRCODE = '23514'; END IF;
    IF EXISTS (
      SELECT 1 FROM app."Lesson" l JOIN app."Chapter" c ON c.id=l."chapterId"
      JOIN app."Asset" a ON a.id=l."bodyAssetId"
      WHERE c."revisionId"=NEW.id AND a.status NOT IN ('CLEAN','APPROVED')
    ) THEN RAISE EXCEPTION 'publication contains unscanned lesson asset' USING ERRCODE = '23514'; END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
