# Proposed clarifications for accountable review

Updated 2026-10-22. These questions are separate from the authoritative SRS. They are not approvals, implementation defaults or permission to reduce scope.

| ID | SRS IDs | Clarification requested | Safe work while open |
|---|---|---|---|
| CLR-01 | `FR-PUB-006–007`, `DR-007` | Which legal entity owns the catalogue and each work, what author/publisher and licence evidence is mandatory, and when may ISBN/edition metadata be displayed? | Add flexible provenance/rights schema; do not invent production book credentials. |
| CLR-02 | `FR-PAY-001–018` | Approve UGX prices, plan scopes, trial terms, refund rules, tax invoice fields and renewal wording. | Keep amounts/terms configurable and no live checkout. |
| CLR-03 | `FR-PAY-004–010`, `INT-006` | Select gateway API/version and verify exact MoMo/card, callback, settlement and recurring capabilities. | Adapter interface and test fixtures only; never trust redirect success. |
| CLR-04 | `FR-INS-001–013` | Define accepted domain-ownership and membership evidence, revalidation cycle, capacity and agreement terms per institution. | Deny benefit activation without approved evidence. |
| CLR-05 | `FR-ENT-007–013`, `FR-OFL-001–012` | Approve content action defaults, licence duration, device limits, watermark identity and user-facing screenshot/offline terms. | Fail closed on protected actions; use truthful deterrent language. |
| CLR-06 | `RAI-COL-001–017`, `DR-005–006` | Approve lawful basis, optional consent granularity, retention by data class, child-related suppression and mapping-service key ownership. | Disable optional research collection and keep restricted schemas. |
| CLR-07 | `RAI-PUB-001–012` | Approve minimum group size and complementary/differencing thresholds, reviewer independence, exception authority and withdrawal policy. | Keep public research publication disabled; no arbitrary public query. |
| CLR-08 | `NFR-OPS-001–003` | Set RPO, RTO, backup retention, restore evidence and hosting responsibilities. | Document recovery procedure and test with disposable data. |
| CLR-09 | `FR-LRN-008–012`, `FR-AI-001–008` | Approve credential, server-language code, classroom and external AI provider scope before activation. | Build interfaces with feature gates; do not send private content externally. |
| CLR-10 | `FR-IAM-009`, `FR-PUB-010/012`, `FR-AST-007`, `FR-PAY-018`, `FR-OPS-005`, `FR-LRN-012` | Should seven wireframe screens with earlier release labels remain preview shells, or should labels be corrected to the SRS R2/R3 targets? | SRS target governs delivery; retain screen design as reference. |
| CLR-11 | `BR-001–018` | Confirm the proposed feature-dependent R1/R2 associations and S06/S12 invariant allocation. | Keep every invariant in the matrix and test plan. |
| CLR-12 | `INT-001–010`, `SEC-001–015` | Approve the exact authorization policy, DTO/error contract and tenant scope per operation, especially session management and research events. | Deny privileged operations until reviewed contracts and guards exist. |
