"""Rebuild and validate SRS traceability without changing the source packages.

Run after installing reconciliation-requirements.txt. The source packages remain
local and Git-ignored; generated implementation records are version controlled.
"""

from __future__ import annotations

import argparse
import csv
import io
import re
from collections import Counter, defaultdict
from pathlib import Path

import yaml
from docx import Document


ROOT = Path(__file__).resolve().parents[2]
DOC = ROOT / "Documentation"
OUT = DOC / "Implementation"
SRS = DOC / "Arata_TechLibrary_SRS_v1.0_2026-10-21.docx"
DESIGN = DOC / "Arata_TechLibrary_Engineering_Design_Package_v1.0"
CONTRACT = DOC / "Arata_TechLibrary_Step1_Implementation_Contracts_v1.0"
WIREFRAME = DOC / "Arata_TechLibrary_Wireframe_v3.1"
ID_RE = re.compile(r"^(?:FR-[A-Z]+|NFR-[A-Z]+|RAI-[A-Z]+|BR|DR|INT|SEC)-\d{3}$")
VERIFICATION_RE = re.compile(r"\s*\[Verification:\s*(.*?)\]\s*$")

MODULES = {
    "FR-IAM": "Identity and access", "FR-CAT": "Catalogue and discovery",
    "FR-PUB": "Publishing", "FR-AST": "Assets and rights",
    "FR-ENT": "Entitlements and policy", "FR-RDR": "Reader",
    "FR-LRN": "Learning", "FR-OFL": "Offline and sync",
    "FR-PAY": "Commerce", "FR-INS": "Institutions",
    "FR-SRC": "Search", "FR-OPS": "Operations and notifications",
    "FR-AI": "Advanced learning", "RAI-COL": "Research collection",
    "RAI-ANA": "Research analysis", "RAI-PUB": "Research publication",
    "DR": "Data architecture", "INT": "Integration architecture",
    "NFR-PER": "Performance", "NFR-UX": "Accessibility and UX",
    "NFR-OPS": "Operations and resilience", "SEC": "Security",
}

# Physical anchors, not claims that service behavior is implemented. Every name
# below is checked against the current Prisma schema before files are written.
MODELS = {
    "FR-IAM": "User;UserProfile;AuthSession;Authenticator;VerificationToken;Role;RoleAssignment;PrivacyPreference",
    "FR-CAT": "Collection;Publication;Volume;Edition;Revision;Resource",
    "FR-PUB": "Publication;Volume;Edition;Revision;Chapter;Lesson;EditorialReview;Asset",
    "FR-AST": "Asset;Resource;ResourceAttachment;ContentPolicy",
    "FR-ENT": "Entitlement;EntitlementEvent;ContentPolicy;PolicyChange;GrantApproval",
    "FR-RDR": "Revision;Chapter;Lesson;ReadingProgress;Bookmark;Annotation;ContentPolicy",
    "FR-LRN": "Lesson;Quiz;QuizQuestion;QuizAttempt;QuizAnswer;Project;ProjectSubmission;ReadingProgress",
    "FR-OFL": "OfflineLicence;SyncOperation;Entitlement;ContentPolicy",
    "FR-PAY": "Plan;PlanVersion;Subscription;TrialUsage;Order;PaymentAttempt;GatewayEvent;Invoice;Refund;ReconciliationRun;ReconciliationItem",
    "FR-INS": "Institution;InstitutionDomain;Membership;EligibilityPolicy;EligibilityReview;Cohort;CohortMember",
    "FR-SRC": "Publication;Revision;Resource",
    "FR-OPS": "User;Notification;AuditEvent;ApprovalRequest;SubjectRequest",
    "FR-AI": "Lesson;ResearchEvent;PrivacyPreference",
    "RAI-COL": "PseudonymLink;ResearchEvent;ResearchSession;PrivacyPreference;RetentionPolicy",
    "RAI-ANA": "ResearchEvent;ResearchSession;ResearchMetric;ResearchAggregate",
    "RAI-PUB": "ResearchStudy;ResearchReport;DisclosureReview;PublicInsight;ResearchExport;ResearchAudit",
    "DR": "User;Publication;Entitlement;PaymentAttempt;ResearchEvent;AuditEvent",
    "INT": "OutboxEvent;GatewayEvent;Notification;Asset",
    "NFR-PER": "N/A (service and deployment)",
    "NFR-UX": "N/A (web interface)",
    "NFR-OPS": "AuditEvent;OutboxEvent;RetentionPolicy",
    "SEC": "User;AuthSession;RoleAssignment;AuditEvent;ApprovalRequest",
}

BR_MAP = {
    1: ("Entitlements and policy", "Resource;Entitlement", "S08", "R1"),
    2: ("Entitlements and policy", "Resource;Entitlement", "S08", "R1"),
    3: ("Publishing", "Revision;Entitlement", "S06", "R1"),
    4: ("Entitlements and policy", "Entitlement;ContentPolicy", "S08", "R1"),
    5: ("Institutions", "Institution;Membership;Entitlement", "S13", "R1"),
    6: ("Institutions", "InstitutionDomain;Membership", "S13", "R1"),
    7: ("Commerce", "Subscription;Entitlement", "S12", "R1"),
    8: ("Commerce", "GatewayEvent;PaymentAttempt;Subscription", "S12", "R1"),
    9: ("Entitlements and policy", "ContentPolicy;Entitlement", "S08", "R1"),
    10: ("Entitlements and policy", "ContentPolicy;PolicyChange", "S08", "R1"),
    11: ("Assets and rights", "ContentPolicy;Asset", "S07", "R1"),
    12: ("Assets and rights", "Asset;ResourceAttachment", "S07", "R1"),
    13: ("Research publication", "PublicInsight;DisclosureReview", "S18", "R2"),
    14: ("Institutions", "InstitutionDomain;ApprovalRequest", "S13", "R1"),
    15: ("Publishing", "Revision;Asset;EditorialReview", "S06", "R1"),
    16: ("Offline and sync", "OfflineLicence;SyncOperation", "S10", "R1"),
    17: ("Institutions and reader", "ReadingProgress;Annotation;Membership", "S13", "R1"),
    18: ("Research publication", "DisclosureReview;PublicInsight;ApprovalRequest", "S18", "R2"),
}
BR_SCREENS = {
    11: "content-policy;reader", 12: "asset-upload;licensing",
    13: "research-disclosure;public-insights", 14: "institution-policies;roles-admin",
    15: "revision-history-admin;review-queue", 17: "notes;institution-portal",
    18: "research-disclosure;research-approvals;public-insights",
}
BR_API = {
    1: "/api/v1/reader/lessons/{id}", 2: "/api/v1/reader/lessons/{id}",
    3: "/api/v1/reader/lessons/{id}", 4: "/api/v1/reader/lessons/{id}",
    5: "/api/v1/institutional/eligibility/check", 6: "/api/v1/institutional/eligibility/check",
    7: "/api/v1/me/subscriptions/{id}/cancel", 8: "/api/v1/payments/webhooks/{provider}",
    9: "/api/v1/resources/{id}/download", 10: "/api/v1/admin/content-policies",
    11: "/api/v1/resources/{id}/download", 12: "/api/v1/resources/{id}/download",
    13: "/api/v1/public/insights", 14: "/api/v1/admin/institutions/{id}/domains",
    15: "/api/v1/admin/revisions/{id}/publish", 16: "/api/v1/reader/offline-licenses",
    17: "/api/v1/me/annotations", 18: "/api/v1/public/insights",
}

# An explicit primary SRS anchor for screens the design backlog left unlinked.
# The screen may also serve other requirements; this is not a claim of delivered UI.
SCREEN_ANCHORS = {
    "volume-detail": "FR-CAT-003", "edition-history": "FR-PUB-012",
    "free-library": "FR-CAT-006", "resource-detail": "FR-AST-002",
    "search": "FR-SRC-001", "pricing": "FR-PAY-002",
    "legal": "FR-IAM-001", "profile": "FR-IAM-007",
    "privacy": "FR-IAM-007", "my-notifications": "FR-OPS-002",
    "my-sessions": "FR-IAM-009", "code-lab": "FR-LRN-005",
    "quiz": "FR-LRN-002", "projects": "FR-LRN-008",
    "roadmap": "FR-LRN-009", "achievements": "FR-LRN-010",
    "my-subscription": "FR-ENT-004", "checkout": "FR-PAY-003",
    "support": "FR-OPS-005", "ai-tutor": "FR-AI-001",
    "cohort-manager": "FR-INS-006", "classroom": "FR-LRN-012",
    "edition-editor": "FR-PUB-003", "chapter-editor": "FR-PUB-005",
    "bulk-import": "FR-AST-007", "free-upload": "FR-AST-002",
    "release-schedule": "FR-PUB-010", "plans-admin": "FR-PAY-001",
    "finance-dashboard": "FR-PAY-018", "transactions": "FR-PAY-006",
    "invoices": "FR-PAY-009", "refunds": "FR-PAY-013",
    "promotion-codes": "FR-ENT-017", "research-cohorts": "RAI-ANA-007",
    "research-quality": "RAI-ANA-008", "research-studies": "RAI-ANA-009",
    "research-methodology": "RAI-ANA-004", "research-report": "RAI-ANA-010",
    "research-registry": "RAI-PUB-009", "research-exports": "RAI-ANA-012",
    "research-audit": "RAI-ANA-001", "system-health": "FR-OPS-006",
    "backups": "NFR-OPS-001", "privacy-requests": "FR-IAM-007",
    "feature-flags": "FR-OPS-008", "incidents": "NFR-OPS-005",
    "integrations": "INT-010",
}

CRITERION_OVERRIDES = {
    "FR-PAY-005": ("Pass when a gateway callback is authenticated under the configured provider API version and a server-to-server check confirms amount, currency, merchant reference and final status before settlement.", "Reject invalid signature, wrong merchant, mismatched amount/currency and pending status without granting access."),
    "FR-PAY-006": ("Pass when a repeated payment, refund or retry idempotency reference produces exactly one authoritative state transition and a stable result.", "Replay the same event concurrently and out of order; assert one financial and entitlement effect."),
    "FR-PAY-007": ("Pass when verified settlement and its purchase entitlement commit atomically, or both remain unapplied on failure.", "Simulate a transaction failure between payment and grant writes; assert no partial premium access."),
    "FR-INS-005": ("Pass when only a currently verified membership within its institution agreement receives a bounded entitlement.", "Reject expired, suspended, unapproved or out-of-scope membership while preserving independent paid access."),
    "FR-ENT-011": ("Pass when Allow, Watermark and Restricted notice states are accurately presented as screenshot deterrents and never promise OS-level blocking.", "Exercise each policy state in the reader and verify protected file access remains server-authorized."),
    "FR-OFL-011": ("Pass when offline messaging states that remote revocation takes effect only after reconnection or local licence expiry.", "Disconnect before server revocation and verify no claim of instant remote invalidation is shown."),
    "RAI-COL-006": ("Pass when optional research events enter analytical storage only under the approved, current purpose/lawful-basis decision.", "Withdraw consent or omit approved basis; verify optional events are not ingested and retention action is scheduled."),
    "RAI-PUB-003": ("Pass when every public subgroup meets the approved configured distinct-subject minimum and complementary suppression; no release occurs while the policy is unapproved.", "Test small groups, complementary totals and repeated overlapping cuts below the approved threshold."),
    "SEC-001": ("Pass when every protected read, write, file and derived rendition checks actor, object, action and current policy on the server.", "Attempt anonymous, cross-user, cross-institution and revoked-grant access by direct ID; verify denial and no data leak."),
    "BR-008": ("Pass when one verified gateway transaction extends a subscription at most once, including repeated and concurrent webhooks.", "Replay the same verified event and assert one period extension, one grant effect and preserved audit evidence."),
    "BR-011": ("Pass when client copy/print affordances and screenshot notices are treated as deterrents while protected content delivery is independently authorized on the server.", "Bypass browser controls and request the original or derived asset directly; verify unauthorized delivery is denied."),
    "BR-018": ("Pass when no external statistics snapshot publishes without a passing disclosure assessment and recorded authorized approval.", "Attempt publish without review, with failed review or with self-approval; verify denial and audit."),
}

# Primary SRS anchors for operations not linked by the Step 1 source backlog.
# Existing path links are preserved; operation semantics remain design-stage.
API_ANCHORS = {
    "/api/v1/auth/verify-email": "FR-IAM-002",
    "/api/v1/auth/password/reset-request": "FR-IAM-003",
    "/api/v1/auth/password/reset": "FR-IAM-003",
    "/api/v1/auth/sessions": "FR-IAM-009",
    "/api/v1/auth/sessions/{id}": "FR-IAM-009",
    "/api/v1/catalogue/publications/{id}/volumes": "FR-CAT-002",
    "/api/v1/catalogue/editions/{id}": "FR-CAT-003",
    "/api/v1/free-resources": "FR-CAT-006",
    "/api/v1/resources/{id}/open": "FR-ENT-001",
    "/api/v1/me/dashboard": "FR-RDR-001",
    "/api/v1/me/entitlements": "FR-ENT-004",
    "/api/v1/me/bookmarks": "FR-RDR-004",
    "/api/v1/me/bookmarks/{id}": "FR-RDR-004",
    "/api/v1/me/progress": "FR-RDR-006",
    "/api/v1/me/privacy-preferences": "FR-IAM-007",
    "/api/v1/reader/sync": "FR-OFL-007",
    "/api/v1/learning/projects": "FR-LRN-008",
    "/api/v1/plans": "FR-PAY-002",
    "/api/v1/orders": "FR-PAY-003",
    "/api/v1/me/invoices": "FR-PAY-009",
    "/api/v1/admin/volumes/{id}/editions": "FR-PUB-003",
    "/api/v1/admin/editions/{id}/revisions": "FR-PUB-004",
    "/api/v1/admin/revisions/{id}/chapters": "FR-PUB-005",
    "/api/v1/admin/revisions/{id}/submit-review": "FR-PUB-008",
    "/api/v1/admin/revisions/{id}/approve": "FR-PUB-008",
    "/api/v1/admin/resource-attachments": "FR-PUB-014",
    "/api/v1/admin/content-policies/{id}": "FR-ENT-007",
    "/api/v1/admin/institution-memberships/{id}/review": "FR-INS-008",
    "/api/v1/admin/cohorts": "FR-INS-006",
    "/api/v1/admin/plans": "FR-PAY-001",
    "/api/v1/admin/orders": "FR-PAY-015",
    "/api/v1/admin/research/reports": "RAI-ANA-010",
    "/api/v1/admin/research/exports": "RAI-ANA-012",
    "/api/v1/admin/research/publications": "RAI-PUB-001",
    "/api/v1/admin/research/publications/{id}/review": "RAI-PUB-003",
    "/api/v1/admin/research/publications/{id}/approve": "RAI-PUB-008",
    "/api/v1/admin/research/publications/{id}/release": "RAI-PUB-001",
    "/api/v1/admin/research/publications/{id}/withdraw": "RAI-PUB-010",
    "/api/v1/public/insights/{id}": "RAI-PUB-011",
    "/api/v1/public/statistics/library-overview": "RAI-PUB-012",
    "/api/v1/public/statistics/popular-resources": "RAI-PUB-012",
}


def rows(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def csv_bytes(records: list[dict[str, str]], fields: list[str]) -> bytes:
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=fields, lineterminator="\n")
    writer.writeheader()
    writer.writerows(records)
    return stream.getvalue().encode("utf-8")


def srs_requirements() -> dict[str, tuple[str, str]]:
    found: dict[str, tuple[str, str]] = {}
    for table in Document(SRS).tables:
        head = [c.text.strip() for c in table.rows[0].cells]
        if head[:2] == ["ID / TARGET", "TESTABLE REQUIREMENT"]:
            for row in table.rows[1:]:
                label = row.cells[0].text.strip()
                ident = label.splitlines()[0].strip()
                if not ID_RE.fullmatch(ident) or ident in found:
                    raise ValueError(f"invalid or duplicate SRS ID: {ident}")
                target = " ".join(label.splitlines()[1:]).strip()
                found[ident] = (target, " ".join(row.cells[1].text.split()))
        elif head[:2] == ["Rule ID", "Decision invariant"]:
            for row in table.rows[1:]:
                ident = row.cells[0].text.strip()
                if not ID_RE.fullmatch(ident) or ident in found:
                    raise ValueError(f"invalid or duplicate SRS business rule: {ident}")
                found[ident] = ("Feature-dependent invariant", " ".join(row.cells[1].text.split()))
    return found


def main(check: bool) -> None:
    source = srs_requirements()
    if len(source) != 287 or sum(k.startswith("BR-") for k in source) != 18:
        raise ValueError(f"unexpected SRS requirement count: {len(source)}")
    baseline = rows(DESIGN / "requirements_baseline.csv")
    baseline_ids = {r["requirement_id"] for r in baseline}
    if len(baseline) != 269 or baseline_ids != {k for k in source if not k.startswith("BR-")}:
        raise ValueError("engineering baseline differs from SRS IDs")
    if any(" ".join(r["requirement"].split()) != source[r["requirement_id"]][1] for r in baseline):
        raise ValueError("engineering baseline text differs from SRS requirements")

    screens = rows(WIREFRAME / "screen_inventory.csv")
    screen_ids = {r["screen_id"] for r in screens}
    if len(screens) != 90 or len(screen_ids) != 90:
        raise ValueError("wireframe screen inventory is not 90 unique IDs")
    design_screens = rows(DESIGN / "wireframe_inventory.csv")
    if {tuple(sorted(row.items())) for row in design_screens} != {tuple(sorted(row.items())) for row in screens}:
        raise ValueError("engineering and wireframe screen inventories differ")
    js = (WIREFRAME / "app.js").read_text(encoding="utf-8")
    js_screen_ids = set(re.findall(r"\['([^']+)','[^']+','[^']+','R[123]'\]", js.split("const META =", 1)[0]))
    if js_screen_ids != screen_ids:
        raise ValueError(f"wireframe navigation differs from inventory: {js_screen_ids ^ screen_ids}")

    api = yaml.safe_load((CONTRACT / "openapi_contracts.yaml").read_text(encoding="utf-8"))
    operations = [(path, method.upper(), value) for path, item in api["paths"].items()
                  for method, value in item.items() if method in {"get", "post", "put", "patch", "delete"}]
    if len(operations) != 102:
        raise ValueError(f"unexpected OpenAPI operation count: {len(operations)}")
    design_api = yaml.safe_load((DESIGN / "openapi_design.yaml").read_text(encoding="utf-8"))
    design_operations = {(path, method) for path, item in design_api["paths"].items()
                         for method in item if method in {"get", "post", "put", "patch", "delete"}}
    if design_operations != {(path, method.lower()) for path, method, _ in operations}:
        raise ValueError("engineering and Step 1 OpenAPI method/path inventories differ")
    api_paths = {path for path, _, _ in operations}
    operation_by_path: dict[str, list[str]] = defaultdict(list)
    for path, method, _ in operations:
        operation_by_path[path].append(method)
    models = set(re.findall(r"(?m)^model (\w+) \{", (ROOT / "prisma/schema.prisma").read_text(encoding="utf-8")))
    if len(models) != 75:
        raise ValueError(f"unexpected Prisma model count: {len(models)}")

    prior = rows(OUT / "REQUIREMENT_TRACEABILITY.csv")
    prior_by_id = {r["requirement_id"]: r for r in prior}
    if len(prior) != 287 or set(prior_by_id) != set(source):
        raise ValueError("existing implementation tracker differs from SRS IDs")
    design_by_id = {r["requirement_id"]: r for r in rows(CONTRACT / "traceability.csv")}
    if set(design_by_id) != baseline_ids:
        raise ValueError("Step 1 traceability differs from the SRS tagged IDs")

    matrix: list[dict[str, str]] = []
    criteria: list[dict[str, str]] = []
    for ident, prior_row in prior_by_id.items():
        target, requirement = source[ident]
        family = ident.rsplit("-", 1)[0]
        if family == "BR":
            number = int(ident[-3:])
            module, db_models, sprint, release = BR_MAP[number]
            screen_value = BR_SCREENS.get(number, prior_row["wireframe_ids"])
            candidate_paths = BR_API[number]
            priority = f"No separate SRS priority; proposed {release} association"
        else:
            module = MODULES[family]
            db_models = MODELS[family]
            design_row = design_by_id[ident]
            sprint = design_row["existing_sprint"]
            release = re.search(r"R[123]", target).group(0)
            source_priority = re.search(r"P[012]", target).group(0)
            priority = f"{source_priority} / {release}"
            screen_value = design_row["screen_ids"]
            candidate_paths = design_row["api_paths"]
        for name in db_models.split(";"):
            if name and not name.startswith("N/A") and name not in models:
                raise ValueError(f"{ident} maps missing Prisma model {name}")
        anchored = [screen for screen, owner in SCREEN_ANCHORS.items() if owner == ident]
        screen_value = ";".join(dict.fromkeys([*filter(None, screen_value.split(";")), *anchored]))
        used_screens = [x for x in screen_value.split(";") if x]
        if any(x not in screen_ids for x in used_screens):
            raise ValueError(f"{ident} maps an unknown screen: {used_screens}")
        candidate = [*filter(None, candidate_paths.split(";")),
                     *(path for path, owner in API_ANCHORS.items() if owner == ident)]
        candidate = list(dict.fromkeys(candidate))
        matched = [x for x in candidate if x in api_paths]
        missing = [x for x in candidate if x not in api_paths]
        api_state = "Route found; semantics provisional" if matched and not missing else "Partial route coverage" if matched else "Uncontracted" if missing else "No direct operation"
        stage = "Planned advanced" if release in {"R2", "R3"} else "MVP foundation" if sprint and int(sprint[1:]) <= 9 else "Production launch"
        body = VERIFICATION_RE.sub("", requirement).strip().rstrip(".")
        method_match = VERIFICATION_RE.search(requirement)
        method = method_match.group(1) if method_match else "Rule, authorization and boundary tests"
        normative_statement = False
        if body.lower().startswith("the system shall "):
            body = body[17:]
            normative_statement = True
        elif body.lower().startswith("the platform shall "):
            body = body[19:]
            normative_statement = True
        if normative_statement:
            criterion = f"Pass when the delivered system is observed to {body[0].lower() + body[1:]}."
        else:
            criterion = f"Pass when {body[0].lower() + body[1:]}."
        lower = requirement.lower()
        if any(token in lower for token in ("never", "reject", "deny", "only", "without", "cannot", "no ")):
            boundary = "Exercise the prohibited or unauthorised counterpart and verify denial without unintended disclosure."
        elif any(token in lower for token in ("expir", "valid", "time", "renew", "retention")):
            boundary = "Exercise before, at and after the configured time or validity boundary."
        elif family.startswith("NFR"):
            boundary = "Measure the stated threshold or quality condition under its defined test environment."
        else:
            boundary = "Exercise an invalid input, unavailable dependency or empty state relevant to this behavior."
        if ident == "BR-006":
            boundary = "Accept an approved exact domain or explicit subdomain; reject evil-example.edu suffix matching."
        if ident == "BR-008":
            boundary = "Replay the same verified gateway transaction and verify one subscription extension."
        if ident == "BR-016":
            boundary = "Disconnect a licensed device and verify the UI does not claim immediate remote revocation."
        if ident in CRITERION_OVERRIDES:
            criterion, boundary = CRITERION_OVERRIDES[ident]
        test_id = f"T-{ident}"
        criteria.append({"requirement_id": ident, "test_id": test_id, "acceptance_criterion": criterion,
                         "boundary_or_negative_case": boundary, "evidence_method": method,
                         "execution_status": "Not run; criterion needs scenario refinement before implementation"})
        matrix.append({
            "requirement_id": ident, "source": "ATL-SRS-001 v1.0 §8.1" if family == "BR" else prior_row["source"], "priority_release": priority,
            "delivery_stage": stage, "planned_sprint": sprint, "module": module,
            "srs_requirement": requirement, "wireframe_ids": screen_value or "N/A (no dedicated screen)",
            "screen_mapping_status": "Source candidate plus reviewed anchor" if anchored else "Source candidate; inspect workflow" if used_screens else "No dedicated screen",
            "api_operations": ";".join(f"{'/'.join(operation_by_path[p])} {p}" for p in matched) or "N/A (no contracted operation)",
            "uncontracted_api_candidates": ";".join(missing), "api_mapping_status": api_state,
            "database_models": db_models, "database_mapping_status": "Physical anchor; service behavior open" if not db_models.startswith("N/A") else "No direct table",
            "acceptance_test_id": test_id, "acceptance_reference": "ACCEPTANCE_CRITERIA.csv",
            "implementation_paths": prior_row["implementation_paths"],
            "implementation_status": prior_row["implementation_status"],
            "verification_result": prior_row["verification_result"],
            "mapping_note": "Proposed invariant mapping; service and end-to-end acceptance remain open" if family == "BR" else prior_row["mapping_note"],
        })

    navigation: list[dict[str, str]] = []
    outbound: dict[str, set[str]] = defaultdict(set)
    for match in re.finditer(r"case\s*'([^']+)'\s*:", js):
        ident = match.group(1)
        if ident not in screen_ids:
            continue
        end = re.search(r"\bcase\s*'|\bdefault\s*:", js[match.end():])
        segment = js[match.end():match.end() + end.start()] if end else js[match.end():]
        for target in re.findall(r"data-route=\\?['\"]([\w-]+)|\blink\(['\"]([\w-]+)", segment):
            to = target[0] or target[1]
            if to in screen_ids and to != ident:
                outbound[ident].add(to)
    inbound: dict[str, set[str]] = defaultdict(set)
    for source_id, targets in outbound.items():
        for target in targets:
            inbound[target].add(source_id)
    global_routes = {"home", "catalogue", "free-library", "pricing", "eligibility", "search", "my-notifications", "bookshelf", "login"}
    requirements_by_screen: dict[str, list[str]] = defaultdict(list)
    for row in matrix:
        for ident in row["wireframe_ids"].split(";"):
            if ident in screen_ids:
                requirements_by_screen[ident].append(row["requirement_id"])
    if set(requirements_by_screen) != screen_ids:
        raise ValueError(f"unlinked wireframe screens: {screen_ids - set(requirements_by_screen)}")
    for screen in screens:
        ident = screen["screen_id"]
        anchor = SCREEN_ANCHORS.get(ident, requirements_by_screen[ident][0])
        anchor_release = re.search(r"R[123]", next(row["priority_release"] for row in matrix if row["requirement_id"] == anchor)).group(0)
        release_alignment = "Screen precedes anchored SRS feature" if int(screen["release"][1:]) < int(anchor_release[1:]) else "Aligned or screen later"
        navigation.append({**screen,
                           "primary_entry": "Screen Explorer; URL #" + ident,
                           "app_shell_entry": "Header/mobile navigation" if ident in global_routes else "Group index or contextual link",
                           "contextual_from_static_source": ";".join(sorted(inbound[ident])) or "Not found by static case extraction",
                           "contextual_to_static_source": ";".join(sorted(outbound[ident])) or "Not found by static case extraction",
                           "prototype_states": "normal;empty;loading;error;access denied;offline",
                           "related_requirements": ";".join(requirements_by_screen[ident]),
                           "primary_requirement_anchor": anchor,
                           "release_alignment": release_alignment,
                           "navigation_evidence": "Static app.js case extraction; runtime actions need manual review"})

    api_audit = []
    source_path_counts = Counter(path for row in design_by_id.values() for path in row["api_paths"].split(";") if path)
    for path, method, operation in operations:
        security = operation.get("security")
        request = operation.get("requestBody", {})
        responses = operation.get("responses", {})
        api_audit.append({"method": method, "path": path, "operation_id": operation["operationId"],
                          "tag": ";".join(operation.get("tags", [])),
                          "contract_state": operation.get("x-contract-status", "draft DTO; needs implementation review"),
                          "security_declared": "yes" if security else "no",
                          "authorization_note": operation.get("x-authorization-policy", ""),
                          "request_body_declared": "yes" if request else "no",
                          "response_codes": ";".join(map(str, responses)),
                          "source_requirement_count": str(source_path_counts[path]),
                          "mapped_requirement_count": str(sum(path in row["api_operations"] for row in matrix)),
                          "implementation_status": "Design only; no API service"})
    if any(int(row["mapped_requirement_count"]) == 0 for row in api_audit):
        raise ValueError("an OpenAPI operation has no SRS anchor")
    if len({row["requirement_id"] for row in criteria}) != len(source) or len({row["test_id"] for row in criteria}) != len(source):
        raise ValueError("acceptance criteria or test IDs are missing or duplicated")
    if any(not row["acceptance_criterion"] or not row["boundary_or_negative_case"] or not row["evidence_method"] for row in criteria):
        raise ValueError("an acceptance criterion lacks an outcome, boundary or evidence method")

    files = {
        "REQUIREMENT_TRACEABILITY.csv": csv_bytes(matrix, list(matrix[0])),
        "ACCEPTANCE_CRITERIA.csv": csv_bytes(criteria, list(criteria[0])),
        "SCREEN_NAVIGATION.csv": csv_bytes(navigation, list(navigation[0])),
        "API_CONTRACT_AUDIT.csv": csv_bytes(api_audit, list(api_audit[0])),
    }
    for name, data in files.items():
        path = OUT / name
        if check:
            if not path.exists() or path.read_bytes() != data:
                raise ValueError(f"generated file differs: {path}")
        else:
            path.write_bytes(data)
    counts = Counter(row["delivery_stage"] for row in matrix)
    api_counts = Counter(row["api_mapping_status"] for row in matrix)
    print(f"validated {len(source)} SRS IDs, {len(screens)} screens, {len(operations)} API operations, {len(models)} Prisma models")
    print("delivery stages:", dict(counts))
    print("API mappings:", dict(api_counts))
    print("specific DTO gaps:", sum(op["contract_state"] == "requires-specific-DTO" for op in api_audit))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="compare generated records without writing")
    main(parser.parse_args().check)
