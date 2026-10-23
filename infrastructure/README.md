# Local development foundation

Run commands from the repository root in VS Code PowerShell. Use Node 22, npm 10, Python 3, Docker Desktop with Compose, and PostgreSQL 18. The existing database instructions in `database/README.md` explain role provisioning, migrations, and recovery. `api/README.md` records the design contract; only `/api/v1/health/live` and `/api/v1/health/ready` are implemented by this foundation.

## Existing local database

1. Keep the already provisioned `arata_techlibrary_dev` connection in ignored `.env.local` as `DATABASE_URL`. Do not put a privileged URL into application configuration.
2. Run `npm ci`, `npm run foundation:init-env`, `npm run db:migrate:deploy`, `npm run db:grant:dev` if migrations or grants are pending. Start a local Redis server on loopback port 6379 or set `REDIS_URL` to an authenticated local development instance before worker checks. `.npmrc` makes the lockfile's peer resolution mode consistent for local, CI and Docker installs.
3. Run `npm run dev`. The web UI is at `http://127.0.0.1:5173`; the API liveness endpoint is `http://127.0.0.1:3000/api/v1/health/live`.
4. Run `npm run foundation:check`, `npm run test:integration`, and `npm run test:e2e`. The E2E runner starts the API and built PWA preview itself; `foundation:check` builds that preview first.

`foundation:init-env` writes an ignored random service token once and preserves it on subsequent runs. The readiness endpoint needs `Authorization: Bearer <HEALTH_TOKEN>` from that ignored file; it queries PostgreSQL. Never paste the token into source or logs.

## Isolated Compose path

For a fresh development environment, run `npm ci`, `npm run foundation:init-env`, and `npm run db:compose:init`. If `.env.compose.local` and `.secrets/postgres_bootstrap_password` already exist, preserve them and skip the init command. Then:

```powershell
docker compose --env-file .env.compose.local -f compose.database.yaml up -d --wait
npm run db:compose:provision
$env:ARATA_ENV_FILE = '.env.compose.local'
npm run db:migrate:deploy
npm run db:grant:dev
docker compose --env-file .env.compose.local --env-file .env.foundation.local -f compose.foundation.yaml up -d --wait postgres redis
docker compose --env-file .env.compose.local --env-file .env.foundation.local -f compose.foundation.yaml up -d --build api worker web
```

Do not run provisioning against a database with unverified existing data. The Compose PostgreSQL service uses a separate named volume and loopback port 55433. The API uses the least privilege application URL. The worker consumes only the `arata-diagnostics` queue; product jobs are not implemented. The PWA caches its shell and static assets; `/api/*` uses `NetworkOnly`, so protected responses are not saved to a public service worker cache. IndexedDB stores only the theme preference. Protected offline reading and sync are future feature work.

Run `docker compose --env-file .env.compose.local --env-file .env.foundation.local -f compose.foundation.yaml down` to stop services while retaining data. Never use `down --volumes` on a database containing data you have not verified and backed up. Compose injects only the application database URL into the API; privileged migration URLs stay on the host setup path.

## Checks and production build

`npm run foundation:check` runs lint, strict type checks, unit and integration tests, and builds. `npm run test:e2e` exercises the browser, including offline shell loading. `npm audit --audit-level=high` checks known dependency advisories. `npm sbom --package-lock-only --omit=optional --sbom-format=cyclonedx` creates an SBOM of the lockfile's nonoptional packages; the audit still covers the full dependency tree. `npm run db:verify` checks physical database state. The application build emits `apps/api/dist`, `apps/worker/dist`, and `apps/web-pwa/dist`. Production deployment still needs external TLS, secret management, monitoring, and the domain services described in the SRS.
