# Arata TechLibrary repository instructions

## Source of truth

- Work from `Documentation/Arata_TechLibrary_SRS_v1.0_2026-10-21.docx` as the requirements baseline for this project. Its formal stakeholder sign-off is still pending; do not claim approval.
- Use `Documentation/Arata_TechLibrary_Step1_Implementation_Contracts_v1.0/` for detailed technical contracts, `Documentation/Arata_TechLibrary_Engineering_Design_Package_v1.0/` for architecture and planning, and `Documentation/Arata_TechLibrary_Wireframe_v3.1/` for UI reference.
- Preserve every SRS requirement, including the 18 `BR-*` invariants omitted from the source traceability exports. For a conflict, record the exact sources and resolution in `Documentation/Implementation/DECISIONS.md`; preserve the SRS and choose the safest standards-compliant interpretation when business approval is not indispensable.
- Treat prototypes, design-stage OpenAPI, candidate Prisma schema, proposed defaults, and sample data as unimplemented until verified in the application.

## Delivery and architecture

- Build a strict TypeScript React/Vite/Tailwind accessible PWA and modular NestJS REST API with OpenAPI, PostgreSQL/Prisma migrations, a worker, private object storage, and Docker-based reproducible development. Keep domain boundaries explicit.
- Enforce server-side object and action authorization, least privilege, verified payment events, safe upload quarantine and scanning, audit logging, validated input, CSRF protection where applicable, rate limits, and privacy controls. Target OWASP ASVS and WCAG 2.2 AA.
- Keep public-free material accessible without a subscription, keep independent grants additive, and keep research data private until a reviewed aggregate snapshot is approved. Browser controls cannot guarantee screenshot or copy prevention.
- Do not invent production content, prices, legal decisions, eligibility, payment capabilities, secrets, or successful tests. Label development samples clearly.

## Working procedure

- Before a task, check repository status, relevant SRS IDs, implementation contracts, and wireframe screens. Update `Documentation/Implementation/REQUIREMENT_TRACEABILITY.csv` for implementation paths and verification.
- For each completed task, update `PROGRESS.md`, `SPRINT_STATUS.md`, `TEST_RESULTS.md`, and relevant decisions/blockers with requirement IDs, screen IDs or `N/A`, paths, tests, and results. Keep incomplete work visibly incomplete.
- Run relevant unit, integration, E2E, authorization, accessibility, and security checks for changed behavior. Record commands and outcomes. Do not describe a design contract or unrun test as a working feature.
- Check Git history and working tree before changes. Preserve existing commits and unrelated work. Use descriptive conventional commits after passing applicable checks, then push and verify the remote ref. Use a feature branch and PR when branch protection or team workflow requires it. Never force-push.
- The supplied SRS identifies itself as an internal specification and the current GitHub repository is public. Do not stage the source specification packages or other private material for this public remote without explicit publication authorization. Never commit credentials or `.env` secrets.
- Request approval only for irreversible/destructive, production-impacting, secret-dependent, or material business decisions that cannot be safely defaulted. Record unresolved decisions and continue independent work.
