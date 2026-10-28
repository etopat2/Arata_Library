# Requirements and design risk register

## Institutional additions — 2026-10-28

| Risk | Likelihood | Impact | SRS / gap | Mitigation and evidence required | Proposed owner |
|---|---|---|---|---|---|
| RSK-INS-01 Domain ownership is mistaken for current student enrollment | Medium | High | `FR-INS-002/004/005`, `BR-014` | Distinct email confirmation, reviewed category policy, manual/roster evidence, bounded membership and negative forged-domain tests. Obtain institution evidence standard. | Institution operations |
| RSK-INS-02 Scoped manager reads another institution or private learner history | Medium | Critical | `FR-INS-009/013`, `BR-017` | Server-side tenant query, recent MFA, permission checks, aggregate opt-in/threshold and cross-tenant tests; no notes/progress fields in manager DTOs. | Security + API |
| RSK-INS-03 SSO metadata is treated as a trusted authentication provider | Medium | Critical | `FR-INS-004`, GAP-036 | Keep authentication disabled and SSO evidence policy unapprovable until real issuer/JWKS/assertion and revocation tests pass. | Identity + institution operations |

Updated 2026-10-22. Likelihood and impact are planning assessments, not measured production incidents. Owners are proposed functions pending assignment.

| Risk | Likelihood | Impact | SRS / gap | Mitigation and evidence required | Proposed owner |
|---|---|---|---|---|---|
| RSK-01 Protected content or personal notes leak through guessed IDs, files, search snippets or caches | High | Critical | `SEC-001/010`, `BR-003/012/017`, REC-03/05/08/19 | Central object/action authorization, private storage, negative IDOR tests and cache/index withdrawal checks. | Security + API |
| RSK-02 Unverified or duplicated payment activates access | Medium | Critical | `FR-PAY-005–008`, `BR-008`, REC-06 | Version-aware signature verification, server reconciliation, atomic entitlement activation and replay tests. | Commerce + finance |
| RSK-03 Institution suffix/domain or self-approval bypasses eligibility | Medium | High | `BR-005–006/014`, REC-07 | Exact-domain parser, verified email, independent domain approval, cross-tenant tests. | IAM + institutions |
| RSK-04 Released revision or source asset changes without provenance | Medium | High | `FR-PUB-004/009`, `BR-015`, REC-01–03 | Immutable revision/asset checksums, approval to exact manifest, rights evidence and migration tests. | Publishing |
| RSK-05 Public research output permits re-identification by small cells or differencing | Medium | Critical | `RAI-PUB-001–012`, `BR-013/018`, REC-14 | Purpose and metric policy, complementary suppression, independent review, fixed snapshots and adversarial disclosure tests. | Privacy + research |
| RSK-06 Analytics collection exceeds consent, captures secrets or links identity too broadly | Medium | Critical | `RAI-COL-006/013/016`, `DR-006`, REC-12 | Strict schema allowlist, purpose gate, isolated encrypted mapping and retention/deletion audit. | Privacy + security |
| RSK-07 Generic OpenAPI and broad mappings hide authorization/DTO omissions | High | High | `INT-001–005`, REC-15/16 | Refine all 39 flagged DTOs, review all 102 methods and link each privileged operation to negative tests. | API architecture + QA |
| RSK-08 Offline content remains accessible after remote revocation or replay | Medium | High | `FR-OFL-001–012`, `BR-016`, REC-10 | Bounded licences, device expiry, reconnect check, replay dedup and truthful UI language. | PWA + security |
| RSK-09 Upload conversion or code lab executes untrusted content in privileged origin | Medium | Critical | `SEC-004/008`, `FR-AST-*`, `FR-LRN-005/011`, REC-03/09 | Quarantine, MIME/signature validation, malware scan, isolated origin/container and resource limits. | Security + platform |
| RSK-10 Launch lacks demonstrated recovery, accessibility or end-to-end authorization | High | High | `NFR-UX-*`, `NFR-OPS-*`, REC-17/18 | Staging gates, WCAG flow tests, restore drill, full CI and release sign-off. | DevSecOps + QA |
