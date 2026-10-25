# Publishing Studio: development operation and current scope

The Studio is available in the PWA at `/?screen=studio` after a verified session. Its
data comes from PostgreSQL through `/api/v1/studio`. Source requirements are
`FR-PUB-001`–`FR-PUB-016`, `FR-AST-001`–`FR-AST-012`, `BR-003`, `BR-010`,
`BR-012`, and `BR-015`. The SRS has not received stakeholder sign-off.

## Local operation

1. Apply the version-controlled Prisma migrations to the named development and
   isolated test databases. Never reset either database to apply this feature.
2. Start PostgreSQL, Redis, and the API/PWA. A Studio worker also needs a ClamAV
   daemon on `CLAMD_HOST:CLAMD_PORT` (default port 3310). The foundation Compose
   file mounts the same private `studio_objects` volume into API and worker and
   starts ClamAV with the worker. `STUDIO_STORAGE_ROOT` is mandatory outside
   development and must point to a private, non-web-served directory.
3. Use `npm run foundation:check`, `npm run db:verify`, `npm run db:test`, and
   `npm run test:e2e:studio` for local verification. Studio integration tests
   require `TEST_DATABASE_URL` to name `arata_techlibrary_test` exactly.

Do not place content in a public web directory. Files first enter private quarantine
under generated keys. The worker checks format and ZIP structure and sends the
original to ClamAV. Scanner failure leaves the asset unavailable. An editor or
publisher must confirm licence, provenance, copyright and attribution after a
clean scan. Download requires an authenticated, scoped Studio role and an approved
asset. General-reader delivery is a separate permission-checked reader capability.

## Editorial authority and workflow

Active platform or publication-scoped `AUTHOR`, `EDITOR`, and `PUBLISHER`
assignments are checked by the API for each operation. Authors and editors can
make drafts. A separate editor reviews the submitted, frozen manuscript. A
publisher attests rights and publishes or schedules the approved revision. All
mutations require a verified session, CSRF token, and a matching origin, and are
audited. PostgreSQL also rejects writes to review-frozen and published content.

Standalone publications take editions directly. Multi-volume publications take
ordered volumes, then editions. New revisions may copy a published revision into
a separate draft; existing published rows remain immutable. Releasing a draft
requires the exact reviewed manifest, a current rights attestation, required
metadata, and safe referenced assets. Correction notices append to published
history. A publisher can withdraw a publication or schedule release/withdrawal.
Publications may begin without a collection, and an authorized publication role
can replace their collection memberships with zero or multiple existing library
collections. Once a publication leaves DRAFT, reclassification requires a publisher role. The
hierarchy displays uncategorised works under the Library root.
Draft authors and editors can reorder chapters and lessons by submitting the entire
current sibling list. The API checks the expected order and parent membership,
normalizes positions atomically, and records an audit event. Series volumes may be
reordered until any revision in the series enters review; the reviewed order is
then frozen. Standalone and volume-scoped editions have independent positive
positions and may be reordered within their own scope until any edition in that
scope enters review. Published revisions cannot be reordered. Broader metadata
editing remains open.

Uploads use a declared SHA-256 digest, a unique idempotency key, and sequential
8 MiB chunks; the limit is 200 MiB. The returned upload and job IDs drive status,
progress, failure, and retry views. Import is asynchronous. A scanned and approved
PDF, DOCX, EPUB, or structured ZIP is previewed; explicit confirmation creates a
new draft in the selected edition. The structured ZIP currently uses
`manifest.json` with `format: "arata-structured-v1"`, ordered `chapters` with
`slug`, `title`, and `lessons`, and lesson Markdown files under `content/`.
Validation rejects traversal, duplicate chapter slugs, encrypted archives,
oversized entries, and excessive expanded size. Generated previews are plain
text; untrusted document markup is never rendered as HTML.

## Recovery and scope limits

Migrations are additive. Before deployment, take a tested database backup and a
matching copy of private objects. On failure, stop API/worker writes, restore the
database and object snapshot together to a new environment, verify migration
status and checksums, then switch traffic. Do not manually delete a committed
migration or reset a database with existing data.

The current screen edits Markdown and structured blocks; it does not provide a
rich WYSIWYG editor. PDF/DOCX/EPUB import extracts text for editorial review and
does not preserve layout, figures, hyperlinks, or guaranteed reading order. ZIP
import populates chapters and lessons in an existing edition, not a whole
book/volume/edition package. ZIP export is a manuscript convenience format and
does not carry the full rights, policies, references, or resource metadata; the
JSON export exposes more of the manuscript. SRS acceptance for these capabilities
remains open in `Documentation/Implementation/BLOCKERS.md`.

Scanner behavior is tested with an in-process ClamAV protocol fixture. A local
ClamAV 1.5 container reached healthy state and scanned a synthetic benign
sample, but the application worker-to-daemon container path still needs an
end-to-end check. Local private storage is
appropriate for reproducible development, but production deployment needs a
private object-store adapter, backup, malware signature update monitoring, and
permission-checked reader renditions. No production manuscripts or rights are
seeded.
