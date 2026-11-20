---
name: project-program-field-retired-use-grant-program
description: "Owner, 2026-11-19: the request Program field (_akoya_programid_value: Science and Engineering / Medical Research) is being retired for deciding J27+ Research membership; use the Grant program (_wmkf_grantprogram_value), as the Workbench does."
metadata:
  type: project
  status: active
---

## Recall Rule
Read before writing or changing any J27-or-later filter, count or eligibility rule that decides whether a request is "Research".

Do: select Research by `_wmkf_grantprogram_value` through the Workbench readiness-only scope (`resolveDiscoveryScope` in `lib/services/workbench/program-scope-service.js`, `buildDiscoveryFilter` in `shared/config/workbenchVisibility.js`). Treat any J27+ rule that still reads `_akoya_programid_value` for membership as suspect and raise it with the owner.

Do not: rewrite every remaining `_akoya_programid_value` reader without asking; pre-2027 cycles were filed under the Program field, and the owner decision covered "these purposes" (deciding membership), not a repo-wide removal.

**Why:** In the first Production rehearsal of proposal lists, Scored J27 test request 1003528 had Grant program Research but a blank Program field, so the Program-field filter silently left it off the list. Owner: "We are moving away from the Program field for these purposes so they probably shouldn't play a part in the 'decision making' process." Fixed for proposal lists in PR #658.

**How to apply:** Ground truth is `lib/services/proposal-lists/list-snapshot-service.js` (2027+ branch) and `docs/plans/J27_PROPOSAL_LIST_EMAILS_PLAN_2026-11-18.md` ("Which proposals are listed"). Related: [[feedback-keep-the-owners-named-input-source]].
