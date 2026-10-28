# Institutional access

This module implements the SRS `FR-INS-001`–`013`, `BR-014` and `BR-017` in stages. The live routes are under `/api/v1/institutional` and `/api/v1/admin/institutions`; exact DTOs and error responses are in `api/openapi.v1.yaml`.

## Local setup

Use the existing ignored local environment files and the isolated PostgreSQL databases. Apply `npm run db:migrate:test` before `npm run db:migrate:deploy`; then run `npm run db:grant:dev`, `npm run db:generate`, `npm run db:verify`, `npm run db:erd`, `npm run db:test` and the focused institution tests. Never reset a database with unverified records. Migration `202610270009` rejects previously active eligibility policies so an operator must review them first. Migrations `010`–`012` add opt-in reporting and correct the domain proof sequence without deleting records.

## Approval and access sequence

1. A central administrator submits a legal identity and opaque evidence reference. A different central administrator approves it. The scoped manager assignment is created centrally and requires an active, verified account.
2. A manager requests an exact email domain. The server returns a one-use 24-hour DNS TXT value; only its digest is stored. The manager proves control through the DNS record, then a different central administrator approves it. A later challenge supersedes older proof. Reverification is required by the configured interval. Suspended, unverified, or overdue domains cannot authorize access.
3. A manager requests a category, evidence method, scope and validity policy. A distinct central administrator approves it. Student status requires reviewed manual or roster evidence by default; domain-only eligibility needs an expressly approved category policy. SSO policies cannot activate until federation verification exists.
4. The reader confirms their institutional email through the ordinary account flow, then requests membership. A scoped manager reviews manual evidence or a previously applied roster. The system checks active policy, exact domain, agreement scope, permitted category, quota and current validity. The shortest relevant window sets expiry. The reader can opt out. Other paid or complimentary grants remain independent.
5. Roster CSV is previewed with row numbers and error codes; no raw CSV is persisted. Application is atomic, content-hash deduplicated and creates pending memberships for review. A cohort can contain only current, verified members of its own institution. Managers cannot see private reading notes or progress.

Administrators require recent MFA for mutations. Scoped managers require an institution role, matching permission and recent MFA. Browser navigation does not grant authorization. A separate approved agreement must enable aggregate reporting; counts below the configured disclosure threshold are suppressed.

## Recovery and boundaries

The migrations are forward-only. Before deployment, take a verified backup and inspect any active legacy eligibility policies. On failure, stop writes, restore the verified backup into a separate database, compare Prisma migration history and affected institutional records, and perform a reviewed forward repair. Do not edit an applied migration or reset the shared development database.

SSO metadata registration and independent review are implemented; **federated authentication and assertion validation are not active**. No SSO claim can grant student status. Roster import currently supports verified existing accounts and CSV `email,category,action` with `UPSERT` or `REVOKE`; external SIS/SCIM synchronization and a production IdP test remain open. Engagement reports expose only a thresholded 30-day distinct reader count, not private activity or learning progress. Final institutional evidence standards and reporting agreements require accountable approval before production launch.
