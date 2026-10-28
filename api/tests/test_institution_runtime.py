"""Institution operation DTO and authorization regression checks."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from validate_contracts import load
from institution_runtime import ROUTES


def test_every_live_institution_route_has_exact_contract():
    spec, policy, trace = load()
    for method, suffix, output, request, anchors, permission in ROUTES:
        path = "/api/v1" + suffix
        operation = spec["paths"][path][method.lower()]
        assert operation["responses"].get("201" if method == "POST" else "200")
        assert operation["x-implemented-requirement-ids"] == anchors.split()
        if request:
            assert operation["requestBody"]["content"]["application/json"]["schema"]["$ref"].endswith("/"+request)
        elif method == "POST":
            assert operation["x-no-request-body"]
        else:
            assert "requestBody" not in operation
        assert operation["x-required-permission"] == (permission or "authenticated-account")
        assert operation["operationId"] in policy["policies"]
        assert any(row["path"] == path and row["method"] == method for row in trace)
        assert output in spec["components"]["schemas"]


def test_institution_policy_denies_foreign_tenants_and_sso_is_metadata_only():
    spec, policies, _ = load()
    op = spec["paths"]["/api/v1/admin/institutions/{id}/memberships"]["get"]
    rule = policies["policies"][op["x-policy-id"]]
    assert rule["institutionBoundary"] == "verified_membership_or_scoped_admin"
    assert rule["mfa"] is True
    op = spec["paths"]["/api/v1/admin/institutions/{id}/sso-providers"]["post"]
    dto = spec["components"]["schemas"]["InstitutionSsoState"]
    assert dto["properties"]["authenticationEnabled"]["type"] == "boolean"
    assert "SSO metadata never enables authentication" in op["description"]
