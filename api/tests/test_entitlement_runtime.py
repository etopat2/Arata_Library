from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from entitlement_runtime import ROUTES
from validate_contracts import load


def test_entitlement_routes_have_explicit_dtos_and_policies():
    spec, policy, trace = load()
    trace_routes = {(row["method"], row["path"]) for row in trace}
    for method, suffix, output_name, input_name, anchors, _ in ROUTES:
        path = "/api/v1" + suffix
        operation = spec["paths"][path][method.lower()]
        assert (method, path) in trace_routes
        assert set(anchors.split()) <= set(operation["x-requirement-ids"])
        assert output_name in spec["components"]["schemas"]
        rule = policy["policies"][operation["x-policy-id"]]
        assert rule["authentication"] == "session"
        if input_name:
            assert operation["requestBody"]["content"]["application/json"]["schema"]["$ref"].endswith(input_name)
        elif method == "POST":
            assert operation["x-no-request-body"] is True
        if suffix.startswith("/admin/"):
            assert rule["rolesAny"] == ["SYSTEM_ADMIN"]
            assert rule["permission"].startswith("ENTITLEMENT_")
            assert rule["mfa"] is True
        if method == "POST":
            assert operation["x-csrf-protection"] is True


def test_promotion_is_free_access_and_approval_is_independent():
    spec, policy, _ = load()
    redeem = spec["paths"]["/api/v1/me/promotion-redemptions"]["post"]
    assert "free promotional code" in redeem["summary"]
    approve = spec["paths"]["/api/v1/admin/entitlements/{id}/approve"]["post"]
    assert policy["policies"][approve["x-policy-id"]]["distinctApprover"] is True
    campaign = spec["paths"]["/api/v1/admin/grant-campaigns/{id}/approve"]["post"]
    assert policy["policies"][campaign["x-policy-id"]]["distinctApprover"] is True
