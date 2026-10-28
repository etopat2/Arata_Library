"""Record verified institutional implementation without altering the SRS text."""
import csv
from pathlib import Path

root = Path(__file__).resolve().parents[2]
path = root / "Documentation/Implementation/REQUIREMENT_TRACEABILITY.csv"
with path.open(encoding="utf-8-sig", newline="") as stream:
    rows = list(csv.DictReader(stream))
fields = list(rows[0])
ids = {f"FR-INS-{number:03d}" for number in range(1,14)} | {"BR-014","BR-017"}
common = [
    "apps/api/src/institutions/institution.controller.ts",
    "apps/api/src/institutions/institution.service.ts",
    "apps/api/src/institutions/rules.ts",
    "apps/web-pwa/src/InstitutionScreens.tsx",
    "apps/api/INSTITUTIONS.md",
    "api/institution_runtime.py",
    "api/openapi.v1.yaml",
    "api/policies.v1.yaml",
    "prisma/migrations/202610270009_institutional_access",
    "prisma/migrations/202610270010_institution_reporting_scope",
    "prisma/migrations/202610270011_domain_reverification_guard",
    "prisma/migrations/202610270012_domain_proof_order",
    "tests/integration/institutions-http.test.ts",
    "tests/unit/institution-rules.test.ts",
    "database/tests/constraints.test.ts",
]
models = ["Institution","InstitutionDomain","InstitutionDomainChallenge",
          "EligibilityPolicy","Membership","EligibilityReview","InstitutionAgreement",
          "InstitutionRosterImport","Cohort","CohortMember","InstitutionSsoProvider"]
for row in rows:
    if row["requirement_id"] not in ids:
        continue
    row["implementation_paths"] = ";".join(sorted(set(filter(None,row["implementation_paths"].split(";"))) | set(common)))
    row["database_models"] = ";".join(sorted(set(filter(None,row["database_models"].split(";"))) | set(models)))
    row["implementation_status"] = "Partially implemented; production institutional acceptance open"
    row["verification_result"] = ("Local DNS-proof, approval, tenant-boundary, roster, membership, "
                                  "cohort and SQL checks passed; live IdP/SSO and operational release evidence open")
    note = ("Institutional APIs use independent central approval, exact domain proof, "
            "verified membership, scoped managers and explicit opt-in reporting. "
            "SSO metadata does not enable login.")
    if note not in row["mapping_note"]:
        row["mapping_note"] = (row["mapping_note"] + " " + note).strip()
with path.open("w",encoding="utf-8",newline="") as stream:
    writer = csv.DictWriter(stream,fieldnames=fields,lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
