import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const port = Number(process.env.ARATA_POSTGRES_PORT || "55433");
if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 5432) {
  throw new Error("ARATA_POSTGRES_PORT must be a non-default local port between 1024 and 65535");
}

const secretDirectory = resolve(".secrets");
const passwordFile = resolve(secretDirectory, "postgres_bootstrap_password");
const envFile = resolve(".env.compose.local");
if (existsSync(passwordFile) || existsSync(envFile)) {
  throw new Error("Compose files already exist; refusing to overwrite an existing secret or connection configuration");
}

mkdirSync(secretDirectory, { recursive: true });
writeFileSync(passwordFile, randomBytes(36).toString("hex"), { encoding: "utf8", mode: 0o600, flag: "wx" });
writeFileSync(envFile, `# Local Compose database only. Generated role URLs are appended by provisioning.\nARATA_POSTGRES_PORT=${port}\n`, {
  encoding: "utf8", mode: 0o600, flag: "wx",
});
console.log("Created ignored Compose secret and environment files for an isolated PostgreSQL development service.");
