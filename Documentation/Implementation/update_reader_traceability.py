"""Apply verified reader contribution anchors without changing SRS source fields."""

import csv
from pathlib import Path

path = Path(__file__).with_name("REQUIREMENT_TRACEABILITY.csv")
ids = {
    "FR-ENT-001", "FR-ENT-004", "FR-ENT-007", "FR-ENT-008", "FR-ENT-009",
    "FR-ENT-010", "FR-ENT-011", "FR-ENT-012", "FR-ENT-013", "FR-ENT-014",
    "FR-ENT-016", "FR-RDR-001", "FR-RDR-002", "FR-RDR-003", "FR-RDR-004",
    "FR-RDR-005", "FR-RDR-006", "FR-RDR-007", "FR-RDR-008", "FR-RDR-009",
    "FR-RDR-010", "FR-SRC-002", "FR-SRC-005", "FR-SRC-006", "BR-001",
    "BR-003", "BR-004", "BR-009", "BR-011",
}
anchors = [
    "packages/access-policy/src/content-policy.ts",
    "apps/api/src/reader/reader.service.ts",
    "apps/api/src/reader/reader.controller.ts",
    "apps/api/src/reader/policy-admin.controller.ts",
    "apps/web-pwa/src/Reader.tsx",
    "apps/web-pwa/src/ContentPolicyAdmin.tsx",
    "prisma/migrations/202610250006_reader_policy_fields",
    "packages/access-policy/src/content-policy.test.ts",
    "tests/integration/catalogue.test.ts",
    "database/tests/reader-policy.test.ts",
    "tests/e2e/catalogue.spec.ts",
    "apps/api/READER.md",
]
with path.open(encoding="utf-8", newline="") as source:
    reader = csv.DictReader(source)
    fields = reader.fieldnames
    assert fields is not None
    rows = list(reader)
found = set()
for row in rows:
    if row["requirement_id"] not in ids:
        continue
    found.add(row["requirement_id"])
    existing = [value for value in row["implementation_paths"].split(";") if value]
    admin_browser = ["tests/e2e/studio.spec.ts"] if row["requirement_id"] in {
        "FR-ENT-007", "FR-ENT-008", "FR-ENT-009", "FR-ENT-010", "FR-ENT-014"
    } else []
    browser_delivery = ["apps/web-pwa/vite.config.ts", "tests/e2e/studio.spec.ts"] if row["requirement_id"] in {
        "FR-ENT-008", "FR-ENT-009", "FR-ENT-013", "FR-SRC-006", "FR-RDR-002"
    } else []
    row["implementation_paths"] = ";".join(dict.fromkeys([*existing, *anchors, *admin_browser, *browser_delivery]))
    if row["requirement_id"] == "FR-ENT-016":
        row["implementation_paths"] = ";".join(dict.fromkeys([
            *row["implementation_paths"].split(";"),
            "prisma/migrations/202610260001_reader_leases",
            "prisma/migrations/202610260002_reader_lease_cleanup_index",
            "apps/worker/src/reader-lease-cleanup.ts",
            "tests/integration/worker.test.ts",
            "database/scripts/grant-dev.ts",
            "database/scripts/verify-dev.ts",
        ]))
    if row["requirement_id"] == "FR-RDR-002":
        row["implementation_paths"] = ";".join(dict.fromkeys([
            *row["implementation_paths"].split(";"),
            "apps/web-pwa/src/style.css",
            "playwright.config.ts",
        ]))
    row["implementation_status"] = "Partially implemented; release acceptance open"
    row["verification_result"] = (
        "Reader policy unit 6/6; SQL constraints 11/11; live catalogue/reader integration 10/10; worker integration 2/2; "
        "public browser 10/10, administrator/Studio browser 3/3, and build evidence in TEST_RESULTS.md. "
        "Full SRS acceptance remains open."
    )
    if row["requirement_id"] == "FR-RDR-002":
        row["verification_result"] = (
            "Device preference Chromium/axe browser 1/1 and PWA build passed; account sync and manual WCAG review open. "
            "Full SRS acceptance remains open."
        )
    note = "Reader paths are live but do not complete offline, export, advanced rendering or release gates; see apps/api/READER.md."
    if note not in row["mapping_note"]:
        row["mapping_note"] = (row["mapping_note"].rstrip() + " " + note).strip()
assert found == ids, f"Missing original SRS IDs: {sorted(ids - found)}"
with path.open("w", encoding="utf-8", newline="") as target:
    writer = csv.DictWriter(target, fieldnames=fields, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
print(f"Updated {len(found)} original requirement rows; retained {len(rows)} total rows.")
