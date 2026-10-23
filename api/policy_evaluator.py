"""Reference evaluator for policy contract tests, not an application auth service.

Real API modules must supply trusted, server-derived context. No client header may
be used as an authority source outside the test-only stub.
"""
from __future__ import annotations


def evaluate(rule: dict, context: dict) -> tuple[bool, str]:
    """Return a deny-by-default decision and stable reason code."""
    if rule.get("effect") != "allow": return False, "DENY_DEFAULT"
    authentication = rule["authentication"]
    if authentication == "session" and not context.get("authenticated"): return False, "AUTH_REQUIRED"
    if authentication == "webhook" and not context.get("webhook_verified"): return False, "WEBHOOK_UNVERIFIED"
    if authentication == "service" and not context.get("service_verified"): return False, "SERVICE_UNVERIFIED"
    if authentication == "optional_session" and not (context.get("authenticated") or context.get("public_free")):
        return False, "AUTH_OR_PUBLIC_FREE_REQUIRED"
    roles = rule.get("rolesAny", [])
    if roles and not set(roles).intersection(context.get("roles", [])): return False, "ROLE_DENIED"
    export_roles = rule.get("exportKindRoles")
    if export_roles:
        kind = context.get("export_kind")
        if kind not in export_roles or not set(export_roles[kind]).intersection(context.get("roles", [])):
            return False, "EXPORT_SCOPE_DENIED"
    ownership = rule.get("ownership", "none")
    if ownership != "none" and not context.get("owns_resource"): return False, "OWNERSHIP_DENIED"
    boundary = rule.get("institutionBoundary", "none")
    if boundary == "verified_membership_or_scoped_admin" and not context.get("institution_scope_valid"):
        return False, "INSTITUTION_DENIED"
    if boundary == "research_isolation" and not context.get("research_scope_valid"):
        return False, "RESEARCH_ISOLATION_DENIED"
    if rule.get("entitlement") == "active_scope_or_free" and not (context.get("active_entitlement") or context.get("public_free") or context.get("registered_free")):
        return False, "ENTITLEMENT_EXPIRED_OR_MISSING"
    permission = rule.get("contentPermission", "none")
    if permission in {"read", "copy", "print", "download", "offline"} and permission not in context.get("content_permissions", []):
        return False, "CONTENT_PERMISSION_DENIED"
    if permission == "research_consent" and not context.get("research_consent"):
        return False, "CONSENT_REQUIRED"
    if permission == "ai_consent_and_read" and not (context.get("ai_consent") and "read" in context.get("content_permissions", [])):
        return False, "AI_CONSENT_OR_READ_DENIED"
    if permission == "verified_paid_purchase" and not context.get("paid_purchase_verified"):
        return False, "PURCHASE_UNVERIFIED"
    if permission == "draft_only_mutation" and not context.get("revision_draft"):
        return False, "PUBLISHED_REVISION_IMMUTABLE"
    if permission == "approved_disclosure_snapshot" and not context.get("disclosure_approved"):
        return False, "DISCLOSURE_NOT_APPROVED"
    if permission == "released_aggregate_only" and not context.get("released_aggregate"):
        return False, "INSIGHT_NOT_RELEASED"
    if permission == "public_metadata_only" and not context.get("public_metadata"):
        return False, "METADATA_NOT_PUBLIC"
    if rule.get("mfa") and not context.get("step_up_valid"): return False, "STEP_UP_REQUIRED"
    if rule.get("reasonRequired") and not context.get("reason_present"): return False, "REASON_REQUIRED"
    if rule.get("purposeRequired") and not context.get("approved_purpose"):
        return False, "PURPOSE_REQUIRED"
    if rule.get("sensitiveExportApproval") and context.get("export_kind") in {"users", "audit", "institution_memberships"} and not context.get("sensitive_export_approved"):
        return False, "SENSITIVE_EXPORT_APPROVAL_REQUIRED"
    if rule.get("distinctApprover") and not context.get("distinct_approver"):
        return False, "DUAL_CONTROL_REQUIRED"
    return True, "ALLOW"
