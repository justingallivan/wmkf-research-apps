---
name: project-institution-identity-cost-calibration
description: Owner cost model — institution-name errors are cheap at display/alert tier (reviewer self-corrects); person-identity binding stays high-stakes
metadata: 
  node_type: memory
  type: project
  status: active
  scope: reviewer
  last_verified: 2026-08-19 (owner accepted source-aware conditional neutrality for the typed Stage 2 contract)
  originSessionId: 363a2e80-2dd8-483e-9088-3193c321799e
  modified: 2026-08-19T00:00:00.000Z
---

## Recall Rule

Read before changing reviewer institution-mismatch thresholds, Stage 2 relationship
policy, or any person-identity write gate. Display-tier institution errors are cheap;
wrong-person persistence is not.

Owner calibration (2026-08-09, Session 409 follow-on): institution names are
not business-critical ("we aren't doing tax stuff"). Reviewers are asked to
correct wrong info and fill in departmental detail themselves, so
Harvard/HMS/Beth-Israel-class conflations and even UCSD-vs-University-of-San-
Diego mixups at the DISPLAY/ALERT tier get shrugged off and fixed by the
reviewer. False clears there are cheap; every SURFACED pair costs the staff
clicking the pair-consistency work exists to eliminate.

`[VERIFIED via docs/INSTITUTION_PAIR_CONSISTENCY_RESOLUTION_PLAN.md,
benchmarks/institution-pair-consistency/results/wave6-enrichment-flip-2026-08-09.json,
and lib/services/workbench/enrich-recommended-service.js, 2026-08-19]` The
owner calibration, frozen-40 safety result, additive comparison seam, and
unchanged person-identity gate remain aligned. The 2026-08-19 owner decision
adds conditional neutrality: unresolved affiliation evidence is neutral when
non-affiliation identity authority is independently sufficient; otherwise the
workflow holds with an identity remedy.

**Why:** the original problem statement ([[institution-pair-consistency]]
plan) was human effort spent on verify-and-cite clicking. A cost model that
over-surfaces recreates the problem it was solving.

**How to apply:**
- At the alert tier, precision-hardening beyond Stage 1 Wave 4 is
  deprioritized; the stop-rule in
  docs/INSTITUTION_PAIR_CONSISTENCY_RESOLUTION_PLAN.md stands.
- Stage 2 relationship truth must not embed a consumer action. The display and
  alert policies should avoid manufactured review prompts for aliases,
  parent/child relationships, additional affiliations, historical differences,
  and unresolved comparisons. Sibling entities still never collapse to the
  same organization.
- The backstop does NOT extend to person-identity binding (enrichment /
  works-first): reviewers can't see or correct a wrong-person publication
  bind. Decision 3's gate discipline held: the one enrichment-comparison
  change since (Wave 6 composite, production 2026-08-09 — seam clears when
  legacy OR staged checker clears, strictly additive) shipped only after a
  frozen-40 rerun identical to baseline (falseBinds 0), and the
  `identityConfirmed` write-gate conjunction is untouched. A seam stop-rule
  (owner-directed) now forbids further iteration there; findings route to
  Stage 2 typed relationships. At high-authority consumers, conditional
  neutrality is permitted only when the sufficiency calculation excludes the
  affiliation assertion being adjudicated; circular affiliation authority is
  forbidden.
