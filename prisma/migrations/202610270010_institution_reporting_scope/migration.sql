-- Reporting is explicitly opt-in on an independently approved agreement.
ALTER TABLE app."InstitutionAgreement" ADD COLUMN "reportingEnabled" boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION app.lock_agreement_core() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'institution agreement history is retained' USING ERRCODE='23514'; END IF;
  IF (NEW.id,NEW."institutionId",NEW."createdById",NEW.scope,NEW."publicationId",NEW."volumeId",
      NEW."memberLimit",NEW."reportingEnabled",NEW."permittedCategories",NEW."startsAt",NEW."endsAt") IS DISTINCT FROM
     (OLD.id,OLD."institutionId",OLD."createdById",OLD.scope,OLD."publicationId",OLD."volumeId",
      OLD."memberLimit",OLD."reportingEnabled",OLD."permittedCategories",OLD."startsAt",OLD."endsAt") THEN
    RAISE EXCEPTION 'institution agreement core is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.status<>'PENDING' AND (NEW."approvedById",NEW."approvedAt") IS DISTINCT FROM
    (OLD."approvedById",OLD."approvedAt") THEN
    RAISE EXCEPTION 'institution approval is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
