-- Assignable non-administrator roles carry no implicit permission.
INSERT INTO app."Role" (id,code,description) VALUES
  (gen_random_uuid(),'AUTHOR','Publishing author; resource scope required by publishing service'),
  (gen_random_uuid(),'EDITOR','Editorial reviewer; resource scope required by publishing service'),
  (gen_random_uuid(),'PUBLISHER','Publication release operator; resource scope required by publishing service')
ON CONFLICT (code) DO NOTHING;
