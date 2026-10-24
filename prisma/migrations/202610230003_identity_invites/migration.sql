-- An administrator may invite a user but cannot acknowledge legal terms for them.
ALTER TABLE app."User" ALTER COLUMN "termsAcceptedAt" DROP NOT NULL;
