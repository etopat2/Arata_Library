# Validation results

## Identity and account service validation - 2026-10-24

Scope: FR-IAM-001–009/011 and SEC-001/002/005/009 contributions. Wireframes: `register`, `login`, `verify-email`, `recovery`, `profile`, `privacy`, `my-sessions`; administrator screens are pending. Implementation: `apps/api/src/identity/`, `apps/web-pwa/src/AccountScreens.tsx`, `prisma/migrations/202610230001_identity_security` through `202610230007_identity_role_catalogue`, `tests/integration/identity.test.ts`, `tests/e2e/foundation.spec.ts`.

| Check | Result | Evidence / limit |
|---|---|---|
| PostgreSQL migration and drift | Passed locally | Identity preflight passed; 10 forward migrations applied to isolated development and test DBs; both Prisma migration diffs empty; 76 tables, 123 foreign keys and UTC confirmed by SQL catalog. Physical ERD regenerated. |
| Identity integration and authorization | Passed locally | 8/8 live NestJS/PostgreSQL/Redis tests: generic duplicate and recovery response, hash storage, verification token expiry/replay, password reset, lockout, CSRF, session ownership/rotation/revocation, MFA and step-up, role escalation denial, administrator invite/suspension, optional preferences, deletion request and audit reasons. Synthetic email capture only. Positive hardware passkey and institutional SSO tests remain open. |
| Foundation quality and browser | Passed locally | `npm run foundation:check`: ESLint, Prettier, strict app/package types, 13/13 Vitest tests and builds passed. `npm run test:e2e`: 4/4 Chromium tests, including account and administrator screen navigation and legal-policy registration gate. The administrator view test uses mocked responses; API authorization is checked separately by live integration tests. Full account browser journeys remain open. |
| Existing database and design contract | Passed locally | `npm run db:test`: 8/8 constraints. `npm run api:validate`: 190 design operations validated; `npm run api:test`: 5/5 stub contract tests. These do not prove live identity route conformance; API drift is GAP-016. |
| Dependency and traceability | Passed locally | `npm audit --audit-level=high`: zero reported vulnerabilities. `build_reconciliation.py --check`: 287 original SRS IDs, 90 screens, 76 Prisma models; 14 rows explicitly marked partial. |

Approved terms/privacy documents, SSO provider, export/retention processor, independent administrator role approval, positive passkey device tests and live OpenAPI reconciliation remain open. Registration stays unavailable without approved versions and URLs. Local and hosted checks do not establish production release readiness.

Hosted runs for commit `c35cf9b`: [API contracts](https://github.com/etopat2/Arata_Library/actions/runs/40026759118), [database](https://github.com/etopat2/Arata_Library/actions/runs/40026759185) and [application foundation](https://github.com/etopat2/Arata_Library/actions/runs/40026759299) all passed, including container build and running-service smoke. The later administrator PWA screen extension has local type, build and browser validation; hosted rerun is pending its push.

Updated: 2026-10-22. Results are grouped by completed task; application behavior and release acceptance remain untested.

| Check | Result | Evidence / limitation |
|---|---|---|
| Git repository and remote inspection | Passed | Local folder had no `.git`; GitHub API reported repository size 0 and zero branches; `git ls-remote` returned no refs. |
| Documentation inventory | Passed | 29 source files across SRS, engineering package, Step 1 contracts, and wireframe package were enumerated. |
| SRS-to-baseline ID reconciliation | Passed with gap recorded | 287 unique SRS IDs; existing baseline and contract traceability each contain 269; 18 omitted IDs are BR-001–BR-018. |
| Wireframe inventory comparison | Passed with source gap recorded | Engineering and wireframe inventories contain the same 90 screens; mapped screen IDs are valid. The initial source mapping left 59 screens without a direct link; the later reconciliation provides explicit anchors for all 90. |
| Contract static inspection | Passed with gap recorded | Step 1 README declares 102 operations and 39 Prisma models; 39 operation flags say `requires-specific-DTO`. No claim of OpenAPI or Prisma runtime validation. |
| Initial tracker integrity | Passed at initial inventory | Python CSV check: 287 unique IDs exactly matched SRS extraction, including all 18 BR IDs; all mapped screens existed. Subsequent database work updated implementation statuses without claiming service completion. |
| Existing `test_contracts.py` | Passed | Isolated temporary Python environment with pytest/PyYAML: `python -m pytest -q Documentation/Arata_TechLibrary_Step1_Implementation_Contracts_v1.0/test_contracts.py` returned 5 passed. These tests assess design contracts, not the app. |
| Application tests | Not applicable | No application exists and none was built in this task. |

## PostgreSQL foundation validation — 2026-10-22

| Check | Result | Evidence / limitation |
|---|---|---|
| Prisma format, validate, generate; TypeScript strict typecheck | Passed | Prisma 7.10.1 client generated; `tsc --noEmit` clean. |
| Local PostgreSQL migration deploy and status | Passed | Fresh `arata_techlibrary_dev` and `_test` each applied three versioned migrations; dev status up to date. |
| Migration-to-database and migration-to-schema diffs | Passed | Both `prisma migrate diff --exit-code` checks report no difference. |
| SQL catalog and role verification | Passed | PostgreSQL 18.4, UTC, 75 tables, 122 FKs, 55 checks, 28 user triggers, 23 enums; four direct role logins confirmed allowed and denied queries. |
| Transactional constraint suite | Passed | 8/8 tests on isolated test DB: FK, uniqueness, immutable publishing, entitlement expiry, institution membership, payment idempotency, research deduplication, deletion/retention. |
| Development seed and physical ERD | Passed | Labelled draft-only sample; 75-table, 122-relationship Mermaid/DOT/SVG generated from PostgreSQL catalog. |
| Dependency audit | Passed | `npm audit --omit=dev` reported zero vulnerabilities. |
| Restore and application security tests | Open | Timed restore, server authorization, payment provider signatures, key management, retention worker and disclosure workflow need future services. |

## Database environment and CI checks — 2026-10-22

| Check | Result | Evidence / limitation |
|---|---|---|
| Compose definition | Passed locally | `docker compose --env-file .env.compose.local -f compose.database.yaml config --quiet`. |
| Compose secret initialization | Passed locally | 72-character random hex password stored in ignored `.secrets`; initializer refused to overwrite it on second run. No secret value printed. |
| Clean dependency install, audit and SBOM | Passed locally | `npm ci`; `npm audit --audit-level=high` found zero vulnerabilities; `npm sbom --package-lock-only --sbom-format=cyclonedx` generated 191 components. |
| Docker container execution and database pipeline | Passed in GitHub Actions | [Main run 39727484615](https://github.com/etopat2/Arata_Library/actions/runs/39727484615): PostgreSQL 18.4 container healthy; provision, migrations, grants, schema drift, role checks, 8/8 tests, dependency audit, SBOM upload and cleanup all succeeded. |
| SBOM artifact | Passed | `arata-database-sbom` artifact uploaded in run 39727149026; 26,269 bytes; SHA-256 digest recorded by GitHub Actions. |

## Requirements reconciliation validation — 2026-10-22

| Check | Result | Evidence / limitation |
|---|---|---|
| Authoritative SRS extraction | Passed | `build_reconciliation.py --check`: 287 unique SRS IDs, including 18 business rules; all 269 tagged requirement texts match the engineering baseline after whitespace normalization. SRS SHA-256: `e0beab52f205a4449d46bef4bd2368d82766dd53184024cefb4ce5d2746979e2`. Source file was read only. |
| Requirement and acceptance coverage | Passed for design inventory | 287 matrix rows and 287 unique `T-*` acceptance IDs; each has an observable statement, boundary/negative case and SRS verification method. No application acceptance test has run. |
| Wireframe and navigation inventory | Passed for static source | 90 unique screen IDs match `app.js`; all 90 have a requirement anchor. Static case extraction found contextual incoming links for 41 and outgoing links for 42 screens; all have Screen Explorer/hash access. Runtime keyboard navigation remains to test. |
| OpenAPI operation inventory | Passed for design inventory | 86 paths and 102 operations parsed; all have proposed SRS anchors. Step 1 directly linked 40 operations; 39 operations still carry `requires-specific-DTO`. 22 operations have no cookie security declaration, including two session-management routes requiring review. |
| Physical database mapping | Passed for names only | All named model anchors exist among 75 Prisma models. This does not verify missing required fields, relationships or service behavior; see REC-01–20. |
| Source Step 1 static contract tests | Passed | `python -m pytest -q Documentation/Arata_TechLibrary_Step1_Implementation_Contracts_v1.0/test_contracts.py`: 5 passed. These validate candidate contracts only. |
| Generated-record reproducibility | Passed | Regeneration followed by `python Documentation/Implementation/build_reconciliation.py --check` produced byte-identical CSV files. |
| Application E2E, authorization, accessibility and security tests | Not run | No application API or PWA exists. Requirement acceptance rows remain test plans rather than execution evidence. |

## Versioned API contract validation - 2026-10-23

| Check | Result | Evidence / limit |
|---|---|---|
| OpenAPI 3.1 and examples | Passed | `python api/validate_contracts.py`: 190 operations, 160 paths, 359 schemas, 190 policies and trace rows; 87 request and 1,900 response/error examples validated. |
| Source reconciliation | Passed | `python Documentation/Implementation/build_reconciliation.py --check`: 287 original SRS IDs, 90 screens, 102 Step 1 candidate routes and 75 database models retained. The standalone v1 design has 88 additional operations. |
| Type generation and strict compilation | Passed | `npm run api:types`; `npm run typecheck`. Generated `api/generated/v1.ts` is committed. |
| Test-only HTTP stub and authorization rules | Passed | `python -m pytest -q api/tests`: 5 tests passed, all 190 operations exercised; negative object, tenant, entitlement, action, MFA, purpose, disclosure, webhook, export and immutable-revision cases passed. Seven dependency deprecation warnings. |
| Dependency audit | Passed | `npm audit --audit-level=high` reported zero vulnerabilities. |
| Live API integration, E2E and security | Not run | No NestJS API exists; stub outcomes are contract validation only. Provider-specific callbacks, SSO, uploads, payments and research release still require live implementation tests. |

## Runnable foundation validation - 2026-10-23

Scope: FR-OFL-001/002 shell contribution; FR-OPS-006 health contribution; INT-001/003/005/009; NFR-OPS-004/005/006/007/008; SEC-001/006/007. Wireframes: N/A for foundation shell; `system-health` remains a future administrator screen. Paths: `apps/`, `packages/`, `infrastructure/`, `compose.foundation.yaml`, `.github/workflows/foundation.yml`, `tests/`.

| Check | Result | Evidence / limit |
|---|---|---|
| Clean dependencies | Passed | `npm ci --legacy-peer-deps` installed 781 packages; `.npmrc` now selects the same mode for ordinary `npm ci`. `npm ci --dry-run --ignore-scripts --no-audit` succeeded. |
| Lint, strict types, integration, build | Passed | `npm run foundation:check`: ESLint and Prettier clean, all workspace TypeScript packages and apps checked, 5/5 Vitest tests passed (including real PostgreSQL and authenticated Redis), API/PWA/worker builds passed. |
| Browser and offline PWA | Passed | `npm run test:e2e`: 2/2 Chromium-channel Chrome tests passed against built preview; live API status, theme control, light theme primary text contrast at least 4.5:1, manifest, service worker activation and offline shell reload verified. |
| Live services | Passed locally | PostgreSQL 18.4 `arata_techlibrary_dev` remained intact; `/api/v1/health/live` and service-authenticated `/ready` returned 200. Worker started and real BullMQ job test passed. |
| Existing database and contract suites | Passed | `npm run db:validate`, `npm run db:migrate:status`, `npm run db:verify` (75 tables, 122 FKs, 3 complete migrations and isolated roles), `npm run db:test` (8/8), `python api/validate_contracts.py` (190 operations), `npm run api:test` (5/5), and reconciliation `--check` (287 IDs, 90 screens). |
| Dependency and Compose checks | Passed for available local checks | `npm audit --audit-level=high` found zero vulnerabilities; CycloneDX SBOM generated for 767 nonoptional components; foundation Compose config passed with local values supplied only for interpolation. Parsed service configuration exposed only `API_HOST`, `DATABASE_URL`, `HEALTH_TOKEN`, `WEB_ORIGIN` to API and only `REDIS_URL` to worker. |
| Container runtime and GitHub CI | Passed in GitHub Actions | Docker Desktop Windows service is stopped and cannot be started in this session. [Foundation CI run 39939266083](https://github.com/etopat2/Arata_Library/actions/runs/39939266083) passed provisioning, application checks, browser tests, audit, SBOM, Docker image build and running-container smoke (API liveness/readiness, web shell/proxy, BullMQ worker job). Foundation, database and API contract workflows passed on both push and PR for commit `27c7aaa`. |

These checks cover the foundation only. The other 188 versioned operations and domain feature acceptance remain open. The earlier “No NestJS API exists” statement above records the prior contract-stage result.
