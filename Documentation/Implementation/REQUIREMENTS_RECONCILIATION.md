# Arata TechLibrary requirements and design reconciliation

Updated 2026-10-22. Baseline: `ATL-SRS-001` v1.0, dated 2026-10-21. Stakeholder sign-off remains pending. This review changes implementation planning records only; it does not amend the SRS or claim that a design prototype is a working service.

## Scope and evidence

The local, Git-ignored SRS is the authority. The engineering design package, Step 1 contracts and wireframe v3.1 are candidate designs. The tracked implementation consists of the 75-model Prisma schema, three migrations, a physical ERD, database tests and database CI. There is no application API, web PWA, worker, private object store or deployment yet.

| Evidence | Reconciliation result |
|---|---|
| SRS requirement tables and business-rule table | 269 tagged IDs and 18 `BR-*` invariants; 287 unique IDs. Every tagged requirement's wording matches the engineering CSV after whitespace normalisation. |
| Wireframe inventory and `app.js` | 90 unique hash-addressable screens in eight groups: 77 R1, 12 R2, 1 R3. Each appears in the Screen Explorer and in [SCREEN_NAVIGATION.csv](SCREEN_NAVIGATION.csv). |
| Step 1 OpenAPI | 86 paths, 102 operations, 14 component schemas. All operations are design-only; 39 explicitly require action-specific DTOs. |
| Current database | 75 Prisma models and 23 enums across `app`, `research` and `research_private`; 3 migrations, 122 FKs, 55 checks and 28 triggers were verified in the prior database module. Physical [ERD](../../database/erd/arata-physical.mmd) and [validation report](../../database/VALIDATION_REPORT.md) are retained. |
| Source backlog | 269 tagged IDs mapped to 20 sprint slots; no `BR-*` entries. S06, S12 and S20 had zero directly assigned IDs. |

The 287 IDs break down as 159 `FR`, 45 `RAI`, 30 `NFR`, 15 `SEC`, 10 `DR`, 10 `INT` and 18 `BR`. The tagged requirements retain 213 R1, 52 R2 and 4 R3 targets. No ID was renumbered.

The updated [traceability matrix](REQUIREMENT_TRACEABILITY.csv) retains the original IDs and implementation status, adds SRS text, a responsible module, delivery stage, physical model anchors and explicit screen/API contract states. [ACCEPTANCE_CRITERIA.csv](ACCEPTANCE_CRITERIA.csv) supplies an observable rule, a negative or boundary case and evidence method for each ID. These are acceptance design, not executed tests. Step 1 directly linked only 40 of 102 operation routes; this review gives all 102 a proposed SRS anchor in [API_CONTRACT_AUDIT.csv](API_CONTRACT_AUDIT.csv). Route existence and table existence do not prove feature behavior. Broad source mappings remain labelled provisional and must be narrowed during each module's contract review.

## Design artefacts reviewed

- The engineering logical ERD and data dictionary describe domain relationships and recommended constraints. The Step 1 physical ERD/39-model Prisma file and `database_constraints.sql` are candidates. The tracked 75-model schema, three migrations and generated physical ERD supersede their table layout for implementation, while SRS data requirements still govern. The current schema enforces hierarchy, published-revision immutability, grant windows, verified-payment sources, institution evidence and research separation; [GAP_DEPENDENCIES.md](GAP_DEPENDENCIES.md) records omitted attributes and services.
- The engineering OpenAPI design and Step 1 contract have the same 86 paths and 102 method/path pairs. Step 1 adds contract detail but has only 14 component schemas and 39 `requires-specific-DTO` flags. Twenty-two operations omit a cookie security declaration; public routes and signed webhooks need distinct schemes, but `GET /auth/sessions` and `DELETE /auth/sessions/{id}` require explicit authenticated-session contracts.
- The Step 1 `authorization_policy.md` describes deny-by-default action/object checks, independent entitlements, restricted research, MFA, CSRF and dual control. No current API enforces it. The wireframe role switch is a demonstration only. Each privileged operation needs a tested principal/scope/object matrix, including indirect IDs and research versus general administration.
- The engineering backlog assigns 269 tagged requirements to 20 slots, while Step 1 `sprint_dependencies.csv` uses different slot meanings. [SPRINT_ALLOCATION.md](SPRINT_ALLOCATION.md) keeps source targets, assigns omitted business rules and states dependencies explicitly.

## Confirmed product rules

| Domain | SRS confirmation and current design interpretation |
|---|---|
| Books and versions | `FR-PUB-001–016`, `FR-CAT-001–010`, `BR-003`, `BR-015`: a publication can stand alone or own ordered volumes; editions own revisions; only approved exact revisions publish; released revisions and their evidence remain immutable. Existing database hierarchy checks are useful, but bibliographic and rights fields need refinement. |
| Free and premium | `FR-CAT-006`, `FR-AST-002`, `FR-ENT-001–004`, `BR-001–004`: public-free access works anonymously, registered-free requires sign-in, and premium depends on current server-resolved grants and publication state. |
| Trials, subscriptions and grants | `FR-ENT-002–006`, `FR-PAY-001–018`, `BR-004`, `BR-007–008`: independent grants are additive; cancellation preserves the paid-through period; payment activation requires verified settlement, atomic state change and idempotency. Pricing, trial policy and gateway capabilities await owner decisions. |
| Institutions and exemptions | `FR-INS-001–013`, `BR-005–006`, `BR-014`, `BR-017`: verified email and exact approved domain are necessary where configured, and membership/roster/SSO/manual evidence follows institution policy. Institution managers cannot approve their own domains or read private learner notes. |
| Content actions | `FR-ENT-007–013`, `FR-RDR-007`, `BR-009–012`: read, select/copy, print, download, export, share and offline actions need separate effective policy decisions. Copy/print controls are deterrents; a browser cannot prevent OS screenshots or all copying of rendered content. Original assets stay private. |
| Offline | `FR-OFL-001–012`, `BR-016`: bounded server-issued licences, private cache, idempotent replay, conflict handling and expiry on the device. Remote revocation takes effect on reconnection, not instantly while disconnected. |
| Interactive learning | `FR-LRN-001–012`, `FR-AI-001–008`: backend-graded versioned quizzes; isolated client code lab; container-isolated server-language execution if enabled; projects, roadmaps, credentials and optional grounded AI follow their SRS release targets. |
| Publishing | `FR-PUB-004`, `FR-PUB-008–016`, `FR-AST-003–012`, `BR-015`: quarantine, rights evidence, editorial review, publisher approval, scheduling, withdrawal, provenance, immutable released revision and exact checksums. |
| Payments, notifications and reporting | `FR-PAY-003–018`, `FR-OPS-001–006`: gateway-specific verification and reconciliation, invoices/refunds with original history, preference-aware transactional notices and scoped finance reports. |
| Independent Research and Insights | `RAI-COL-001–017`, `RAI-ANA-001–016`, `DR-006`, `BR-013`: collection is purpose-gated and minimised, identity linkage is more restricted than research events, and private dashboards require explicit research permission and MFA. Ordinary admin status is insufficient. |
| Approved public statistics | `RAI-PUB-001–012`, `BR-018`: only precomputed immutable aggregate snapshots pass disclosure checks, approval and differencing review. Minimum group size 30 is a proposal, not an approved fixed policy. R2 publication does not turn private R1 research dashboards public. |
| Administration, security and recovery | `FR-OPS-*`, `NFR-OPS-*`, `SEC-*`, `DR-009`: scoped administration, immutable audit, least privilege, incident response, environment separation, CI, backups and timed restore drills. Database CI is present; application, staging and recovery evidence remain open. |

## Conflicts and overlap

1. **SRS release versus wireframe labels.** Seven screens precede their anchored SRS feature: `edition-history`, `my-sessions`, `support`, `bulk-import`, `release-schedule`, `finance-dashboard` and `classroom`. The screen may be a design shell earlier, but functionality stays at the SRS R2/R3 target unless a formally approved change is made. `SCREEN_NAVIGATION.csv` flags each case.
2. **Sprint numbering.** Engineering S02 is design/infrastructure, while Step 1 S02 is database/auth. Keep the original requirement IDs and R1/R2/R3 targets; use the updated allocation as a dependency plan, not a SRS amendment. See `ADR-OPS-001` and [SPRINT_ALLOCATION.md](SPRINT_ALLOCATION.md).
3. **Candidate SQL versus current database and SRS governance.** Step 1 `database_constraints.sql` references candidate `PlanPrice` and `CourseProgress` tables not present in the applied schema, and fixes public group size at 30. The SRS calls 30 an initial proposal subject to policy approval. Do not execute this example SQL against the current database; retain versioned migrations and configurable disclosure policy.
4. **Repeated invariants are deliberate.** `FR-CAT-006`/`BR-001`, `FR-ENT-004`/`BR-004`, `FR-PAY-006`/`BR-008`, `FR-ENT-011`/`BR-011`, `FR-RDR-005`/`BR-017`, and `RAI-PUB-001`/`BR-018` overlap as feature behavior and cross-feature guardrails. Keep both IDs and use shared test evidence where a test genuinely covers both. No duplicate SRS ID, exact duplicate requirement body or duplicate OpenAPI `operationId` was found.
5. **Prototype status.** The wireframe can show role switches, payments, uploads and statistics, but those are demonstrations. The source README warns that no production authentication, payment, upload or telemetry exists. Its HTML metadata says “nine platform areas” while the screen inventory and navigation define eight groups; use the 90-screen inventory as the UI reference.

## Acceptance and release classification

The matrix assigns 104 IDs to an **MVP foundation** integration slice, 125 to **production launch**, and 58 to **planned advanced** work. This is sequencing only: all 229 R1-associated IDs remain launch obligations, including any first exercised in the MVP slice. The advanced set contains 52 R2 tagged requirements, 4 R3 tagged requirements and 2 R2-associated business rules. `BR-*` had no independent SRS priority/release field; associations are explicit proposals, not invented SRS targets.

See [GAP_DEPENDENCIES.md](GAP_DEPENDENCIES.md), [IMPLEMENTATION_ASSUMPTIONS.md](IMPLEMENTATION_ASSUMPTIONS.md), [RISK_REGISTER.md](RISK_REGISTER.md) and [PROPOSED_CLARIFICATIONS.md](PROPOSED_CLARIFICATIONS.md) for unresolved implementation and owner decisions.

## Reproduce the coverage check

With the ignored source packages present locally, install `reconciliation-requirements.txt` and run `python Documentation/Implementation/build_reconciliation.py --check`. The check compares the SRS and design exports, verifies all IDs, screens, operations, model names and acceptance records, and confirms generated CSV bytes. Running the script without `--check` regenerates only the four tracked CSV inventories; it never writes to the SRS or source packages. Results are recorded in [TEST_RESULTS.md](TEST_RESULTS.md).
