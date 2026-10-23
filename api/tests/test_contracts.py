from __future__ import annotations

import json
import sys
from pathlib import Path
from threading import Thread
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import pytest
from jsonschema import Draft202012Validator, RefResolver

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from validate_contracts import load, validate_all
from policy_evaluator import evaluate
from stub_server import start_server


@pytest.fixture(scope="module")
def contract():
    return load()


@pytest.fixture(scope="module")
def stub():
    server = start_server()
    thread = Thread(target=server.serve_forever, daemon=True); thread.start()
    yield f"http://127.0.0.1:{server.server_port}"
    server.shutdown(); server.server_close(); thread.join()


def full_context(rule):
    return {"authenticated": True, "webhook_verified": True, "service_verified": True,
            "public_free": True, "registered_free": True, "roles": rule["rolesAny"],
            "owns_resource": True, "institution_scope_valid": True, "research_scope_valid": True,
            "active_entitlement": True, "content_permissions": ["read", "copy", "print", "download", "offline"],
            "research_consent": True, "ai_consent": True, "disclosure_approved": True, "released_aggregate": True,
            "public_metadata": True, "step_up_valid": True, "reason_present": True,
            "distinct_approver": True, "export_kind": "finance", "paid_purchase_verified": True,
            "approved_purpose": True, "sensitive_export_approved": True,
            "revision_draft": True}


def send(stub, method, path, operation, context, body_override=None):
    params = {}
    for parameter in operation.get("parameters", []):
        if parameter["in"] == "path": path = path.replace("{"+parameter["name"]+"}", "sample")
        if parameter["in"] == "query" and parameter.get("required"):
            params[parameter["name"]] = "sample" if parameter["name"] not in {"from", "to"} else "2026-10-22T00:00:00Z"
    if params: path += "?" + urlencode(params)
    body_contract = operation.get("requestBody", {}).get("content", {}).get("application/json")
    body = body_override if body_override is not None else body_contract["example"] if body_contract else None
    raw = json.dumps(body).encode() if body is not None else None
    headers = {"X-Stub-Context": json.dumps(context), "Content-Type": "application/json"}
    request = Request(stub+path, data=raw, headers=headers, method=method)
    try:
        with urlopen(request, timeout=5) as response:
            return response.status, json.load(response)
    except HTTPError as error:
        return error.code, json.load(error)


def test_complete_contract_validation():
    counts = validate_all()
    assert counts["operations"] == counts["policies"] == counts["trace_rows"]
    assert counts["operations"] >= 150


def test_every_operation_against_stub(contract, stub):
    spec, policies, _ = contract
    resolver = RefResolver.from_schema(spec)
    for path, methods in spec["paths"].items():
        for method, operation in methods.items():
            rule = policies["policies"][operation["x-policy-id"]]
            status, result = send(stub, method.upper(), path, operation, full_context(rule))
            expected = int(next(code for code in operation["responses"] if code.startswith("2")))
            assert status == expected, (method, path, result)
            schema = operation["responses"][str(status)]["content"]["application/json"]["schema"]
            Draft202012Validator(schema, resolver=resolver).validate(result)


def test_stub_rejects_unknown_request_field(contract, stub):
    spec, policies, _ = contract
    op = spec["paths"]["/api/v1/admin/refunds"]["post"]
    body = dict(op["requestBody"]["content"]["application/json"]["example"])
    body["uncontracted"] = "unsafe"
    status, problem = send(stub, "POST", "/api/v1/admin/refunds", op, full_context(policies["policies"][op["x-policy-id"]]), body)
    assert status == 400 and problem["code"] == "VALIDATION_FAILED"


def test_deny_by_default_and_boundaries(contract, stub):
    spec, policies, _ = contract
    cases = [
        ("/api/v1/me/annotations", "get", {"owns_resource": False}, "OWNERSHIP_DENIED"),
        ("/api/v1/admin/institutions/{id}/memberships", "get", {"institution_scope_valid": False}, "INSTITUTION_DENIED"),
        ("/api/v1/admin/research/exports", "post", {"research_scope_valid": False}, "RESEARCH_ISOLATION_DENIED"),
        ("/api/v1/admin/research/metrics", "get", {"approved_purpose": False}, "PURPOSE_REQUIRED"),
        ("/api/v1/reader/lessons/{id}", "get", {"active_entitlement": False, "public_free": False, "registered_free": False}, "ENTITLEMENT_EXPIRED_OR_MISSING"),
        ("/api/v1/resources/{id}/download", "post", {"content_permissions": ["read"]}, "CONTENT_PERMISSION_DENIED"),
        ("/api/v1/admin/refunds", "post", {"step_up_valid": False}, "STEP_UP_REQUIRED"),
        ("/api/v1/admin/lessons/{id}", "patch", {"revision_draft": False}, "PUBLISHED_REVISION_IMMUTABLE"),
        ("/api/v1/admin/role-assignments", "post", {"distinct_approver": False}, "DUAL_CONTROL_REQUIRED"),
        ("/api/v1/admin/research/publications/{id}/release", "post", {"disclosure_approved": False}, "DISCLOSURE_NOT_APPROVED"),
        ("/api/v1/public/insights/{id}", "get", {"released_aggregate": False}, "INSIGHT_NOT_RELEASED"),
        ("/api/v1/research/events", "post", {"research_consent": False}, "CONSENT_REQUIRED"),
        ("/api/v1/admin/exports", "post", {"export_kind": "audit", "roles": ["finance"]}, "EXPORT_SCOPE_DENIED"),
    ]
    for path, method, changes, expected in cases:
        op = spec["paths"][path][method]; context = full_context(policies["policies"][op["x-policy-id"]]); context.update(changes)
        status, problem = send(stub, method.upper(), path, op, context)
        assert status == 403 and problem["code"] == expected, (path, problem)


def test_anonymous_free_resource_and_webhook_verification(contract):
    spec, policies, _ = contract
    open_rule = policies["policies"][spec["paths"]["/api/v1/resources/{id}/open"]["get"]["x-policy-id"]]
    context = full_context(open_rule); context["authenticated"] = False
    assert evaluate(open_rule, context) == (True, "ALLOW")
    context["public_free"] = False
    assert evaluate(open_rule, context)[0] is False
    webhook_rule = policies["policies"][spec["paths"]["/api/v1/payments/webhooks/{provider}"]["post"]["x-policy-id"]]
    context = full_context(webhook_rule); context["webhook_verified"] = False
    assert evaluate(webhook_rule, context) == (False, "WEBHOOK_UNVERIFIED")
