# Platform policy subsystem

Status: implemented foundation, with business and legal launch gates still open. SRS v1.0 is the baseline and awaits formal sign-off. The settings at version `0` are conservative **proposals**, not stakeholder approvals.

## Runtime contract

`packages/validation/src/platform-policy.ts` is the single strict schema and default snapshot. `PlatformPolicyService.current()` selects the one active database version, validates it on every read, and fails closed if an active snapshot is malformed. Without an activated version it returns validated proposal v0. Secrets are never configuration fields; imports reject unknown keys. All times are UTC and money is integer minor units with an ISO currency code. A null price means the plan is disabled.

The live server consumes `security.sessionHours`, login rate window/threshold/lockout, recovery token lifetime, upload MIME/size, and reader copy/print/download/export/offline/watermark/screenshot defaults. A content-specific active policy overrides a platform **default**; the existing parent read-denial and entitlement checks still apply. Other settings provide validated policy data and pure rule functions for subscription calendar periods, complimentary expiry, institution eligibility, trials and research disclosure. Their full operational services are not implemented here.

API prefix: `/api/v1/admin/platform-policy`. All routes require `SYSTEM_ADMIN`, the named `PLATFORM_POLICY_*` permission and administrator MFA. Mutations require recent step-up and CSRF protection. `POST /preview` checks the proposed snapshot without saving. Drafts can be created, edited, submitted, approved, rejected and activated. The approver must be different from both creator and last editor. Changed subscription settings also require an active `FINANCE` role; changed research settings require `PRIVACY_APPROVER`. Activation requires the UTC effective time and the same active base version the draft was built against. A restoration copies an earlier activated snapshot into a **new** draft and repeats approval. `GET /effective`, `/history`, `/:id`, `/:id/events`, `/export` and `POST /import` support inspection and non-secret portability.

Policy snapshots become immutable after submission. SQL state checks, an active-version unique index and append-only event triggers protect direct database paths. Every mutation also inserts a correlated `AuditEvent` with before/after hashes. The UI route is `/?screen=platform-settings`; it groups categories, previews changes, shows history/audit, and exposes review actions. Original 90 source wireframes are preserved; this is a supplemental administrator screen.

## Proposed defaults and reasons

| Area | Proposal | Reason / release gate |
|---|---|---|
| Subscription | UGX; 1/3/12 calendar months; prices null and plans disabled; 7-day trial disabled; manual renewal; 7/1-day reminders; zero grace; cancellation at period end | Avoid charges or entitlement promises before approved prices, tax, legal disclosure and verified gateway capability. Refund window 7 days is a proposed operations value, subject to counsel/finance. |
| Complimentary | 1/7/14/30/90/365 days; custom at most 365; permanent only with independent approval; expiry notice 7 days | Matches SRS range while limiting abuse and preserving audit. Bulk limit 100 is an operations proposal. |
| Institutional | Benefits disabled; central approval, proof of domain, verified email and evidence review; student/cohort 90 days, staff 180 days, reverify 90 days; capacity unset | Membership must remain bounded by a signed agreement and independent evidence; no inferred exemption from a domain alone. |
| Reader | Copy, print, original download, export and offline default denied; two licensed devices; offline licence 7 days; one preview chapter; pseudonymous watermark and screenshot notice | Conservative defaults; publication-specific approved policies may permit actions. Browser screenshots cannot be blocked. |
| Research | Collection and public publication disabled; 180-second idle, 1800-second session gap, 30-second heartbeat; public minimum 30 subjects; event/session/aggregate proposals 90/365/730 days | Timing and threshold follow SRS initial proposals; lawful basis, consent and privacy approval remain independent gates. |
| Security | 12-hour sessions; admin MFA mandatory; 30-minute recovery token; 50 MiB uploads; 20 login requests/15 minutes, five failed passwords before a 15-minute lockout; audit 365 days; daily backup and 90-day restore drills; RPO/RTO unset | Balanced conservative operations proposals. Backup cadence and recovery objectives require infrastructure evidence and approval. |

Mandatory SRS controls (administrator MFA, independent permanent-grant approval, finance refund approval, central institution approval, independent manual-evidence review and privacy disclosure approval) cannot be disabled by configuration. Recurring renewal is rejected until verified provider support exists. Enabling prices or research settings in configuration does not implement payment processing or research publication.

## Setup and recovery

Migration `202610260004_platform_policy` adds two app tables, five foreign keys, six checks, two triggers and three permissions. It does not alter old rows. Apply to the isolated test database first, then development using `npm run db:migrate:test` and `npm run db:migrate:deploy`; run `npm run db:grant:dev`, `npm run db:verify`, `npm run db:erd`, and the SQL/integration tests. Never reset a database to undo a policy. For an incorrect active policy, use the audited restoration flow: select a prior activated version, create a new draft, get independent approval, then activate. For failed migration deployment, stop writes, inspect `_prisma_migrations`, recover from a verified backup under the database runbook and reconcile migration history without manual table drops. A backup restore must be tested before any production use.

## Open work

The API design-stage OpenAPI and generated client do not yet cover these live routes. Full subscription, grant, institution, offline, research, retention and backup workers must consume these settings with their own authorization and acceptance tests. Effective-date activation is currently an explicit administrator action after the date; there is no scheduler. Legal drafts in `Documentation/Policies/Drafts/` are not active notices. Formal SRS sign-off and DEC-01–DEC-12 owners remain open.
