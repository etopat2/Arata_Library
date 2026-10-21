# Implementation decisions

Updated: 2026-10-21. Decisions here do not amend the SRS. Material owner decisions remain open in `BLOCKERS.md`.

| ID | Status | Sources and issue | Decision and consequence |
|---|---|---|---|
| ADR-INIT-001 | Adopted for project work | SRS §1 says v1.0 awaits stakeholder sign-off; project instruction designates it authoritative. | Use the SRS as the engineering requirements baseline now. Preserve its pending formal approval state and release gate. Do not imply stakeholder sign-off. |
| ADR-INIT-002 | Adopted | SRS §8.1 contains BR-001–BR-018; engineering and Step 1 traceability exports contain only 269 other IDs. | Track all 287 SRS IDs. Treat the 18 omitted business rules as mandatory invariants and leave their release/sprint/test mappings open for refinement. No requirement is removed. |
| ADR-INIT-003 | Adopted | Source packages are locally supplied; SRS document control classifies the SRS as internal, while the GitHub remote is public. | Keep source packages local and ignored by Git. Publish only project operating/tracking metadata in this task. Source publication requires explicit authorization. |
| ADR-INIT-004 | Adopted | GitHub repository `etopat2/Arata_Library` has no branches or commits; workspace has no `.git`. | Initialize local `main`, preserve local source files, add the remote, and make an initial documentation-only commit. Verify the pushed remote ref. |
| ADR-INIT-005 | Adopted | Contracts README and `architecture_decisions.md` mark contracts and schema as candidates; 39 operations are flagged `requires-specific-DTO`. | Keep contract, schema, and prototype status as design-only. Require action-specific DTO review, `prisma validate`, migrations, transactional tests, and security tests before application claims. |
| ADR-INIT-006 | Adopted | SRS R1/R2/R3 scope and 20-sprint design plan; S06, S12, S20 have no direct IDs in the current assignment. | Treat the sprint plan as sequencing, not scope or completion evidence. Preserve all requirement IDs and refine assignments before delivery. |

## Existing design decisions retained

The Step 1 `architecture_decisions.md` contains ADR-001–ADR-010 for modular monolith, database integrity, publication revisions, additive entitlements, private assets, verified payments, research separation, public snapshots, offline limitations, and versioned API. These are design guidance subject to SRS precedence and implementation validation.
