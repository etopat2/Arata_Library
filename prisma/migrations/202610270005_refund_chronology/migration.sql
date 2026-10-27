ALTER TABLE app."Refund" ADD COLUMN "requestedAt" timestamptz(6) NOT NULL DEFAULT now();
CREATE INDEX "Refund_requestedAt_idx" ON app."Refund" ("requestedAt" DESC);
