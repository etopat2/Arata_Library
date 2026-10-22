# Open gaps and blockers

Updated: 2026-10-22. These are preparation findings, not claims that the project is blocked in full.

| ID | Severity | Scope | Next action |
|---|---|---|---|
| GAP-001 | Release gate | SRS v1.0 stakeholder approval is pending. | Obtain recorded product, engineering, security/privacy, publishing, and QA sign-off before release. Continue implementation planning against the SRS. |
| GAP-002 | Contract | 39 of 102 Step 1 OpenAPI operations carry `requires-specific-DTO`; design-stage contracts are not implementation-ready. | Specify request/response DTOs, errors, authorization, and negative tests per operation before building each module. |
| GAP-003 | Resolved for database foundation | Candidate 39-model schema lacked SRS domains and SQL integrity rules. | Replaced with validated 75-model schema, three applied migrations and eight passing database tests; service behavior is tracked separately. |
| GAP-004 | Mapping quality | Source exports omit 18 business rules and use broad screen/API links. Step 1 directly links only 40 of 102 operation routes; the reconciled matrix now anchors all 287 IDs, 90 screens and 102 operations, with semantics still provisional. | Review per-operation DTO, object scope, screen workflow and negative tests during module refinement; see `GAP_DEPENDENCIES.md` REC-16/17. |
| GAP-005 | Business/provider | SRS DEC-01–DEC-12 remain open: legal publisher/rights, prices/trial/refunds, gateway and recurring capability, hosting RPO/RTO, upload policy, offline terms, institution proof, research lawful basis/retention/disclosure, role separation, certification/AI/classroom scope, and capacity/cost. | Use configurable, deny-by-default technical boundaries. Obtain accountable decisions before corresponding production capability or release. |
| GAP-006 | Content | Approved manuscripts, teaching assets, final rights, and publisher review are not supplied as deployable content. | Keep future content unpublished until supplied and approved; do not fabricate production books. |
| GAP-007 | Source package | Wireframe README references a companion single-file HTML export that is not present; editable `index.html`, CSS, JS, CSV and previews are present. | Use editable wireframe source as UI reference and request export only if needed. |
| GAP-008 | Repository | Public GitHub remote now has project history; internal source documents remain local only. | Continue keeping source packages out of public commits. Establish a secure sharing route if collaborators need them. |
| GAP-009 | Release gate | DR-006 encrypted identity mapping service and key management, DR-009 timed restore drill, and scheduled retention execution are not delivered by the schema. | Implement and validate these before release. |
| GAP-010 | Resolved for database CI | Docker Desktop engine was unavailable in the Windows session. | [Main CI run 39727484615](https://github.com/etopat2/Arata_Library/actions/runs/39727484615) passed the complete PostgreSQL container path. Local Docker remains optional for developers with a running engine. |
| GAP-011 | Data/contract refinement | The database passes physical integrity checks but lacks several SRS-required bibliographic, action-policy, notification and report-provenance fields and operational entities. | Review REC-01–04, REC-11 and REC-13 before additive schema migrations; do not treat current models as complete service contracts. |
| GAP-012 | Release alignment | Seven wireframe screen labels precede their anchored SRS R2/R3 features. | Keep SRS targets; obtain product clarification on screen labels or preview-shell treatment (CLR-10). |

No application API or deployable service exists yet. The database CI pipeline and local database foundation are present; full application CI gates remain open.
