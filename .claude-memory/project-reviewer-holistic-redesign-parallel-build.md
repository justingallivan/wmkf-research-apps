---
name: project-reviewer-holistic-redesign-parallel-build
description: The reviewer finding/identity redesign is ACTIVE under the owner-approved hybrid model: safe legacy-default slices reach main through short branches; containment promotes per invariant; the baseline freezes after shared containment; cohort activation is server-owned; destructive cleanup waits through a controlled pilot and one campaign of observation.
metadata:
  type: project
  status: active
  scope: reviewer
  last_verified: 2026-07-12 via owner approval, governing release strategy, live contract audit, and reconciled implementation plan
---

## Recall Rule

Read this when planning or starting reviewer-finding work
(`lib/services/discovery/`, the discovery facade) or reviewer identity work
(`reviewer-identity-resolver.js`, `researcher.js` identity fields), or whenever
`docs/REVIEWER_HOLISTIC_REVIEW_IMPLEMENTATION_PLAN.md` is proposed for action.

## Current direction

The plan is **active under a hybrid incremental model**:

1. **Safe slices to main:** evaluation assets, additive schema artifacts, seams,
   dual writes, and shadow comparisons land through short branches while legacy
   behavior remains authoritative.
2. **C0 containment:** current save-boundary, correction, attestation-overwrite,
   and send-eligibility defects promote one verified invariant at a time on
   Tier-2 branches.
3. **Measured switches:** the baseline freezes after shared containment. New
   readers/finding behavior activate only through a server-owned deterministic
   request cohort; missing/invalid assignment selects baseline.
4. **D1 cleanup:** Track B or heuristic deletion waits until promotion and one
   complete campaign of old/new observation.

Wave 13 identity-binding schema artifacts are now tracked but are **not deployed
or authoritative**. The ten nullable fields cover person binding generation and
per-field lineage plus proposal COI binding/context currency. Apply remains a
separate owner gate; dual writers/readers remain later slices. Null future fields
mean legacy/unknown, never eligible-by-default.

The pure non-I/O contracts are built in
`reviewer-identity-binding-contract.js` and `institution-coi-context.js`, with
focused negative tests. They freeze strict canonical anchors, binding tuples,
seven-field lineage, and server-loaded proposal institution context hashing but
do not select or write Wave 13 columns. Durable institution-COI `clear` still
requires server-owned reviewer affiliations covered by the binding generation.

The documented sandbox is reachable but lacks
`wmkf_appreviewersuggestion`; Wave 13 preflight therefore aborts before apply and
the combined wave was not partially installed. Production remains 10 ABSENT / 0
DIVERGENT. The owner must choose sandbox reviewer-schema provisioning or an
explicit production-only schema exception before runtime wiring resumes.

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

- Start with the plan's B0 manifest foundation; freeze only after shared C0.
- Keep every production slice small, legacy-default, and independently reversible.
- Build phases one at a time; do not batch the redesign into one opaque change.
- Preserve fail-closed identity reads and the no-COI-regating posture.
- Run `/contract-reconcile` for containment, binding/schema, and cross-layer
  phases; run `/sweep` for durable fact changes.
- Require raw-field consumer/projection fan-out before retiring
  `wmkf_identitystatus` as a trust signal.
- Use the plan's independently labeled identity gates, blinded proposal A/B,
  and controlled-pilot thresholds for promote/stop.

## Do not

- Do not activate runtime behavior without the relevant promotion gate.
- Do not treat the old P0→P4 sequence or a single
  `wmkf_identitybindingsource` column as the current plan.
- Do not let client-supplied nested identity state establish persistence or
  action eligibility.
- Do not infer self-report from legacy `confirmed`; unproven rows stay
  legacy/unbound until reviewed.
- Do not call mutable suggestion rows an immutable shortlist/panel history.
- Do not delete Track B or other retrieval/ranking code before the offline
  comparison, controlled pilot, explicit promotion, and campaign observation.

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
