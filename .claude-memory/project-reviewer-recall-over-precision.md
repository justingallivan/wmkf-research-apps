---
name: project-reviewer-recall-over-precision
description: "Reviewer-finder design reframe (S238): a 10-yr retrospective found ~no correlation between reviewer ratings and funded-project success → review is a FLOOR/GATE (screen out bad), not a RANKER. Optimize coverage/recall of competent sub-communities; relax fine ranking precision. The slate is a toe-hold seeding a referral search; COI = surface-not-gate except permanent policy conflicts. Full design: docs/REVIEWER_FINDER_RETRIEVAL_REDESIGN_PLAN.md Part C (§8)."
metadata:
  node_type: memory
  type: project
  status: active
  scope: reviewer
  last_verified: 2026-06-09
---

## Recall Rule
Read before any reviewer-finder ranking / COI / candidate-disposition / "should we
drop this candidate" work. The durable record is the canonical design doc
`docs/REVIEWER_FINDER_RETRIEVAL_REDESIGN_PLAN.md` **Part C (§8)** — read it; this is
the intent/routing layer.

## The reframe (why it exists)
[VERIFIED 2026-07-27 as owner research interpretation and product design;
current enforcement examples live in
`lib/services/discovery-service.js` and COI/save services.]
A 10-year retrospective (Justin/foundation) found **essentially no correlation between
reviewer ratings and funded-project success**. It is selection-biased (funded-only →
restriction-of-range), so the honest read is: **review functions as a FLOOR/GATE**
(screen out the clearly-bad), **not a RANKER** (resolve which good ones succeed). Do
NOT over-read into "reviewer quality doesn't matter" — the selection bias forbids that.

## Load-bearing consequences
- **Optimize recall/coverage of competent sub-communities; relax rating precision.** The
  elaborate recency/h-index ranking machinery is lower-leverage than origination breadth.
- **Collective seed SPREAD is non-relaxable; per-person precision is.** The slate is a
  toe-hold (0→~75%) that seeds a referral-driven snowball search (decline→suggest→iterate).
  Snowball stays in the seed's neighborhood, so a collapsed seed is *entrenched* by
  iteration, not fixed. A two-axis slate (question-experts AND methods/technique-experts —
  usually different communities) is the built-in spread floor.
- **False negatives, not false positives, are the danger.** Distributed human review
  absorbs a weak reviewer (discounted by staff); it cannot recover a sub-community the
  system never surfaced. So don't silently drop on the retrieval pool.
- **COI = surface-not-gate**, except the permanent *policy* conflicts (proposal-authors,
  corroborated/current same-institution — default hard drop per foundation policy, with the
  approved Contract 5 Phase C read-only exception for a single low-trust match contradicted
  by current-affiliation evidence). Reviewers over-recuse, so system
  over-exclusion is the expensive error. Keep factual co-author evidence, but do
  not surface PD-unverifiable inferred/relationship flags; rely on reviewer
  self-disclosure. See [[project-reviewer-coi-rely-on-self-disclosure]].

## How to apply (shipped S238 — examples of the principle)
- Track-B `<3`-pub candidates → surfaced as a warning, not silently dropped (dedup can
  undercount a preprint+published pair below the bar). `partitionByPublicationBar`.
- `isRelevant: No` (parametric Claude cull of grounded people) → surfaced + ranked last +
  named, not hard-dropped.
- Co-authorship COI graded (`coauthorCOIStrength` 'likely' vs 'possible'; max-shared-with-
  one-author ≥3 = likely) so a single hub-artifact paper doesn't red-flag the methods
  experts who accumulate incidental co-authorships → protects methods-axis recall.

Related: [[project-reviewer-finder-retrieval-redesign]], [[project-reviewer-coi-concern-surfacing]],
[[project-reviewer-ranking-recency-over-citations]], [[project-reviewer-finder-proposal-doc-context]].
