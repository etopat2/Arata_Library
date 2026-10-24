import { readFileSync } from "node:fs";
import dotenv from "dotenv";
import pg from "pg";

async function checkRole(url: string | undefined, allowed: string, denied: string): Promise<boolean> {
  if (!url) throw new Error("Missing a generated least-privilege role URL");
  const connection = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
  try {
    await connection.connect();
    await connection.query(allowed);
    try {
      await connection.query(denied);
      return false;
    } catch (error) {
      return (error as { code?: string }).code === "42501";
    }
  } finally {
    await connection.end().catch(() => undefined);
  }
}

const local = dotenv.parse(readFileSync(process.env.ARATA_ENV_FILE || ".env.local", "utf8"));
const url = process.env.MIGRATION_DATABASE_URL || local.MIGRATION_DATABASE_URL;
if (!url) throw new Error("MIGRATION_DATABASE_URL is required");
const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
try {
  await client.connect();
  const database = await client.query<{ name: string; timezone: string; version: string }>(
    "SELECT current_database() AS name, current_setting('TimeZone') AS timezone, current_setting('server_version') AS version",
  );
  if (database.rows[0]?.name !== "arata_techlibrary_dev") throw new Error("Verification requires arata_techlibrary_dev");
  const counts = await client.query<{ tables: number; foreign_keys: number; checks: number; triggers: number; enums: number }>(`
    SELECT
      (SELECT count(*)::int FROM pg_tables WHERE schemaname IN ('app', 'research', 'research_private')) AS tables,
      (SELECT count(*)::int FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname IN ('app', 'research', 'research_private') AND c.contype = 'f') AS foreign_keys,
      (SELECT count(*)::int FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname IN ('app', 'research', 'research_private') AND c.contype = 'c') AS checks,
      (SELECT count(*)::int FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname IN ('app', 'research', 'research_private') AND NOT t.tgisinternal) AS triggers,
      (SELECT count(*)::int FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname IN ('app', 'research', 'research_private') AND t.typtype = 'e') AS enums`);
  const migrations = await client.query<{ migration_name: string; complete: boolean }>(`
    SELECT migration_name, finished_at IS NOT NULL AND rolled_back_at IS NULL AS complete
    FROM public._prisma_migrations WHERE rolled_back_at IS NULL ORDER BY migration_name`);
  const access = await client.query<{ app_can_research: boolean; report_can_link: boolean; identity_can_link: boolean }>(`
    SELECT has_schema_privilege('arata_app_dev', 'research', 'USAGE') AS app_can_research,
      has_schema_privilege('arata_research_report_dev', 'research_private', 'USAGE') AS report_can_link,
      has_table_privilege('arata_research_identity_dev', 'research_private."PseudonymLink"', 'SELECT') AS identity_can_link`);
  const snapshotView = await client.query<{ present: boolean }>("SELECT to_regclass('app.\"PublicInsightSnapshot\"') IS NOT NULL AS present");
  const row = counts.rows[0];
  const perms = access.rows[0];
  const directRoleChecks = {
    app: await checkRole(local.DATABASE_URL, 'SELECT 1 FROM app."Publication" LIMIT 0', 'SELECT 1 FROM research."ResearchEvent" LIMIT 0'),
    ingest: await checkRole(local.RESEARCH_INGEST_DATABASE_URL, 'SELECT 1 FROM app."ProcessingPurpose" LIMIT 0', 'SELECT 1 FROM research."ResearchEvent" LIMIT 0'),
    report: await checkRole(local.RESEARCH_REPORT_DATABASE_URL, 'SELECT 1 FROM research."ResearchEvent" LIMIT 0', 'SELECT 1 FROM research_private."PseudonymLink" LIMIT 0'),
    identity: await checkRole(local.RESEARCH_IDENTITY_DATABASE_URL, 'SELECT 1 FROM research_private."PseudonymLink" LIMIT 0', 'SELECT 1 FROM research."ResearchEvent" LIMIT 0'),
  };
  if (!row || row.tables !== 87 || row.enums !== 28 || row.foreign_keys < 150 || row.checks < 70 || row.triggers < 39
    || migrations.rows.length !== 15 || migrations.rows.some(m => !m.complete)
    || !perms || perms.app_can_research || perms.report_can_link || !perms.identity_can_link || !snapshotView.rows[0]?.present
    || Object.values(directRoleChecks).some(passed => !passed)) {
    throw new Error("Database structure, migration history or role isolation did not match expected baseline");
  }
  console.log(JSON.stringify({ database: database.rows[0], counts: row, migrations: migrations.rows, roleIsolation: perms, directRoleChecks, publicSnapshotView: true }, null, 2));
} catch (error) {
  const message = error instanceof Error && !('code' in error) ? error.message : `database error ${String((error as { code?: unknown }).code ?? "unknown")}`;
  console.error(message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
