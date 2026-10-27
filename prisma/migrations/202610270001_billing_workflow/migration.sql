-- Additive billing workflow fields. Existing orders remain valid and untouched.
ALTER TABLE app."Order" ADD COLUMN "subscriptionId" uuid;
ALTER TABLE app."Order" ADD COLUMN "upgradeFromId" uuid REFERENCES app."Subscription"(id) ON DELETE RESTRICT;
ALTER TABLE app."Order" ADD CONSTRAINT "Order_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES app."Subscription"(id) ON DELETE RESTRICT;
CREATE INDEX "Order_subscriptionId_idx" ON app."Order" ("subscriptionId", "createdAt" DESC);
ALTER TABLE app."PaymentAttempt" ADD COLUMN "checkoutUrl" varchar(2048);
ALTER TABLE app."GatewayEvent" ADD COLUMN "serverVerifiedAt" timestamptz(6);
ALTER TABLE app."Refund" ADD COLUMN reason text, ADD COLUMN "requestedById" uuid,
  ADD COLUMN "approvedById" uuid, ADD COLUMN "correlationId" varchar(80);
ALTER TABLE app."Refund" ADD CONSTRAINT refund_requester_fk FOREIGN KEY ("requestedById") REFERENCES app."User"(id) ON DELETE RESTRICT;
ALTER TABLE app."Refund" ADD CONSTRAINT refund_approver_fk FOREIGN KEY ("approvedById") REFERENCES app."User"(id) ON DELETE RESTRICT;
ALTER TABLE app."Refund" ADD CONSTRAINT refund_independent_approval CHECK ("approvedById" IS NULL OR "approvedById" <> "requestedById");
CREATE TABLE app."PaymentDispute" (
  id uuid PRIMARY KEY,
  "paymentAttemptId" uuid NOT NULL REFERENCES app."PaymentAttempt"(id) ON DELETE RESTRICT,
  "providerCaseId" varchar(160),
  status varchar(24) NOT NULL,
  reason text NOT NULL,
  "openedAt" timestamptz(6) NOT NULL DEFAULT now(),
  "resolvedAt" timestamptz(6),
  "reportedById" uuid REFERENCES app."User"(id) ON DELETE RESTRICT,
  CONSTRAINT dispute_status CHECK (status IN ('OPEN','WON','LOST','CLOSED')),
  CONSTRAINT dispute_resolution CHECK ((status='OPEN' AND "resolvedAt" IS NULL) OR (status<>'OPEN' AND "resolvedAt" IS NOT NULL)),
  CONSTRAINT dispute_reason_present CHECK (length(btrim(reason)) >= 10)
);
CREATE UNIQUE INDEX "PaymentDispute_paymentAttemptId_providerCaseId_key" ON app."PaymentDispute" ("paymentAttemptId","providerCaseId");
CREATE INDEX "PaymentDispute_status_openedAt_idx" ON app."PaymentDispute" (status,"openedAt");
ALTER TABLE app."PlanVersion" ADD CONSTRAINT plan_scope_kind CHECK (
  ("scopeKind" = 'LIBRARY' AND "scopeId" IS NULL) OR
  ("scopeKind" IN ('PUBLICATION','VOLUME') AND "scopeId" IS NOT NULL)
);

CREATE OR REPLACE FUNCTION app.guard_payment_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o record;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW."orderId", NEW."amountMinor", NEW."currencyCode", NEW.provider, NEW."providerRef")
    IS DISTINCT FROM (OLD."orderId", OLD."amountMinor", OLD."currencyCode", OLD.provider, OLD."providerRef") THEN
    RAISE EXCEPTION 'payment identity and amount are immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'VERIFIED' THEN
    SELECT "totalMinor", "currencyCode" INTO o FROM app."Order" WHERE id = NEW."orderId";
    IF NEW."verifiedAt" IS NULL OR NEW."amountMinor" <> o."totalMinor" OR NEW."currencyCode" <> o."currencyCode"
      OR NOT EXISTS (SELECT 1 FROM app."GatewayEvent" WHERE "paymentAttemptId" = NEW.id AND "serverVerifiedAt" IS NOT NULL) THEN
      RAISE EXCEPTION 'verified payment requires matching order and server verification evidence' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app.guard_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW."merchantRef", NEW."idempotencyKey", NEW."currencyCode", NEW."totalMinor", NEW."planVersionId", NEW."userId", NEW."subscriptionId", NEW."upgradeFromId")
    IS DISTINCT FROM (OLD."merchantRef", OLD."idempotencyKey", OLD."currencyCode", OLD."totalMinor", OLD."planVersionId", OLD."userId", OLD."subscriptionId", OLD."upgradeFromId") THEN
    RAISE EXCEPTION 'order identity and amount are immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW."subscriptionId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM app."Subscription" s WHERE s.id = NEW."subscriptionId" AND s."userId" = NEW."userId" AND s."planVersionId" = NEW."planVersionId"
  ) THEN
    RAISE EXCEPTION 'order subscription must match owner and plan' USING ERRCODE = '23514';
  END IF;
  IF NEW."upgradeFromId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM app."Subscription" s WHERE s.id=NEW."upgradeFromId" AND s."userId"=NEW."userId"
  ) THEN RAISE EXCEPTION 'upgrade source must belong to order owner' USING ERRCODE='23514'; END IF;
  IF NEW.status = 'PAID' AND (NEW."paidAt" IS NULL OR NOT EXISTS (
    SELECT 1 FROM app."PaymentAttempt" WHERE "orderId" = NEW.id AND status = 'VERIFIED')) THEN
    RAISE EXCEPTION 'paid order requires verified payment' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app.guard_plan_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."scopeKind" = 'PUBLICATION' AND NOT EXISTS (SELECT 1 FROM app."Publication" WHERE id=NEW."scopeId") THEN
    RAISE EXCEPTION 'plan publication does not exist' USING ERRCODE='23503';
  END IF;
  IF NEW."scopeKind" = 'VOLUME' AND NOT EXISTS (SELECT 1 FROM app."Volume" WHERE id=NEW."scopeId") THEN
    RAISE EXCEPTION 'plan volume does not exist' USING ERRCODE='23503';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER plan_scope_guard BEFORE INSERT OR UPDATE ON app."PlanVersion" FOR EACH ROW EXECUTE FUNCTION app.guard_plan_scope();

COMMENT ON COLUMN app."GatewayEvent"."serverVerifiedAt" IS 'Set only after authenticated server-to-server gateway verification; webhook signature alone never activates access.';

INSERT INTO app."Role" (id,code,description) VALUES (gen_random_uuid(),'FINANCE','Finance operations with independent approval') ON CONFLICT (code) DO NOTHING;
INSERT INTO app."Permission" (id,code,description) VALUES
  (gen_random_uuid(),'BILLING_READ','Read finance records and reconciliation'),
  (gen_random_uuid(),'BILLING_PLAN_MANAGE','Version prices and scope of subscription plans'),
  (gen_random_uuid(),'BILLING_REFUND_REQUEST','Request a refund or dispute review'),
  (gen_random_uuid(),'BILLING_REFUND_APPROVE','Independently approve and submit a refund'),
  (gen_random_uuid(),'BILLING_RECONCILE','Run payment reconciliation')
ON CONFLICT (code) DO NOTHING;
INSERT INTO app."RolePermission" ("roleId","permissionId")
SELECT r.id,p.id FROM app."Role" r CROSS JOIN app."Permission" p
WHERE r.code IN ('SYSTEM_ADMIN','FINANCE') AND p.code LIKE 'BILLING_%' ON CONFLICT DO NOTHING;
