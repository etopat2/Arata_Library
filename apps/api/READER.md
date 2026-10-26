# Reader and content policy implementation

Status: partial live implementation, 2026-10-25. The SRS remains unsigned. This document records what the application currently does; it does not represent release acceptance.

## Implemented paths

- `apps/api/src/reader/`: published current-revision lesson reads, filtered edition manifest and search, explicit progress, bookmarks, encrypted private annotations, short-lived lesson and resource asset grants, and versioned policy administration.
- `packages/access-policy/src/content-policy.ts`: one resolver for nullable inheritance across library, publication, volume, edition, revision, chapter, lesson and resource. All action defaults deny. Parent read denials cannot be lifted by a child policy. Earliest licence end and strictest concurrent-session cap win. An active approved policy is required.
- `prisma/migrations/202610250006_reader_policy_fields/`: policy fields, platform/library scope, checks, active/version uniqueness and administrator permission. The migration preflights duplicate versions and is additive.
- `apps/web-pwa/src/Reader.tsx`, `ContentPolicyAdmin.tsx` and `PublicPortal.tsx`: responsive lesson reader, text size/theme, contents, search, explicit completion, bookmarks, notes/highlights, rights summary, edition links and administrator policy editor.

The reader verifies publication status, current published revision, time, active grants, audience and effective policy on every protected read. `app."EffectiveEntitlement"` filters expired/revoked/ineligible grants; a matching library, publication, volume, edition or resource scope is required for premium access. Public-free content does not require a subscription. Private notes are encrypted using the existing `AUTH_DATA_KEY` and queried only by owner. Asset grants are HMAC signed, bound to the current user/session, expire after one minute, and are rechecked at delivery. Only approved, scanned, rights-confirmed assets inside private storage are served. Downloads create audit events.

Policy changes require `SYSTEM_ADMIN`, `CONTENT_POLICY_MANAGE`, MFA within five minutes, CSRF, a reason and a real target. Each approval creates a new version, a `PolicyChange` and an `AuditEvent`; prior rows remain as history. A value of `null` inherits; absent fields keep the last active value. The admin UI can inspect effective values and history. Effective inspection derives the selected target's actual ancestors from PostgreSQL and rejects inconsistent supplied parent IDs; it cannot combine unrelated policies into a misleading result.

The screenshot modes are notices/watermarks and cannot stop operating-system screenshots. Reader UI copy and print affordances express licensed actions; content displayed by a browser can still be copied or printed through other means. Semantic text remains selectable for assistive technology. The reader renders source Markdown as escaped text and limited semantic headings/code blocks; it never injects author HTML.

## Live routes

- `GET /api/v1/reader/editions/:id/manifest`, `/search?q=...`, `/bookmarks`, `/progress`
- `GET /api/v1/reader/lessons/:id`, `/annotations`, `/asset-grant`
- `POST /api/v1/reader/lessons/:id/progress`, `/bookmarks`, `/annotations`; `DELETE /api/v1/reader/annotations/:id`
- `GET /api/v1/reader/resources/:id/assets/:assetId/grant` and `/assets/:assetId?grant=...`
- `GET /api/v1/admin/content-policies/effective`, `/:scope/:id`; `POST /api/v1/admin/content-policies`
- Existing catalogue preview and resource-open routes now use the same reader policy service.

Writes use authenticated same-origin CSRF checks. All SQL values are bound; scope identifiers are from validated allowlists. Authentication failures and rights failures use 401/403; hidden publication revisions and unauthorized previews use 404. Responses do not expose session secrets, internal asset keys or plaintext stored notes.

## Incomplete acceptance

This does **not** complete FR-RDR-002/003/009/010, FR-ENT-008/010/012/013/016 or the offline and export requirements. Remaining work includes server-backed font family/line spacing/reduced-motion preferences, a standards-complete safe Markdown/diagram/formula/code renderer, synchronized reading position and cross-edition anchor migration, explicit offline/expired-licence screens, offline licence issuance and sync, PDF/EPUB export services, resource-file and browser-level delivery tests, stronger session lease controls, library mapping for publications in multiple libraries, complete runtime OpenAPI alignment and manual WCAG review. A live API test covers approved lesson-file delivery and tampered, expired, wrong-session and policy-revoked grants. Cross-browser copy/print behavior is a deterrence and must be described honestly. See `Documentation/Implementation/BLOCKERS.md`.

## Checks

Use `npm run db:format`, `npm run db:validate`, `npm run db:generate`, `npm run db:migrate:test`, `npm run db:test`, `npm run db:verify`, `npm run test:integration`, `npm run build:foundation`, `npm run lint` and `npm run test:e2e`. Database tests require the isolated `arata_techlibrary_test` URL. Do not reset either database. The migration rollback is a forward corrective migration after backup and impact review; the new columns and version history must not be dropped while active readers depend on them.
