# Public catalogue service

The public portal uses live PostgreSQL records through `/api/v1/catalogue`, `/api/v1/resources`, and the typed `@arata/api-client`. Public pages mirror the `home`, `collections`, `catalogue`, `search`, `series-detail`, `volume-detail`, `free-library`, and `resource-detail` wireframe flows. No production publication is seeded.

## Local demonstration

Apply all migrations and development grants first. Run `ARATA_ENABLE_DEV_SEED=1 npm run db:seed:dev` and `ARATA_ENABLE_DEV_SEED=1 npm run db:seed:catalogue:dev` against **only** `arata_techlibrary_dev`. On PowerShell set `$env:ARATA_ENABLE_DEV_SEED='1'` for the two commands, then remove that environment variable. The seed is idempotent and every synthetic public title and body is labelled `[DEV SAMPLE]`. It creates no real manuscripts, licences, prices or people.

Start the API and PWA with `npm run dev`, then open `/`, `/?screen=catalogue`, and `/?screen=free-library&access=PUBLIC_FREE`. The API and browser tests use real database queries; integration fixtures target only `arata_techlibrary_test`.

## Public boundary

- Publication results include only `PUBLISHED` records with a current published revision, or explicitly `FORTHCOMING` records with a release date. Draft, archived and withdrawn records are absent.
- Book cards, collection counts and search results expose editorial public metadata, contributors and access labels. Edition detail exposes only current published revision and chapter titles. Historical revisions are not returned to anonymous callers.
- A chapter sample requires an active, approved `PUBLIC_FREE` chapter policy with `allowRead=true`; its text is fetched from a separate endpoint. A resource requires a current published window and matching active, approved resource policy. Public-free text opens without a session. Registered-free text requires a verified active session. Premium and restricted body text is not returned.
- Search covers publication metadata and approved `PUBLIC_FREE` resource text. Premium and registered-only text are excluded from anonymous searchable input, and every public result omits body text, private asset storage keys and protected snippets. Subject, author, volume, edition and format facets come from public records. The public resource listing intentionally does not supply direct asset URLs.
- The share endpoint returns escaped, crawlable title and description metadata only. The SPA updates browser metadata; social crawlers should use `/api/v1/share/publications/{slug}`. A deployed web proxy must route that path to the API.

## Open boundaries

This module provides readable plain-text development resources attached directly to a public publication or to no publication. Volume-, edition-, revision-, chapter- and lesson-linked resources remain unavailable through the public listing until their current-version authorization chain is implemented. Safe binary upload, private asset delivery, publisher-approved derived previews, payment entitlements, trial/grant status, historical-edition entitlement, reader-authorized search and full publishing workflow remain separate modules. The portal labels these cases as locked or unavailable until their services exist. `api/openapi.v1.yaml` is still a design contract and needs live DTO reconciliation before it can be presented as this implementation's runtime contract.

## Migration recovery

The additive catalogue migration was first attempted locally with a non-immutable full-text index expression. Prisma recorded a failed attempt after PostgreSQL had applied the preceding DDL. The two missing indexes were added after inspecting both named local database catalogues, and Prisma recorded the corrected migration as applied. The failed attempts are retained as rolled-back history; no database was reset. Fresh environments apply the corrected version-controlled SQL. For future failed migrations, inspect `_prisma_migrations` and physical catalogues before using `prisma migrate resolve`; never assume a failed PostgreSQL migration is fully rolled back.
