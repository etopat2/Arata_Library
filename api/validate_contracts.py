"""Strict OpenAPI 3.1, example, policy and traceability checks."""
from __future__ import annotations

import csv
import json
import re
import warnings
from pathlib import Path

import yaml
from jsonschema import Draft202012Validator, FormatChecker, RefResolver
from openapi_spec_validator import validate_spec

ROOT = Path(__file__).resolve().parent.parent
API = ROOT / "api"


def load():
    spec = yaml.safe_load((API / "openapi.v1.yaml").read_text(encoding="utf-8"))
    policy = yaml.safe_load((API / "policies.v1.yaml").read_text(encoding="utf-8"))
    trace = list(csv.DictReader((API / "ENDPOINT_TRACEABILITY.csv").open(encoding="utf-8", newline="")))
    return spec, policy, trace


def validate_all():
    spec, policy, trace = load()
    validate_spec(spec)
    components = spec["components"]["schemas"]
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        resolver = RefResolver.from_schema(spec)
    checker = FormatChecker()
    for name, schema in components.items(): Draft202012Validator.check_schema(schema)
    all_ids = {row["requirement_id"] for row in csv.DictReader((ROOT / "Documentation/Implementation/REQUIREMENT_TRACEABILITY.csv").open(encoding="utf-8-sig", newline=""))}
    acceptance_ids = {row["test_id"] for row in csv.DictReader((ROOT / "Documentation/Implementation/ACCEPTANCE_CRITERIA.csv").open(encoding="utf-8-sig", newline=""))}
    seen_ids = set(); seen_routes = set(); errors = []
    for path, item in spec["paths"].items():
        if not path.startswith("/api/v1/"): errors.append(f"Unversioned path: {path}")
        for method, op in item.items():
            if method.upper() not in {"GET", "POST", "PUT", "PATCH", "DELETE"}: continue
            key = method.upper() + " " + path
            op_id = op.get("operationId")
            if not op_id or op_id in seen_ids: errors.append(f"Duplicate or missing operationId: {key}")
            seen_ids.add(op_id); seen_routes.add(key)
            if "security" not in op: errors.append(f"Missing security declaration: {key}")
            if not op.get("summary") or not op.get("description"): errors.append(f"Missing functional description: {key}")
            req_ids = op.get("x-requirement-ids", [])
            if not req_ids or set(req_ids) - all_ids: errors.append(f"Missing or unknown SRS ID: {key}")
            if not set(op.get("x-acceptance-tests", [])) <= acceptance_ids or not op.get("x-acceptance-tests"):
                errors.append(f"Missing acceptance ID: {key}")
            policy_id = op.get("x-policy-id")
            if policy_id not in policy["policies"]: errors.append(f"Missing policy: {key}")
            else:
                rule = policy["policies"][policy_id]
                if rule.get("mfa") and not any(p.get("name") == "X-Step-Up-Token" for p in op.get("parameters", [])):
                    errors.append(f"Missing step-up parameter: {key}")
                if rule.get("purposeRequired") and not any(p.get("name") == "X-Research-Purpose" for p in op.get("parameters", [])):
                    errors.append(f"Missing research purpose parameter: {key}")
            if op.get("x-idempotency", {}).get("required") and not (any(p.get("name") == "Idempotency-Key" for p in op.get("parameters", [])) or "webhooks" in path):
                errors.append(f"Missing idempotency header: {key}")
            if op.get("x-csrf-protection") and not any(p.get("name") == "X-CSRF-Token" for p in op.get("parameters", [])):
                errors.append(f"Missing CSRF header: {key}")
            if not op.get("x-rate-limit") or "x-audit-event" not in op or "x-audit-fields" not in op or not op.get("x-acceptance-scenarios"):
                errors.append(f"Missing operational control or acceptance scenario: {key}")
            if method.upper() in {"POST", "PUT", "PATCH"} and "requestBody" not in op and key not in {
                "POST /api/v1/auth/logout", "POST /api/v1/resources/{id}/download",
                "POST /api/v1/me/subscriptions/{id}/cancel", "POST /api/v1/me/notifications/{id}/read"}:
                errors.append(f"Missing request DTO: {key}")
            for p in op.get("parameters", []):
                if "$ref" in p and p["$ref"].split("/")[-1] not in spec["components"].get("parameters", {}): errors.append(f"Unknown parameter ref: {key}")
            for medium in op.get("requestBody", {}).get("content", {}).values():
                schema = medium.get("schema", {})
                if schema.get("$ref", "").endswith("/Command") or schema.get("type") == "object" and schema.get("additionalProperties") is True:
                    errors.append(f"Generic request DTO: {key}")
                if "example" in medium:
                    try: Draft202012Validator(schema, resolver=resolver, format_checker=checker).validate(medium["example"])
                    except Exception as e: errors.append(f"Invalid request example {key}: {e}")
            success = [v for k,v in op["responses"].items() if k.startswith("2")]
            if len(success) != 1: errors.append(f"Expected one typed success: {key}")
            for code, response in op["responses"].items():
                if code.startswith("2") and "application/json" not in response.get("content", {}): errors.append(f"Missing typed response: {key}")
                if code.startswith("4") or code.startswith("5"):
                    if "application/problem+json" not in response.get("content", {}): errors.append(f"Nonstandard error: {key} {code}")
                for medium in response.get("content", {}).values():
                    schema = medium.get("schema", {})
                    if "$ref" not in schema: errors.append(f"Inline or missing response DTO: {key} {code}")
                    if "example" in medium:
                        try: Draft202012Validator(schema, resolver=resolver, format_checker=checker).validate(medium["example"])
                        except Exception as e: errors.append(f"Invalid response example {key} {code}: {e}")
    if set(policy["policies"]) != seen_ids: errors.append("Policy and operation ID sets differ")
    if {r["method"]+" "+r["path"] for r in trace} != seen_routes: errors.append("Traceability and operation route sets differ")
    if policy.get("defaultEffect") != "deny": errors.append("Policy default is not deny")
    if errors: raise AssertionError("\n".join(errors))
    return {"operations": len(seen_ids), "paths": len(spec["paths"]), "schemas": len(components), "policies": len(policy["policies"]), "trace_rows": len(trace), "request_examples": sum("example" in m for item in spec["paths"].values() for op in item.values() for m in op.get("requestBody", {}).get("content", {}).values()), "response_examples": sum("example" in m for item in spec["paths"].values() for op in item.values() for response in op["responses"].values() for m in response.get("content", {}).values())}


if __name__ == "__main__": print(json.dumps(validate_all(), indent=2))
