# Arata TechLibrary database

This package defines the PostgreSQL data layer for the SRS baseline. It does not implement authentication, payments, publishing services, retention jobs, or research publication workflows. The application must enforce authorization and orchestrate transactions using the database constraints described here.

## Requirements and structure

- SRS baseline: `Documentation/Arata_TechLibrary_SRS_v1.0_2026-10-21.docx` (local, intentionally not committed to the public repository).
- Design guidance: the local Engineering Design Package and Step 1 Implementation Contracts. Conflicts and interpretations are recorded in `Documentation/Implementation/DECISIONS.md`.
- `prisma/schema.prisma`: 75 models, 23 enums, three schemas. `app` owns operational data, `research` holds pseudonymous events and analysis, and `research_private` holds the identity-to-pseudonym link.
- `prisma/migrations`: the initial Prisma model migration followed by versioned SQL for conditional uniqueness, check constraints, triggers, and views. Applied migrations must never be edited; corrections belong in a new migration.
- `database/erd/arata-physical.mmd`, `.dot`, and `.svg`: generated from the actual PostgreSQL catalog, covering 75 tables and 122 named foreign keys. Generate again with `npm run db:erd` after a schema change. The SVG is large and intended for browser zoom.
- `prisma/seed.dev.ts`: fictional, visibly labelled, unpublished examples for development only.

## Local setup

Requirements: Node 22 or later, PostgreSQL 18 with a role that can create databases and roles. The scripts work with a PostgreSQL URL; a pgAdmin login credential is not assumed to be the database credential.

1. Run `npm ci`.
2. Copy `.env.database.example` to `.env.local` (ignored by Git). Add `ARATA_POSTGRES_ADMIN_URL` pointing at the local `postgres` maintenance database. Never commit or paste its password into issue text or logs.
3. Run `npm run db:provision:dev`. It refuses to proceed if any target database or role already exists or any generated URL is populated. It creates `arata_techlibrary_dev`, `arata_techlibrary_test`, and `arata_techlibrary_shadow_dev`, and stores randomly generated role URLs only in `.env.local`.
   Remove the temporary `ARATA_POSTGRES_ADMIN_URL` line from `.env.local` after successful provisioning.
4. Run `npm run db:migrate:deploy`, then `npm run db:migrate:test`, then `npm run db:grant:dev`.
5. Run `npm run db:verify`, `npm run db:test`, `npm run db:migrate:status`, `npm run db:validate`, `npm run db:generate`, and `npm run typecheck`.
6. For optional fictional sample data, set `ARATA_ENABLE_DEV_SEED=1` for one command and run `npm run db:seed:dev`. The seed script checks that the target is exactly `arata_techlibrary_dev`; tests always target `arata_techlibrary_test` and roll back their transactions.

The migration role owns database objects. The app role receives DML only in `app` and has no `research` schema access. Separate research ingestion, reporting, and identity-link roles receive only their required schema and table privileges. Do not use the migration or privileged admin URL in the application runtime. Store credentials in a managed secret store for any nonlocal environment.

## Isolated Docker development database

The repository also has a PostgreSQL 18.4 Compose service on localhost port `55433` by default. It uses a separate named volume and does not connect to or modify the PostgreSQL service on port `5432`. The official PostgreSQL 18 image persists data under `/var/lib/postgresql`; the Compose mount follows that layout. The bootstrap password is a generated, ignored file mounted as a container secret, and no privileged URL is stored in the Compose environment file.

From PowerShell, with Docker Desktop running:

```powershell
npm ci
npm run db:compose:init
docker compose --env-file .env.compose.local -f compose.database.yaml up --detach --wait
$env:ARATA_ENV_FILE = '.env.compose.local'
npm run db:compose:provision
npm run db:migrate:deploy
npm run db:migrate:test
npm run db:grant:dev
npm run db:verify
npm run db:test
```

`db:compose:init` refuses to overwrite existing secret or environment files. If port `55433` is occupied, set `ARATA_POSTGRES_PORT` to another free, non-default local port before running it; the generated Compose environment file keeps provisioning and port mapping aligned. `docker compose ... down` stops the service while preserving its named data volume. Removing volumes discards that database and must be confined to a verified disposable environment. Do not apply the provisioning script to an existing database.

The [database CI workflow](../.github/workflows/database.yml) runs the same provisioning, migrations, grants, SQL checks, tests, schema drift checks, dependency audit, and CycloneDX SBOM generation on an ephemeral GitHub runner. It uses read-only repository permissions, pinned action commits, and removes its disposable container, volume, and secret files after the job.

| Local role | Scope |
|---|---|
| `arata_migrate_dev` | Owns development, test and shadow databases; migration and maintenance only. |
| `arata_app_dev` | Operational `app` tables and approved views; no research schema access. |
| `arata_research_ingest_dev` | Insert/select on research events and sessions, and read processing purpose IDs. |
| `arata_research_report_dev` | Read research analysis tables and the approved public catalog view; no identity links. |
| `arata_research_identity_dev` | Identity-link table only; no general research event access. |

## Integrity and authorization

Relational foreign keys, unique constraints, named checks, partial unique indexes, and triggers enforce the database invariants. Published revisions require an approved exact manifest and become immutable with their chapters, lessons, resources, assessments, and referenced assets. Standalone editions and series volumes have disjoint shapes. A current revision must be published and belong to its edition.

Access grants are additive; `app."EffectiveEntitlement"` filters by UTC time, revocation, and status. The application must still evaluate content policy, publication status, role authorization, legal restrictions, and resource access class. The view alone is not a reader authorization decision. Verified payment events and matching amount/currency gate payment state; external signatures must be checked by the payment service before a row is marked verified. Role permissions in PostgreSQL protect schema boundaries, while the future API must enforce user-level authorization.

UTC `timestamptz` columns store instants. Monetary amounts use integer minor units and a three-letter currency code; the payment service must validate provider and currency-specific rules. Idempotency keys and provider event/reference uniqueness prevent repeated writes. The research publication tables require approved disclosure policy and review evidence. No disclosure threshold is seeded pending the SRS business decision.

## Migration, backup, and recovery

Before a new migration, inspect the generated SQL and estimate any table rewrite or lock. Capture a verified PostgreSQL backup and a restore point in an isolated environment. Run `prisma validate`, migrate an empty disposable database, run the constraint tests, and compare migrations to the schema and target using `prisma migrate diff --exit-code`. Check `prisma migrate status` and `db:verify` after deployment. A destructive migration requires explicit review of affected rows, dependencies, and a tested data-preserving conversion; never reset a database with unverified data.

Prisma Migrate has no automatic down migration for this package. For a failed forward migration, preserve the database and migration history, inspect `_prisma_migrations`, and create a corrective forward migration after a backup. For data loss or corruption, restore the verified backup to a separate database, check row counts and migration status, then plan a controlled cutover. Do not run `migrate reset` against any non-disposable database. A timed backup/restore drill and production RPO/RTO remain release work.

Example PowerShell backup from an already configured, private session:

```powershell
pg_dump --dbname "$env:MIGRATION_DATABASE_URL" --format=custom --no-owner --no-acl --file arata-before-migration.dump
```

Restore into a newly created, empty recovery database using a recovery connection URL supplied through the environment. Never restore over the existing database:

```powershell
pg_restore --dbname "$env:ARATA_RECOVERY_DATABASE_URL" --no-owner --no-acl --exit-on-error arata-before-migration.dump
```

After restore, compare table counts and migration records with the captured pre-migration manifest, then run the appropriate read-only `prisma migrate status` and catalog checks against the recovery URL. Record recovery duration and data loss for the eventual RPO/RTO sign-off.

For production, provision roles and database through environment-specific infrastructure automation, review the privilege matrix, and use the production secret store. The local provisioning script is guarded for development names only and must not be used against a production database.

## Tests

`npm run db:test` covers referential integrity, duplicate prevention, publication immutability, expiry and additive entitlements, institutional membership, payment idempotency, research event deduplication, and deletion/retention behavior. The test role is isolated to `arata_techlibrary_test`. `npm run db:verify` queries the live catalog for schema counts, migration history, timezone, role isolation, and the public insight snapshot view. The latest local validation is in `database/VALIDATION_REPORT.md`.
