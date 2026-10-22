import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import dotenv from "dotenv";

const envFile = process.env.ARATA_ENV_FILE || ".env.local";
const local = dotenv.parse(readFileSync(envFile, "utf8"));
const testUrl = process.env.TEST_DATABASE_URL || local.TEST_DATABASE_URL;
if (!testUrl || new URL(testUrl).pathname !== "/arata_techlibrary_test") {
  throw new Error("TEST_DATABASE_URL must target the isolated arata_techlibrary_test database");
}
const result = spawnSync(process.execPath, [resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"], {
  stdio: "inherit",
  env: { ...process.env, ARATA_ENV_FILE: envFile, MIGRATION_DATABASE_URL: testUrl },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
