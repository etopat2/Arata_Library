# Source document inventory

Inventoried 2026-10-21: 29 files. All paths below are local source materials under `Documentation/`. They are excluded from the public Git repository by `.gitignore` because the SRS is classified as internal.

## Authoritative requirements

- `Arata_TechLibrary_SRS_v1.0_2026-10-21.docx` — ATL-SRS-001 v1.0, pending stakeholder sign-off; 287 unique IDs (269 tagged functional/data/integration/quality/security/research requirements plus BR-001–BR-018). SRS §17 lists DEC-01–DEC-12.

## Engineering design package v1.0

- `README.md` — package status and caveats.
- `architecture_design.md` — modular-monolith design, trust boundaries, transactions and security.
- `database_design.md` — logical entity and integrity register.
- `database_erd.mmd` — logical Mermaid ERD.
- `openapi_design.yaml` — design-stage API inventory.
- `requirements_baseline.csv` — 269 tagged SRS requirement rows; omits BR-001–BR-018.
- `requirements_traceability_backlog.csv` — preliminary requirement/sprint/screen/API/test mapping.
- `sprint_plan.md` — 20-sprint sequence and gates.
- `wireframe_inventory.csv` — 90-screen index.

## Step 1 implementation contracts v1.0

- `README.md` — candidate status and stated limitations.
- `architecture_decisions.md` — ADR-001–ADR-010 and pending approvals.
- `authorization_policy.md` — deny-by-default policy matrix.
- `database_constraints.sql` — example post-Prisma integrity constraints, not applied migrations.
- `openapi_contracts.yaml` — 102 design contract operations; 39 flagged for specific DTOs.
- `physical_erd.mmd` — candidate physical Mermaid ERD.
- `schema.prisma` — candidate 39-model schema, not CLI validated here.
- `sprint_dependencies.csv` — 20 sprint dependency rows.
- `test_contracts.py` — static candidate contract tests.
- `traceability.csv` — 269-row implementation design mapping; omits BR-001–BR-018.

## Interactive wireframe v3.1

- `README.md` — prototype status and usage notes.
- `index.html`, `style.css`, `app.js` — editable interactive prototype; not production UI/auth/payment.
- `screen_inventory.csv` — 90 screens across eight groups; 77 R1, 12 R2, 1 R3.
- `preview_home_desktop.png`, `preview_reader_mobile.png`, `preview_publishing_studio.png`, `preview_research_dashboard.png` — representative previews.

The wireframe README mentions a separate single-file HTML export that was not present in this workspace. Its editable source is present.
