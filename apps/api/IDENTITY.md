# Identity and account service

The NestJS API serves identity routes under `/api/v1`. It uses the `app` PostgreSQL schema, Redis for abuse limits and passkey challenges, and SMTP for verification, invitations and recovery. Session cookies are HTTP only, SameSite Lax, rotate after MFA, and require an origin plus CSRF header on authenticated mutations. The browser client sends the CSRF header from its separate cookie. Production requires HTTPS and a configured SMTP relay.

## Local setup

1. Run `npm ci`, `npm run foundation:init-env`, `npm run db:identity:preflight`, `npm run db:migrate:deploy`, `npm run db:migrate:test`, and `npm run db:grant:dev`. Existing database records are preserved; inspect any preflight error before migrating.
2. Start the local PostgreSQL and Redis services documented in `database/README.md` and `infrastructure/README.md`. Set `AUTH_SMTP_HOST` to a development mail sink (Compose uses Mailpit). Never use a production recipient with a development sink.
3. Set `AUTH_TERMS_VERSION`, `AUTH_PRIVACY_VERSION`, `AUTH_TERMS_URL` and `AUTH_PRIVACY_URL` only after approved, hosted documents exist. Registration and invitation acceptance reject missing or stale versions. Tests use clearly labelled synthetic versions and `example.invalid` URLs.
4. Start `npm run dev`; open `http://127.0.0.1:5173/?screen=register`. Verification and recovery links return to the corresponding account screens.
5. To create the first development administrator, register and verify a real development account, enroll and confirm TOTP, then run `npm run identity:bootstrap-admin -- account@example.org`. The script uses the ignored migration URL, refuses other databases and refuses if an active administrator already exists. Later SYSTEM_ADMIN changes require an independently approved workflow and are denied by the public API.

## Checks

Run `npm run foundation:check`, `npm run test:e2e`, `npm run db:verify`, and `npm run db:test`. Identity integration tests use the isolated `arata_techlibrary_test` database and synthetic email capture. They must never target the development database.

## Release gates

The legal notice versions, operational SMTP sender, federated institutional SSO provider, subject-data export, legal retention and erasure processor, administrator dual-approval workflow, passkey device-matrix E2E and production incident/recovery runbooks are not approved or implemented yet. Account deletion closes login and records an open subject request; it does not claim immediate erasure. Audit events record request correlation and privileged change reasons; broader before/after security evidence remains a release task. The existing design OpenAPI contract predates the live identity routes and must be reconciled before treating it as an accurate runtime specification.
