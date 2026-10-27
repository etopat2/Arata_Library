ALTER TABLE app."PaymentDispute" ADD COLUMN "resolvedById" uuid REFERENCES app."User"(id) ON DELETE RESTRICT;
ALTER TABLE app."PaymentDispute" ADD CONSTRAINT dispute_independent_resolution
  CHECK ("reportedById" IS NULL OR "resolvedById" IS NULL OR "reportedById" <> "resolvedById");
