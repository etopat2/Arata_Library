# Reconciled sprint allocation

Updated 2026-10-22. Sprint numbers are sequencing slots from the engineering design, not delivery dates or changes to SRS release targets. The per-ID assignment and stage are in [REQUIREMENT_TRACEABILITY.csv](REQUIREMENT_TRACEABILITY.csv). A business rule appears at the first sprint that must enforce it; it remains a regression invariant thereafter.

| Sprint | Reconciled focus | IDs | MVP foundation | Production launch | Planned advanced | Key exit dependency |
|---|---|---:|---:|---:|---:|---|
| S01 | Data contracts and baseline | 10 | 10 | 0 | 0 | SRS and schema review; database foundation complete, other contracts open |
| S02 | API/UX contracts and infrastructure | 20 | 19 | 0 | 1 | Threat model, DTO/authz policy, CI foundations |
| S03 | Identity, sessions, roles | 11 | 9 | 0 | 2 | Email verification, MFA and recovery tests |
| S04 | Public catalogue and free library | 10 | 9 | 0 | 1 | Public versus protected response tests |
| S05 | Publication hierarchy | 16 | 13 | 0 | 3 | Stable owner, edition and revision semantics |
| S06 | Editorial immutable release | 2 | 2 | 0 | 0 | `BR-003`, `BR-015`; approval, scan and provenance tests |
| S07 | Assets and upload safety | 14 | 12 | 0 | 2 | `BR-011`, `BR-012`; private originals and scan pipeline |
| S08 | Effective entitlements and policies | 22 | 20 | 0 | 2 | `BR-001/002/004/009/010`; negative object/action tests |
| S09 | Protected reader | 12 | 10 | 0 | 2 | Private notes and accessible reader states |
| S10 | Offline licences and sync | 13 | 0 | 12 | 1 | `BR-016`; replay, conflict and expiry tests |
| S11 | Commerce and checkout | 18 | 0 | 16 | 2 | Verified gateway semantics and plan approvals |
| S12 | Payment reconciliation | 2 | 0 | 2 | 0 | `BR-007`, `BR-008`; paid-through and webhook replay tests |
| S13 | Institutional proof and cohorts | 17 | 0 | 15 | 2 | `BR-005/006/014/017`; independent approval and privacy |
| S14 | Learning and assessment | 12 | 0 | 7 | 5 | Backend grading and code isolation |
| S15 | Search, notifications, operations | 18 | 0 | 14 | 4 | Published-only index and delivery audit |
| S16 | Research collection | 17 | 0 | 17 | 0 | Purpose gate, pseudonym boundary and retention |
| S17 | Private research metrics | 16 | 0 | 8 | 8 | Metric dictionary, quality and scoped dashboard |
| S18 | Advanced AI and public insight publication | 22 | 0 | 0 | 22 | `BR-013/018`; separate R2/R3 feature gates and disclosure approval |
| S19 | Cross-cutting performance, security and operations | 35 | 0 | 34 | 1 | Full security/accessibility/CI and restore evidence |
| S20 | Staging, UAT and launch gate | 0 direct | 0 | 0 | 0 | All R1 IDs and invariants pass; sign-off and recovery drill |
| **Total** | | **287** | **104** | **125** | **58** | |

The original engineering backlog assigned zero IDs to S06, S12 and S20. Assigning relevant `BR-*` invariants makes the editorial and reconciliation gates explicit. S20 is an acceptance gate across all R1 requirements, so its zero new-ID count is intentional. Step 1 dependency numbers differ from this engineering sequence; `ADR-OPS-001` records the interpretation. R2/R3 items appearing in early source sprints remain planned advanced capability and cannot be represented as R1 completion.

## Release gate

- **MVP foundation:** integrated prelaunch slice only. Its 104 IDs still require production evidence for R1.
- **Production launch:** 125 later R1-associated IDs plus all MVP foundation R1 IDs, with approved owner decisions and S20 quality gates.
- **Planned advanced:** 58 R2/R3-associated IDs retained in the plan, enabled only when their own prerequisites, privacy/security review and acceptance tests pass.
