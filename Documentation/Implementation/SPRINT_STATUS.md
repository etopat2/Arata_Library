# Sprint status

Updated: 2026-10-22. The source plan proposes 20 two-week sequencing units; durations are not delivery commitments.

| Sprint | Source goal | Status | Current note |
|---|---|---|---|
| S01 | Initiation and design/contracts | In progress | Inventory, operating rules, database CI and full SRS reconciliation complete; action-specific contracts, application environments and threat model remain. |
| S02–S20 | Design system through staging/UAT | Not started | Reconciled per-ID allocation is in `SPRINT_ALLOCATION.md`; source sprint numbers remain planning aids and service work has not started. |

Database foundation completed across S01/S05/S08/S11/S13/S16/S18: 75 models, three migrations, development roles, ERD, seed and eight passing constraint tests. The application services and release acceptance for those sprints remain open.

S01/S02 infrastructure contribution: isolated PostgreSQL Compose service, secret-file bootstrap and database CI workflow passed local checks and [main CI run 39727484615](https://github.com/etopat2/Arata_Library/actions/runs/39727484615). Full application CI gates remain open. Engineering and Step 1 packages assign different sprint numbers; ADR-OPS-001 records the sequencing interpretation.

The reconciled allocation assigns `BR-003/015` to S06 and `BR-007/008` to S12. S20 remains the all-R1 staging/UAT gate without new IDs. All R1/R2/R3 targets are preserved; advanced features in early source sprints remain gated by their SRS release.
