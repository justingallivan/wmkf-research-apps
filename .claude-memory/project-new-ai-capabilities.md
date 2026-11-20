---
name: AI capabilities — matching and compliance
description: Standalone Expertise Finder retirement is production-live; Dataverse roster/Admin remain live. Backend matching is separate. Compliance screening will not be built in the app (owner, 2026-11-20).
type: project
status: active
scope: strategy
last_verified: 2026-11-19 via retirement source and production migration report
---

## Recall Rule

Read this when planning staff/consultant/Board proposal matching or compliance screening.

Do:
- Read `docs/plans/EXPERTISE_FINDER_RETIREMENT_2026-11-19.md` for retirement release status.
- Use the production Dataverse roster contract in `docs/plans/EXPERTISE_ROSTER_CONNOR_HANDOFF_2026-11-19.md`.
- Keep backend matching in Connor's flow separate from the retired standalone app.
- Compliance Screening is not an app capability (owner decision 2026-11-20). Connor's planned step 3 writes advisory compliance fields; staff do not set `wmkf_readyforreview` on a non-compliant application, and the app requires that flag for most J27 surfaces. See `docs/POWER_AUTOMATE_RESEARCH_INTAKE_FLOWS.md` section 9 items 4 and 8. Do not propose an app compliance screen.

Do not:
- Restore standalone matching as part of roster maintenance.
- Treat `modules/expertise_matching` as production; it is an isolated reference/demo.
- Infer that Connor's replacement flow is live from the completed roster migration.

Ground truth: `pages/expertise-finder.js` (retirement notice), `shared/config/appRegistry.js`,
`pages/api/admin/expertise-roster.js`, and `docs/atlas/dataverse-wmkf-expertiseprofile.md`.
Historical matching implementation is under `_archived/pages/api/expertise-finder/`;
its prompt is `_archived/shared/config/prompts/expertise-finder-dynamics.js`.

Historical proposals included full-PDF/text-only compliance screening, criteria-based
reasoning, and batch evaluation against past proposals before Power Automate adoption.
Those proposals do not authorize an implementation or establish current architecture.
