ALTER TABLE "app"."OfflineLicence"
  ADD COLUMN "idempotencyKey" VARCHAR(160),
  ADD COLUMN "requestHash" VARCHAR(128);

CREATE UNIQUE INDEX "OfflineLicence_userId_idempotencyKey_key"
  ON "app"."OfflineLicence"("userId", "idempotencyKey");
