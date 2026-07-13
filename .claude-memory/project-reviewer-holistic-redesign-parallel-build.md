---
name: project-reviewer-holistic-redesign-parallel-build
description: The reviewer finding/identity redesign is PARKED pending owner go. The reconciled plan now separates current-safety containment from the long-lived experiment: C0 may promote independently to main after an explicit owner decision; M1 through F2 accumulate on a dedicated branch against a frozen main commit; destructive D1 cleanup happens only after a successful controlled pilot and promotion decision.
metadata:
  type: project
  status: active
  scope: reviewer
  last_verified: 2026-07-12 via controlling comparison memo, live contract audit, and reconciled implementation plan
---

## Recall Rule

Read this when planning or starting reviewer-finding work
(`lib/services/discovery/`, the discovery facade) or reviewer identity work
(`reviewer-identity-resolver.js`, `researcher.js` identity fields), or whenever
`docs/REVIEWER_HOLISTIC_REVIEW_IMPLEMENTATION_PLAN.md` is proposed for action.

## Current direction

The plan is **parked, not green-lit**. It has two execution lanes:

1. **C0 containment:** current save-boundary, correction, attestation-overwrite,
   and send-eligibility defects are built on a short-lived Tier-1 branch. The
   owner must explicitly decide whether verified containment promotes to main
   before the larger redesign or whether the continuing exposure is accepted.
2. **M1→F2 redesign experiment:** measurement, versioned identity binding,
   migration/fan-out, resolver hardening, finding experiments, and a controlled
   pilot accumulate one phase at a time on a dedicated testing branch. The
   comparison baseline is an exact frozen main commit plus frozen prompts,
   models, documents, exclusions, and rubric—not a moving branch name.
3. **D1 cleanup:** Track B or heuristic deletion is post-promotion work only.
   It contributes no experiment signal and must not reduce reversibility before
   the promote/stop decision.

## Required evidence model

- Identity confidence is not provenance. The durable contract separates
  binding source, version, canonical anchor, evidence lineage, correction, and
  action eligibility.
- Existing tests/eval scripts may seed fixture shapes but do not supply ground
  truth. The identity benchmark is independently labeled and adjudicated before
  A/B output is unblinded.
- The existing suggestion ledger supports an observational channel baseline,
  not a causal historical experiment: source tokens can overlap and current
  selected/engagement state is mutable.
- Offline A/B qualifies a limited controlled pilot; it cannot measure
  acceptance or review completion while the redesign remains off production.
- The staff decline-referral callout and Add-or-Refer handoff are already
  shipped. Measure conversion; do not rebuild them.

## Do

- Start with the plan's B0 owner/evaluation freeze.
- Keep C0 promotion separate from the redesign-branch decision.
- Build phases one at a time; do not batch the redesign into one opaque change.
- Preserve fail-closed identity reads and the no-COI-regating posture.
- Run `/contract-reconcile` for containment, binding/schema, and cross-layer
  phases; run `/sweep` for durable fact changes.
- Require raw-field consumer/projection fan-out before retiring
  `wmkf_identitystatus` as a trust signal.
- Use the plan's independently labeled identity gates, blinded proposal A/B,
  and controlled-pilot thresholds for promote/stop.

## Do not

- Do not start without the relevant owner gate.
- Do not treat the old P0→P4 sequence or a single
  `wmkf_identitybindingsource` column as the current plan.
- Do not let client-supplied nested identity state establish persistence or
  action eligibility.
- Do not infer self-report from legacy `confirmed`; unproven rows stay
  legacy/unbound until reviewed.
- Do not call mutable suggestion rows an immutable shortlist/panel history.
- Do not delete Track B or other retrieval/ranking code before the offline
  comparison, controlled pilot, and explicit promotion decision all succeed.

## Ground truth

- Reconciled plan: `docs/REVIEWER_HOLISTIC_REVIEW_IMPLEMENTATION_PLAN.md`
- Controlling synthesis: `docs/audits/reviewer-holistic-review-comparison-2026-07-09.md`
- Current-tree review: `docs/audits/reviewer-holistic-review-codex-2026-07-09.md`
- Strategic source review: `docs/audits/reviewer-holistic-review-fable-2026-07-08.md`
- Owner sourcing constraints: [[project-reviewer-sourcing-constraints]]
- Identity safety context: [[project-reviewer-self-report-orcid-sticky-confirmed]],
  [[project-reviewer-verify-fail-dangerous]]

Related: [[project-reviewer-apps-redesign-direction]] (Workbench/UI is a
different axis), [[project-reviewer-recall-over-precision]],
[[project-reviewer-count-invariant]].
