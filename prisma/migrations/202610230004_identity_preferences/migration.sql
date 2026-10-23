CREATE TABLE app."NotificationPreference" (
  "userId" uuid PRIMARY KEY REFERENCES app."User"(id) ON DELETE CASCADE,
  email boolean NOT NULL DEFAULT true,
  "inApp" boolean NOT NULL DEFAULT true,
  "updatedAt" timestamptz(6) NOT NULL DEFAULT now()
);

INSERT INTO app."ProcessingPurpose" (id,code,description,"lawfulBasis",optional)
VALUES
  (gen_random_uuid(),'ANALYTICS','Optional product usage analytics','CONSENT_REQUIRED',true),
  (gen_random_uuid(),'RESEARCH','Optional educational research','CONSENT_REQUIRED',true),
  (gen_random_uuid(),'PERSONALIZATION','Optional personalization','CONSENT_REQUIRED',true),
  (gen_random_uuid(),'AI_ASSISTANCE','Optional AI assistance','CONSENT_REQUIRED',true)
ON CONFLICT (code) DO NOTHING;
