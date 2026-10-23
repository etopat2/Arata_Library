-- Preserve prior acknowledgements without inventing their historical version.
ALTER TABLE app."User" ADD COLUMN "termsVersion" varchar(64) NOT NULL DEFAULT 'LEGACY_UNRECORDED';
CREATE UNIQUE INDEX "User_email_normalized_key" ON app."User" (lower(email));

INSERT INTO app."Role" (id,code,description) VALUES
  (gen_random_uuid(),'READER','Ordinary verified reader'),
  (gen_random_uuid(),'SYSTEM_ADMIN','Platform identity administrator')
ON CONFLICT (code) DO NOTHING;

INSERT INTO app."Permission" (id,code,description) VALUES
  (gen_random_uuid(),'IDENTITY_USER_READ','Read account directory'),
  (gen_random_uuid(),'IDENTITY_USER_CREATE','Create reader accounts'),
  (gen_random_uuid(),'IDENTITY_USER_SUSPEND','Suspend or restore accounts'),
  (gen_random_uuid(),'IDENTITY_ROLE_ASSIGN','Assign or revoke platform roles'),
  (gen_random_uuid(),'IDENTITY_PRIVACY_REVIEW','Review account privacy requests')
ON CONFLICT (code) DO NOTHING;

INSERT INTO app."RolePermission" ("roleId","permissionId")
SELECT r.id,p.id FROM app."Role" r CROSS JOIN app."Permission" p
WHERE r.code='SYSTEM_ADMIN' AND p.code LIKE 'IDENTITY_%'
ON CONFLICT DO NOTHING;
