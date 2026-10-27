"""Exact billing runtime overlay on the older design-stage OpenAPI inventory.

Keep this small and explicit: generated design DTOs for other domains are not
silently treated as implemented service responses.
"""
from __future__ import annotations

from copy import deepcopy


def ref(name): return {"$ref": f"#/components/schemas/{name}"}
def obj(fields, required=None):
    return {"type": "object", "additionalProperties": False, "properties": fields,
            "required": list(fields) if required is None else required}
def arr(value): return {"type": "array", "items": value}
def nullable(value): return {"anyOf": [value, {"type": "null"}]}

UUID = {"type": "string", "format": "uuid"}
TEXT = {"type": "string"}
TIME = {"type": "string", "format": "date-time"}
INT = {"type": "integer", "minimum": 0}
BOOL = {"type": "boolean"}
STATUS = TEXT

SCHEMAS = {
    "BillingPlan": obj({"id": UUID, "code": TEXT, "name": TEXT, "version": INT, "planVersionId": UUID,
        "currencyCode": TEXT, "amountMinor": INT, "periodMonths": INT, "scopeKind": TEXT,
        "scopeId": nullable(UUID), "scopeTitle": TEXT, "automaticRenewal": BOOL, "cancellation": TEXT,
        "refundWindowDays": INT, "trialDays": INT}),
    "BillingPlans": obj({"free": obj({"name": TEXT, "priceMinor": INT, "currency": TEXT,
        "description": TEXT}), "paid": arr(ref("BillingPlan")), "policyVersion": INT}),
    "BillingOrder": obj({"id": UUID, "status": STATUS, "paymentStatus": STATUS,
        "planVersionId": UUID, "amountMinor": INT, "currency": TEXT,
        "checkoutUrl": nullable({"type": "string", "format": "uri"}), "subscriptionId": nullable(UUID)}),
    "BillingPaymentStatus": obj({"id": UUID, "status": STATUS, "verifiedAt": nullable(TIME),
        "createdAt": TIME, "orderId": UUID, "orderStatus": STATUS}),
    "BillingSubscription": obj({"id": UUID, "status": STATUS,
        "currentPeriodStart": nullable(TIME), "currentPeriodEnd": nullable(TIME),
        "cancelAtPeriodEnd": BOOL, "name": TEXT, "scopeKind": TEXT,
        "scopeId": nullable(UUID), "periodMonths": nullable(INT)}),
    "BillingInvoiceSummary": obj({"id": UUID, "invoiceNumber": TEXT,
        "currencyCode": TEXT, "totalMinor": INT, "issuedAt": TIME, "orderId": UUID}),
    "BillingInvoice": obj({"id": UUID, "invoiceNumber": TEXT,
        "currencyCode": TEXT, "totalMinor": INT, "issuedAt": TIME, "orderId": UUID,
        "paidAt": TIME, "planName": TEXT, "periodMonths": nullable(INT),
        "scopeKind": TEXT, "scopeId": nullable(UUID), "tax": TEXT}),
    "BillingNotification": obj({"id": UUID, "kind": TEXT, "status": TEXT,
        "createdAt": TIME, "sentAt": nullable(TIME)}),
    "BillingFinanceReport": obj({"paidOrders": INT, "grossMinor": {"type": "string", "pattern": "^[0-9]+$"},
        "settledRefundMinor": {"type": "string", "pattern": "^[0-9]+$"},
        "pendingOrders": INT, "openDisputes": INT, "currency": TEXT}),
    "BillingPlanVersionCreated": obj({"id": UUID, "code": TEXT, "version": INT}),
    "BillingCancellation": obj({"id": UUID, "cancelAtPeriodEnd": BOOL, "paidThrough": TIME}),
    "BillingRefundAction": obj({"id": UUID, "status": TEXT}, ["id", "status"]),
    "BillingDisputeAction": obj({"id": UUID, "status": TEXT}),
    "BillingReconciliation": obj({"id": UUID, "examined": INT, "refundsExamined": INT,
        "batchLimited": BOOL, "exceptions": INT}),
    "BillingReconciliationRunSummary": obj({"id": UUID, "provider": TEXT,
        "periodFrom": TIME, "periodTo": TIME, "startedAt": TIME, "endedAt": nullable(TIME),
        "examined": INT, "exceptions": INT}),
    "BillingReconciliationItem": obj({"id": UUID, "paymentAttemptId": nullable(UUID),
        "providerRef": TEXT, "outcome": TEXT,
        "detail": nullable(obj({"code": TEXT}))}),
    "BillingReconciliationRunDetail": obj({"id": UUID, "provider": TEXT,
        "periodFrom": TIME, "periodTo": TIME, "startedAt": TIME, "endedAt": nullable(TIME),
        "items": arr(ref("BillingReconciliationItem"))}),
    "BillingWebhookReceipt": obj({"received": BOOL}),
    "BillingStatementText": {"type": "string"},
    "BillingOrderRecord": obj({"id": UUID, "userId": UUID, "merchantRef": TEXT,
        "currencyCode": TEXT, "totalMinor": {"type": "string", "pattern": "^[0-9]+$"},
        "status": TEXT, "createdAt": TIME, "paidAt": nullable(TIME)}),
    "BillingPaymentRecord": obj({"id": UUID, "orderId": UUID, "provider": TEXT,
        "providerRef": nullable(TEXT), "status": TEXT, "verifiedAt": nullable(TIME), "createdAt": TIME}),
    "BillingRefundRecord": obj({"id": UUID, "paymentAttemptId": UUID,
        "amountMinor": {"type": "string", "pattern": "^[0-9]+$"}, "status": TEXT,
        "reason": nullable(TEXT), "requestedById": nullable(UUID), "approvedById": nullable(UUID),
        "requestedAt": TIME, "approvedAt": nullable(TIME), "settledAt": nullable(TIME)}),
    "BillingDisputeRecord": obj({"id": UUID, "paymentAttemptId": UUID, "status": TEXT,
        "reason": TEXT, "openedAt": TIME, "resolvedAt": nullable(TIME)}),
    "BillingInvoiceRecord": obj({"id": UUID, "invoiceNumber": TEXT, "orderId": UUID,
        "currencyCode": TEXT, "totalMinor": {"type": "string", "pattern": "^[0-9]+$"},
        "issuedAt": TIME, "userId": UUID, "status": TEXT}),
    "BillingOrderCreateInput": obj({"planVersionId": UUID, "renewalSubscriptionId": UUID,
        "upgradeFromId": UUID}, ["planVersionId"]),
    "BillingPlanCreateInput": obj({"name": {"type": "string", "minLength": 3, "maxLength": 200},
        "period": {"type": "string", "enum": ["monthly", "quarterly", "annual"]},
        "scopeKind": {"type": "string", "enum": ["LIBRARY", "PUBLICATION", "VOLUME"]},
        "scopeId": UUID, "amountMinor": {"type": "integer", "minimum": 1, "maximum": 1000000000}},
        ["name", "period", "scopeKind", "amountMinor"]),
    "BillingRefundCreateInput": obj({"paymentAttemptId": UUID,
        "amountMinor": {"type": "integer", "minimum": 1},
        "reason": {"type": "string", "minLength": 10, "maxLength": 1000}}),
    "BillingDisputeCreateInput": obj({"paymentAttemptId": UUID,
        "providerCaseId": {"type": "string", "minLength": 3, "maxLength": 160},
        "reason": {"type": "string", "minLength": 10, "maxLength": 1000}}),
    "BillingDisputeResolveInput": obj({"decision": {"type": "string", "enum": ["WON", "LOST"]}}),
    "BillingReconcileInput": obj({"from": TIME, "to": TIME}),
    "BillingWebhookInput": obj({"data": obj({"tx_ref": TEXT}, ["tx_ref"])}, ["data"]),
}

# method, path, response data schema, request DTO, SRS anchors, short description
ROUTES = [
    ("GET", "/plans", "BillingPlans", None, "FR-PAY-001 FR-PAY-002", "List approved free and paid access offers."),
    ("POST", "/orders", "BillingOrder", "BillingOrderCreateInput", "FR-PAY-003 FR-PAY-004 FR-PAY-006 BR-008", "Create an idempotent hosted checkout order without granting access."),
    ("GET", "/orders/{id}", "BillingOrder", None, "FR-PAY-003 FR-PAY-009", "Read only the signed-in customer's order."),
    ("POST", "/orders/{id}/verify", "BillingOrder", None, "FR-PAY-005 FR-PAY-007 BR-008", "Requery the provider before activating any paid access."),
    ("POST", "/orders/{id}/retry", "BillingOrder", None, "FR-PAY-006 FR-PAY-008 FR-PAY-009", "Retry a failed order with a fresh idempotency key."),
    ("GET", "/payments/{id}/status", "BillingPaymentStatus", None, "FR-PAY-005 FR-PAY-009", "Read only the customer's payment state."),
    ("POST", "/payments/webhooks/{provider}", "BillingWebhookReceipt", "BillingWebhookInput", "FR-PAY-005 FR-PAY-006 FR-PAY-007 BR-008", "Accept a v3 verif-hash webhook; independently verify settlement."),
    ("GET", "/me/subscriptions", "BillingSubscription", None, "FR-PAY-009 FR-PAY-010 FR-PAY-012 BR-007", "List the customer's paid subscriptions."),
    ("POST", "/me/subscriptions/{id}/cancel", "BillingCancellation", None, "FR-PAY-012 BR-007", "Cancel future renewal while preserving paid-through access."),
    ("GET", "/me/invoices", "BillingInvoiceSummary", None, "FR-PAY-009 FR-PAY-018", "List verified invoices owned by the customer."),
    ("GET", "/me/invoices/{id}", "BillingInvoice", None, "FR-PAY-009 FR-PAY-018", "Read one verified owned invoice."),
    ("GET", "/me/invoices/{id}/statement", "BillingStatementText", None, "FR-PAY-009 FR-PAY-018", "Download the owned invoice as a CSV statement with tax review notice."),
    ("GET", "/me/billing-notifications", "BillingNotification", None, "FR-PAY-016 FR-OPS-001", "List billing notification delivery states for the customer."),
    ("GET", "/admin/plans", "BillingPlans", None, "FR-PAY-001 FR-PAY-002", "Read approved plans as a finance officer with MFA."),
    ("POST", "/admin/plans", "BillingPlanVersionCreated", "BillingPlanCreateInput", "FR-PAY-001 FR-PAY-002", "Create an immutable plan version under an active approved price policy."),
    ("GET", "/admin/finance/report", "BillingFinanceReport", None, "FR-PAY-018", "Read verified gross receipts, settled refunds and exceptions."),
    ("GET", "/admin/orders", "BillingOrderRecord", None, "FR-PAY-015 FR-PAY-018", "List recent orders for authorized finance staff."),
    ("GET", "/admin/payments", "BillingPaymentRecord", None, "FR-PAY-015 FR-PAY-018", "List recent provider payment attempts."),
    ("GET", "/admin/refunds", "BillingRefundRecord", None, "FR-PAY-013 FR-PAY-014", "List refund requests and settlement state."),
    ("GET", "/admin/disputes", "BillingDisputeRecord", None, "FR-PAY-014 FR-PAY-015", "List finance dispute cases."),
    ("GET", "/admin/invoices", "BillingInvoiceRecord", None, "FR-PAY-009 FR-PAY-018", "List verified invoice records for finance."),
    ("GET", "/admin/reconciliation-runs", "BillingReconciliationRunSummary", None, "FR-PAY-015 FR-PAY-018", "List bounded reconciliation runs and exception counts."),
    ("GET", "/admin/reconciliation-runs/{id}", "BillingReconciliationRunDetail", None, "FR-PAY-015 FR-PAY-018", "Read one bounded reconciliation run with review-safe exception details."),
    ("POST", "/admin/refunds", "BillingRefundAction", "BillingRefundCreateInput", "FR-PAY-013 FR-PAY-014", "Request an idempotent refund under the active policy."),
    ("POST", "/admin/refunds/{id}/approve", "BillingRefundAction", None, "FR-PAY-013 FR-PAY-014", "Independently approve and submit a verified refund once."),
    ("POST", "/admin/disputes", "BillingDisputeAction", "BillingDisputeCreateInput", "FR-PAY-014 FR-PAY-015", "Open an audited payment dispute."),
    ("POST", "/admin/disputes/{id}/resolve", "BillingDisputeAction", "BillingDisputeResolveInput", "FR-PAY-014 FR-PAY-015", "Resolve a dispute with independent review and provider confirmation for wins."),
    ("POST", "/admin/payments/reconcile", "BillingReconciliation", "BillingReconcileInput", "FR-PAY-015 FR-PAY-018", "Requery a bounded period of payments and submitted refunds."),
]


def sample(schema, components):
    if "$ref" in schema: return sample(components[schema["$ref"].split("/")[-1]], components)
    if "anyOf" in schema: return None
    if "enum" in schema: return schema["enum"][0]
    if schema.get("type") == "object": return {k: sample(schema["properties"][k], components) for k in schema["required"]}
    if schema.get("type") == "array": return []
    if schema.get("type") == "integer": return max(1, schema.get("minimum", 0))
    if schema.get("type") == "boolean": return True
    if schema.get("format") == "uuid": return "00000000-0000-4000-8000-000000000001"
    if schema.get("format") == "date-time": return "2026-10-27T00:00:00Z"
    if schema.get("format") == "uri": return "https://checkout.flutterwave.com/test"
    if schema.get("pattern") == "^[0-9]+$": return "0"
    if schema.get("minLength", 0) >= 10: return "Review required"
    return "sample"


def apply_billing_runtime(spec, policies, trace, requirement_rows):
    components = spec["components"]["schemas"]
    components.update(SCHEMAS)
    paths = spec["paths"]
    error_responses = deepcopy(paths["/api/v1/orders"]["post"]["responses"])
    error_responses = {code: value for code, value in error_responses.items() if code.startswith(("4", "5"))}
    known_ids = {row["requirement_id"] for row in requirement_rows}
    for method, suffix, data_name, request_name, anchors, description in ROUTES:
        path = "/api/v1" + suffix
        operation_id = method.lower() + "_" + suffix.strip("/").replace("/", "_").replace("{", "").replace("}", "").replace("-", "_")
        existing = paths.get(path, {}).get(method.lower())
        if existing: operation_id = existing["operationId"]
        req_ids = anchors.split()
        if set(req_ids) - known_ids: raise ValueError(f"Unknown billing SRS anchor: {path}")
        is_admin = suffix.startswith("/admin/")
        is_webhook = suffix.startswith("/payments/webhooks/")
        is_public = suffix == "/plans"
        list_data = method == "GET" and suffix in {"/me/subscriptions", "/me/invoices", "/me/billing-notifications",
            "/admin/orders", "/admin/payments", "/admin/refunds", "/admin/disputes", "/admin/invoices", "/admin/reconciliation-runs"}
        response_name = operation_id + "Response"
        data_schema = arr(ref(data_name)) if list_data else ref(data_name)
        components[response_name] = (ref(data_name) if is_webhook else obj({"data": data_schema, "requestId": TEXT}))
        response = {"description": description, "content": {"application/json": {"schema": ref(response_name),
            "example": sample(components[response_name], components)}}}
        if suffix.endswith("/statement"):
            response = {"description": description, "content": {"text/csv": {"schema": ref("BillingStatementText"),
                "example": "Invoice,Issued UTC,Plan,Currency,Amount minor,Tax note\n"}}}
        parameters = []
        for name in ("provider", "id"):
            if "{" + name + "}" in suffix:
                parameters.append({"name": name, "in": "path", "required": True,
                    "schema": {"type": "string", "enum": ["flutterwave_v3"]} if name == "provider" else UUID})
        if is_admin and suffix in {"/admin/orders", "/admin/payments", "/admin/refunds", "/admin/disputes", "/admin/invoices", "/admin/reconciliation-runs"}:
            parameters.append({"name": "limit", "in": "query", "required": False,
                "schema": {"type": "integer", "minimum": 1, "maximum": 100, "default": 50}})
        needs_key = suffix in {"/orders", "/orders/{id}/retry", "/admin/refunds"} and method == "POST"
        if needs_key:
            parameters.append({"name": "Idempotency-Key", "in": "header", "required": True,
                "schema": {"type": "string", "pattern": "^[a-zA-Z0-9_-]{16,120}$"}})
        if method == "POST" and not is_webhook:
            parameters.append({"name": "X-CSRF-Token", "in": "header", "required": True,
                "schema": {"type": "string", "minLength": 16, "maxLength": 256}})
        if is_webhook:
            parameters.append({"name": "verif-hash", "in": "header", "required": True,
                "schema": {"type": "string", "minLength": 1, "maxLength": 256}})
        operation = {
            "operationId": operation_id, "tags": ["payments" if is_webhook or "payment" in suffix or "refund" in suffix or "dispute" in suffix else "subscriptions"],
            "summary": description.split(".")[0], "description": description,
            "security": [{"webhookSignature": []}] if is_webhook else [] if is_public else [{"cookieAuth": []}],
            "parameters": parameters, "responses": {"201" if method == "POST" else "200": response, **error_responses},
            "x-requirement-ids": req_ids, "x-policy-id": operation_id,
            "x-authorized-roles": ["finance"] if is_admin else [],
            "x-entitlement-condition": "none", "x-rate-limit": {"bucket": "billing", "limit": 20 if suffix == "/orders" else 60,
                "windowSeconds": 3600 if suffix == "/orders" else 60, "key": "subject-or-source-ip"},
            "x-idempotency": {"required": needs_key or is_webhook, "scope": "actor+key" if needs_key else "verified-provider-event" if is_webhook else "none"},
            "x-audit-event": "billing." + operation_id if method == "POST" else "none",
            "x-audit-fields": ["actorId", "resourceId", "requestId", "occurredAt"] if method == "POST" else [],
            "x-acceptance-tests": ["T-" + value for value in req_ids],
            "x-acceptance-scenarios": ["authorized request returns the declared schema", "malformed request or state is denied",
                "verified provider evidence is required before paid access"],
            "x-csrf-protection": method == "POST" and not is_webhook,
            "x-mfa-evidence": "verified-session" if is_admin else "none",
        }
        if request_name:
            input_schema = components[request_name]
            operation["requestBody"] = {"required": True, "content": {"application/json": {
                "schema": ref(request_name), "example": sample(input_schema, components)}}}
        paths.setdefault(path, {})[method.lower()] = operation
        policies[operation_id] = {"effect": "allow", "authentication": "webhook" if is_webhook else "public" if is_public else "session",
            "rolesAny": ["finance"] if is_admin else [], "ownership": "subject_user" if suffix.startswith("/me/") or suffix.startswith("/orders/") or suffix.startswith("/payments/{id}") else "none",
            "institutionBoundary": "none", "entitlement": "none", "contentPermission": "none", "mfa": is_admin,
            "reasonRequired": suffix in {"/admin/refunds", "/admin/disputes"} and method == "POST",
            "distinctApprover": suffix in {"/admin/refunds/{id}/approve", "/admin/disputes/{id}/resolve"},
            "purposeRequired": False, "note": "Runtime billing: deny by default; resolve role, permission, ownership and current state on server."}
        screens = sorted({screen.strip() for row in requirement_rows if row["requirement_id"] in req_ids
            for screen in row["wireframe_ids"].split(";") if screen.strip()})
        entry = {"method": method, "path": path, "operation_id": operation_id,
            "requirement_ids": ";".join(req_ids), "screen_ids": ";".join(screens),
            "request_dto": request_name or "None", "response_dto": response_name,
            "policy_id": operation_id, "acceptance_tests": ";".join("T-" + value for value in req_ids)}
        for index, row in enumerate(trace):
            if row["method"] == method and row["path"] == path:
                trace[index] = entry
                break
        else: trace.append(entry)
    spec["components"]["securitySchemes"]["webhookSignature"] = {"type": "apiKey", "in": "header",
        "name": "verif-hash", "description": "Flutterwave v3 dashboard secret hash; server verifies transaction independently."}
