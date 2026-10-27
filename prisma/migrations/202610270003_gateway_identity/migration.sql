ALTER TABLE app."PaymentAttempt" ADD COLUMN "providerTransactionId" varchar(160);
CREATE UNIQUE INDEX "PaymentAttempt_provider_providerTransactionId_key"
  ON app."PaymentAttempt" (provider,"providerTransactionId");
CREATE OR REPLACE FUNCTION app.guard_payment_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o record;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW."orderId", NEW."amountMinor", NEW."currencyCode", NEW.provider, NEW."providerRef")
    IS DISTINCT FROM (OLD."orderId", OLD."amountMinor", OLD."currencyCode", OLD.provider, OLD."providerRef") THEN
    RAISE EXCEPTION 'payment identity and amount are immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."providerTransactionId" IS NOT NULL
    AND NEW."providerTransactionId" IS DISTINCT FROM OLD."providerTransactionId" THEN
    RAISE EXCEPTION 'provider transaction identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'VERIFIED' THEN
    SELECT "totalMinor", "currencyCode" INTO o FROM app."Order" WHERE id = NEW."orderId";
    IF NEW."verifiedAt" IS NULL OR NEW."providerTransactionId" IS NULL
      OR NEW."amountMinor" <> o."totalMinor" OR NEW."currencyCode" <> o."currencyCode"
      OR NOT EXISTS (SELECT 1 FROM app."GatewayEvent" WHERE "paymentAttemptId" = NEW.id AND "serverVerifiedAt" IS NOT NULL) THEN
      RAISE EXCEPTION 'verified payment requires matching order and server verification evidence' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- The free access plan is a catalogue rule; it never creates a paid order or renewal.
INSERT INTO app."Plan" (id,code,name,active)
VALUES (gen_random_uuid(),'FREE:LIBRARY:ALL','Free access',true) ON CONFLICT (code) DO NOTHING;
INSERT INTO app."PlanVersion" (id,"planId",version,"currencyCode","amountMinor","periodMonths","scopeKind","scopeId","termsHash","validFrom")
SELECT gen_random_uuid(),p.id,1,'UGX',0,NULL,'LIBRARY',NULL,
  encode(sha256(convert_to('SRS FR-PAY-001 public and registered free access','UTF8')),'hex'),now()
FROM app."Plan" p WHERE p.code='FREE:LIBRARY:ALL'
AND NOT EXISTS (SELECT 1 FROM app."PlanVersion" v WHERE v."planId"=p.id);
