"""Append verified billing implementation anchors without changing original SRS IDs or text."""
from __future__ import annotations

import csv
from pathlib import Path

path = Path(__file__).with_name("REQUIREMENT_TRACEABILITY.csv")
with path.open(encoding="utf-8-sig", newline="") as source:
    reader = csv.DictReader(source)
    fields = reader.fieldnames
    rows = list(reader)

assert fields and len(rows) == 287 and len({row["requirement_id"] for row in rows}) == 287
ids = {f"FR-PAY-{number:03}" for number in range(1, 19)} | {"BR-007", "BR-008"}
paths = (
    "apps/api/src/billing/billing.service.ts;apps/api/src/billing/billing.controller.ts;"
    "apps/api/src/billing/gateway.ts;apps/web-pwa/src/BillingScreens.tsx;"
    "prisma/migrations/202610270001_billing_workflow;api/billing_runtime.py;"
    "tests/integration/billing.test.ts;tests/integration/billing-http.test.ts;"
    "tests/unit/billing-gateway.test.ts;tests/e2e/billing.spec.ts;database/tests/billing.test.ts"
)
for row in rows:
    requirement_id = row["requirement_id"]
    if requirement_id not in ids or requirement_id == "FR-PAY-011":
        continue  # Trial issuance remains in its previous state.
    existing = [item for item in row["implementation_paths"].split(";") if item]
    for item in paths.split(";"):
        if item not in existing:
            existing.append(item)
    row["implementation_paths"] = ";".join(existing)
    row["implementation_status"] = "Partially implemented; paid launch acceptance open"
    row["verification_result"] = (
        "Billing DB/API/gateway/contract and browser checks recorded in TEST_RESULTS.md; "
        "live provider sandbox conformance unavailable without credentials"
    )
    note = "Billing launch gates: GAP-033–035; no approved paid price, tax terms or provider sandbox evidence."
    if note not in row["mapping_note"]:
        row["mapping_note"] = (row["mapping_note"].rstrip() + " " + note).strip()

with path.open("w", encoding="utf-8", newline="") as output:
    writer = csv.DictWriter(output, fieldnames=fields, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
