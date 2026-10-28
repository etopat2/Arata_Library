"""Build the reviewed v1 API contract from an explicit operation inventory.

The ignored source design documents are deliberately not read by this build.
"""
from __future__ import annotations

import csv
import json
import re
from pathlib import Path
import yaml

from schema_library import base_schemas, ENTITY_FIELDS, ref, obj, arr, ID, DATE, SHORT, STATUS, INT, string
from input_library import F, input_schema
from operation_additions import ADDITIONS
from billing_runtime import apply_billing_runtime
from entitlement_runtime import apply_entitlement_runtime
from institution_runtime import apply_institution_runtime

ROOT = Path(__file__).resolve().parent.parent
API = ROOT / "api"
METHODS = {"GET", "POST", "PUT", "PATCH", "DELETE"}

BODY = """
POST /auth/register Register
POST /auth/login Login
POST /auth/verify-email VerifyEmail
POST /auth/password/reset-request ResetRequest
POST /auth/password/reset ResetPassword
POST /auth/mfa/challenge MfaChallenge
POST /auth/mfa/verify MfaVerify
PATCH /me/profile ProfilePatch
PUT /me/notification-preferences NotificationPreferences
PUT /me/privacy-preferences PrivacyPreferences
POST /me/bookmarks BookmarkCreate
POST /me/annotations AnnotationCreate
PUT /me/progress ProgressUpsert
POST /reader/offline-licenses OfflineLicenseCreate
POST /reader/sync SyncBatch
POST /learning/quizzes/{id}/attempts QuizAttemptCreate
POST /learning/attempts/{id}/submit QuizSubmit
POST /learning/projects ProjectCreate
POST /orders OrderCreate
POST /institutional/eligibility/check EligibilityCheck
POST /institutional/memberships MembershipCreate
POST /admin/publications PublicationCreate
PATCH /admin/publications/{id} PublicationPatch
POST /admin/publications/{id}/volumes VolumeCreate
POST /admin/volumes/{id}/editions EditionCreate
POST /admin/editions/{id}/revisions RevisionCreate
PATCH /admin/revisions/{id} RevisionPatch
POST /admin/revisions/{id}/chapters ChapterCreate
POST /admin/publications/{id}/editions EditionCreate
POST /admin/chapters/{id}/lessons LessonCreate
PATCH /admin/lessons/{id} LessonPatch
POST /admin/revisions/{id}/submit-review RevisionSubmit
POST /admin/revisions/{id}/approve ReviewDecision
POST /admin/revisions/{id}/publish RevisionPublish
POST /admin/uploads/initiate UploadInitiate
POST /admin/uploads/{id}/complete UploadComplete
POST /admin/resource-attachments ResourceAttachment
POST /admin/content-policies ContentPolicyCreate
PATCH /admin/content-policies/{id} ContentPolicyPatch
POST /admin/entitlements GrantCreate
POST /admin/entitlements/{id}/revoke Reason
POST /admin/entitlements/{id}/extend GrantExtend
POST /admin/institutions InstitutionCreate
POST /admin/institutions/{id}/domains DomainCreate
POST /admin/institutions/{id}/domains/{domainId}/approve Reason
POST /admin/institution-memberships/{id}/review MembershipReview
POST /admin/cohorts CohortCreate
POST /admin/plans PlanCreate
POST /admin/payments/reconcile Reconcile
POST /research/events ResearchEvent
POST /admin/research/studies ResearchStudyCreate
POST /admin/research/reports ResearchReportCreate
POST /admin/research/exports ResearchExportCreate
POST /admin/research/publications InsightPublicationCreate
POST /admin/research/publications/{id}/review InsightReviewDecision
POST /admin/research/publications/{id}/approve InsightApproval
POST /admin/research/publications/{id}/release InsightRelease
POST /admin/research/publications/{id}/withdraw Reason
POST /admin/research/publications/{id}/disclosure-assessment DisclosureAssessment
PATCH /admin/users/{id}/status StatusChange
POST /admin/role-assignments RoleAssignmentCreate
DELETE /admin/role-assignments/{id} Reason
POST /admin/refunds RefundCreate
POST /admin/refunds/{id}/approve Reason
POST /me/trials TrialCreate
POST /me/privacy-requests PrivacyRequestCreate
POST /admin/privacy-requests/{id}/resolve PrivacyRequestResolve
POST /admin/publications/{id}/withdraw Reason
POST /learning/projects/{id}/submissions ProjectSubmissionCreate
POST /learning/code-labs/{id}/runs CodeRunCreate
POST /me/support-tickets SupportTicketCreate
POST /admin/support-tickets/{id}/resolve Reason
PATCH /admin/feature-flags/{id} FeatureFlagPatch
POST /me/consents ConsentCreate
POST /admin/research/retention-runs RetentionRunCreate
PUT /admin/institutions/{id}/eligibility-policy EligibilityPolicyUpsert
POST /auth/sso/{provider}/callback SsoCallback
POST /admin/imports ImportCreate
POST /admin/gift-codes GiftCodeCreate
POST /gift-codes/redeem GiftCodeRedeem
PUT /me/reader-settings ReaderSettingsUpsert
POST /me/learning-goals LearningGoalCreate
POST /learning/lessons/{id}/discussions DiscussionThreadCreate
POST /learning/discussions/{id}/replies DiscussionReplyCreate
POST /admin/institutions/{id}/roster-imports RosterImportCreate
POST /me/ai/questions AiQuestion
POST /admin/exports AdminExportCreate
"""
BODY_MAP = {f"{method} /api/v1{path}": schema for method, path, schema in (line.split() for line in BODY.strip().splitlines())}

NO_BODY = {
    "POST /api/v1/auth/logout", "POST /api/v1/resources/{id}/download",
    "POST /api/v1/me/subscriptions/{id}/cancel", "POST /api/v1/me/notifications/{id}/read",
}

PUBLIC = {
    "POST /api/v1/auth/register", "POST /api/v1/auth/login", "POST /api/v1/auth/verify-email",
    "POST /api/v1/auth/password/reset-request", "POST /api/v1/auth/password/reset",
    "GET /api/v1/catalogue/collections", "GET /api/v1/catalogue/publications",
    "GET /api/v1/catalogue/publications/{id}", "GET /api/v1/catalogue/publications/{id}/volumes",
    "GET /api/v1/catalogue/editions/{id}", "GET /api/v1/catalogue/editions/{id}/history",
    "GET /api/v1/catalogue/publications/{id}/toc",
    "GET /api/v1/catalogue/search", "GET /api/v1/free-resources", "GET /api/v1/resources/{id}",
    "GET /api/v1/plans", "GET /api/v1/public/insights", "GET /api/v1/public/insights/{id}",
    "GET /api/v1/public/statistics/library-overview", "GET /api/v1/public/statistics/popular-resources",
    "GET /api/v1/health/live",
    "GET /api/v1/auth/sso/{provider}/start", "POST /api/v1/auth/sso/{provider}/callback",
    "GET /api/v1/catalogue/publications/{id}/related",
}

SPECIAL_SECURITY = {
    "POST /api/v1/payments/webhooks/{provider}": "webhookSignature",
    "GET /api/v1/health/ready": "serviceToken",
}

HIGH_RISK = [
    "/admin/role-assignments", "/admin/entitlements", "/admin/institutions/{id}/domains/{domainId}/approve",
    "/admin/refunds", "/admin/research/exports", "/admin/research/publications/{id}/release",
    "/admin/research/publications/{id}/approve", "/admin/privacy-requests/{id}/resolve",
    "/admin/users/{id}/status", "/admin/publications/{id}/withdraw", "/admin/exports",
    "/admin/research/retention-runs", "/admin/feature-flags",
    "/admin/gift-codes",
    "/admin/revisions/{id}/publish",
]

LIST_PATHS = {
    "/auth/sessions", "/catalogue/collections", "/catalogue/publications", "/catalogue/publications/{id}/volumes",
    "/catalogue/editions/{id}/history", "/catalogue/search", "/free-resources", "/me/entitlements",
    "/me/bookmarks", "/me/annotations", "/me/progress", "/me/subscriptions", "/me/invoices",
    "/me/notifications", "/me/refunds", "/me/privacy-requests", "/reader/offline-licenses",
    "/learning/projects", "/plans", "/institutional/memberships", "/admin/publications",
    "/admin/content-policies", "/admin/entitlements", "/admin/institutions", "/admin/institutions/{id}/memberships",
    "/admin/cohorts", "/admin/plans", "/admin/orders", "/admin/payments", "/admin/refunds",
    "/admin/audit", "/admin/users", "/admin/roles", "/admin/security/alerts",
    "/admin/research/studies", "/admin/research/reports", "/admin/research/publications",
    "/admin/research/events", "/admin/research/sessions", "/admin/research/quality",
    "/admin/privacy-requests", "/public/insights", "/public/statistics/popular-resources",
    "/learning/projects/{id}/submissions", "/me/support-tickets", "/admin/support-tickets",
    "/admin/feature-flags", "/me/consents", "/admin/uploads/{id}/assets",
    "/catalogue/publications/{id}/related", "/me/recommendations", "/me/learning-goals",
    "/learning/lessons/{id}/discussions",
}

RESOURCE_OVERRIDES = {
    "/auth/register": "Acknowledgement", "/auth/login": "Session", "/auth/logout": "Session",
    "/auth/verify-email": "Acknowledgement", "/auth/password/reset-request": "Acknowledgement", "/auth/password/reset": "Acknowledgement",
    "/auth/mfa/challenge": "Session", "/auth/mfa/verify": "Session", "/auth/sessions": "Session",
    "/me/dashboard": "ReaderDashboard", "/me/profile": "Profile", "/me/notification-preferences": "NotificationPreferences",
    "/me/privacy-preferences": "PrivacyPreferences", "/me/entitlements": "Entitlement",
    "/reader/sync": "SyncResult", "/reader/editions/{id}/manifest": "ReaderManifest",
    "/catalogue/search": "Publication", "/free-resources": "Resource",
    "/learning/attempts/{id}/submit": "QuizAttempt", "/institutional/eligibility/check": "Eligibility",
    "/admin/payments/reconcile": "ReconciliationRun", "/admin/research/dashboard": "ResearchDashboard",
    "/admin/research/metrics": "ResearchMetric", "/admin/research/quality": "ResearchQuality",
    "/admin/research/sessions": "ResearchSession", "/admin/research/events": "ResearchEventRecord",
    "/research/events": "ResearchEventReceipt", "/admin/security/alerts": "SecurityAlert",
    "/resources/{id}/open": "ResourceOpen", "/resources/{id}/download": "DownloadTicket",
    "/reader/lessons/{id}/code-assets": "Resource",
    "/admin/research/publications/{id}/disclosure-assessment": "InsightPublication",
    "/public/statistics/library-overview": "ResearchMetric", "/public/statistics/popular-resources": "ResearchMetric",
    "/health/live": "Health", "/health/ready": "Health", "/admin/system/health": "Health",
    "/admin/access/decisions/{id}": "AccessDecision", "/admin/roles": "RoleDefinition",
    "/admin/users": "Account", "/me/trials": "Subscription",
    "/catalogue/publications/{id}/toc": "TableOfContents",
    "/reader/editions/{id}/search": "SearchHit", "/admin/revisions/{id}/diff": "RevisionDiff",
    "/learning/code-labs/{id}": "CodeLab", "/learning/code-labs/{id}/runs": "CodeRun",
    "/admin/finance/report": "FinanceReport", "/admin/feature-flags": "FeatureFlag",
    "/me/consents": "ConsentRecord", "/admin/research/retention": "RetentionRun",
    "/admin/research/retention-runs": "RetentionRun", "/admin/content-policies/effective": "PermissionDecision",
    "/admin/institutions/{id}/eligibility-policy": "EligibilityPolicy",
    "/admin/uploads/{id}/assets": "Asset",
    "/auth/sso/{provider}/start": "SsoRedirect", "/auth/sso/{provider}/callback": "Session",
    "/catalogue/publications/{id}/related": "Publication", "/me/recommendations": "Publication",
    "/admin/imports": "ImportJob", "/admin/gift-codes": "GiftCodeIssue", "/gift-codes/redeem": "Entitlement",
    "/me/reader-settings": "ReaderSettings", "/me/learning-goals": "LearningGoal",
    "/admin/exports": "AdminExport", "/me/ai/questions": "AiAnswer",
    "/admin/institutions/{id}/impact-report": "InstitutionImpactReport",
}

ROUTE_RESOURCE = [
    ("notification", "Notification"), ("refund", "Refund"), ("invoice", "Invoice"),
    ("reconciliation", "ReconciliationRun"), ("payment", "Payment"), ("order", "Order"),
    ("subscription", "Subscription"), ("plan", "Plan"), ("trial", "Subscription"),
    ("offline-licenses", "OfflineLicense"), ("bookmark", "Bookmark"), ("annotation", "Annotation"),
    ("progress", "Progress"), ("resource-attachments", "Resource"), ("resource", "Resource"),
    ("upload", "Upload"), ("content-polic", "ContentPolicy"), ("entitlement", "Entitlement"),
    ("membership", "Membership"), ("domains", "VerifiedDomain"), ("institution", "Institution"),
    ("cohort", "Cohort"), ("volume", "Volume"), ("edition", "Edition"),
    ("revision", "Revision"), ("chapter", "Chapter"), ("lesson", "Lesson"),
    ("publication", "Publication"), ("collection", "Collection"), ("quiz", "Quiz"),
    ("attempt", "QuizAttempt"), ("project", "Project"), ("audit", "AuditEvent"),
    ("privacy-request", "PrivacyRequest"), ("role-assignment", "RoleAssignment"),
    ("research/exports", "ResearchExport"), ("research/reports", "ResearchReport"),
    ("research/studies", "ResearchStudy"), ("research/publications", "InsightPublication"),
    ("insights", "InsightPublication"),
]

REQ_BY_DOMAIN = {
    "auth": ["FR-IAM-001", "FR-IAM-003", "FR-IAM-006"],
    "profile": ["FR-IAM-007"], "notifications": ["FR-OPS-001", "FR-OPS-002"],
    "catalogue": ["FR-CAT-001", "FR-CAT-002", "FR-CAT-008"],
    "resources": ["FR-AST-011", "FR-ENT-009", "BR-009", "BR-012"],
    "reader": ["FR-RDR-001", "FR-ENT-001", "FR-ENT-009"],
    "offline": ["FR-OFL-003", "FR-OFL-004", "BR-016"],
    "learning": ["FR-LRN-002", "FR-LRN-003"],
    "subscriptions": ["FR-PAY-011", "FR-PAY-012", "BR-007"],
    "payments": ["FR-PAY-003", "FR-PAY-006", "FR-PAY-007", "BR-008"],
    "institutions": ["FR-INS-002", "FR-INS-004", "BR-005", "BR-006"],
    "publishing": ["FR-PUB-004", "FR-PUB-008", "BR-003", "BR-015"],
    "administration": ["FR-OPS-003", "FR-OPS-007"],
    "research": ["BR-013", "BR-018", "FR-OPS-004"],
    "privacy": ["FR-IAM-007", "BR-017"],
    "security": ["FR-OPS-004", "FR-OPS-007"],
    "health": ["FR-OPS-006"],
}

# Operation-level semantic anchors supplement the broad domain anchors above.
# A route is linked only where its contract can participate in that SRS behavior.
ROUTE_REQUIREMENTS = [
    (r"^/auth/register$", "FR-IAM-001 FR-IAM-002 FR-IAM-005 FR-IAM-006 SEC-009"),
    (r"^/auth/(login|logout|sessions)", "FR-IAM-003 FR-IAM-008 FR-IAM-009 SEC-002 SEC-005"),
    (r"^/auth/sessions|^/reader/offline-licenses", "FR-ENT-016"),
    (r"^/auth/mfa", "FR-IAM-004 SEC-005"),
    (r"^/auth/(password|verify-email)", "FR-IAM-002 FR-IAM-011 SEC-009"),
    (r"^/auth/sso", "FR-IAM-010 FR-INS-004 SEC-005"),
    (r"^/me/(profile|notification-preferences|privacy-preferences|consents)", "FR-IAM-007"),
    (r"^/catalogue/", "FR-CAT-001 FR-CAT-002 FR-CAT-003 FR-CAT-004 FR-CAT-005 FR-CAT-007 FR-CAT-008 FR-CAT-010"),
    (r"^/catalogue/search$", "FR-SRC-001 FR-SRC-002 FR-SRC-003 FR-SRC-004 FR-SRC-006"),
    (r"^/catalogue/publications/\{id\}/related$|^/me/recommendations$", "FR-CAT-009 FR-SRC-008"),
    (r"^/free-resources$", "FR-CAT-006 BR-001"),
    (r"^/resources/", "FR-CAT-006 FR-ENT-008 FR-ENT-009 FR-ENT-013 BR-002 BR-009 BR-012 RAI-COL-003"),
    (r"^/admin/publications$", "FR-PUB-001 FR-PUB-002 FR-PUB-006 FR-PUB-007"),
    (r"^/admin/publications/\{id\}/volumes$", "FR-PUB-001 FR-PUB-002"),
    (r"^/admin/volumes/", "FR-PUB-003"),
    (r"^/admin/editions/", "FR-PUB-004 FR-PUB-011"),
    (r"^/admin/revisions/\{id\}/chapters$", "FR-PUB-005 FR-LRN-001"),
    (r"^/admin/revisions/\{id\}/(submit-review|approve|publish)$", "FR-PUB-008 FR-PUB-009 FR-PUB-016 BR-015"),
    (r"^/admin/revisions/\{id\}/diff$", "FR-PUB-012 FR-PUB-013"),
    (r"^/admin/publications/\{id\}/withdraw$", "FR-PUB-010 FR-PUB-015 BR-003"),
    (r"^/admin/resource-attachments$", "FR-PUB-014 FR-AST-002 FR-AST-009"),
    (r"^/admin/uploads", "FR-AST-001 FR-AST-003 FR-AST-004 FR-AST-005 FR-AST-006 FR-AST-008 FR-AST-010 FR-AST-012 SEC-008"),
    (r"^/admin/imports", "FR-AST-007 FR-AST-008"),
    (r"^/admin/content-policies", "FR-ENT-007 FR-ENT-008 FR-ENT-010 FR-ENT-011 FR-ENT-012 BR-010 BR-011"),
    (r"^/admin/entitlements", "FR-ENT-001 FR-ENT-002 FR-ENT-003 FR-ENT-004 FR-ENT-005 FR-ENT-006 FR-ENT-015 BR-004"),
    (r"^/me/entitlements$", "FR-ENT-001 FR-ENT-002 FR-ENT-004 FR-INS-011 BR-004"),
    (r"^/reader/", "FR-RDR-001 FR-RDR-003 FR-RDR-007 FR-RDR-008 FR-RDR-009 FR-RDR-010 FR-RDR-012 FR-ENT-014"),
    (r"^/reader/editions/\{id\}/search$", "FR-SRC-005 FR-SRC-007"),
    (r"^/me/reader-settings$", "FR-RDR-002 FR-RDR-011 FR-OFL-012"),
    (r"^/me/(bookmarks|annotations|progress)", "FR-RDR-004 FR-RDR-005 FR-RDR-006 BR-017"),
    (r"^/reader/offline-licenses", "FR-OFL-003 FR-OFL-004 FR-OFL-005 FR-OFL-006 FR-OFL-010 FR-OFL-011 BR-016"),
    (r"^/reader/sync$", "FR-OFL-007 FR-OFL-008 FR-OFL-009 FR-OFL-011"),
    (r"^/learning/quizzes", "FR-LRN-001 FR-LRN-002 FR-LRN-003 FR-LRN-004"),
    (r"^/learning/attempts", "FR-LRN-003 FR-LRN-004 FR-LRN-006"),
    (r"^/learning/projects", "FR-LRN-007 FR-LRN-008"),
    (r"^/learning/code-labs", "FR-LRN-005 FR-LRN-011 SEC-004"),
    (r"^/me/learning-goals", "FR-LRN-009"),
    (r"^/learning/certificates", "FR-LRN-010"),
    (r"^/learning/(lessons|discussions).*/(discussions|replies)", "FR-LRN-012"),
    (r"^/plans$|^/admin/plans", "FR-PAY-001 FR-PAY-002"),
    (r"^/orders$", "FR-PAY-003 FR-PAY-004 FR-PAY-006 FR-PAY-008 INT-008"),
    (r"^/payments/", "FR-PAY-005 FR-PAY-006 FR-PAY-007 FR-PAY-008 FR-PAY-015 INT-006 INT-010 BR-008 RAI-COL-003"),
    (r"^/me/(subscriptions|invoices|refunds|trials)", "FR-PAY-009 FR-PAY-010 FR-PAY-011 FR-PAY-012 FR-PAY-013 FR-PAY-016 BR-007"),
    (r"^/admin/(payments|orders|refunds|reconciliation|finance)", "FR-PAY-013 FR-PAY-014 FR-PAY-015 FR-PAY-018 SEC-011"),
    (r"^/admin/gift-codes|^/gift-codes", "FR-ENT-017 FR-PAY-006"),
    (r"^/institutional/", "FR-INS-003 FR-INS-004 FR-INS-005 FR-INS-006 FR-INS-011 BR-005 BR-006"),
    (r"^/admin/institutions", "FR-INS-001 FR-INS-002 FR-INS-007 FR-INS-008 FR-INS-009 FR-INS-010 BR-014 SEC-010"),
    (r"^/admin/institutions/\{id\}/roster-imports$", "FR-INS-012"),
    (r"^/admin/institutions/\{id\}/impact-report$", "FR-INS-013"),
    (r"^/admin/institution-memberships", "FR-INS-004 FR-INS-008 FR-INS-009"),
    (r"^/admin/cohorts", "FR-INS-007 FR-INS-009"),
    (r"^/me/notifications|^/me/notification-preferences", "FR-OPS-001 FR-OPS-002"),
    (r"^/admin/audit|^/admin/security", "FR-OPS-004 SEC-011 SEC-013"),
    (r"^/admin/system/health|^/health/", "FR-OPS-006"),
    (r"^/admin/feature-flags", "FR-OPS-007 FR-OPS-008"),
    (r"^/admin/exports", "FR-OPS-009"),
    (r"^/me/support-tickets|^/admin/support-tickets", "FR-OPS-005"),
    (r"^/research/events$", "RAI-COL-001 RAI-COL-002 RAI-COL-004 RAI-COL-005 RAI-COL-006 RAI-COL-011 RAI-COL-012 RAI-COL-013 INT-007 SEC-014"),
    (r"^/admin/research/(events|sessions|quality)", "RAI-COL-007 RAI-COL-008 RAI-COL-009 RAI-COL-010 RAI-COL-015 RAI-ANA-008"),
    (r"^/admin/research/retention", "RAI-COL-014 RAI-COL-017"),
    (r"^/admin/research/(dashboard|metrics)", "RAI-ANA-001 RAI-ANA-002 RAI-ANA-003 RAI-ANA-004 RAI-ANA-005 RAI-ANA-006 RAI-ANA-007"),
    (r"^/admin/research/studies", "RAI-ANA-009 RAI-ANA-015 RAI-ANA-016"),
    (r"^/admin/research/reports", "RAI-ANA-010 RAI-ANA-011 RAI-ANA-013 RAI-ANA-014 RAI-ANA-015"),
    (r"^/admin/research/exports", "RAI-ANA-012 SEC-014"),
    (r"^/admin/research/publications", "RAI-PUB-001 RAI-PUB-003 RAI-PUB-004 RAI-PUB-006 RAI-PUB-007 RAI-PUB-008 RAI-PUB-009 RAI-PUB-010 BR-018"),
    (r"^/public/(insights|statistics)", "RAI-PUB-002 RAI-PUB-005 RAI-PUB-009 RAI-PUB-011 RAI-PUB-012 BR-013 BR-018"),
    (r"^/me/privacy-requests|^/admin/privacy-requests", "SEC-014 BR-017"),
    (r"^/me/ai/", "FR-AI-001 FR-AI-002 FR-AI-003 FR-AI-004 FR-AI-005 FR-AI-006 FR-AI-007 FR-AI-008 SEC-015"),
]


def route_key(op):
    return op["method"] + " " + op["path"]


def short_path(path):
    return path.removeprefix("/api/v1")


def resource_for(path):
    p = short_path(path)
    if p in RESOURCE_OVERRIDES: return RESOURCE_OVERRIDES[p]
    if p.startswith("/auth/sessions/"): return "Session"
    if p.startswith("/admin/users/"): return "Account"
    if p.startswith("/admin/lessons/"): return "Lesson"
    if p.startswith("/admin/chapters/"): return "Lesson"
    if p.startswith("/admin/publications/") and p.endswith("/editions"): return "Edition"
    if p.startswith("/me/support-tickets") or p.startswith("/admin/support-tickets"): return "SupportTicket"
    if p.startswith("/admin/imports/") or p.endswith("/roster-imports"): return "ImportJob"
    if p.startswith("/admin/gift-codes/"): return "GiftCode"
    if p.startswith("/admin/exports/"): return "AdminExport"
    if p.startswith("/learning/certificates/"): return "Certificate"
    if p.startswith("/learning/lessons/") and "/discussions" in p: return "DiscussionThread"
    if p.startswith("/learning/discussions/"): return "DiscussionPost"
    if p.startswith("/admin/feature-flags/"): return "FeatureFlag"
    if p.startswith("/me/consents"): return "ConsentRecord"
    if p.startswith("/learning/projects/") and "/submissions" in p: return "ProjectSubmission"
    if p.startswith("/admin/research/publications"): return "InsightPublication"
    if p.startswith("/admin/research/exports"): return "ResearchExport"
    if p.startswith("/admin/research/reports"): return "ResearchReport"
    if p.startswith("/admin/research/studies"): return "ResearchStudy"
    if p.startswith("/public/insights"): return "PublicInsight"
    for fragment, resource in ROUTE_RESOURCE:
        if fragment in p: return resource
    raise ValueError(f"No response resource: {path}")


def public_kind(key):
    return "public" if key in PUBLIC else "webhook" if key.startswith("POST /api/v1/payments/webhooks/") else "service" if key in SPECIAL_SECURITY else "optional_session" if key in {"GET /api/v1/resources/{id}/open", "POST /api/v1/resources/{id}/download"} else "session"


def role_for(op):
    p = short_path(op["path"])
    if not p.startswith("/admin/"): return []
    if p.startswith("/admin/research/"):
        if "/retention" in p: return ["research_admin", "privacy_approver"]
        if "/exports" in p: return ["research_admin"]
        if "/publications" in p and ("/approve" in p or "/review" in p): return ["privacy_approver"]
        if "/publications" in p and ("/release" in p or "/withdraw" in p): return ["research_admin"]
        return ["research_analyst", "research_admin"]
    if p.startswith("/admin/payments") or p.startswith("/admin/refunds") or p.startswith("/admin/orders") or p.startswith("/admin/reconciliation") or p.startswith("/admin/finance"): return ["finance"]
    if p.startswith("/admin/role-assignments") or p.startswith("/admin/security") or p.startswith("/admin/access"): return ["security_admin", "platform_admin"]
    if p.startswith("/admin/privacy-requests"): return ["privacy_approver"]
    if p.startswith("/admin/institutions") or p.startswith("/admin/institution-memberships") or p.startswith("/admin/cohorts"):
        return ["platform_admin", "institution_manager"] if op["method"] == "GET" else ["platform_admin"]
    if p.startswith("/admin/audit"): return ["security_admin", "platform_admin"]
    if p.startswith("/admin/support-tickets"): return ["support", "platform_admin"]
    if p.startswith("/admin/gift-codes"): return ["finance", "platform_admin"]
    if p.startswith("/admin/imports"): return ["editor", "publisher"]
    if p.startswith("/admin/exports"): return ["platform_admin", "finance", "security_admin"]
    if p.startswith("/admin/feature-flags"): return ["platform_admin"]
    if p.startswith("/admin/system"): return ["platform_admin", "security_admin"]
    if p.startswith("/admin/users"): return ["support", "platform_admin"] if op["method"] == "GET" else ["platform_admin"]
    if p.startswith("/admin/entitlements"): return ["platform_admin"]
    if p.startswith("/admin/plans"): return ["finance", "platform_admin"]
    if p.startswith("/admin/uploads") or p.startswith("/admin/publications") or p.startswith("/admin/volumes") or p.startswith("/admin/editions") or p.startswith("/admin/revisions") or p.startswith("/admin/chapters") or p.startswith("/admin/lessons") or p.startswith("/admin/resource") or p.startswith("/admin/content"):
        return ["author", "editor", "publisher"] if op["method"] == "GET" else ["editor", "publisher"]
    return ["platform_admin"]


def policy_for(op):
    key = route_key(op); p = short_path(op["path"]); kind = public_kind(key)
    rule = {"effect": "allow", "authentication": kind, "rolesAny": role_for(op),
            "ownership": "none", "institutionBoundary": "none", "entitlement": "none",
            "contentPermission": "none", "mfa": False, "reasonRequired": False,
            "distinctApprover": False, "purposeRequired": False,
            "note": "Deny by default; server evaluates current resource state."}
    if kind in {"session", "optional_session"}:
        if p.startswith("/me/") or p.startswith("/auth/sessions"): rule["ownership"] = "subject_user"
        if p.startswith("/reader/") or p.startswith("/learning/") or p.startswith("/resources/"):
            rule["entitlement"] = "active_scope_or_free"; rule["contentPermission"] = "read"
        if p.endswith("/download") or p.endswith("/open") or "code-assets" in p:
            rule["contentPermission"] = "download" if p.endswith("/download") else "read"
        if p.startswith("/institutional/") or "/institutions/" in p or "/cohorts" in p:
            rule["institutionBoundary"] = "verified_membership_or_scoped_admin"
        if p.startswith("/admin/research/"):
            rule["institutionBoundary"] = "research_isolation"
            rule["mfa"] = True; rule["purposeRequired"] = True
        if p == "/research/events": rule["ownership"] = "subject_user"; rule["contentPermission"] = "research_consent"
        if p.startswith("/admin/publications") or p.startswith("/admin/revisions") or p.startswith("/admin/editions") or p.startswith("/admin/volumes") or p.startswith("/admin/chapters") or p.startswith("/admin/lessons"):
            rule["ownership"] = "editorial_scope"
        if (p.startswith("/admin/revisions/") and op["method"] == "PATCH") or p.endswith("/chapters") or p.startswith("/admin/chapters/") or (p.startswith("/admin/lessons/") and op["method"] == "PATCH"):
            rule["contentPermission"] = "draft_only_mutation"
        if p.startswith("/admin/entitlements"):
            rule["ownership"] = "grant_scope"
        if p.startswith("/admin/exports/"):
            rule["ownership"] = "export_scope"
        if p.startswith("/learning/certificates/") or p.startswith("/learning/discussions/") or p.startswith("/learning/lessons/"):
            rule["ownership"] = "subject_or_cohort_scope"
        if p.startswith("/me/ai/"):
            rule["entitlement"] = "active_scope_or_free"; rule["contentPermission"] = "ai_consent_and_read"
        if p.startswith("/admin/gift-codes"):
            rule["contentPermission"] = "verified_paid_purchase"
        if p.startswith("/admin/exports"):
            rule["exportKindRoles"] = {"users": ["platform_admin"], "finance": ["finance"], "audit": ["security_admin"], "institution_memberships": ["platform_admin"]}
            rule["sensitiveExportApproval"] = True
    if any(part in p for part in HIGH_RISK) and op["method"] != "GET":
        rule["mfa"] = True; rule["reasonRequired"] = True
        rule["distinctApprover"] = any(x in p for x in ["/role-assignments", "/entitlements", "/domains/{domainId}/approve", "/research/exports", "/research/publications/{id}/release", "/research/publications/{id}/approve", "/research/retention-runs"]) or ("/refunds/" in p and p.endswith("/approve"))
    if p.startswith("/admin/research/publications/{id}/release"):
        rule["contentPermission"] = "approved_disclosure_snapshot"
    if p.startswith("/public/"):
        rule["contentPermission"] = "released_aggregate_only"
    if p.startswith("/catalogue/") or p == "/free-resources" or (p.startswith("/resources/") and kind == "public"):
        rule["contentPermission"] = "public_metadata_only"
    return rule


def requirement_ids(op, all_ids):
    p = short_path(op["path"]); tag = op["tag"]
    ids = list(REQ_BY_DOMAIN.get(tag, []))
    def add(*values):
        for v in values:
            if v not in ids: ids.append(v)
    add("INT-001", "INT-002", "INT-003", "INT-005", "INT-009", "SEC-001")
    if p in LIST_PATHS or p.startswith("/admin/uploads"): add("INT-004")
    for pattern, codes in ROUTE_REQUIREMENTS:
        if re.search(pattern, p): add(*codes.split())
    if p.startswith("/me/"): add("FR-IAM-007")
    if p.startswith("/reader/"): add("FR-RDR-001", "FR-ENT-009")
    if p.startswith("/learning/"): add("FR-LRN-002")
    if p.startswith("/institutional/"): add("FR-INS-004")
    if p.startswith("/admin/"): add("FR-OPS-003")
    if p.startswith("/admin/publications") or p.startswith("/admin/revisions") or p.startswith("/admin/volumes") or p.startswith("/admin/editions") or p.startswith("/admin/chapters") or p.startswith("/admin/lessons"): add("FR-PUB-004", "FR-PUB-008", "BR-015")
    if p.startswith("/admin/uploads") or p.startswith("/admin/resource-attachments"): add("FR-AST-003", "FR-AST-012")
    if p.startswith("/admin/research/"): add("BR-013", "BR-018")
    if p.startswith("/admin/institutions") or p.startswith("/admin/cohorts") or p.startswith("/admin/institution-memberships"): add("FR-INS-001", "FR-INS-009")
    if p.startswith("/admin/payments") or p.startswith("/admin/orders") or p.startswith("/admin/plans"): add("FR-PAY-001", "FR-PAY-015")
    if p.startswith("/admin/finance"): add("FR-PAY-018")
    if "code-labs" in p: add("FR-LRN-005", "FR-LRN-011")
    if "submissions" in p: add("FR-LRN-008")
    if "support-tickets" in p: add("FR-OPS-005")
    if "feature-flags" in p: add("FR-OPS-008")
    if "consents" in p: add("FR-IAM-007")
    if "retention" in p: add("BR-013", "FR-OPS-004")
    if "eligibility-policy" in p: add("FR-INS-004", "FR-INS-007")
    if p.startswith("/public/"): add("BR-013", "BR-018")
    if p == "/plans": add("FR-PAY-002")
    if p == "/orders": add("FR-PAY-003")
    if p == "/free-resources": add("FR-CAT-006", "BR-001")
    if p.startswith("/auth/sessions"): add("FR-IAM-009")
    if "mfa" in p: add("FR-IAM-004")
    if "profile" in p or "notification-preferences" in p: add("FR-IAM-007")
    if "privacy-preferences" in p: add("FR-IAM-007")
    if "search" in p: add("FR-SRC-001", "FR-SRC-002")
    if p.startswith("/free-resources") or (p.startswith("/resources/") and op["method"] == "GET"): add("FR-CAT-006", "BR-001")
    if "content-polic" in p: add("FR-ENT-007", "FR-ENT-008", "BR-010", "BR-011")
    if "entitlements" in p: add("FR-ENT-003", "FR-ENT-004", "BR-004")
    if "offline" in p or p == "/reader/sync": add("FR-OFL-007", "FR-OFL-008", "FR-OFL-011")
    if "refund" in p: add("FR-PAY-013", "FR-PAY-014")
    if "webhook" in p: add("FR-PAY-005", "FR-PAY-006", "BR-008")
    if "domains" in p: add("FR-INS-002", "BR-014")
    if "role-assignments" in p: add("FR-IAM-004", "FR-OPS-007")
    if "research" in p or "insights" in p or "statistics" in p: add("BR-013", "BR-018")
    if "privacy-request" in p: add("FR-OPS-004", "BR-017")
    if not ids: raise ValueError(f"No requirement mapping: {route_key(op)}")
    invalid = set(ids) - all_ids
    if invalid: raise ValueError(f"Unknown SRS IDs for {route_key(op)}: {invalid}")
    return ids


def summary_description(op, resource):
    p = short_path(op["path"]); method = op["method"]
    tail = p.split("/")[-1]
    actions = {"register": "Register an account", "login": "Create an authenticated session", "logout": "End the current session",
        "verify-email": "Verify email ownership", "reset-request": "Request password recovery", "reset": "Reset a password",
        "open": "Open an authorized resource", "download": "Request a protected download",
        "submit": "Submit an attempt", "submit-review": "Submit a revision for editorial review",
        "approve": "Approve a reviewed record", "publish": "Publish an approved revision",
        "release": "Release an approved statistical snapshot", "withdraw": "Withdraw a published record",
        "revoke": "Revoke an access grant", "extend": "Extend an access grant", "cancel": "Cancel future renewal",
        "reconcile": "Start payment reconciliation", "read": "Mark a notification as read",
        "check": "Check institution eligibility", "complete": "Complete a quarantined upload",
        "initiate": "Initiate a quarantined upload", "sync": "Synchronize offline changes"}
    if tail in actions: summary = actions[tail]
    elif method == "GET": summary = f"List {resource.lower()} records" if p in LIST_PATHS else f"Get {resource.lower()} details"
    elif method == "DELETE": summary = f"Remove {resource.lower()} record"
    elif method == "PATCH" or method == "PUT": summary = f"Update {resource.lower()} record"
    else: summary = f"Create {resource.lower()} record"
    rule = policy_for(op)
    description = (f"{summary}. Server resolves the current subject, resource scope and policy before returning data; "
        f"only the fields in the {resource} response schema are exposed. "
        f"Authentication: {rule['authentication']}; ownership: {rule['ownership']}; institution boundary: {rule['institutionBoundary']}; "
        f"entitlement: {rule['entitlement']}; content permission: {rule['contentPermission']}. "
        "A denied object is not disclosed through a more permissive list, filter or export.")
    details = [
        (r"^/auth/register$", "Accept mandatory terms and privacy versions, send a one-use email verification challenge, and use an enumeration-resistant acknowledgement."),
        (r"^/auth/(login|logout|sessions)", "Rotate or revoke server-held sessions; privileged users must complete configured MFA before administrative actions."),
        (r"^/auth/(password|verify-email)", "Use short-lived one-use tokens and uniform external responses for unknown or expired accounts."),
        (r"^/auth/sso", "Accept only configured federated providers and validate state, nonce, issuer, audience and verified email claims before benefit activation."),
        (r"^/catalogue/|^/free-resources$", "Expose published discoverable metadata only; omit draft text, private assets and unauthorized premium snippets."),
        (r"^/resources/", "Resolve current access and the requested action on the server; protected file references are short-lived and never expose enumerable object keys."),
        (r"^/me/(bookmarks|annotations|progress)", "Return and mutate only the authenticated reader's records, retaining revision anchors and deterministic synchronization metadata."),
        (r"^/reader/", "Resolve the exact approved revision and effective read, download or offline policy at request time; do not serve withdrawn content."),
        (r"^/learning/quizzes|^/learning/attempts", "Keep answer keys server-side; enforce attempt limits and grade submitted answers against the approved quiz version."),
        (r"^/learning/code-labs", "Run code only in the configured sandbox with bounded execution; never execute learner source in the API process."),
        (r"^/reader/offline-licenses|^/reader/sync", "Issue bounded offline scope and expiry, deduplicate client change IDs, and reconcile revocation on reconnect without promising immediate remote revocation."),
        (r"^/orders$", "Create an immutable merchant reference and integer minor-unit amount before gateway redirection; this request alone never grants access."),
        (r"^/payments/webhooks", "Verify the active provider signature over exact raw bytes, reject replays, confirm settlement and amount/currency/merchant match, then update access once."),
        (r"^/me/subscriptions", "A renewal cancellation preserves already paid access through its contractual paid-through time."),
        (r"^/admin/refunds", "Record the verified original transaction, amount, reason and independent approval before finance settlement or entitlement adjustment."),
        (r"^/institutional/|^/admin/institutions", "Require verified exact-domain ownership and current membership evidence; an institution manager cannot approve their own domain or cross another institution."),
        (r"^/admin/uploads|^/admin/imports", "Quarantine and validate signatures, scan binaries, preserve originals and provenance, then expose only approved derived assets."),
        (r"^/admin/(publications|volumes|editions|revisions|chapters|lessons)", "Edit drafts only, preserve immutable published revisions, and bind editorial approval and release to the exact expected content hash."),
        (r"^/admin/content-policies|^/admin/entitlements", "Resolve inherited action policy and independent additive grants at UTC decision time; changes require scope checks and audit evidence."),
        (r"^/research/events$", "Accept only allowlisted schema-versioned and consented minimized events; deduplicate event IDs and preserve event time separately from ingest time."),
        (r"^/admin/research/", "Keep private research in separate authorization scope, require approved purpose and MFA, and restrict exports to reviewed fields and retention."),
        (r"^/public/(insights|statistics)", "Serve only allowlisted fields from immutable approved aggregate snapshots; suppress unsafe cells and reject arbitrary raw-data filters."),
        (r"^/me/ai/", "Use only opted-in, currently readable revision content for retrieval; return citations and never treat retrieved text as instructions."),
        (r"^/admin/exports", "Apply export-kind role restrictions, approved purpose, sensitive-export review, short-lived delivery and audit logging."),
    ]
    for pattern, detail in details:
        if re.search(pattern, p): description += " " + detail
    return summary, description


def example(schema, components):
    if "$ref" in schema: return example(components[schema["$ref"].split("/")[-1]], components)
    if "enum" in schema: return schema["enum"][0]
    t = schema.get("type")
    if t == "object":
        keys = schema.get("required", []) or ([next(iter(schema["properties"]))] if schema.get("minProperties") else [])
        return {k: example(schema["properties"][k], components) for k in keys}
    if t == "array": return []
    if t == "integer": return max(0, schema.get("minimum", 0))
    if t == "number": return max(0, schema.get("minimum", 0))
    if t == "boolean": return True
    if t == "string":
        if schema.get("format") == "date-time": return "2026-10-22T00:00:00Z"
        if schema.get("format") == "email": return "example@invalid.test"
        if schema.get("format") == "uri": return "https://example.invalid/resource"
        if schema.get("pattern") == "^[A-Z]{3}$": return "UGX"
        if schema.get("minLength", 0) > 6: return "a" * schema["minLength"]
        if schema.get("pattern") == "^[a-z0-9.-]+$": return "example.invalid"
        return "sample"
    return None


def pagination_parameters(resource):
    fields = ENTITY_FIELDS[resource]
    sort_fields = [field for field in ("createdAt", "updatedAt", "issuedAt", "releasedAt", "occurredAt", "ordinal", "title", "name", "id", "metric") if field in fields]
    if not sort_fields: sort_fields = list(fields)[:1]
    sort_values = [value for field in sort_fields for value in (field, "-" + field)]
    parameters = [
        {"name": "cursor", "in": "query", "required": False, "description": "Opaque cursor from the preceding page; do not construct it.", "schema": SHORT},
        {"name": "limit", "in": "query", "required": False, "description": "Maximum page size.", "schema": {"type": "integer", "minimum": 1, "maximum": 100, "default": 20}},
        {"name": "sort", "in": "query", "required": False, "description": "Allowlisted sort key; prefix - requests descending order.", "schema": string(enum=sort_values)},
    ]
    if "status" in fields:
        parameters.append({"name": "status", "in": "query", "required": False, "description": "Filter by a domain-valid record status.", "schema": STATUS})
    return parameters


def parameters(op, resource):
    p = op["path"]; method = op["method"]; out = []
    for name in re.findall(r"\{([^}]+)\}", p):
        out.append({"name": name, "in": "path", "required": True, "description": f"Stable {name} identifier.", "schema": ID if name != "provider" else SHORT})
    if method == "GET" and short_path(p) in LIST_PATHS: out += pagination_parameters(resource)
    if p.endswith("/search"):
        out += [{"name": "q", "in": "query", "required": True, "description": "Search terms, normalized server side.", "schema": string(max_length=200)},
                {"name": "subject", "in": "query", "required": False, "schema": SHORT},
                {"name": "author", "in": "query", "required": False, "schema": SHORT},
                {"name": "accessClass", "in": "query", "required": False, "schema": string(enum=["public_free", "registered_free", "entitled"])},
                {"name": "contentType", "in": "query", "required": False, "schema": SHORT}]
    if p.endswith("/diff"):
        out.append({"name": "fromRevisionId", "in": "query", "required": True, "schema": ID})
    if p.endswith("/content-policies/effective"):
        out += [{"name": "scopeType", "in": "query", "required": True, "schema": string(enum=["publication", "volume", "edition", "revision", "chapter", "lesson", "resource"])},
                {"name": "scopeId", "in": "query", "required": True, "schema": ID},
                {"name": "action", "in": "query", "required": True, "schema": string(enum=["read", "copy", "print", "download", "offline"])}]
    if p == "/api/v1/catalogue/publications":
        out += [{"name": "kind", "in": "query", "required": False, "schema": string(enum=["standalone", "series"])},
                {"name": "subject", "in": "query", "required": False, "schema": SHORT},
                {"name": "accessClass", "in": "query", "required": False, "schema": STATUS}]
    if p.startswith("/api/v1/admin/research/") and method == "GET":
        out += [{"name": "from", "in": "query", "required": False, "schema": DATE},
                {"name": "to", "in": "query", "required": False, "schema": DATE}]
    if p.startswith("/api/v1/public/statistics") and method == "GET":
        out += [{"name": "period", "in": "query", "required": False, "schema": string(enum=["week", "month", "year"])}]
    return out


def build():
    inventory = json.loads((API / "design_operation_inventory.json").read_text(encoding="utf-8"))
    inventory += [dict(method=m, path=p, operationId=i, tag=t) for m,p,i,t in ADDITIONS]
    keys = [route_key(op) for op in inventory]
    if len(keys) != len(set(keys)): raise ValueError("Duplicate method/path")
    ids = [op["operationId"] for op in inventory]
    if len(ids) != len(set(ids)): raise ValueError("Duplicate operationId")
    requirement_rows = list(csv.DictReader((ROOT / "Documentation/Implementation/REQUIREMENT_TRACEABILITY.csv").open(encoding="utf-8-sig", newline="")))
    all_ids = {row["requirement_id"] for row in requirement_rows}
    components = base_schemas()
    for name in F: components[name + "Input"] = input_schema(name)
    paths = {}; policies = {}; trace = []
    for op in inventory:
        key = route_key(op); method = op["method"]; path = op["path"]
        if method not in METHODS or not path.startswith("/api/v1/"): raise ValueError(key)
        if method in {"POST", "PATCH", "PUT"} and key not in BODY_MAP and key not in NO_BODY and key not in SPECIAL_SECURITY:
            raise ValueError(f"Missing explicit request DTO or no-body declaration: {key}")
        if key in BODY_MAP and BODY_MAP[key] not in F: raise ValueError(f"Unknown input DTO: {key}")
        resource = resource_for(path); rule = policy_for(op); policy_id = op["operationId"]
        req_ids = requirement_ids(op, all_ids); summary, description = summary_description(op, resource)
        kind = public_kind(key); security = [] if kind == "public" else [{} , {"cookieAuth": []}] if kind == "optional_session" else [{SPECIAL_SECURITY[key]: []}] if key in SPECIAL_SECURITY else [{"cookieAuth": []}]
        is_list = method == "GET" and short_path(path) in LIST_PATHS
        response_name = op["operationId"] + "Response"
        if is_list:
            response_schema = obj({"data": arr(ref(resource)), "page": ref("PageInfo"), "requestId": SHORT}, ["data", "page", "requestId"])
        else:
            response_schema = obj({"data": ref(resource), "requestId": SHORT}, ["data", "requestId"])
        components[response_name] = response_schema
        response_code = "201" if method == "POST" and (key in BODY_MAP and not any(path.endswith("/"+a) for a in ["approve", "review", "release", "withdraw", "revoke", "extend", "cancel", "submit", "reconcile", "check", "complete", "read", "resolve", "disclosure-assessment"])) else "202" if key.startswith("POST /api/v1/payments/webhooks") or key.startswith("POST /api/v1/research/events") else "200"
        success = {"description": f"{resource} result; only authorized data is returned.", "content": {"application/json": {"schema": ref(response_name), "example": example(response_schema, components)}}}
        errors = {}
        for code, title in [(400,"Invalid request"),(401,"Authentication required"),(403,"Access denied"),(404,"Not found"),(409,"State conflict"),(412,"Precondition failed"),(422,"Business rule violation"),(429,"Rate limit exceeded"),(500,"Unexpected server error")]:
            errors[str(code)] = {"description": title, "content": {"application/problem+json": {"schema": ref("Problem"), "example": {"type": f"https://api.arata.example/problems/{code}", "title": title, "status": code, "code": "REQUEST_ERROR", "requestId": "sample"}}}}
        operation = {"operationId": op["operationId"], "tags": [op["tag"]], "summary": summary,
            "description": description, "security": security, "parameters": parameters(op, resource),
            "responses": {response_code: success, **errors},
            "x-requirement-ids": req_ids, "x-policy-id": policy_id,
            "x-authorized-roles": rule["rolesAny"],
            "x-entitlement-condition": rule["entitlement"],
            "x-rate-limit": {"bucket": "auth" if path.startswith("/api/v1/auth/") else "webhook" if kind == "webhook" else "read" if method == "GET" else "write", "limit": 10 if path.startswith("/api/v1/auth/") else 60 if method == "GET" else 30, "windowSeconds": 60, "key": "subject-or-source-ip"},
            "x-idempotency": {"required": method in {"POST", "PUT", "PATCH"} and key not in {"POST /api/v1/auth/login", "POST /api/v1/auth/register", "POST /api/v1/auth/password/reset-request", "POST /api/v1/auth/password/reset", "POST /api/v1/auth/verify-email", "POST /api/v1/auth/mfa/challenge", "POST /api/v1/auth/mfa/verify"}, "scope": "actor+operation+key", "retention": "configured per domain"},
            "x-audit-event": "none" if method == "GET" and kind == "public" else ("security." if path.startswith("/api/v1/auth/") else "api.") + op["operationId"],
            "x-audit-fields": [] if method == "GET" and kind == "public" else ["actorId", "operationId", "resourceType", "resourceId", "outcome", "requestId", "occurredAt"] + (["reason", "stepUpEvidenceId", "approvalReference"] if rule["mfa"] else []) + (["providerEventId", "signatureVersion"] if kind == "webhook" else []),
            "x-acceptance-tests": ["T-"+r for r in req_ids],
            "x-acceptance-scenarios": ["valid DTO and authorized state returns the declared success schema", "unknown fields or malformed values return a problem response", "missing required security or policy evidence is denied without data disclosure"] + (["expired or unmatched entitlement is denied"] if rule["entitlement"] != "none" else []) + (["independent approver and recent MFA are required"] if rule["distinctApprover"] else []),
            "x-csrf-protection": kind in {"session", "optional_session"} and method != "GET",
        }
        if key in BODY_MAP:
            input_name = BODY_MAP[key] + "Input"
            input_def = components[input_name]
            operation["requestBody"] = {"required": True, "description": f"Validated {input_name} DTO. Unknown fields are rejected.", "content": {"application/json": {"schema": ref(input_name), "example": example(input_def, components)}}}
        if kind == "webhook":
            operation["requestBody"] = {"required": True, "description": "Raw provider payload. Verify the active provider's exact signature scheme over the unmodified bytes before parsing or state changes.", "content": {"application/octet-stream": {"schema": {"type": "string", "format": "binary"}}}}
            operation["x-idempotency"]["required"] = True
            operation["x-idempotency"]["scope"] = "provider+verified-event-id"
        if operation["x-idempotency"]["required"] and kind != "webhook":
            operation["parameters"].append({"name": "Idempotency-Key", "in": "header", "required": True, "description": "Opaque 8–128 character key. Same actor, operation, key and body returns the original result; changed body is 409.", "schema": string(min_length=8, max_length=128)})
        if operation["x-csrf-protection"]:
            operation["parameters"].append({"name": "X-CSRF-Token", "in": "header", "required": True, "description": "Bound to the authenticated cookie session.", "schema": string(min_length=16, max_length=256)})
        if rule["mfa"]:
            operation["parameters"].append({"name": "X-Step-Up-Token", "in": "header", "required": True, "description": "Recent MFA proof bound to this action and actor.", "schema": string(min_length=16, max_length=512)})
        if rule.get("purposeRequired"):
            operation["parameters"].append({"name": "X-Research-Purpose", "in": "header", "required": True, "description": "Approved study or operational purpose code, checked against actor and requested dataset.", "schema": SHORT})
        paths.setdefault(path, {})[method.lower()] = operation
        policies[policy_id] = rule
        screens = sorted({s.strip() for row in requirement_rows if row["requirement_id"] in req_ids for s in row["wireframe_ids"].split(";") if s.strip()})
        trace.append({"method": method, "path": path, "operation_id": policy_id,
            "requirement_ids": ";".join(req_ids), "screen_ids": ";".join(screens),
            "request_dto": BODY_MAP.get(key, "None") + ("Input" if key in BODY_MAP else ""),
            "response_dto": response_name, "policy_id": policy_id,
            "acceptance_tests": ";".join(operation["x-acceptance-tests"])})
    spec = {"openapi": "3.1.0", "info": {"title": "Arata TechLibrary API", "version": "1.0.0", "description": "Versioned design contract. Service implementation and stakeholder approval remain pending."},
        "servers": [{"url": "https://api.example.invalid", "description": "Example only; configure deployment URL."}],
        "tags": [{"name": t, "description": t.replace("_", " ").capitalize()} for t in sorted({op["tag"] for op in inventory})],
        "paths": paths, "components": {"securitySchemes": {"cookieAuth": {"type": "apiKey", "in": "cookie", "name": "atl_session", "description": "HttpOnly, Secure, SameSite session cookie."},
            "webhookSignature": {"type": "apiKey", "in": "header", "name": "X-Provider-Signature", "description": "Provider-specific verified signature; configured adapter enforces timestamp and replay window."},
            "serviceToken": {"type": "http", "scheme": "bearer", "bearerFormat": "opaque-service-token"}},
            "schemas": components}}
    apply_billing_runtime(spec, policies, trace, requirement_rows)
    apply_entitlement_runtime(spec, policies, trace, requirement_rows)
    apply_institution_runtime(spec, policies, trace, requirement_rows)
    (API / "openapi.v1.yaml").write_text(yaml.safe_dump(spec, sort_keys=False, allow_unicode=True, width=120), encoding="utf-8")
    (API / "policies.v1.yaml").write_text(yaml.safe_dump({"version": 1, "defaultEffect": "deny", "evaluationOrder": ["authentication", "rolesAny", "ownership", "institutionBoundary", "entitlement", "contentPermission", "mfa", "reasonRequired", "distinctApprover"], "policies": policies}, sort_keys=False, allow_unicode=True, width=120), encoding="utf-8")
    with (API / "ENDPOINT_TRACEABILITY.csv").open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(trace[0]), lineterminator="\n"); writer.writeheader(); writer.writerows(trace)
    policy_rows = []
    for row in trace:
        rule = policies[row["policy_id"]]
        policy_rows.append({"method": row["method"], "path": row["path"], "policy_id": row["policy_id"],
            "authentication": rule["authentication"], "roles_any": ";".join(rule["rolesAny"]),
            "ownership": rule["ownership"], "institution_boundary": rule["institutionBoundary"],
            "entitlement": rule["entitlement"], "content_permission": rule["contentPermission"],
            "step_up_mfa": rule["mfa"], "reason_required": rule["reasonRequired"],
            "distinct_approver": rule["distinctApprover"], "purpose_required": rule.get("purposeRequired", False),
            "sensitive_export_approval": rule.get("sensitiveExportApproval", False),
            "export_kind_roles": json.dumps(rule.get("exportKindRoles", {}), sort_keys=True),
            "default_effect": "deny"})
    with (API / "POLICY_MATRIX.csv").open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(policy_rows[0]), lineterminator="\n"); writer.writeheader(); writer.writerows(policy_rows)
    print(f"Generated {sum(len(item) for item in paths.values())} operations, {len(components)} schemas, {len(policies)} policies")


if __name__ == "__main__": build()
