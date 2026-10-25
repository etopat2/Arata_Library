-- Restore review-state protection for chapter/lesson-linked resources after the metadata-guard migration.
-- Also correct the prior cross-reference source lookup. No rows are rewritten.
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
    IF TG_OP <> 'DELETE' THEN SELECT COALESCE(NEW."revisionId",c."revisionId",lc."revisionId") INTO target_revision FROM (SELECT 1) x LEFT JOIN app."Chapter" c ON c.id=NEW."chapterId" LEFT JOIN app."Lesson" l ON l.id=NEW."lessonId" LEFT JOIN app."Chapter" lc ON lc.id=l."chapterId"; END IF;
    IF TG_OP <> 'INSERT' THEN SELECT COALESCE(OLD."revisionId",c."revisionId",lc."revisionId") INTO prior_revision FROM (SELECT 1) x LEFT JOIN app."Chapter" c ON c.id=OLD."chapterId" LEFT JOIN app."Lesson" l ON l.id=OLD."lessonId" LEFT JOIN app."Chapter" lc ON lc.id=l."chapterId"; END IF;
  ELSIF TG_TABLE_NAME = 'ResourceAttachment' THEN
    IF TG_OP <> 'DELETE' THEN SELECT COALESCE(res."revisionId",c."revisionId",lc."revisionId") INTO target_revision FROM app."Resource" res LEFT JOIN app."Chapter" c ON c.id=res."chapterId" LEFT JOIN app."Lesson" l ON l.id=res."lessonId" LEFT JOIN app."Chapter" lc ON lc.id=l."chapterId" WHERE res.id=NEW."resourceId"; END IF;
    IF TG_OP <> 'INSERT' THEN SELECT COALESCE(res."revisionId",c."revisionId",lc."revisionId") INTO prior_revision FROM app."Resource" res LEFT JOIN app."Chapter" c ON c.id=res."chapterId" LEFT JOIN app."Lesson" l ON l.id=res."lessonId" LEFT JOIN app."Chapter" lc ON lc.id=l."chapterId" WHERE res.id=OLD."resourceId"; END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM app."Revision" WHERE id IN (target_revision,prior_revision) AND status IN ('IN_REVIEW','APPROVED','PUBLISHED')) THEN
    RAISE EXCEPTION 'reviewed manuscript content is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
