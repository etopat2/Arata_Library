import { readFileSync } from "node:fs";
import dotenv from "dotenv";
import pg from "pg";

const local = dotenv.parse(readFileSync(process.env.ARATA_ENV_FILE || ".env.local", "utf8"));
const url = process.env.MIGRATION_DATABASE_URL || local.MIGRATION_DATABASE_URL;
if (!url) throw new Error("MIGRATION_DATABASE_URL is required");
const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
try {
  await client.connect();
  const database = await client.query<{ current_database: string }>("SELECT current_database()");
  if (database.rows[0]?.current_database !== "arata_techlibrary_dev") throw new Error("Refusing grants outside arata_techlibrary_dev");
  await client.query("BEGIN");
  await client.query(`
    REVOKE CREATE ON SCHEMA public FROM PUBLIC;
    REVOKE ALL ON SCHEMA app, research, research_private FROM PUBLIC;
    GRANT USAGE ON SCHEMA app TO arata_app_dev;
    GRANT SELECT ON ALL TABLES IN SCHEMA app TO arata_app_dev;
    GRANT SELECT ON app."EffectiveEntitlement", app."PublicInsightSnapshot" TO arata_app_dev;
    DO $$ DECLARE t record; BEGIN
      FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'app' LOOP
        EXECUTE format('GRANT INSERT, UPDATE ON app.%I TO arata_app_dev', t.tablename);
      END LOOP;
    END $$;
    GRANT DELETE ON app."AuthSession", app."VerificationToken", app."Bookmark", app."Annotation", app."SyncOperation", app."ReaderLease" TO arata_app_dev;

    GRANT USAGE ON SCHEMA research TO arata_research_ingest_dev, arata_research_report_dev;
    GRANT USAGE ON SCHEMA app TO arata_research_ingest_dev, arata_research_report_dev;
    GRANT SELECT ON app."ProcessingPurpose" TO arata_research_ingest_dev;
    GRANT INSERT ON research."ResearchEvent" TO arata_research_ingest_dev;
    GRANT SELECT, INSERT, UPDATE ON research."ResearchSession" TO arata_research_ingest_dev;
    GRANT SELECT ON ALL TABLES IN SCHEMA research TO arata_research_report_dev;
    GRANT SELECT ON app."Publication", app."Volume", app."Edition", app."Revision" TO arata_research_report_dev;

    GRANT USAGE ON SCHEMA research_private TO arata_research_identity_dev;
    GRANT SELECT, INSERT, UPDATE, DELETE ON research_private."PseudonymLink" TO arata_research_identity_dev;
  `);
  await client.query("COMMIT");
  console.log("Applied development role grants. App role has no research schema access; reporting role has no identity-link schema access.");
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  const message = error instanceof Error && !('code' in error) ? error.message : `database error ${String((error as { code?: unknown }).code ?? "unknown")}`;
  console.error(message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
