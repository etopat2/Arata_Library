# API problem catalogue

Every non-success response uses RFC 9457 style `application/problem+json` with `type`, `title`, HTTP `status`, stable `code`, and `requestId`. `detail` and `fieldErrors` are optional and must be safe to disclose. Do not encode secrets, raw tokens, private tenant identities or internal stack traces.

| HTTP | Stable code | Meaning and handling |
|---|---|---|
| 400 | `VALIDATION_FAILED` | Malformed or unsupported fields; return field paths where safe. |
| 400 | `UNSUPPORTED_PROVIDER` | Unknown configured gateway or SSO provider. |
| 401 | `AUTH_REQUIRED` | Missing or expired authenticated session. |
| 401 | `STEP_UP_REQUIRED` | Recent action-bound MFA proof missing or invalid. |
| 401 | `WEBHOOK_UNVERIFIED` | Provider signature, timestamp or replay check failed. Do not mutate money or access state. |
| 403 | `ROLE_DENIED` | Action is outside the actor's assigned scoped role. |
| 403 | `OWNERSHIP_DENIED` | Reader-owned note, certificate, support ticket or export belongs to another actor. |
| 403 | `INSTITUTION_DENIED` | Verified current membership or authorized institution scope is absent. |
| 403 | `ENTITLEMENT_EXPIRED_OR_MISSING` | No active matching access source at the server's UTC decision time. |
| 403 | `CONTENT_PERMISSION_DENIED` | Effective action policy does not permit read, copy, print, download or offline use. |
| 403 | `PURPOSE_REQUIRED` | Research actor has no approved purpose for this study or dataset. |
| 403 | `DISCLOSURE_NOT_APPROVED` | Statistical release lacks a passing assessment and distinct approvals. |
| 403 | `SENSITIVE_EXPORT_APPROVAL_REQUIRED` | Identifying or sensitive export lacks recorded approval. |
| 404 | `NOT_FOUND` | Object absent or deliberately hidden across user, tenant or research boundaries. |
| 409 | `STATE_CONFLICT` | Resource state changed, duplicate is conflicting, or idempotency key was reused with another body. |
| 409 | `DUPLICATE_EVENT` | Research event or provider event already accepted with conflicting content. |
| 412 | `PRECONDITION_FAILED` | Expected revision hash/version or approval evidence no longer matches. |
| 422 | `BUSINESS_RULE_VIOLATION` | Structurally valid request violates publishing, payment, eligibility or disclosure state rules. |
| 429 | `RATE_LIMITED` | Retry after `Retry-After`; use bounded backoff. |
| 500 | `INTERNAL_ERROR` | Correlation ID only; details stay in protected logs. |

The OpenAPI examples use the generic `REQUEST_ERROR` code to demonstrate the envelope. A service must choose the specific stable code above. A 403 or 404 choice for protected objects must be consistent with the no-enumeration policy.
