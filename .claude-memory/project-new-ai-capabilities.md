---
name: AI capabilities — matching and compliance
description: Standalone Expertise Finder retirement is built; Dataverse roster/Admin remain live. Backend matching is separate. Compliance status requires a fresh check.
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
- Recheck Compliance Screening source and owner priority; its absence was last checked July 27, not established currently.

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
