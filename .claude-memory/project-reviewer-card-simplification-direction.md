---
name: Reviewer candidate card simplification — decided direction and sequence
description: The card's 15 banners are a symptom of a matching layer with ~25 scattered boolean predicates and no shared scorer; the redesign follows the matching decision, not the reverse.
type: project
status: active
scope: reviewer
last_verified: 2026-08-15 via current ReviewerSearchSection source, save gates, owner decisions, and the strategic-reset brief
---

## Recall Rule

Read this when: planning work on the Find-tab candidate card, the reviewer matching /
normalizer layer, fuzzy-matching work, institution comparison, or COI presentation.

## Current truth

- **Card simplification is not built.** `[VERIFIED via
  shared/components/reviewers/ReviewerSearchSection.js, 2026-08-15]` The card still
  renders separate COI, identity, mismatch, relevance, and address warnings. The
  shared promotion/email helpers resolve blocking states, but there is no unified
  ready / needs-review / blocked band or one Details disclosure.
- **Matching work must start from the strategic reset, not the earlier ROR sequence.**
  The falsification harness, comparators, and request-scoped shadow integration exist,
  but the first diagnostic mixed reviewer relevance, person identity, and institution
  normalization. Current authority is
  `docs/ROR_REVIEWER_FINDING_STRATEGIC_RESET_BRIEF.md`; production authority remains
  legacy-default until a later owner decision.
- Historical benchmark results and owner answers live in
  `benchmarks/fuzzy-matching-falsification/`,
  `outputs/fuzzy-matching-consensus-recommendation-2026-08-06.md`, and
  `outputs/fuzzy-matching-owner-answers-2026-08-06.md`. Do not restate their evolving
  counts here.

## Owner-decided direction (planned, not implementation)

1. Decide the matching verdict before redesigning the card; otherwise a status band
   becomes another hand-built precedence chain.
2. Then add one status band, one “Details — N notes” disclosure, and a separate action
   footer in small independently shippable increments.
3. Keep institution COI and coauthor overlap distinct. Institution COI is already a
   server-authoritative save rejection; coauthor overlap is advisory. Any institution
   override would require a separately authorized, audited server path.
4. Any future coauthor verdict is request-scoped durable evidence with who/when/source
   and a defined lifetime; it must not become a global person attribute.

## Hazards

- Preserve evidence framing on identity-unresolved rows: evidence was retrieved for a
  name, not confirmed about a person.
- Do not combine all card predicates in one pass; follow
  [[feedback-latency-plan-scope-accretion-postmortem]].
- Identity-before-address ordering, fail-closed remedies, and suppression of unconfirmed
  contact/bibliometric claims are safety properties, not styling. See
  [[project-reviewer-verify-fail-dangerous]] and
  [[feedback-affordance-consistency-beats-deduplication]].
