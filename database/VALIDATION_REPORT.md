# Database validation report

## Billing migrations — 2026-10-27

Five additive forward migrations (`202610270001_billing_workflow` through `202610270005_refund_chronology`) extend orders, payment attempts, gateway verification evidence, refunds, disputes, reconciliation indexes and the free plan record. The migrations were reviewed and applied to the isolated test database and then local development without reset or destructive changes. `prisma validate`, `prisma migrate status` and `db:verify` passed: PostgreSQL 18.4 in UTC, 92 tables, 167 foreign keys, 91 checks, 47 triggers, 29 enums and 28 complete migrations. Application/research role isolation passed. `database/tests/billing.test.ts` rejected duplicate orders, unverified paid state, mutable payment amounts and invalid plan scope. The physical ERD source and SVG were regenerated. Recovery is a reviewed corrective forward migration or a verified backup restore; never reset a database with unverified data. Payment provider sandbox conformance remains GAP-033.


## Account reader preferences — 2026-10-26

Migration `202610260003_reader_preferences` only creates `app."ReaderPreference"`; it changes no existing table or row. It was reviewed and applied first to the isolated test database, then to development, without a reset. The user-owned row has a cascade delete with its account and four PostgreSQL allowlist checks. Prisma format, validate, generate and both migration drift comparisons passed. PostgreSQL 18.4 reports 89 tables, 155 foreign keys, 79 checks, 44 triggers, 29 enums and 22 complete migrations. `db:verify` confirms application read/write privileges without direct preference deletion, research role isolation and UTC. SQL constraints passed 12/12, including invalid settings and deletion. The physical ERD was regenerated. Recovery is a reviewed forward migration or verified backup restore after assessing saved preferences; do not reset a database containing unverified data.

## Reader-lease expiry index and retention worker - 2026-10-26

The additive `202610260002_reader_lease_cleanup_index` migration creates only an expiry index on `app."ReaderLease"`. It was reviewed and applied first to `arata_techlibrary_test`, then to `arata_techlibrary_dev`, with no reset or row rewrite. Prisma format, validate and generate passed. Both migration drift comparisons found no difference. PostgreSQL 18.4 reports 88 tables, 154 foreign keys, 75 checks, 44 triggers, 29 enums and 21 completed migrations; `db:verify` confirms the index, application lease privileges and research role isolation. The SQL constraint suite passes 11/11. The worker deletes at most 1,000 expired leases per sweep and preserves active leases; its live integration result is in `Documentation/Implementation/TEST_RESULTS.md`. Rolling back this additive index requires a reviewed forward migration or restore from a verified backup; do not reset a database containing unverified data.

## Session-bound reader leases - 2026-10-26

The additive `202610260001_reader_leases` migration was reviewed and applied to the isolated `arata_techlibrary_test` database before `arata_techlibrary_dev`, without resetting either database or removing existing rows. It adds a reader lease table, a composite authentication-session ownership key, foreign keys, uniqueness, an expiry check and an indexed policy/user/expiry lookup. PostgreSQL 18.4 now reports 88 tables, 154 foreign keys, 75 checks, 44 triggers, 29 enums and 20 complete migrations. `prisma format`, `prisma validate`, `prisma generate`, both migration-to-schema and database-to-schema drift comparisons, `db:verify` and `db:erd` passed. The physical Mermaid/DOT/SVG ERDs include 154 named relationships. The SQL constraint suite passed 11/11, including duplicate leases, cross-user session rejection, expiry and cascade deletion. `ReaderLease` privileges were granted to the application role; research data isolation remains verified. For rollback, restore a verified backup or deploy a reviewed forward migration after confirming lease/data impact; never reset a database with unverified data. Global cleanup of dormant expired leases remains open; active acquisitions remove stale rows.

## Reader policy extension - 2026-10-25

The additive `202610250006_reader_policy_fields` migration was reviewed and applied first to `arata_techlibrary_test`, then to `arata_techlibrary_dev`. It preflights duplicate scope versions, adds a library policy scope and nullable action overrides, and preserves existing policies and content. No reset or row deletion occurred. `prisma format`, `prisma validate` and `prisma generate` passed. PostgreSQL 18.4 reports 87 tables, 151 foreign keys, 74 checks, 44 triggers, 29 enums and 19 complete migrations in UTC. `db:verify` passed including role isolation. The isolated SQL suite passed 10/10; physical Mermaid/DOT/SVG diagrams were regenerated with 151 named relationships. Reader policy/API/browser validation is recorded in `Documentation/Implementation/TEST_RESULTS.md`. A production restore drill and full reader release acceptance remain open.

## Reviewed bibliographic metadata guard - 2026-10-25

The additive `202610250004_reviewed_bibliography_guard` migration was inspected,
applied first to the isolated `_test` database and then to
`arata_techlibrary_dev`; neither database was reset and no rows were rewritten.
Five PostgreSQL triggers now guard reviewed publication, volume, edition and
contributor metadata. The existing manuscript-child guard already rejected changes
while a revision is IN_REVIEW. A draft edition created beside a reviewed edition
remains editable, while an order change to the reviewed scope is rejected.
An audit found that migration `004` had copied an earlier version of the child
guard and lost its chapter/lesson fallback for resources. We preserved the
applied migration and added corrective forward migration
`202610250005_restore_review_resource_guard`, tested on `_test` before applying
to development. It restores the fallback and corrects the prior cross-reference
source lookup; direct SQL tests now reject changes to a chapter-linked resource
and cross-reference during review.
`prisma format`, `prisma validate`, `prisma generate`, `migrate status`, and the
database-to-schema drift comparison passed after migration `005`. `db:verify`
found 87 tables, 150 foreign keys, 71 checks, 44 triggers, 28 enums, 18
completed migrations, all five named guards, the in-review child guard and
the restored resource-parent fallback. SQL constraints passed 9/9;
the Studio API integration passed 7/7 and the full foundation tests passed
30/30 against the migrated test database. A concurrent update/submission stress
test and wider asset/policy release acceptance remain open in GAP-025 and the
other publishing gaps. The entity relationship graph did not change.

## Edition order extension - 2026-10-25

The additive `202610250003_edition_order` migration was reviewed and applied to
`arata_techlibrary_dev` and the isolated `_test` database without a reset. It
backfilled existing editions in stable creation order within each standalone
publication or volume. Positive ordinals and separate partial unique indexes
prevent duplicate positions in each scope. Prisma format, validate and generate
passed; migration-to-database and migration-to-schema comparisons found no
drift. `db:verify` passed with 87 tables, 150 foreign keys, 71 checks, 39
triggers, 28 enums and 16 completed migrations; 8/8 SQL constraint tests and
physical ERD regeneration passed. Full publishing acceptance remains open in
GAP-021–024.

## Publishing Studio extension - 2026-10-24

Two additive migrations (`202610250001_publishing_studio` and
`202610250002_review_freeze`) were reviewed and applied to the named local
development and isolated test databases without reset. They add Library root,
revision rights and correction history, bibliography and cross-references,
private upload/scan/import jobs, and scheduled release records. SQL triggers
freeze review and published content and preserve rights evidence. The physical
design now has 87 tables, 150 foreign keys, 28 enums, 70 checks, 39 triggers and
15 applied migrations. Prisma format/validate/generate, drift comparison,
`db:verify`, 8/8 database tests, both labelled development seeds, and ERD
regeneration passed locally. Source SRS acceptance remains separate; see
`apps/api/STUDIO.md` and GAP-021–024. Fresh-container CI and live ClamAV
validation remain open.

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
