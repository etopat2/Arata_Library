# Implementation assumptions register

Updated 2026-10-22. These are engineering planning assumptions, not SRS amendments or business approvals. Each is reversible before the affected module is released. Material owner questions are listed in [PROPOSED_CLARIFICATIONS.md](PROPOSED_CLARIFICATIONS.md).

| ID | Assumption | Basis and consequence | Validation or owner checkpoint |
|---|---|---|---|
| ASM-01 | The SRS v1.0 remains the working engineering baseline while formal approval is pending. | Project instruction and SRS document control; no requirement is dropped. | Record SRS sign-off before production launch. |
| ASM-02 | MVP foundation is an internal build slice, not a reduced R1 release. | The SRS defines R1/R2/R3, not an MVP waiver. | All R1 acceptance IDs must pass the launch gate. |
| ASM-03 | `BR-*` rules inherit the release of the feature they constrain. | SRS §8.1 gives no separate priority/release column. The matrix labels associations as proposed. | Confirm associations with product/security reviewers. |
| ASM-04 | Screen labels and routes are design references; the 90-screen CSV and `app.js` navigation are the current inventory. | Wireframe README explicitly describes a prototype. | UX review of contextual, keyboard and mobile navigation. |
| ASM-05 | A screen may be designed before its functionality is released. | Seven source release labels precede anchored SRS targets. | Keep capability unavailable until its SRS release or obtain formal scope change. |
| ASM-06 | A real OpenAPI path is only a candidate trace link until method, DTO, object scope, errors and test are reviewed. | 39 operations are flagged; 62 lacked direct links in Step 1 and now have proposed anchors. | Operation-level contract refinement. |
| ASM-07 | Prisma models are physical anchors, not proof of workflows. | Current database module has 75 models and successful constraint tests but no service. | Service transaction, authz and E2E tests. |
| ASM-08 | Public-free, registered-free and premium are distinct access classes; valid grants compose as a union. | SRS `BR-001–004`; existing `AccessClass` and `Entitlement` design. | Entitlement resolver tests under simultaneous and expired grants. |
| ASM-09 | Browser copy/print controls and screenshot notices are deterrents. | SRS `FR-ENT-011–012`, `BR-011`; wireframe disclaimer. | UX/legal copy review and protected file authorization tests. |
| ASM-10 | Institution domain proof never substitutes for membership evidence unless an approved policy expressly permits it. | SRS `FR-INS-003–005`, `BR-005–006`. | Institution policy and owner verification decision. |
| ASM-11 | Public insight data is served only from approved, immutable, fixed-shape snapshots. | SRS `RAI-PUB-001–012`, `BR-013`, `BR-018`. | Disclosure policy and independent approval tests. |
| ASM-12 | Research collection is off for optional purposes until lawful basis and preference semantics are approved. | SRS `RAI-COL-006`, `DR-005–006`; current database separates schemas. | Privacy/legal review, key-management design. |
| ASM-13 | No unconfirmed automatic recurring billing, trial duration, price or refund promise is shown as live. | SRS payment requirements and open `DEC-02–04`. | Verified gateway and owner-approved terms. |
| ASM-14 | Database migrations remain forward-only and additive until a reviewed data preservation plan exists. | Existing migrations and `database/README.md` recovery procedure. | Backup, migration compatibility and restore drill. |
