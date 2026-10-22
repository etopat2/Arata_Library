# Open gaps and blockers

Updated: 2026-10-22. These are preparation findings, not claims that the project is blocked in full.

| ID | Severity | Scope | Next action |
|---|---|---|---|
| GAP-001 | Release gate | SRS v1.0 stakeholder approval is pending. | Obtain recorded product, engineering, security/privacy, publishing, and QA sign-off before release. Continue implementation planning against the SRS. |
| GAP-002 | Contract | 39 of 102 Step 1 OpenAPI operations carry `requires-specific-DTO`; design-stage contracts are not implementation-ready. | Specify request/response DTOs, errors, authorization, and negative tests per operation before building each module. |
| GAP-003 | Resolved for database foundation | Candidate 39-model schema lacked SRS domains and SQL integrity rules. | Replaced with validated 75-model schema, three applied migrations and eight passing database tests; service behavior is tracked separately. |
| GAP-004 | Traceability | 18 SRS business rules are absent from source traceability; 59 of 90 wireframe screens have no direct requirement link in the source mapping. | Refine screen, API, sprint, and test mappings during module planning without dropping BR rules or treating every screen as an independent requirement. |
| GAP-005 | Business/provider | SRS DEC-01–DEC-12 remain open: legal publisher/rights, prices/trial/refunds, gateway and recurring capability, hosting RPO/RTO, upload policy, offline terms, institution proof, research lawful basis/retention/disclosure, role separation, certification/AI/classroom scope, and capacity/cost. | Use configurable, deny-by-default technical boundaries. Obtain accountable decisions before corresponding production capability or release. |
| GAP-006 | Content | Approved manuscripts, teaching assets, final rights, and publisher review are not supplied as deployable content. | Keep future content unpublished until supplied and approved; do not fabricate production books. |
| GAP-007 | Source package | Wireframe README references a companion single-file HTML export that is not present; editable `index.html`, CSS, JS, CSV and previews are present. | Use editable wireframe source as UI reference and request export only if needed. |
| GAP-008 | Repository | Public GitHub remote now has project history; internal source documents remain local only. | Continue keeping source packages out of public commits. Establish a secure sharing route if collaborators need them. |
| GAP-009 | Release gate | DR-006 encrypted identity mapping service and key management, DR-009 timed restore drill, and scheduled retention execution are not delivered by the schema. | Implement and validate these before release. |
| GAP-010 | Validation environment | Docker Desktop engine is stopped and cannot be started from this Windows session. Compose syntax and secret generation pass locally, but container execution has not run here. | Run the feature-branch GitHub Actions database job on an ephemeral PostgreSQL container; retain this gap until the job passes. |

No application API, CI pipeline, or deployable service exists yet. The local database foundation and development configuration are present.
