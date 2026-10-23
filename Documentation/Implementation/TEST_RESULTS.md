# Validation results

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
