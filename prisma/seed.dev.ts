import { readFileSync } from "node:fs";
import dotenv from "dotenv";
import pg from "pg";

if (process.env.ARATA_ENABLE_DEV_SEED !== "1") throw new Error("Set ARATA_ENABLE_DEV_SEED=1 to seed development-only examples");
const local = dotenv.parse(readFileSync(process.env.ARATA_ENV_FILE || ".env.local", "utf8"));
const url = process.env.MIGRATION_DATABASE_URL || local.MIGRATION_DATABASE_URL;
if (!url) throw new Error("MIGRATION_DATABASE_URL is required");
const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
try {
  await client.connect();
  const identity = await client.query<{ current_database: string }>("SELECT current_database()");
  if (identity.rows[0]?.current_database !== "arata_techlibrary_dev") throw new Error("Development seed refuses any other database");
  await client.query("BEGIN");
  for (const code of ["SYSTEM_ADMIN", "INSTITUTION_APPROVER", "READER", "AUTHOR", "EDITOR", "PUBLISHER_MANAGER", "FINANCE", "RESEARCH_ANALYST", "PRIVACY_APPROVER"]) {
    await client.query('INSERT INTO app."Role" (id, code, description) VALUES (gen_random_uuid(), $1, $2) ON CONFLICT (code) DO NOTHING', [code, "Development role catalogue; assign only after authorization review"]);
  }
  const user = await client.query<{ id: string }>(`
    INSERT INTO app."User" (id, email, status, "termsAcceptedAt", "privacyVersion", "createdAt", "updatedAt")
    VALUES (gen_random_uuid(), 'dev-reader@example.invalid', 'ACTIVE', now(), 'DEV-ONLY', now(), now())
    ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id`);
  const userId = user.rows[0]?.id;
  if (!userId) throw new Error("Could not create development sample identity");
  const collection = await client.query<{ id: string }>(`
    INSERT INTO app."Collection" (id, slug, title, description)
    VALUES (gen_random_uuid(), 'dev-sample-collection', '[DEV SAMPLE] Technology books', 'Fictional development-only catalogue')
    ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug RETURNING id`);
  const publication = await client.query<{ id: string }>(`
    INSERT INTO app."Publication" (id, slug, title, kind, status, "ownerId", "createdAt", "updatedAt")
    VALUES (gen_random_uuid(), 'dev-sample-series', '[DEV SAMPLE] Unpublished series', 'SERIES', 'DRAFT', $1, now(), now())
    ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug RETURNING id`, [userId]);
  const publicationId = publication.rows[0]?.id;
  const collectionId = collection.rows[0]?.id;
  if (!publicationId || !collectionId) throw new Error("Could not create development sample catalogue");
  await client.query(`INSERT INTO app."PublicationCollection" ("publicationId", "collectionId") VALUES ($1, $2) ON CONFLICT DO NOTHING`, [publicationId, collectionId]);
  const volume = await client.query<{ id: string }>(`
    INSERT INTO app."Volume" (id, "publicationId", ordinal, title)
    VALUES (gen_random_uuid(), $1, 1, '[DEV SAMPLE] Unpublished volume')
    ON CONFLICT ("publicationId", ordinal) DO UPDATE SET ordinal = EXCLUDED.ordinal RETURNING id`, [publicationId]);
  const edition = await client.query<{ id: string }>(`
    SELECT id FROM app."Edition" WHERE "volumeId" = $1 AND "editionCode" = 'DEV-1'`, [volume.rows[0]?.id]);
  let editionId = edition.rows[0]?.id;
  if (!editionId) {
    const inserted = await client.query<{ id: string }>(`
      INSERT INTO app."Edition" (id, "publicationId", "volumeId", "editionCode", label)
      VALUES (gen_random_uuid(), $1, $2, 'DEV-1', '[DEV SAMPLE] Draft edition') RETURNING id`, [publicationId, volume.rows[0]?.id]);
    editionId = inserted.rows[0]?.id;
  }
  if (!editionId) throw new Error("Could not create development sample edition");
  await client.query(`INSERT INTO app."Revision" (id, "editionId", number, status, "changeSummary")
    VALUES (gen_random_uuid(), $1, 1, 'DRAFT', '[DEV SAMPLE] No manuscript supplied')
    ON CONFLICT ("editionId", number) DO NOTHING`, [editionId]);
  await client.query("COMMIT");
  console.log("Seeded only labelled, unpublished development catalogue records and role codes.");
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  const message = error instanceof Error && !('code' in error) ? error.message : `database error ${String((error as { code?: unknown }).code ?? "unknown")}`;
  console.error(message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
