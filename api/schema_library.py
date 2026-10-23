"""Concrete JSON Schema vocabulary for the Arata v1 wire contract.

All objects are closed.  These are API DTOs, not a serialization of Prisma rows.
"""
from __future__ import annotations


def ref(name: str) -> dict:
    return {"$ref": f"#/components/schemas/{name}"}


def obj(fields: dict, required: list[str] | None = None) -> dict:
    return {"type": "object", "additionalProperties": False,
            "properties": fields, "required": required or []}


def arr(item: dict) -> dict:
    return {"type": "array", "items": item}


def string(*, max_length=500, min_length=1, fmt=None, enum=None, pattern=None):
    s = {"type": "string", "minLength": min_length, "maxLength": max_length}
    if fmt: s["format"] = fmt
    if enum: s["enum"] = enum
    if pattern: s["pattern"] = pattern
    return s


ID = string(max_length=64, pattern="^[A-Za-z0-9_-]+$")
DATE = string(max_length=40, fmt="date-time", pattern="Z$")
EMAIL = string(max_length=254, fmt="email")
URL = string(max_length=2048, fmt="uri")
TEXT = string(max_length=10000)
SHORT = string(max_length=200)
BOOL = {"type": "boolean"}
INT = {"type": "integer", "minimum": 0}
MONEY = {"type": "integer", "minimum": 0, "description": "Minor currency units; no floating point amount."}
CURRENCY = string(max_length=3, min_length=3, pattern="^[A-Z]{3}$")
ROLE = string(enum=["reader", "author", "editor", "publisher", "institution_manager", "finance", "support", "research_analyst", "privacy_approver", "research_admin", "security_admin", "platform_admin"])
SCOPE = string(enum=["publication", "volume", "edition", "revision", "chapter", "lesson", "resource", "collection", "plan", "institution"])
STATUS = string(max_length=40)
JSON_VALUE = {"oneOf": [{"type": "string"}, {"type": "number"}, {"type": "boolean"}, {"type": "null"}]}


ENTITY_FIELDS = {
    "Account": {"id": ID, "email": EMAIL, "emailVerifiedAt": DATE, "status": STATUS, "roles": arr(ROLE), "createdAt": DATE},
    "Acknowledgement": {"accepted": BOOL, "message": SHORT},
    "SsoRedirect": {"authorizationUrl": URL, "stateExpiresAt": DATE},
    "Session": {"id": ID, "createdAt": DATE, "lastSeenAt": DATE, "expiresAt": DATE, "deviceLabel": SHORT, "current": BOOL},
    "Profile": {"userId": ID, "displayName": SHORT, "bio": string(max_length=2000, min_length=0), "locale": string(max_length=20), "timezone": SHORT, "updatedAt": DATE},
    "PrivacyPreferences": {"analyticsConsent": BOOL, "researchConsent": BOOL, "personalizationConsent": BOOL, "aiAssistanceConsent": BOOL, "updatedAt": DATE},
    "NotificationPreferences": {"email": BOOL, "inApp": BOOL, "securityMandatory": BOOL, "updatedAt": DATE},
    "Notification": {"id": ID, "category": STATUS, "title": SHORT, "body": TEXT, "createdAt": DATE, "readAt": DATE},
    "Collection": {"id": ID, "slug": ID, "title": SHORT, "description": TEXT},
    "Publication": {"id": ID, "slug": ID, "kind": string(enum=["standalone", "series"]), "title": SHORT, "description": TEXT, "authors": arr(SHORT), "subjects": arr(SHORT), "language": string(max_length=35), "accessClass": STATUS, "status": STATUS, "defaultEditionId": ID, "coverAssetId": ID},
    "Volume": {"id": ID, "publicationId": ID, "ordinal": INT, "title": SHORT, "description": TEXT},
    "Edition": {"id": ID, "publicationId": ID, "volumeId": ID, "label": SHORT, "ordinal": INT, "isbn": string(max_length=32), "currentRevisionId": ID, "status": STATUS},
    "Revision": {"id": ID, "editionId": ID, "version": INT, "status": STATUS, "contentHash": string(max_length=128), "submittedAt": DATE, "approvedAt": DATE, "publishedAt": DATE, "scheduledAt": DATE, "withdrawnAt": DATE},
    "Chapter": {"id": ID, "revisionId": ID, "ordinal": INT, "title": SHORT, "summary": TEXT, "lessonIds": arr(ID)},
    "Lesson": {"id": ID, "chapterId": ID, "ordinal": INT, "title": SHORT, "bodyHtml": TEXT, "learningOutcomes": arr(SHORT), "resourceIds": arr(ID)},
    "Resource": {"id": ID, "title": SHORT, "mediaType": SHORT, "accessClass": STATUS, "byteSize": INT, "license": SHORT, "attribution": TEXT, "downloadAllowed": BOOL, "status": STATUS},
    "DownloadTicket": {"url": URL, "expiresAt": DATE, "assetId": ID, "disposition": STATUS},
    "ResourceOpen": {"resourceId": ID, "viewerUrl": URL, "expiresAt": DATE, "permission": ref("PermissionDecision")},
    "Upload": {"id": ID, "status": STATUS, "uploadUrl": URL, "expiresAt": DATE, "maxBytes": INT, "assetId": ID, "scanStatus": STATUS},
    "Asset": {"id": ID, "uploadId": ID, "mediaType": SHORT, "byteSize": INT, "sha256": string(min_length=64, max_length=64), "status": STATUS, "scanStatus": STATUS, "rightsStatus": STATUS},
    "ContentPolicy": {"id": ID, "scopeType": SCOPE, "scopeId": ID, "read": BOOL, "copy": BOOL, "print": BOOL, "download": BOOL, "offline": BOOL, "screenshotMode": string(enum=["allow", "watermark", "restrict_ui"]), "watermarkMode": STATUS, "version": INT},
    "PermissionDecision": {"allowed": BOOL, "reasonCode": STATUS, "effectivePolicy": ref("ContentPolicy"), "entitlementId": ID, "evaluatedAt": DATE},
    "Entitlement": {"id": ID, "source": STATUS, "scopeType": SCOPE, "scopeId": ID, "startsAt": DATE, "expiresAt": DATE, "status": STATUS, "recipientUserId": ID, "institutionId": ID},
    "Bookmark": {"id": ID, "editionId": ID, "revisionId": ID, "lessonId": ID, "anchor": SHORT, "label": SHORT, "createdAt": DATE},
    "Annotation": {"id": ID, "editionId": ID, "revisionId": ID, "lessonId": ID, "anchor": SHORT, "body": TEXT, "visibility": string(enum=["private"]), "updatedAt": DATE},
    "Progress": {"editionId": ID, "revisionId": ID, "lessonId": ID, "percent": {"type": "number", "minimum": 0, "maximum": 100}, "updatedAt": DATE},
    "ReaderManifest": {"editionId": ID, "revisionId": ID, "title": SHORT, "chapters": arr(ref("Chapter")), "permission": ref("PermissionDecision")},
    "TableOfContents": {"publicationId": ID, "editionId": ID, "revisionId": ID, "chapters": arr(obj({"id": ID, "ordinal": INT, "title": SHORT, "lessonTitles": arr(SHORT)}, ["id", "ordinal", "title"]))},
    "ReaderDashboard": {"continueReading": arr(ref("Progress")), "activeEntitlements": arr(ref("Entitlement")), "unreadNotificationCount": INT},
    "ReaderSettings": {"fontFamily": SHORT, "fontScale": {"type": "number", "minimum": 0.8, "maximum": 2}, "lineSpacing": {"type": "number", "minimum": 1, "maximum": 2.5}, "theme": string(enum=["system", "light", "dark", "sepia"]), "reducedMotion": BOOL, "lowBandwidth": BOOL},
    "LearningGoal": {"id": ID, "editionId": ID, "targetAt": DATE, "status": STATUS, "progressPercent": {"type": "number", "minimum": 0, "maximum": 100}},
    "Quiz": {"id": ID, "lessonId": ID, "title": SHORT, "questions": arr(ref("QuizQuestion")), "maxAttempts": INT},
    "QuizQuestion": {"id": ID, "kind": string(enum=["single_choice", "multi_select", "short_text"]), "prompt": TEXT, "options": arr(obj({"id": ID, "label": SHORT}, ["id", "label"]))},
    "QuizAttempt": {"id": ID, "quizId": ID, "status": STATUS, "score": {"type": "number", "minimum": 0, "maximum": 100}, "submittedAt": DATE, "feedback": arr(SHORT)},
    "Project": {"id": ID, "lessonId": ID, "title": SHORT, "brief": TEXT, "rubric": arr(SHORT), "status": STATUS},
    "ProjectSubmission": {"id": ID, "projectId": ID, "status": STATUS, "submittedAt": DATE, "feedback": TEXT},
    "Certificate": {"id": ID, "userId": ID, "editionId": ID, "issuedAt": DATE, "verificationCode": SHORT, "status": STATUS},
    "DiscussionThread": {"id": ID, "lessonId": ID, "authorAlias": SHORT, "title": SHORT, "body": TEXT, "status": STATUS, "createdAt": DATE},
    "DiscussionPost": {"id": ID, "threadId": ID, "authorAlias": SHORT, "body": TEXT, "status": STATUS, "createdAt": DATE},
    "SupportTicket": {"id": ID, "category": STATUS, "subject": SHORT, "status": STATUS, "createdAt": DATE, "resolvedAt": DATE},
    "CodeLab": {"id": ID, "lessonId": ID, "language": SHORT, "starterCode": TEXT, "instructions": TEXT, "executionMode": string(enum=["browser_sandbox", "isolated_server"]), "status": STATUS},
    "CodeRun": {"id": ID, "labId": ID, "status": STATUS, "stdout": TEXT, "stderr": TEXT, "exitCode": {"type": "integer"}, "finishedAt": DATE},
    "Plan": {"id": ID, "code": ID, "name": SHORT, "priceMinor": MONEY, "currency": CURRENCY, "billingPeriod": STATUS, "scopeType": SCOPE, "scopeId": ID, "status": STATUS},
    "Order": {"id": ID, "merchantReference": SHORT, "planId": ID, "amountMinor": MONEY, "currency": CURRENCY, "status": STATUS, "checkoutUrl": URL, "createdAt": DATE},
    "Payment": {"id": ID, "orderId": ID, "provider": SHORT, "status": STATUS, "amountMinor": MONEY, "currency": CURRENCY, "verifiedAt": DATE},
    "Refund": {"id": ID, "paymentId": ID, "amountMinor": MONEY, "currency": CURRENCY, "reason": TEXT, "status": STATUS, "approvedBy": ID, "createdAt": DATE},
    "Invoice": {"id": ID, "orderId": ID, "number": SHORT, "currency": CURRENCY, "totalMinor": MONEY, "issuedAt": DATE, "downloadUrl": URL},
    "Subscription": {"id": ID, "planId": ID, "status": STATUS, "startsAt": DATE, "paidThroughAt": DATE, "renewsAt": DATE, "cancelAtPeriodEnd": BOOL},
    "Institution": {"id": ID, "name": SHORT, "legalName": SHORT, "status": STATUS, "createdAt": DATE},
    "InstitutionImpactReport": {"institutionId": ID, "periodStart": DATE, "periodEnd": DATE, "activeMembers": INT, "engagedReaders": INT, "suppressed": BOOL},
    "VerifiedDomain": {"id": ID, "institutionId": ID, "domain": string(max_length=253), "status": STATUS, "verifiedAt": DATE},
    "Membership": {"id": ID, "institutionId": ID, "userId": ID, "category": string(enum=["student", "academic_staff", "organization_member"]), "status": STATUS, "verifiedAt": DATE, "expiresAt": DATE},
    "Eligibility": {"eligible": BOOL, "reasonCode": STATUS, "institutionId": ID, "category": STATUS, "validUntil": DATE},
    "Cohort": {"id": ID, "institutionId": ID, "name": SHORT, "status": STATUS, "memberCount": INT},
    "OfflineLicense": {"id": ID, "editionId": ID, "revisionId": ID, "deviceId": ID, "issuedAt": DATE, "expiresAt": DATE, "maxOfflineAt": DATE, "status": STATUS, "manifestUrl": URL},
    "SyncResult": {"accepted": arr(ID), "rejected": arr(obj({"id": ID, "reasonCode": STATUS}, ["id", "reasonCode"])), "serverTime": DATE, "cursor": SHORT},
    "AuditEvent": {"id": ID, "actorId": ID, "action": STATUS, "objectType": STATUS, "objectId": ID, "occurredAt": DATE, "reason": TEXT, "requestId": SHORT},
    "SecurityAlert": {"id": ID, "category": STATUS, "severity": string(enum=["low", "medium", "high", "critical"]), "openedAt": DATE, "status": STATUS},
    "Health": {"status": string(enum=["ok", "degraded", "unavailable"]), "checkedAt": DATE, "components": arr(obj({"name": SHORT, "status": STATUS}, ["name", "status"]))},
    "ResearchMetric": {"metric": SHORT, "value": {"type": "number"}, "periodStart": DATE, "periodEnd": DATE, "suppressed": BOOL},
    "ResearchEventReceipt": {"eventId": ID, "status": string(enum=["accepted", "duplicate", "rejected"]), "receivedAt": DATE},
    "ResearchEventRecord": {"eventId": ID, "eventType": SHORT, "occurredAt": DATE, "receivedAt": DATE, "qualityStatus": STATUS},
    "ResearchSession": {"id": ID, "startedAt": DATE, "endedAt": DATE, "eventCount": INT, "qualityStatus": STATUS},
    "ResearchQuality": {"periodStart": DATE, "periodEnd": DATE, "accepted": INT, "duplicates": INT, "rejected": INT, "late": INT},
    "ResearchDashboard": {"periodStart": DATE, "periodEnd": DATE, "metrics": arr(ref("ResearchMetric")), "lastComputedAt": DATE},
    "ResearchStudy": {"id": ID, "title": SHORT, "purpose": TEXT, "status": STATUS, "legalBasis": SHORT, "retentionUntil": DATE},
    "ResearchReport": {"id": ID, "studyId": ID, "title": SHORT, "status": STATUS, "generatedAt": DATE, "metrics": arr(ref("ResearchMetric"))},
    "ResearchExport": {"id": ID, "studyId": ID, "status": STATUS, "expiresAt": DATE, "downloadUrl": URL, "approvedBy": ID},
    "InsightPublication": {"id": ID, "title": SHORT, "status": STATUS, "snapshotHash": SHORT, "disclosureAssessmentId": ID, "releasedAt": DATE, "metrics": arr(ref("ResearchMetric"))},
    "PublicInsight": {"id": ID, "title": SHORT, "releasedAt": DATE, "metrics": arr(ref("ResearchMetric")), "methodology": TEXT},
    "SearchHit": {"publicationId": ID, "editionId": ID, "revisionId": ID, "lessonId": ID, "title": SHORT, "snippet": TEXT, "score": {"type": "number", "minimum": 0}},
    "RevisionDiff": {"fromRevisionId": ID, "toRevisionId": ID, "changes": arr(obj({"kind": string(enum=["added", "removed", "changed"]), "path": SHORT, "summary": TEXT}, ["kind", "path", "summary"]))},
    "PrivacyRequest": {"id": ID, "kind": string(enum=["access", "erase", "restrict", "export"]), "status": STATUS, "createdAt": DATE, "resolvedAt": DATE},
    "RoleAssignment": {"id": ID, "userId": ID, "role": ROLE, "scopeType": SCOPE, "scopeId": ID, "expiresAt": DATE, "status": STATUS},
    "RoleDefinition": {"code": ROLE, "description": TEXT, "scopeTypes": arr(SCOPE)},
    "ReconciliationRun": {"id": ID, "provider": SHORT, "status": STATUS, "startedAt": DATE, "completedAt": DATE, "matched": INT, "exceptions": INT},
    "FinanceReport": {"periodStart": DATE, "periodEnd": DATE, "currency": CURRENCY, "grossMinor": MONEY, "refundMinor": MONEY, "netMinor": {"type": "integer"}, "paidOrders": INT},
    "FeatureFlag": {"id": ID, "key": SHORT, "enabled": BOOL, "scopeType": SCOPE, "scopeId": ID, "updatedAt": DATE},
    "ConsentRecord": {"id": ID, "purpose": STATUS, "granted": BOOL, "policyVersion": SHORT, "recordedAt": DATE},
    "RetentionRun": {"id": ID, "scope": STATUS, "status": STATUS, "startedAt": DATE, "completedAt": DATE, "deletedCount": INT},
    "ImportJob": {"id": ID, "kind": STATUS, "status": STATUS, "acceptedCount": INT, "rejectedCount": INT, "reportAssetId": ID},
    "GiftCode": {"id": ID, "status": STATUS, "scopeType": SCOPE, "scopeId": ID, "maxRedemptions": INT, "redeemedCount": INT, "expiresAt": DATE},
    "GiftCodeIssue": {"id": ID, "redemptionCode": string(min_length=16, max_length=128), "expiresAt": DATE, "maxRedemptions": INT, "status": STATUS},
    "AdminExport": {"id": ID, "kind": STATUS, "status": STATUS, "expiresAt": DATE, "downloadUrl": URL},
    "AiAnswer": {"answer": TEXT, "citations": arr(obj({"editionId": ID, "revisionId": ID, "chapterId": ID, "lessonId": ID, "anchor": SHORT}, ["editionId", "revisionId", "chapterId"])), "limitations": TEXT, "modelPolicyVersion": SHORT},
    "EligibilityPolicy": {"institutionId": ID, "categories": arr(STATUS), "requiresRoster": BOOL, "requiresSso": BOOL, "membershipDays": INT, "capacity": INT, "updatedAt": DATE},
    "AccessDecision": {"allowed": BOOL, "reasonCode": STATUS, "policyId": SHORT, "evaluatedAt": DATE},
}

ENTITY_REQUIRED = {
    "Acknowledgement": ["accepted", "message"], "Account": ["id", "status", "createdAt"],
    "Session": ["id", "createdAt", "expiresAt", "current"],
    "Publication": ["id", "slug", "kind", "title", "status", "accessClass"],
    "Volume": ["id", "publicationId", "ordinal", "title"],
    "Edition": ["id", "publicationId", "label", "ordinal", "status"],
    "Revision": ["id", "editionId", "version", "status", "contentHash"],
    "Chapter": ["id", "revisionId", "ordinal", "title"],
    "Lesson": ["id", "chapterId", "ordinal", "title", "bodyHtml"],
    "Resource": ["id", "title", "mediaType", "accessClass", "status"],
    "DownloadTicket": ["url", "expiresAt", "assetId"],
    "ResourceOpen": ["resourceId", "viewerUrl", "expiresAt", "permission"],
    "ContentPolicy": ["id", "scopeType", "scopeId", "read", "copy", "print", "download", "offline", "screenshotMode", "version"],
    "PermissionDecision": ["allowed", "reasonCode", "evaluatedAt"],
    "Entitlement": ["id", "source", "scopeType", "scopeId", "startsAt", "expiresAt", "status"],
    "Plan": ["id", "code", "name", "priceMinor", "currency", "status"],
    "Order": ["id", "merchantReference", "amountMinor", "currency", "status", "createdAt"],
    "Payment": ["id", "orderId", "provider", "status", "amountMinor", "currency"],
    "Refund": ["id", "paymentId", "amountMinor", "currency", "status", "createdAt"],
    "Subscription": ["id", "planId", "status", "startsAt", "paidThroughAt"],
    "ResearchEventReceipt": ["eventId", "status", "receivedAt"],
    "ResearchMetric": ["metric", "value", "periodStart", "periodEnd", "suppressed"],
    "PublicInsight": ["id", "title", "releasedAt", "metrics", "methodology"],
    "InsightPublication": ["id", "title", "status", "snapshotHash", "metrics"],
    "ResearchDashboard": ["periodStart", "periodEnd", "metrics", "lastComputedAt"],
    "Health": ["status", "checkedAt"],
    "SyncResult": ["accepted", "rejected", "serverTime"],
}


def entity_schema(name: str) -> dict:
    fields = ENTITY_FIELDS[name]
    required = ENTITY_REQUIRED.get(name, ["id"] if "id" in fields else [])
    return obj(fields, required)


def base_schemas() -> dict:
    out = {name: entity_schema(name) for name in ENTITY_FIELDS}
    out["Problem"] = obj({
        "type": URL, "title": SHORT, "status": {"type": "integer", "minimum": 400, "maximum": 599},
        "detail": TEXT, "instance": SHORT, "code": SHORT, "requestId": SHORT,
        "fieldErrors": arr(obj({"field": SHORT, "code": SHORT, "message": SHORT}, ["field", "code", "message"])),
    }, ["type", "title", "status", "code", "requestId"])
    out["PageInfo"] = obj({"nextCursor": SHORT, "limit": {"type": "integer", "minimum": 1, "maximum": 100}, "hasMore": BOOL}, ["limit", "hasMore"])
    return out
