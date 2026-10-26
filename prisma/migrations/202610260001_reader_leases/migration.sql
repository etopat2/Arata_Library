-- Additive, session-bound reader leases. The composite session key prevents a
-- lease from naming a session owned by another user.
CREATE UNIQUE INDEX "AuthSession_id_userId_key"
  ON app."AuthSession" (id, "userId");

CREATE TABLE app."ReaderLease" (
  id uuid NOT NULL,
  "policyId" uuid NOT NULL,
  "userId" uuid NOT NULL,
  "sessionId" uuid NOT NULL,
  "expiresAt" timestamptz(6) NOT NULL,
  "createdAt" timestamptz(6) NOT NULL DEFAULT now(),
  "updatedAt" timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "ReaderLease_pkey" PRIMARY KEY (id),
  CONSTRAINT "ReaderLease_future_expiry" CHECK ("expiresAt" > "createdAt")
);
CREATE UNIQUE INDEX "ReaderLease_policyId_userId_sessionId_key"
  ON app."ReaderLease" ("policyId", "userId", "sessionId");
CREATE INDEX "ReaderLease_policyId_userId_expiresAt_idx"
  ON app."ReaderLease" ("policyId", "userId", "expiresAt");
ALTER TABLE app."ReaderLease" ADD CONSTRAINT "ReaderLease_policyId_fkey"
  FOREIGN KEY ("policyId") REFERENCES app."ContentPolicy"(id)
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE app."ReaderLease" ADD CONSTRAINT "ReaderLease_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES app."User"(id)
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE app."ReaderLease" ADD CONSTRAINT "ReaderLease_sessionId_userId_fkey"
  FOREIGN KEY ("sessionId", "userId") REFERENCES app."AuthSession"(id, "userId")
  ON DELETE CASCADE ON UPDATE CASCADE;
