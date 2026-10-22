import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import dotenv from "dotenv";
import pg from "pg";

const envPath = resolve(process.env.ARATA_ENV_FILE || ".env.local");
if (!existsSync(envPath)) throw new Error("Missing ignored .env.local with ARATA_POSTGRES_ADMIN_URL");
const localText = readFileSync(envPath, "utf8");
const local = dotenv.parse(localText);
const adminUrl = process.env.ARATA_POSTGRES_ADMIN_URL || local.ARATA_POSTGRES_ADMIN_URL;
if (!adminUrl) throw new Error("Set ARATA_POSTGRES_ADMIN_URL in ignored .env.local");

const dbNames = ["arata_techlibrary_dev", "arata_techlibrary_test", "arata_techlibrary_shadow_dev"] as const;
const roleNames = ["arata_migrate_dev", "arata_app_dev", "arata_research_ingest_dev", "arata_research_report_dev", "arata_research_identity_dev"] as const;
const outputKeys = ["MIGRATION_DATABASE_URL", "SHADOW_DATABASE_URL", "DATABASE_URL", "TEST_DATABASE_URL", "RESEARCH_INGEST_DATABASE_URL", "RESEARCH_REPORT_DATABASE_URL", "RESEARCH_IDENTITY_DATABASE_URL"] as const;
for (const key of outputKeys) {
  if (local[key]) throw new Error(`Refusing to overwrite existing ${key}; inspect this development setup manually`);
}

function connectionUrl(base: string, user: string, password: string, database: string): string {
  const url = new URL(base);
  url.username = user;
  url.password = password;
  url.pathname = `/${database}`;
  return url.toString();
}

const admin = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 5000 });
try {
  await admin.connect();
  const identity = await admin.query<{ current_database: string; can_create_db: boolean; can_create_role: boolean }>(
    "SELECT current_database(), rolcreatedb OR rolsuper AS can_create_db, rolcreaterole OR rolsuper AS can_create_role FROM pg_roles WHERE rolname = current_user",
  );
  if (identity.rows[0]?.current_database !== "postgres" || !identity.rows[0]?.can_create_db || !identity.rows[0]?.can_create_role) {
    throw new Error("Admin URL must target postgres with CREATEDB and CREATEROLE privileges");
  }
  const existingDbs = await admin.query<{ datname: string }>("SELECT datname FROM pg_database WHERE datname = ANY($1)", [dbNames]);
  const existingRoles = await admin.query<{ rolname: string }>("SELECT rolname FROM pg_roles WHERE rolname = ANY($1)", [roleNames]);
  if (existingDbs.rowCount || existingRoles.rowCount) {
    throw new Error(`Refusing to modify existing databases/roles: databases=${existingDbs.rows.map(r => r.datname).join(",") || "none"}; roles=${existingRoles.rows.map(r => r.rolname).join(",") || "none"}`);
  }

  const secrets = new Map(roleNames.map(name => [name, randomBytes(36).toString("base64url")]));
  for (const name of roleNames) {
    const secret = secrets.get(name);
    if (!secret) throw new Error("Role secret generation failed");
    await admin.query(`CREATE ROLE ${name} LOGIN PASSWORD '${secret}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT`);
  }
  for (const name of dbNames) {
    await admin.query(`CREATE DATABASE ${name} OWNER arata_migrate_dev ENCODING 'UTF8' TEMPLATE template0`);
    await admin.query(`REVOKE ALL ON DATABASE ${name} FROM PUBLIC`);
    await admin.query(`GRANT CONNECT ON DATABASE ${name} TO arata_migrate_dev`);
    if (name === "arata_techlibrary_dev") {
      for (const role of roleNames.slice(1)) await admin.query(`GRANT CONNECT ON DATABASE ${name} TO ${role}`);
    }
    await admin.query(`ALTER DATABASE ${name} SET timezone TO 'UTC'`);
  }

  const make = (role: (typeof roleNames)[number], database: (typeof dbNames)[number]): string =>
    connectionUrl(adminUrl, role, secrets.get(role)!, database);
  const generated: Record<(typeof outputKeys)[number], string> = {
    MIGRATION_DATABASE_URL: make("arata_migrate_dev", dbNames[0]),
    SHADOW_DATABASE_URL: make("arata_migrate_dev", dbNames[2]),
    DATABASE_URL: make("arata_app_dev", dbNames[0]),
    TEST_DATABASE_URL: make("arata_migrate_dev", dbNames[1]),
    RESEARCH_INGEST_DATABASE_URL: make("arata_research_ingest_dev", dbNames[0]),
    RESEARCH_REPORT_DATABASE_URL: make("arata_research_report_dev", dbNames[0]),
    RESEARCH_IDENTITY_DATABASE_URL: make("arata_research_identity_dev", dbNames[0]),
  };
  const suffix = Object.entries(generated).map(([key, value]) => `${key}=${value}`).join("\n");
  writeFileSync(envPath, `${localText.trimEnd()}\n${suffix}\n`, { encoding: "utf8", mode: 0o600 });
  console.log("Created isolated development, test and shadow databases and five roles. Connection URLs were saved only to the ignored local env file.");
} catch (error) {
  const message = error instanceof Error && !('code' in error) ? error.message : `database error ${String((error as { code?: unknown }).code ?? "unknown")}`;
  console.error(`Provisioning stopped: ${message}`);
  process.exitCode = 1;
} finally {
  await admin.end().catch(() => undefined);
}
