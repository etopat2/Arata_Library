# Database validation report

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
