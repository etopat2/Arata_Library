# API contract validation report

## Billing runtime overlay — 2026-10-27

`billing_runtime.py` reconciles 28 running `/api/v1` billing operations with the generated OpenAPI 3.1 contract. The regenerated contract has 201 unique operations, 170 paths, 401 schemas, 201 policy rows and 201 endpoint trace rows. `api:validate` passed schema, security, example, acceptance-ID and duplicate checks; `api:test` passed 7/7 against the test-only stub, including exact billing path/DTO/finance MFA assertions. TypeScript definitions regenerated in `api/generated/v1.ts`. The billing service also has isolated PostgreSQL and HTTP authorization tests in `tests/integration/` and `database/tests/`; those results are recorded separately in `Documentation/Implementation/TEST_RESULTS.md`. The stub does not verify real gateway behavior; Flutterwave sandbox credentials are unavailable (GAP-033).

The clean Linux [API contract workflow](https://github.com/etopat2/Arata_Library/actions/runs/40501585137) passed for commit `a19e612`, including deterministic regeneration, TypeScript generation, contract tests and type checking. The final coverage report has 238 direct operation anchors among 287 preserved SRS IDs.


Date: 2026-10-23 (Africa/Kampala). Branch: `feat/api-contracts`.

| Check | Result | Evidence |
|---|---|---|
| Source and operation inventory | Passed | Preserved all 102 Step 1 candidate routes and added 88 SRS-derived operations; 190 unique operations on 160 paths. |
| OpenAPI 3.1 parse and structural validation | Passed | `python api/validate_contracts.py`; OpenAPI parser accepted the spec. |
| DTO references and examples | Passed | 359 component schemas; 87 JSON request examples and 1,900 success/problem response examples validated with JSON Schema 2020-12 and format checking. No generic `Command` or `ApiResult` response is used. |
| Security, operation IDs, controls | Passed | 190 unique operation IDs, explicit security declaration, policy, requirement IDs, acceptance IDs, rate bucket, idempotency declaration and audit event on every operation; mutation CSRF and privileged MFA/purpose headers checked. |
| Policy and SRS traceability | Passed for design | 190 policy rows and endpoint trace rows; 238 of 287 SRS IDs have direct API anchors, 49 are documented as indirect or outside this API layer. Requirement and acceptance IDs checked against the committed matrix. |
| Type generation and compile | Passed | `npm run api:types`; `npm run typecheck` in strict TypeScript mode. |
| Stub HTTP contracts and denial cases | Passed | `python -m pytest -q api/tests`: 5 tests passed; all 190 operations received a schema-valid success response from the test-only stub. Negative cases cover unknown fields, ownership, institution scope, expired entitlements, action permission, MFA, dual control, research purpose/consent, disclosure, export roles, webhook signature and immutable revisions. |
| Reconciliation generator | Passed | `python Documentation/Implementation/build_reconciliation.py --check`: 287 SRS IDs, 90 screens, 102 source candidate operations and 75 Prisma models retained. |
| Dependency audit | Passed | `npm audit --audit-level=high`: zero vulnerabilities reported. |

The test run emitted seven dependency deprecation warnings (`jsonschema.RefResolver` and the `openapi-spec-validator` convenience shortcut); it had no failures. This report verifies a **design contract and test stub only**. No NestJS endpoint, live authorization, provider signature, payment settlement, object storage, research retention or release workflow was exercised. Gateway/SSO-specific payloads and production operational limits remain decisions listed in `Documentation/Implementation/BLOCKERS.md`.
