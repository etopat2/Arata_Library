# Sprint status

Updated: 2026-10-24. The source plan proposes 20 two-week sequencing units; durations are not delivery commitments.

| Sprint | Source goal | Status | Current note |
|---|---|---|---|
| S01 | Initiation and design/contracts | In progress | Inventory, database CI, reconciliation, v1 API design contract and runnable API/PWA/worker foundation are verified. Product services, threat model and staging environment remain. |
| S02?S20 | Design system through staging/UAT | S03/S04 in progress; other feature sprints not started | Identity and public catalogue have live partial implementation. Reconciled per-ID allocation remains in `SPRINT_ALLOCATION.md`; release acceptance is open. |

The initial database foundation delivered 75 models and three migrations. Identity and catalogue extensions now bring the physical design to 78 tables, 125 foreign keys and 13 applied migrations in development and test. Product service and release acceptance remain separate.

S01/S02 infrastructure contribution: isolated PostgreSQL Compose service, secret-file bootstrap and database CI workflow passed local checks and [main CI run 39727484615](https://github.com/etopat2/Arata_Library/actions/runs/39727484615). The application foundation passed local lint, type, build, integration and browser checks plus [foundation CI run 39939266083](https://github.com/etopat2/Arata_Library/actions/runs/39939266083), including image build and running-container smoke. Engineering and Step 1 packages assign different sprint numbers; ADR-OPS-001 records the sequencing interpretation.

The reconciled allocation assigns `BR-003/015` to S06 and `BR-007/008` to S12. S20 remains the all-R1 staging/UAT gate without new IDs. All R1/R2/R3 targets are preserved; advanced features in early source sprints remain gated by their SRS release.

S03 identity implementation is in progress: verified-email registration, recovery, sessions, TOTP, optional passkeys, account preferences, invitation and administrator controls have live API code and local integration checks. FR-IAM-007 export/retention, FR-IAM-010 institutional SSO, legal policy approval, independent administrator-role approval and live OpenAPI reconciliation remain open. The `register`, `login`, `verify-email`, `recovery`, `profile`, `privacy`, `my-sessions`, `user-admin` and `roles-admin` wireframe flows have a connected PWA implementation.

S04 public discovery is in progress: real PostgreSQL-backed home, collections, catalogue, search, publication, edition, TOC, sample, free library and resource detail paths are connected to the PWA. FR-CAT-001–008/010 and FR-SRC-001–004/006 have tested contributions, including subject, author, volume, edition and resource-format facets. FR-CAT-003/005/009, reader-authorized and intra-book search, entitlement states, asset downloads, live OpenAPI alignment and manual accessibility acceptance remain open. The S04 UI tests use labelled development-only synthetic records.
