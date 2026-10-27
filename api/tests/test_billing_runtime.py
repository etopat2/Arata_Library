from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from billing_runtime import ROUTES
from validate_contracts import load


def test_billing_routes_have_exact_runtime_contracts():
    spec, policy, trace = load()
    trace_paths = {(row["method"], row["path"]) for row in trace}
    for method, suffix, data_name, request_name, anchors, _ in ROUTES:
        path = "/api/v1" + suffix
        operation = spec["paths"][path][method.lower()]
        assert (method, path) in trace_paths
        assert set(anchors.split()) <= set(operation["x-requirement-ids"])
        assert operation["x-policy-id"] in policy["policies"]
        assert data_name in spec["components"]["schemas"]
        if request_name:
            assert operation["requestBody"]["content"]["application/json"]["schema"]["$ref"].endswith(request_name)
        if suffix.startswith("/admin/"):
            assert operation["security"] == [{"cookieAuth": []}]
            assert policy["policies"][operation["x-policy-id"]]["mfa"] is True
            assert policy["policies"][operation["x-policy-id"]]["rolesAny"] == ["finance"]
    webhook = spec["paths"]["/api/v1/payments/webhooks/{provider}"]["post"]
    assert any(p["name"] == "verif-hash" for p in webhook["parameters"])
    assert webhook["x-csrf-protection"] is False
    assert spec["components"]["securitySchemes"]["webhookSignature"]["name"] == "verif-hash"


def test_finance_aggregate_uses_decimal_strings():
    components = load()[0]["components"]["schemas"]
    report = components["BillingFinanceReport"]
    assert report["properties"]["grossMinor"]["type"] == "string"
    assert report["properties"]["settledRefundMinor"]["type"] == "string"
