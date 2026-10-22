import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import dotenv from "dotenv";

const envPath = resolve(".env.compose.local");
const local = dotenv.parse(readFileSync(envPath, "utf8"));
const port = Number(local.ARATA_POSTGRES_PORT);
if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 5432) {
  throw new Error("Invalid isolated Compose PostgreSQL port");
}
const password = readFileSync(resolve(".secrets/postgres_bootstrap_password"), "utf8").trim();
if (!/^[0-9a-f]{72}$/.test(password)) throw new Error("Invalid generated Compose secret");
const url = new URL(`postgresql://postgres@127.0.0.1:${port}/postgres`);
url.password = password;
process.env.ARATA_ENV_FILE = envPath;
process.env.ARATA_POSTGRES_ADMIN_URL = url.toString();
await import("./provision-dev.js");
