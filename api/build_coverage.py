"""Report direct and indirect v1 operation coverage without changing the SRS."""
from __future__ import annotations

import csv
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main():
    with (ROOT / "api/ENDPOINT_TRACEABILITY.csv").open(encoding="utf-8", newline="") as f:
        direct = {ident for operation in csv.DictReader(f) for ident in operation["requirement_ids"].split(";")}
    with (ROOT / "Documentation/Implementation/REQUIREMENT_TRACEABILITY.csv").open(encoding="utf-8-sig", newline="") as f:
        requirements = list(csv.DictReader(f))
    indirect = [row for row in requirements if row["requirement_id"] not in direct]
    out = ["# API to SRS coverage", "", f"{len(direct)} of {len(requirements)} SRS IDs have a direct v1 operation anchor. These are design links; no service acceptance test has passed.", "", "The remaining IDs may be UI, PWA, worker, database, infrastructure or policy requirements. They remain in the authoritative traceability matrix and are not waived.", "", "## IDs without a direct v1 operation", ""]
    for row in indirect:
        out.append(f"- `{row['requirement_id']}` — {row['module']}; {row['delivery_stage']}")
    (ROOT / "api/REQUIREMENT_COVERAGE.md").write_text("\n".join(out)+"\n", encoding="utf-8")
    print(f"Direct: {len(direct)}; indirect: {len(indirect)}; total: {len(requirements)}")


if __name__ == "__main__": main()
