-- Additive guards for metadata included in editorial review manifests. No rows are rewritten.
CREATE FUNCTION app.assert_unreviewed_publication_metadata(target_publication uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM app."Publication" WHERE id=target_publication FOR UPDATE;
  IF EXISTS (
    SELECT 1 FROM app."Edition" e JOIN app."Revision" r ON r."editionId"=e.id
    WHERE e."publicationId"=target_publication
      AND r.status IN ('IN_REVIEW','APPROVED','PUBLISHED')
  ) THEN
    RAISE EXCEPTION 'reviewed publication metadata is immutable' USING ERRCODE='23514';
  END IF;
END $$;

CREATE FUNCTION app.guard_reviewed_publication_metadata()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.title,NEW.subtitle,NEW.description,NEW.subject,NEW.keywords,
         NEW."ownerId",NEW."languageCode",NEW."licenceCode",NEW."sourceRef",NEW."copyrightNotice")
     IS DISTINCT FROM
     ROW(OLD.title,OLD.subtitle,OLD.description,OLD.subject,OLD.keywords,
         OLD."ownerId",OLD."languageCode",OLD."licenceCode",OLD."sourceRef",OLD."copyrightNotice")
  THEN PERFORM app.assert_unreviewed_publication_metadata(OLD.id);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER reviewed_publication_metadata_guard
  BEFORE UPDATE ON app."Publication" FOR EACH ROW
  EXECUTE FUNCTION app.guard_reviewed_publication_metadata();

CREATE FUNCTION app.guard_reviewed_volume_metadata()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."publicationId" IS DISTINCT FROM OLD."publicationId" THEN
    RAISE EXCEPTION 'volume parent cannot change' USING ERRCODE='23514';
  END IF;
  IF ROW(NEW.title,NEW.ordinal) IS DISTINCT FROM ROW(OLD.title,OLD.ordinal) THEN
    PERFORM 1 FROM app."Publication" WHERE id=OLD."publicationId" FOR UPDATE;
    IF NEW.ordinal IS DISTINCT FROM OLD.ordinal AND EXISTS (
      SELECT 1 FROM app."Edition" e JOIN app."Revision" r ON r."editionId"=e.id
      WHERE e."publicationId"=OLD."publicationId"
        AND r.status IN ('IN_REVIEW','APPROVED','PUBLISHED')
    ) THEN RAISE EXCEPTION 'reviewed volume order is immutable' USING ERRCODE='23514'; END IF;
    IF NEW.title IS DISTINCT FROM OLD.title AND EXISTS (
      SELECT 1 FROM app."Edition" e JOIN app."Revision" r ON r."editionId"=e.id
      WHERE e."volumeId"=OLD.id
        AND r.status IN ('IN_REVIEW','APPROVED','PUBLISHED')
    ) THEN RAISE EXCEPTION 'reviewed volume title is immutable' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER reviewed_volume_metadata_guard
  BEFORE UPDATE ON app."Volume" FOR EACH ROW
  EXECUTE FUNCTION app.guard_reviewed_volume_metadata();

CREATE FUNCTION app.guard_reviewed_edition_metadata()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW."publicationId",NEW."volumeId") IS DISTINCT FROM
     ROW(OLD."publicationId",OLD."volumeId") THEN
    RAISE EXCEPTION 'edition parent cannot change' USING ERRCODE='23514';
  END IF;
  IF ROW(NEW.ordinal,NEW."editionCode",NEW.label,NEW.isbn13,NEW."publicationDate")
     IS DISTINCT FROM
     ROW(OLD.ordinal,OLD."editionCode",OLD.label,OLD.isbn13,OLD."publicationDate")
  THEN
    PERFORM 1 FROM app."Publication" WHERE id=OLD."publicationId" FOR UPDATE;
    IF NEW.ordinal IS DISTINCT FROM OLD.ordinal AND EXISTS (
      SELECT 1 FROM app."Edition" e JOIN app."Revision" r ON r."editionId"=e.id
      WHERE e."publicationId"=OLD."publicationId"
        AND e."volumeId" IS NOT DISTINCT FROM OLD."volumeId"
        AND r.status IN ('IN_REVIEW','APPROVED','PUBLISHED')
    ) THEN RAISE EXCEPTION 'reviewed edition order is immutable' USING ERRCODE='23514'; END IF;
    IF ROW(NEW."editionCode",NEW.label,NEW.isbn13,NEW."publicationDate") IS DISTINCT FROM
       ROW(OLD."editionCode",OLD.label,OLD.isbn13,OLD."publicationDate") AND EXISTS (
      SELECT 1 FROM app."Revision" r WHERE r."editionId"=OLD.id
        AND r.status IN ('IN_REVIEW','APPROVED','PUBLISHED')
    ) THEN RAISE EXCEPTION 'reviewed edition metadata is immutable' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER reviewed_edition_metadata_guard
  BEFORE UPDATE ON app."Edition" FOR EACH ROW
  EXECUTE FUNCTION app.guard_reviewed_edition_metadata();

CREATE FUNCTION app.guard_reviewed_publication_contributor()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    PERFORM app.assert_unreviewed_publication_metadata(NEW."publicationId");
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' THEN
    PERFORM app.assert_unreviewed_publication_metadata(OLD."publicationId");
    RETURN OLD;
  END IF;
  PERFORM app.assert_unreviewed_publication_metadata(OLD."publicationId");
  IF NEW."publicationId" IS DISTINCT FROM OLD."publicationId" THEN
    PERFORM app.assert_unreviewed_publication_metadata(NEW."publicationId");
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER reviewed_publication_contributor_guard
  BEFORE INSERT OR UPDATE OR DELETE ON app."PublicationContributor" FOR EACH ROW
  EXECUTE FUNCTION app.guard_reviewed_publication_contributor();

CREATE FUNCTION app.guard_reviewed_contributor_identity()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE linked_publication uuid;
BEGIN
  IF ROW(NEW.slug,NEW."displayName") IS DISTINCT FROM
     ROW(OLD.slug,OLD."displayName") THEN
    FOR linked_publication IN
      SELECT DISTINCT "publicationId" FROM app."PublicationContributor"
      WHERE "contributorId"=OLD.id ORDER BY "publicationId"
    LOOP
      PERFORM app.assert_unreviewed_publication_metadata(linked_publication);
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER reviewed_contributor_identity_guard
  BEFORE UPDATE ON app."Contributor" FOR EACH ROW
  EXECUTE FUNCTION app.guard_reviewed_contributor_identity();

-- Reuse the existing chapter/lesson/resource guard, adding the review state to
-- the states that prohibit changes to an exact submitted manifest.
CREATE OR REPLACE FUNCTION app.guard_frozen_manuscript_child() RETURNS trigger LANGUAGE plpgsql AS $$
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
  IF EXISTS (SELECT 1 FROM app."Revision" WHERE id IN (target_revision,prior_revision) AND status IN ('IN_REVIEW','APPROVED','PUBLISHED')) THEN
    RAISE EXCEPTION 'submitted manuscript content is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
