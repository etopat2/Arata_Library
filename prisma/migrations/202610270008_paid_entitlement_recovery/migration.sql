-- Billing owns PAID validity adjustments for grace periods and verified dispute recovery.
-- Manual, trial, promotional and institutional grants retain immutable scope and dates.
CREATE OR REPLACE FUNCTION app.entitlement_identity_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.source='PAID' THEN
    IF (NEW."userId",NEW.source,NEW.scope,NEW."collectionId",NEW."publicationId",NEW."volumeId",
        NEW."editionId",NEW."resourceId",NEW."orderId",NEW."subscriptionId",NEW."trialUsageId",
        NEW."membershipId",NEW."cohortId",NEW."campaignId",NEW."grantedById")
      IS DISTINCT FROM
       (OLD."userId",OLD.source,OLD.scope,OLD."collectionId",OLD."publicationId",OLD."volumeId",
        OLD."editionId",OLD."resourceId",OLD."orderId",OLD."subscriptionId",OLD."trialUsageId",
        OLD."membershipId",OLD."cohortId",OLD."campaignId",OLD."grantedById") THEN
      RAISE EXCEPTION 'paid entitlement identity and scope are immutable' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW."userId",NEW.source,NEW.scope,NEW."collectionId",NEW."publicationId",NEW."volumeId",
      NEW."editionId",NEW."resourceId",NEW."orderId",NEW."subscriptionId",NEW."trialUsageId",
      NEW."membershipId",NEW."cohortId",NEW."campaignId",NEW."grantedById",NEW."startsAt",NEW."endsAt")
    IS DISTINCT FROM
     (OLD."userId",OLD.source,OLD.scope,OLD."collectionId",OLD."publicationId",OLD."volumeId",
      OLD."editionId",OLD."resourceId",OLD."orderId",OLD."subscriptionId",OLD."trialUsageId",
      OLD."membershipId",OLD."cohortId",OLD."campaignId",OLD."grantedById",OLD."startsAt",OLD."endsAt") THEN
    RAISE EXCEPTION 'entitlement source, scope and dates are immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.status='REVOKED' AND NEW.status<>'REVOKED' THEN
    RAISE EXCEPTION 'revoked entitlement cannot be restored' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
