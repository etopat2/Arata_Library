"""Explicit OpenAPI 3.1 contracts for the implemented entitlement routes."""
from copy import deepcopy
from billing_runtime import ref, obj, arr, nullable, sample, UUID, TEXT, TIME, INT

SCOPE = {"type": "string", "enum": ["LIBRARY", "COLLECTION", "PUBLICATION", "VOLUME", "EDITION"]}
REASON = {"type": "string", "minLength": 10, "maxLength": 1000}
STATUS = {"type": "string", "enum": ["PENDING", "ACTIVE", "SUSPENDED", "REVOKED"]}
SOURCE = {"type": "string", "enum": ["PAID", "TRIAL", "INSTITUTION", "COMPLIMENTARY", "SPONSORED", "PROMOTION"]}
SCHEMAS = {
    "EntitlementMine": obj({"id": UUID, "source": SOURCE, "status": STATUS, "scope": SCOPE,
        "collectionId": nullable(UUID), "publicationId": nullable(UUID), "volumeId": nullable(UUID),
        "editionId": nullable(UUID), "resourceId": nullable(UUID), "startsAt": TIME,
        "endsAt": nullable(TIME), "revokedAt": nullable(TIME), "createdAt": TIME,
        "effectiveStatus": TEXT}),
    "EntitlementUser": obj({"id": UUID, "email": TEXT, "status": TEXT,
        "emailVerifiedAt": nullable(TIME), "activeGrants": INT}),
    "EntitlementAdminRecord": obj({"id": UUID, "userId": UUID, "source": SOURCE,
        "status": STATUS, "scope": SCOPE, "collectionId": nullable(UUID),
        "publicationId": nullable(UUID), "volumeId": nullable(UUID), "editionId": nullable(UUID),
        "resourceId": nullable(UUID), "grantedById": nullable(UUID), "startsAt": TIME,
        "endsAt": nullable(TIME), "revokedAt": nullable(TIME), "reason": nullable(TEXT),
        "createdAt": TIME, "approvalStatus": nullable(TEXT)}),
    "EntitlementExpiring": obj({"id": UUID, "userId": UUID, "source": SOURCE,
        "scope": SCOPE, "endsAt": TIME}),
    "EntitlementHistoryGrant": obj({"id": UUID, "userId": UUID, "source": SOURCE,
        "status": STATUS, "scope": SCOPE, "startsAt": TIME, "endsAt": nullable(TIME),
        "reason": nullable(TEXT)}),
    "EntitlementHistoryEvent": obj({"id": UUID, "action": TEXT, "reason": nullable(TEXT),
        "actorId": nullable(UUID), "occurredAt": TIME}),
    "EntitlementHistory": obj({"grant": ref("EntitlementHistoryGrant"),
        "events": arr(ref("EntitlementHistoryEvent"))}),
    "EntitlementGrantRequested": obj({"id": UUID, "status": STATUS, "startsAt": TIME,
        "endsAt": nullable(TIME)}),
    "EntitlementState": obj({"id": UUID, "status": STATUS}),
    "EntitlementTrial": obj({"id": UUID, "startsAt": TIME, "endsAt": TIME, "status": STATUS}),
    "EntitlementRedeemed": obj({"id": UUID, "status": STATUS, "endsAt": TIME}),
    "EntitlementCampaign": obj({"id": UUID, "kind": TEXT, "status": TEXT, "name": TEXT,
        "scope": SCOPE, "collectionId": nullable(UUID), "publicationId": nullable(UUID),
        "volumeId": nullable(UUID), "editionId": nullable(UUID), "startsAt": TIME,
        "endsAt": TIME, "maxClaims": INT, "createdAt": TIME, "claimCount": INT}),
    "EntitlementCampaignRequested": obj({"id": UUID, "status": TEXT, "kind": TEXT,
        "code": nullable(TEXT)}),
    "EntitlementCampaignApproved": obj({"id": UUID, "status": TEXT, "issued": {"type": "boolean"}}),
    "InstitutionAgreement": obj({"id": UUID, "institutionId": UUID, "status": TEXT,
        "scope": SCOPE, "publicationId": nullable(UUID), "volumeId": nullable(UUID),
        "memberLimit": INT, "permittedCategories": arr(TEXT), "startsAt": TIME,
        "endsAt": TIME, "createdById": nullable(UUID), "approvedById": nullable(UUID),
        "approvedAt": nullable(TIME), "reportingEnabled": {"type": "boolean"}}),
    "InstitutionAgreementState": obj({"id": UUID, "status": TEXT}),
    "EntitlementMaintenance": obj({"notified": INT}),
    "EntitlementGrantInput": obj({"userId": UUID, "reason": REASON, "scope": SCOPE,
        "scopeId": UUID, "startsAt": TIME, "durationDays": {"type": "integer", "minimum": 1, "maximum": 3650},
        "endsAt": TIME, "permanent": {"type": "boolean"},
        "source": {"type": "string", "enum": ["COMPLIMENTARY", "INSTITUTION", "SPONSORED"]},
        "membershipId": UUID, "cohortId": UUID}, ["userId", "reason", "scope"]),
    "EntitlementReasonInput": obj({"reason": REASON}),
    "EntitlementExtensionInput": obj({"durationDays": {"type": "integer", "minimum": 1, "maximum": 3650},
        "reason": REASON}),
    "EntitlementRedemptionInput": obj({"code": {"type": "string", "minLength": 40,
        "maxLength": 80, "pattern": "^[a-zA-Z0-9_-]+$"}}),
    "EntitlementCampaignInput": obj({"kind": {"type": "string", "enum": ["BULK", "PROMOTION"]},
        "name": {"type": "string", "minLength": 3, "maxLength": 160}, "reason": REASON,
        "scope": SCOPE, "scopeId": UUID, "startsAt": TIME, "endsAt": TIME,
        "maxClaims": {"type": "integer", "minimum": 1, "maximum": 1000},
        "userIds": arr(UUID)}, ["kind", "name", "reason", "scope", "startsAt", "endsAt", "maxClaims"]),
    "InstitutionAgreementInput": obj({"institutionId": UUID, "reason": REASON, "scope": {"type": "string",
        "enum": ["LIBRARY", "PUBLICATION", "VOLUME"]}, "scopeId": UUID,
        "memberLimit": {"type": "integer", "minimum": 1, "maximum": 100000},
        "permittedCategories": arr({"type": "string", "enum": ["STUDENT", "ACADEMIC_STAFF",
            "ORGANIZATION_MEMBER", "SCHOLARSHIP", "SPONSORED_COHORT"]}),
        "startsAt": TIME, "endsAt": TIME, "reportingEnabled": {"type": "boolean"}}, ["institutionId", "reason", "scope", "memberLimit",
            "permittedCategories", "startsAt", "endsAt"]),
}

# method, path, response DTO, request DTO, SRS anchors, operation summary
ROUTES = [
    ("GET", "/me/entitlements", "EntitlementMine", None, "FR-ENT-001 FR-ENT-002 FR-ENT-004", "List all own access sources and their current states."),
    ("POST", "/me/trials", "EntitlementTrial", None, "FR-ENT-002 FR-PAY-011", "Start one eligible verified-account trial."),
    ("POST", "/me/promotion-redemptions", "EntitlementRedeemed", "EntitlementRedemptionInput", "FR-ENT-002 FR-ENT-017", "Redeem one approved free promotional code."),
    ("GET", "/admin/entitlement-users", "EntitlementUser", None, "FR-ENT-006 FR-ENT-007", "Search active account recipients by email."),
    ("GET", "/admin/entitlements", "EntitlementAdminRecord", None, "FR-ENT-003 FR-ENT-006", "List scoped grants and approval state."),
    ("GET", "/admin/entitlements/upcoming", "EntitlementExpiring", None, "FR-ENT-006", "List active grants nearing expiry."),
    ("GET", "/admin/entitlements/{id}/history", "EntitlementHistory", None, "FR-ENT-003 FR-ENT-006", "Read immutable events for one grant."),
    ("POST", "/admin/entitlements", "EntitlementGrantRequested", "EntitlementGrantInput", "FR-ENT-003 FR-ENT-005 FR-ENT-006", "Request a scoped access grant for independent review."),
    ("POST", "/admin/entitlements/{id}/approve", "EntitlementState", "EntitlementReasonInput", "FR-ENT-003 FR-ENT-006", "Independently approve a pending grant."),
    ("POST", "/admin/entitlements/{id}/extend", "EntitlementGrantRequested", "EntitlementExtensionInput", "FR-ENT-005 FR-ENT-006", "Request a new grant extending an existing fixed term."),
    ("POST", "/admin/entitlements/{id}/suspend", "EntitlementState", "EntitlementReasonInput", "FR-ENT-006 FR-ENT-009", "Suspend one manually issued grant."),
    ("POST", "/admin/entitlements/{id}/resume", "EntitlementState", "EntitlementReasonInput", "FR-ENT-006 FR-ENT-009", "Resume an eligible suspended grant."),
    ("POST", "/admin/entitlements/{id}/revoke", "EntitlementState", "EntitlementReasonInput", "FR-ENT-006 FR-ENT-009", "Revoke one manually issued grant."),
    ("GET", "/admin/grant-campaigns", "EntitlementCampaign", None, "FR-ENT-006 FR-ENT-017", "List bulk and promotional campaigns."),
    ("POST", "/admin/grant-campaigns", "EntitlementCampaignRequested", "EntitlementCampaignInput", "FR-ENT-006 FR-ENT-017", "Create a reviewed bulk or free promotion campaign."),
    ("POST", "/admin/grant-campaigns/{id}/approve", "EntitlementCampaignApproved", "EntitlementReasonInput", "FR-ENT-006 FR-ENT-017", "Independently approve and issue a campaign."),
    ("POST", "/admin/entitlements/maintenance", "EntitlementMaintenance", None, "FR-ENT-006 FR-OPS-001", "Send bounded expiry notices and purge expired decision logs."),
    ("GET", "/admin/institution-agreements", "InstitutionAgreement", None, "FR-INS-007 FR-INS-008", "List proposed and approved institution benefit agreements."),
    ("POST", "/admin/institution-agreements", "InstitutionAgreementState", "InstitutionAgreementInput", "FR-INS-007 FR-INS-008", "Request a scoped institution benefit agreement."),
    ("POST", "/admin/institution-agreements/{id}/approve", "InstitutionAgreementState", "EntitlementReasonInput", "FR-INS-007 FR-INS-008", "Independently approve an institution benefit agreement."),
]
LIST_PATHS = {"/me/entitlements", "/admin/entitlement-users", "/admin/entitlements",
    "/admin/entitlements/upcoming", "/admin/grant-campaigns", "/admin/institution-agreements"}
PERMISSIONS = {"/admin/entitlements": "ENTITLEMENT_GRANT", "/admin/grant-campaigns": "ENTITLEMENT_GRANT",
    "/admin/institution-agreements": "ENTITLEMENT_INSTITUTION"}


def apply_entitlement_runtime(spec, policies, trace, requirement_rows):
    components = spec["components"]["schemas"]
    components.update(SCHEMAS)
    paths = spec["paths"]
    errors = {key: deepcopy(value) for key, value in paths["/api/v1/orders"]["post"]["responses"].items()
              if key.startswith(("4", "5"))}
    known_ids = {row["requirement_id"] for row in requirement_rows}
    for method, suffix, output_name, input_name, anchors, description in ROUTES:
        path = "/api/v1" + suffix
        existing = paths.get(path, {}).get(method.lower())
        operation_id = (existing or {}).get("operationId") or method.lower() + "_" + suffix.strip("/").replace("/", "_").replace("{", "").replace("}", "").replace("-", "_")
        ids = sorted(set(anchors.split()) | set((existing or {}).get("x-requirement-ids", [])))
        if set(ids) - known_ids: raise ValueError(f"Unknown entitlement SRS anchor: {path}")
        admin = suffix.startswith("/admin/")
        list_response = method == "GET" and suffix in LIST_PATHS
        response_name = operation_id + "Response"
        components[response_name] = obj({"data": arr(ref(output_name)) if list_response else ref(output_name), "requestId": TEXT})
        parameters = []
        if "{id}" in suffix:
            parameters.append({"name": "id", "in": "path", "required": True, "schema": UUID})
        for name, schema in {"q": {"type": "string", "minLength": 3, "maxLength": 120},
                             "userId": UUID, "institutionId": UUID,
                             "limit": {"type": "integer", "minimum": 1, "maximum": 200, "default": 100},
                             "days": {"type": "integer", "minimum": 1, "maximum": 90, "default": 7}}.items():
            if (suffix == "/admin/entitlement-users" and name == "q") or (
                suffix == "/admin/entitlements" and name in {"userId", "limit"}) or (
                suffix == "/admin/entitlements/upcoming" and name == "days") or (
                suffix == "/admin/institution-agreements" and name == "institutionId"):
                parameters.append({"name": name, "in": "query", "required": name == "q", "schema": schema})
        if method == "POST":
            parameters.append({"name": "X-CSRF-Token", "in": "header", "required": True,
                               "schema": {"type": "string", "minLength": 16}})
        output = {"description": description, "content": {"application/json": {
            "schema": ref(response_name), "example": sample(components[response_name], components)}}}
        permission = "ENTITLEMENT_READ" if method == "GET" else PERMISSIONS.get(suffix, "ENTITLEMENT_APPROVE" if suffix.endswith("/approve") or suffix.endswith("/maintenance") else "ENTITLEMENT_REVOKE" if suffix.endswith(("/suspend", "/resume", "/revoke")) else "ENTITLEMENT_GRANT")
        if suffix.startswith("/admin/institution-agreements") and method == "POST" and not suffix.endswith("/approve"):
            permission = "ENTITLEMENT_INSTITUTION"
        operation = {"operationId": operation_id, "tags": ["entitlements"], "summary": description,
            "description": description + " Server checks active policy, scope, ownership and current source state at request time.",
            "security": [{"cookieAuth": []}], "parameters": parameters,
            "responses": {"200": output, **errors}, "x-requirement-ids": ids,
            "x-implemented-requirement-ids": anchors.split(),
            "x-policy-id": operation_id, "x-authorized-roles": ["SYSTEM_ADMIN"] if admin else [],
            "x-required-permission": permission if admin else "authenticated-account",
            "x-entitlement-condition": "none", "x-rate-limit": {"bucket": "identity-auth:permission" if admin and method == "POST" else "identity-auth" if method == "POST" else "none", "limit": 8 if method == "POST" else 0, "windowSeconds": None, "policySetting": "security.loginWindowMinutes" if method == "POST" else "none", "key": "hashed-admin-account" if admin and method == "POST" else "hashed-subject-and-source-ip" if method == "POST" else "none"},
            "x-idempotency": {"required": False, "scope": "single-use trial, claim or locked state transition"},
            "x-audit-event": "entitlement." + operation_id if method == "POST" else "none",
            "x-audit-fields": ["actorId", "resourceId", "requestId", "occurredAt"] if method == "POST" else [],
            "x-acceptance-tests": ["T-" + item for item in ids],
            "x-acceptance-scenarios": ["authorized request returns declared DTO", "invalid scope or state is denied", "independent approval and current source evidence are enforced where applicable"],
            "x-csrf-protection": method == "POST", "x-mfa-evidence": "verified-session" if admin else "none",
            "x-no-request-body": method == "POST" and input_name is None}
        if input_name:
            example = sample(components[input_name], components)
            if input_name == "EntitlementRedemptionInput": example["code"] = "A" * 43
            operation["requestBody"] = {"required": True, "content": {"application/json": {
                "schema": ref(input_name), "example": example}}}
        paths.setdefault(path, {})[method.lower()] = operation
        policies[operation_id] = {"effect": "allow", "authentication": "session",
            "rolesAny": ["SYSTEM_ADMIN"] if admin else [],
            "permission": permission if admin else "authenticated-account",
            "ownership": "subject_user" if suffix.startswith("/me/") else "none",
            "institutionBoundary": "verified-agreement-and-membership" if "institution" in suffix else "none",
            "entitlement": "none", "contentPermission": "none", "mfa": admin,
            "reasonRequired": method == "POST" and input_name in {"EntitlementReasonInput", "EntitlementGrantInput", "EntitlementExtensionInput", "EntitlementCampaignInput"},
            "distinctApprover": suffix.endswith("/approve"), "purposeRequired": False,
            "note": "Deny by default; server verifies scope, current policy and source evidence."}
        screens = sorted({screen.strip() for row in requirement_rows if row["requirement_id"] in ids
                          for screen in row["wireframe_ids"].split(";") if screen.strip()})
        entry = {"method": method, "path": path, "operation_id": operation_id,
            "requirement_ids": ";".join(ids), "screen_ids": ";".join(screens),
            "request_dto": input_name or "None", "response_dto": response_name,
            "policy_id": operation_id, "acceptance_tests": ";".join("T-" + item for item in ids)}
        for index, row in enumerate(trace):
            if row["method"] == method and row["path"] == path:
                trace[index] = entry
                break
        else: trace.append(entry)
