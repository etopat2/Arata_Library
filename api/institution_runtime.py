"""Reviewed OpenAPI contracts for the implemented institutional HTTP surface."""
from copy import deepcopy
from billing_runtime import ref, obj, arr, nullable, sample, UUID, TEXT, TIME, INT, BOOL

REASON = {"type": "string", "minLength": 10, "maxLength": 1000}
CATEGORY = {"type": "string", "enum": ["STUDENT", "ACADEMIC_STAFF", "ORGANIZATION_MEMBER", "SCHOLARSHIP", "SPONSORED_COHORT"]}
SCOPE = {"type": "string", "enum": ["LIBRARY", "PUBLICATION", "VOLUME"]}
MODE = {"type": "string", "enum": ["MANUAL", "ROSTER", "DOMAIN_ONLY", "SSO"]}
URL = {"type": "string", "format": "uri"}
SCHEMAS = {
    "InstitutionRecord": obj({"id": UUID, "legalName": TEXT, "kind": TEXT, "registrationRef": TEXT,
        "status": TEXT, "verificationMode": TEXT, "approvedAt": nullable(TIME), "createdAt": TIME}),
    "InstitutionState": obj({"id": UUID, "status": TEXT}),
    "InstitutionManagerAssignment": obj({"id": UUID, "institutionId": UUID, "userId": UUID}),
    "InstitutionManagerRevocation": obj({"revoked": BOOL}),
    "InstitutionDomainRecord": obj({"id": UUID, "domain": TEXT, "verifiedAt": nullable(TIME),
        "approvedAt": nullable(TIME), "suspendedAt": nullable(TIME), "reviewDueAt": nullable(TIME), "createdAt": TIME}),
    "InstitutionDomainChallenge": obj({"challengeId": UUID, "dnsName": TEXT,
        "dnsValue": TEXT, "expiresInHours": INT}),
    "InstitutionDomainRequested": obj({"id": UUID, "domain": TEXT, "challengeId": UUID,
        "dnsName": TEXT, "dnsValue": TEXT, "expiresInHours": INT}),
    "InstitutionDomainVerified": obj({"id": UUID, "verified": BOOL}),
    "InstitutionDomainApproved": obj({"id": UUID, "approved": BOOL}),
    "InstitutionDomainSuspended": obj({"id": UUID, "suspended": BOOL}),
    "InstitutionPolicyRecord": obj({"id": UUID, "category": CATEGORY, "scope": SCOPE,
        "scopeId": nullable(UUID), "verificationMode": MODE, "validityDays": INT,
        "active": BOOL, "approvalStatus": TEXT, "approvedAt": nullable(TIME)}),
    "InstitutionPolicyState": obj({"id": UUID, "status": TEXT}),
    "InstitutionPolicySuspended": obj({"id": UUID, "suspended": BOOL}),
    "InstitutionOwnMembership": obj({"id": UUID, "institutionId": UUID, "legalName": TEXT,
        "category": CATEGORY, "status": TEXT, "verificationMethod": MODE,
        "verifiedAt": nullable(TIME), "expiresAt": nullable(TIME),
        "optedOutAt": nullable(TIME), "effectiveStatus": TEXT}),
    "InstitutionEligible": obj({"id": UUID, "legalName": TEXT, "kind": TEXT}),
    "InstitutionMembershipRecord": obj({"id": UUID, "userId": UUID, "email": TEXT,
        "category": CATEGORY, "status": TEXT, "verificationMethod": MODE,
        "verifiedAt": nullable(TIME), "expiresAt": nullable(TIME), "createdAt": TIME}),
    "InstitutionMembershipState": obj({"id": UUID, "status": TEXT, "expiresAt": TIME}, ["id", "status"]),
    "InstitutionRosterError": obj({"row": INT, "code": TEXT}),
    "InstitutionRosterResult": obj({"id": UUID, "status": TEXT, "rowCount": INT,
        "acceptedCount": INT, "rejectedCount": INT, "errors": arr(ref("InstitutionRosterError"))},
        ["status", "rowCount", "acceptedCount", "rejectedCount", "errors"]),
    "InstitutionCohort": obj({"id": UUID, "name": TEXT, "active": BOOL,
        "createdAt": TIME, "memberCount": INT}, ["id", "name", "active"]),
    "InstitutionCohortMember": obj({"cohortId": UUID, "userId": UUID, "active": BOOL}),
    "InstitutionCohortState": obj({"id": UUID, "active": BOOL}),
    "InstitutionSsoRecord": obj({"id": UUID, "issuerUrl": URL, "clientId": TEXT,
        "status": TEXT, "approvedAt": nullable(TIME), "createdAt": TIME}),
    "InstitutionSsoState": obj({"id": UUID, "status": TEXT, "authenticationEnabled": BOOL}),
    "InstitutionEngagement": obj({"uniqueReaders30d": INT, "periodDays": INT}),
    "InstitutionDashboard": obj({"id": UUID, "legalName": TEXT, "status": TEXT,
        "activeMembers": INT, "pendingMembers": INT, "activeCohorts": INT,
        "engagement": nullable(ref("InstitutionEngagement")), "engagementReason": nullable(TEXT)}),
    "InstitutionRegistrationInput": obj({"legalName": {"type":"string","minLength":3,"maxLength":400},
        "kind":{"type":"string","enum":["EDUCATIONAL","ORGANIZATION"]},
        "registrationRef":{"type":"string","minLength":3,"maxLength":160},
        "evidenceRef":{"type":"string","minLength":8,"maxLength":500}}),
    "InstitutionReasonInput": obj({"reason": REASON}),
    "InstitutionManagerInput": obj({"userId": UUID}),
    "InstitutionDomainInput": obj({"domain":{"type":"string","minLength":4,"maxLength":253}}),
    "InstitutionProofInput": obj({"token":{"type":"string","pattern":"^[A-Za-z0-9_-]{40,60}$"}}),
    "InstitutionPolicyInput": obj({"category":CATEGORY,"scope":SCOPE,"scopeId":UUID,
        "verificationMode":MODE,"validityDays":{"type":"integer","minimum":1,"maximum":3650}},
        ["category","scope","verificationMode","validityDays"]),
    "InstitutionEnrollmentInput": obj({"institutionId":UUID,"category":CATEGORY,
        "evidenceRef":{"type":"string","minLength":8,"maxLength":160}},
        ["institutionId","category"]),
    "InstitutionReviewInput": obj({"decision":{"type":"string","enum":["APPROVED","REJECTED","SUSPENDED"]},
        "reason":REASON,"evidenceRef":{"type":"string","minLength":8,"maxLength":160}},
        ["decision","reason"]),
    "InstitutionRosterInput": obj({"csv":{"type":"string","minLength":1,"maxLength":1000000},
        "apply":BOOL},["csv"]),
    "InstitutionCohortInput": obj({"name":{"type":"string","minLength":3,"maxLength":200}}),
    "InstitutionCohortMemberInput": obj({"userId":UUID,"join":BOOL}),
    "InstitutionSsoInput": obj({"issuerUrl":URL,"clientId":{"type":"string","minLength":3,"maxLength":300}}),
}

# method, path suffix, response schema, request schema, SRS anchors, required permission
ROUTES = [
 ("GET","/institutional/memberships","InstitutionOwnMembership",None,"FR-INS-004 FR-INS-005 FR-INS-010",None),
 ("GET","/institutional/eligible-institutions","InstitutionEligible",None,"FR-INS-002 FR-INS-003",None),
 ("POST","/institutional/memberships","InstitutionMembershipState","InstitutionEnrollmentInput","FR-INS-003 FR-INS-004 FR-INS-005",None),
 ("POST","/institutional/memberships/{id}/opt-out","InstitutionMembershipState",None,"FR-INS-010 BR-017",None),
 ("GET","/admin/institutions","InstitutionRecord",None,"FR-INS-001 FR-INS-008","INSTITUTION_READ"),
 ("POST","/admin/institutions","InstitutionState","InstitutionRegistrationInput","FR-INS-001 FR-INS-008","INSTITUTION_APPROVE"),
 ("POST","/admin/institutions/{id}/approve","InstitutionState","InstitutionReasonInput","FR-INS-001 FR-INS-008","INSTITUTION_APPROVE"),
 ("POST","/admin/institutions/{id}/reject","InstitutionState","InstitutionReasonInput","FR-INS-001 FR-INS-008","INSTITUTION_APPROVE"),
 ("POST","/admin/institutions/{id}/suspend","InstitutionState","InstitutionReasonInput","FR-INS-008 FR-INS-010","INSTITUTION_APPROVE"),
 ("POST","/admin/institutions/{id}/managers","InstitutionManagerAssignment","InstitutionManagerInput","FR-INS-009","INSTITUTION_APPROVE"),
 ("POST","/admin/institutions/{id}/managers/{userId}/revoke","InstitutionManagerRevocation","InstitutionReasonInput","FR-INS-009","INSTITUTION_APPROVE"),
 ("GET","/admin/institutions/{id}/dashboard","InstitutionDashboard",None,"FR-INS-013 BR-017","INSTITUTION_READ"),
 ("GET","/admin/institutions/{id}/domains","InstitutionDomainRecord",None,"FR-INS-002","INSTITUTION_READ"),
 ("POST","/admin/institutions/{id}/domains","InstitutionDomainRequested","InstitutionDomainInput","FR-INS-002","INSTITUTION_ROSTER"),
 ("POST","/admin/institutions/{id}/domains/{domainId}/challenge","InstitutionDomainChallenge",None,"FR-INS-002","INSTITUTION_ROSTER"),
 ("POST","/admin/institutions/{id}/domains/{domainId}/verify","InstitutionDomainVerified","InstitutionProofInput","FR-INS-002","INSTITUTION_ROSTER"),
 ("POST","/admin/institutions/{id}/domains/{domainId}/approve","InstitutionDomainApproved","InstitutionReasonInput","FR-INS-002 FR-INS-008","INSTITUTION_APPROVE"),
 ("POST","/admin/institutions/{id}/domains/{domainId}/suspend","InstitutionDomainSuspended","InstitutionReasonInput","FR-INS-002 FR-INS-010","INSTITUTION_APPROVE"),
 ("GET","/admin/institutions/{id}/eligibility-policies","InstitutionPolicyRecord",None,"FR-INS-004 FR-INS-007","INSTITUTION_READ"),
 ("POST","/admin/institutions/{id}/eligibility-policies","InstitutionPolicyState","InstitutionPolicyInput","FR-INS-004 FR-INS-007","INSTITUTION_ROSTER"),
 ("POST","/admin/institutions/{id}/eligibility-policies/{policyId}/approve","InstitutionPolicyState","InstitutionReasonInput","FR-INS-004 FR-INS-008","INSTITUTION_APPROVE"),
 ("POST","/admin/institutions/{id}/eligibility-policies/{policyId}/suspend","InstitutionPolicySuspended","InstitutionReasonInput","FR-INS-004 FR-INS-010","INSTITUTION_APPROVE"),
 ("GET","/admin/institutions/{id}/memberships","InstitutionMembershipRecord",None,"FR-INS-004 FR-INS-009","INSTITUTION_READ"),
 ("POST","/admin/institutions/{id}/memberships/{membershipId}/review","InstitutionMembershipState","InstitutionReviewInput","FR-INS-004 FR-INS-005 FR-INS-008","INSTITUTION_ROSTER"),
 ("POST","/admin/institutions/{id}/roster-imports","InstitutionRosterResult","InstitutionRosterInput","FR-INS-011","INSTITUTION_ROSTER"),
 ("GET","/admin/institutions/{id}/cohorts","InstitutionCohort",None,"FR-INS-006","INSTITUTION_READ"),
 ("POST","/admin/institutions/{id}/cohorts","InstitutionCohort","InstitutionCohortInput","FR-INS-006","INSTITUTION_COHORT"),
 ("POST","/admin/institutions/{id}/cohorts/{cohortId}/members","InstitutionCohortMember","InstitutionCohortMemberInput","FR-INS-006","INSTITUTION_COHORT"),
 ("POST","/admin/institutions/{id}/cohorts/{cohortId}/suspend","InstitutionCohortState","InstitutionReasonInput","FR-INS-006 FR-INS-010","INSTITUTION_COHORT"),
 ("GET","/admin/institutions/{id}/sso-providers","InstitutionSsoRecord",None,"FR-INS-004","INSTITUTION_READ"),
 ("POST","/admin/institutions/{id}/sso-providers","InstitutionSsoState","InstitutionSsoInput","FR-INS-004","INSTITUTION_ROSTER"),
 ("POST","/admin/institutions/{id}/sso-providers/{providerId}/approve","InstitutionSsoState","InstitutionReasonInput","FR-INS-004 FR-INS-008","INSTITUTION_SSO"),
]
LIST = {"/institutional/memberships","/institutional/eligible-institutions","/admin/institutions",
        "/admin/institutions/{id}/domains","/admin/institutions/{id}/eligibility-policies",
        "/admin/institutions/{id}/memberships","/admin/institutions/{id}/cohorts",
        "/admin/institutions/{id}/sso-providers"}

def apply_institution_runtime(spec, policies, trace, requirement_rows):
    components = spec["components"]["schemas"]
    components.update(SCHEMAS)
    paths = spec["paths"]
    errors = {key:deepcopy(value) for key,value in paths["/api/v1/orders"]["post"]["responses"].items()
              if key.startswith(("4","5"))}
    known = {row["requirement_id"] for row in requirement_rows}
    for method,suffix,out_name,in_name,anchors,permission in ROUTES:
        path = "/api/v1"+suffix
        old = paths.get(path,{}).get(method.lower(),{})
        opid = old.get("operationId") or method.lower()+"_"+suffix.strip("/").replace("/","_").replace("{","").replace("}","").replace("-","_")
        ids = sorted(set(anchors.split()) | set(old.get("x-requirement-ids",[])))
        if set(ids)-known: raise ValueError(f"Unknown institutional SRS anchors for {path}: {set(ids)-known}")
        response_name = opid+"Response"
        components[response_name] = obj({"data":arr(ref(out_name)) if suffix in LIST else ref(out_name),"requestId":TEXT})
        params = [{"name":name,"in":"path","required":True,"schema":UUID}
                  for name in ("id","userId","domainId","policyId","membershipId","cohortId","providerId")
                  if "{"+name+"}" in suffix]
        if suffix.endswith("/memberships") and permission == "INSTITUTION_READ":
            params.append({"name":"limit","in":"query","required":False,"schema":{"type":"integer","minimum":1,"maximum":200,"default":100}})
        if method == "POST":
            params.append({"name":"X-CSRF-Token","in":"header","required":True,
                           "schema":{"type":"string","minLength":16}})
        administrative = permission is not None
        summary = {
            "GET":"List", "POST":"Manage",
        }[method]+" "+suffix.replace("/admin/","").replace("/institutional/","").replace("/"," ")
        operation = {"operationId":opid,"tags":["institutions"],"summary":summary,
            "description":f"{summary}. Server rechecks verified identity, exact domain, active approved institution, scoped manager permission and current agreement or policy as applicable. SSO metadata never enables authentication.",
            "security":[{"cookieAuth":[]}],"parameters":params,
            "responses":{("201" if method=="POST" else "200"):{"description":summary,"content":{"application/json":{
                "schema":ref(response_name),"example":sample(components[response_name],components)}}},**errors},
            "x-requirement-ids":ids,"x-implemented-requirement-ids":anchors.split(),
            "x-policy-id":opid,"x-authorized-roles":(["SYSTEM_ADMIN"] if permission in {"INSTITUTION_APPROVE","INSTITUTION_SSO"} else ["SYSTEM_ADMIN","INSTITUTION_MANAGER"]) if administrative else [],
            "x-required-permission":permission or "authenticated-account",
            "x-entitlement-condition":"current approved agreement and reviewed membership for benefits; none for administration",
            "x-rate-limit":{"bucket":"identity-auth:permission" if method=="POST" else "none",
                "limit":8 if method=="POST" else 0,"windowSeconds":None,
                "policySetting":"security.loginWindowMinutes" if method=="POST" else "none",
                "key":"hashed-subject-and-source-ip" if method=="POST" else "none"},
            "x-idempotency":{"required":False,"scope":"locked transition or roster content hash"},
            "x-audit-event":"institution."+opid if method=="POST" else "none",
            "x-audit-fields":["actorId","resourceId","requestId","occurredAt"] if method=="POST" else [],
            "x-acceptance-tests":["T-"+item for item in ids],
            "x-acceptance-scenarios":["authorized request returns declared DTO",
                "foreign tenant and unverified identity are denied",
                "independent approval, current domain proof and quota are enforced where applicable"],
            "x-csrf-protection":method=="POST",
            "x-mfa-evidence":"verified-session" if administrative else "none",
            "x-no-request-body":method=="POST" and in_name is None}
        if in_name:
            example = sample(components[in_name],components)
            for field,value in {"reason":"Reviewed institutional evidence", "evidenceRef":"TEST-EVIDENCE",
                "registrationRef":"TEST-REGISTRATION", "domain":"school.example.edu"}.items():
                if field in example: example[field]=value
            if in_name == "InstitutionProofInput": example["token"]="A"*43
            if in_name == "InstitutionRosterInput": example["csv"]="email,category,action\nstudent@example.edu,STUDENT,UPSERT"
            if in_name == "InstitutionSsoInput": example["issuerUrl"]="https://identity.example.edu/"
            operation["requestBody"]={"required":True,"content":{"application/json":{
                "schema":ref(in_name),"example":example}}}
        paths.setdefault(path,{})[method.lower()] = operation
        policies[opid]={"effect":"allow","authentication":"session",
            "rolesAny":(["SYSTEM_ADMIN"] if permission in {"INSTITUTION_APPROVE","INSTITUTION_SSO"} else ["SYSTEM_ADMIN","INSTITUTION_MANAGER"]) if administrative else [],
            "permission":permission or "authenticated-account",
            "ownership":"subject_user" if not administrative else "none",
            "institutionBoundary":"verified_membership_or_scoped_admin",
            "entitlement":"current-approved-agreement-for-benefit","contentPermission":"none",
            "mfa":administrative,"reasonRequired":in_name in {"InstitutionReasonInput","InstitutionReviewInput"},
            "distinctApprover":suffix.endswith("/approve") and administrative,
            "purposeRequired":False,
            "note":"Deny by default; central approval differs from institution manager scope."}
        screens=sorted({screen.strip() for row in requirement_rows if row["requirement_id"] in ids
                        for screen in row["wireframe_ids"].split(";") if screen.strip()})
        entry={"method":method,"path":path,"operation_id":opid,"requirement_ids":";".join(ids),
               "screen_ids":";".join(screens),"request_dto":in_name or "None",
               "response_dto":response_name,"policy_id":opid,
               "acceptance_tests":";".join("T-"+item for item in ids)}
        for i,row in enumerate(trace):
            if row["method"]==method and row["path"]==path:
                trace[i]=entry
                break
        else: trace.append(entry)
