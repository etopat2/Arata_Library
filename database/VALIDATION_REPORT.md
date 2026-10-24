# Database validation report

## Public catalogue extension - 2026-10-24

Three additive migrations add public bibliographic metadata, contributor relationships, approved chapter preview text, text-resource summaries and editorial featured selection. Local PostgreSQL 18.4 development and isolated test databases now have 78 tables, 125 foreign keys and 13 completed migrations; UTC, least-privilege role isolation and eight existing constraint tests pass. `prisma format`, `prisma validate`, `prisma generate`, `migrate status`, database-to-schema diff, `db:verify` and physical ERD regeneration passed. Synthetic published examples are permitted only by the explicit development seed guard.

The first local attempt at `202610240001_public_catalogue` stopped on a non-immutable expression index after earlier additive DDL had applied. Both named databases were inspected; only two missing indexes were created. Prisma retains the failed attempt as rolled-back history and records the corrected migration as applied. No existing data was reset or deleted. [Hosted database run 40091452375](https://github.com/etopat2/Arata_Library/actions/runs/40091452375) passed fresh container provisioning, the corrected migrations, drift and integrity checks. See `apps/api/CATALOGUE.md` and `Documentation/Implementation/DECISIONS.md`.

## Identity extension - 2026-10-24

Seven additive migrations (`202610230001`–`202610230007`) extend the baseline to 76 tables, 123 foreign keys and 10 applied migrations. `prisma format`, `prisma validate`, `prisma generate`, both migration drift comparisons, `db:verify` and eight database constraint tests passed locally. The migrations were applied only after the duplicate/noncanonical email preflight. No database reset was used. The physical ERD was regenerated as Mermaid, DOT and SVG. This verifies physical integrity, not operational identity acceptance; see `apps/api/IDENTITY.md` and `Documentation/Implementation/TEST_RESULTS.md`.

Date: 2026-10-22. Environment: local PostgreSQL 18.4 on `127.0.0.1:5432`, Node 22.23.2, Prisma 7.10.1. No connection secret is recorded here. The temporary privileged URL was removed from the ignored local environment file after provisioning.

| Check | Result |
|---|---|
| `prisma format`, `prisma validate`, `prisma generate` | Passed |
| `tsc --noEmit` | Passed |
| Three migrations on fresh local development and test databases | Passed |
| `prisma migrate status` | Up to date |
| `prisma migrate diff --from-migrations ... --to-config-datasource --exit-code` | No difference |
| `prisma migrate diff --from-migrations ... --to-schema prisma/schema.prisma --exit-code` | No difference after representing the BRIN index in Prisma |
| `db:verify` SQL catalog and privilege checks | Passed: 75 tables, 122 foreign keys, 55 checks, 28 user triggers, 23 enums, three complete migrations, UTC database setting; direct logins confirmed allowed and denied queries for app, ingest, reporting and identity roles |
| `db:test` integration and constraint tests | 8 passed, 0 failed, against `arata_techlibrary_test` |
| `db:seed:dev` | Passed twice without duplicate records; fictional draft series and role catalogue only |
| Physical ERD generation | Passed: 75 tables and 122 named relationships in Mermaid, DOT, SVG |
| `npm audit --omit=dev` | Passed: zero reported vulnerabilities |
| Requirement tracker check | 287 unique SRS IDs retained; 49 database contributions recorded; all referenced wireframe IDs valid |

The tests use rollback transactions and do not assert production service behavior. Payment signature verification, encryption and key management for pseudonym mapping, automated retention execution, authorization at the API layer, a timed restore drill, and disclosure policy values remain separate work. No real customer, payment, or research data was seeded.

An isolated Linux/PostgreSQL 18.4 container validation passed in [GitHub Actions main run 39727484615](https://github.com/etopat2/Arata_Library/actions/runs/39727484615), including fresh provisioning, migrations, grants, both drift checks, 8/8 integration tests, dependency audit, and CycloneDX SBOM upload. The local Docker Desktop engine was unavailable; the hosted run provides container execution evidence.
