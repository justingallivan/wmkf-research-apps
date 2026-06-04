---
name: D26 reviewer-inputs ground truth (S209 probe)
description: Live-data probe of the 35 D26 allowlist requests — existing reviewer candidates, legacy slot population, and excluded-reviewer free-text shape. Grounds the Workbench Phase 2 smoke + Phase 3 ingestion.
metadata:
  type: project
  status: stale
  scope: reviewer
  last_verified: S209 (2026-05-31) via memory-content (not re-probed 2026-06-04)
---

## Recall Rule

Read this when: planning a Workbench reviewer smoke/validation against D26 requests, or building Phase 3 applicant-reviewer ingestion (excluded-reviewer parsing, legacy-slot materialization).

Do:
- Expect D26 requests to have NO `wmkf_appreviewersuggestion` candidates — use an older Phase II cycle via the standalone Review Manager for meaningful Manage-panel validation.
- Treat excluded-reviewer free-text as heterogeneous (structured blocks AND prose with embedded affiliations) and null-equivalent noise ("N/A", "none") as empty.
- Re-run `scripts/probe-d26-reviewer-inputs.js` before relying on these counts — this is a point-in-time probe snapshot, not live state.

Do not:
- Assume D26 Invite/Track/Completed panels will render data — they were empty as of the probe.
- Assume one excluded-text format; the parser must pull names out of prose.

Ground truth: probe `scripts/probe-d26-reviewer-inputs.js`; `docs/REQUEST_WORKBENCH_BUILD_PLAN.md`; structural Dataverse facts (slots, suggestion rows, statuses) should be re-probed, not trusted from this memory — see `../docs/APPLICATION_STATE_ATLAS.md`.

Read-only probe `scripts/probe-d26-reviewer-inputs.js` against prod Dataverse on 2026-05-31, over all 35 D26 allowlist requests ([[project-reviewer-apps-redesign-direction]] Workbench build, `docs/REQUEST_WORKBENCH_BUILD_PLAN.md`):

- **0 / 35 have any `wmkf_appreviewersuggestion` rows** — no candidates, none selected, none accepted. So during a Workbench browser smoke the Reviewers-tab **Invite/Track/Completed panels are all EMPTY** for every D26 request and the state-aware default lands on **Find** (which since S210 Phase 3 is the live in-panel search + applicant-reviewer ingestion, no longer a placeholder). The Phase 2 Manage panel therefore has **no live D26 data to render** — meaningful Manage-panel validation must use an older Phase II cycle via the standalone Review Manager (which does have accepted reviewers), not D26.
- **35 / 35 have all 5 `wmkf_potentialreviewer1..5` slots populated** with real, distinct named persons (lookups → person GUIDs; spot-checked 1002836, 1003020, 1002912). Confirms the build plan's "user-attested: slots still in use this cycle" with data: Phase 3 ingestion has up to 35×5 = **~175 applicant-recommended persons** to materialize as `disposition=recommended` junction rows.
- **12 / 35 have `wmkf_excludedreviewers` free-text, but only ~5-6 are substantive.** The rest are null-equivalent noise ("N/A", "N/a", "N/A.", "none"). The Phase 3 parser MUST treat those as empty.
- **Excluded free-text format is heterogeneous** — no single shape. Examples: 1003020 uses structured "Name: <x>\nReason for Exclusion: <y>" blocks (3 names); 1002912 uses prose "exclude Drs. Thomas K. Wood (Pennsylvania State University) and Jens Hör (Helmholtz Institute)". The "confident match" name-extraction (build plan Phase 3) can't assume one format and must pull names out of prose with embedded affiliations.

All 35 are still `akoya_requeststatus = 'Phase I Pending'` (consistent with the allowlist's reason for existing). See [[project-intake-portal-reviewer-capture]] for the going-forward intake-portal write path that deprecates these slots.
