-- Additive identity security metadata. Existing credentials and sessions remain valid.
ALTER TABLE app."User"
  ADD COLUMN "failedLoginCount" integer NOT NULL DEFAULT 0,
  ADD COLUMN "lockedUntil" timestamptz(6),
  ADD COLUMN "closedAt" timestamptz(6);
ALTER TABLE app."User" ADD CONSTRAINT "User_failedLoginCount_check" CHECK ("failedLoginCount" BETWEEN 0 AND 1000);

ALTER TABLE app."AuthSession"
  ADD COLUMN "deviceLabel" varchar(160),
  ADD COLUMN "lastSeenAt" timestamptz(6);

ALTER TABLE app."Authenticator"
  ADD COLUMN "credentialId" varchar(512),
  ADD COLUMN "signCount" integer NOT NULL DEFAULT 0,
  ADD COLUMN "transports" text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN "confirmedAt" timestamptz(6);
ALTER TABLE app."Authenticator" ADD CONSTRAINT "Authenticator_signCount_check" CHECK ("signCount" >= 0);
CREATE UNIQUE INDEX "Authenticator_credentialId_key" ON app."Authenticator" ("credentialId") WHERE "credentialId" IS NOT NULL;
CREATE INDEX "User_lockedUntil_idx" ON app."User" ("lockedUntil") WHERE "lockedUntil" IS NOT NULL;
