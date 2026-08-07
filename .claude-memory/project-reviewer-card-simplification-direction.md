---
name: Reviewer candidate card simplification — decided direction and sequence
description: The card's 15 banners are a symptom of a matching layer with ~25 scattered boolean predicates and no shared scorer; the redesign follows the matching decision, not the reverse.
type: project
status: active
scope: reviewer
last_verified: 2026-08-07 via current card/save gates, owner decisions, and institution decision benchmark v3
---

## Recall Rule

Read this when: planning work on the Find-tab candidate card, the reviewer matching /
normalizer layer, the fuzzy-matching reconciliation, or the containment-first
institution comparison fix.

Design memo (inventory, diagnosis, proposed structure, decisions, sequence):
`https://claude.ai/code/artifact/e535ed0d-6724-40ad-9d1d-ff95b0ae85a1`

## The framing that decides sequencing

The card renders every contributing signal in parallel — up to 15 stacked banners, 10
pills, 5 contact chips, a 7-control action row, 6 border states, and 4 independent
severity encodings — because the matching layer never produces a single verdict.
`getCandidatePromotionDecision` / `getCandidateEmailReadiness` already resolve to ONE
blocking state in strict precedence (repair → identity → email → address), and the card
ignores that.

The independent fuzzy-matching research recommends Fellegi–Sunter additive scoring with
**three-band decisions (auto / review / reject)**, which maps directly onto the proposed
card **status band (ready / needs review / blocked)**. Adopt the model and the band
renders a real scored verdict; skip it and the band is a hand-assembled precedence chain
— the same accretion, better dressed. **The card redesign therefore follows the matching
decision.** An earlier draft had the containment-first comparison fix first; the owner
corrected the altitude — order by what most rapidly reduces complexity.

## Decided (owner, 2026-08-06) — card redesign unbuilt; matching groundwork partial

- **Sequence (step 1 DONE S404, 2026-08-06):** fuzzy-matching reconciliation — completed
  as a confirmed Claude×Codex consensus,
  `outputs/fuzzy-matching-consensus-recommendation-2026-08-06.md`; its six §4 owner
  questions ANSWERED S405 (2026-08-06) —
  `outputs/fuzzy-matching-owner-answers-2026-08-06.md`; falsification suite BUILT
  and incumbent baseline FROZEN S405 (owner authorized) at
  `benchmarks/fuzzy-matching-falsification/` — incumbent "safe but blind"
  (0 wrong entities, 36/47 positives abstain), see
  `baseline/incumbent-2026-08-06.md` → ROR v1 comparator DONE → canonical-ID
  candidate benchmark v2 DONE (ROR API 128/141 vs incumbent 84/141; retrieval
  still not decision authority), see
  `benchmarks/fuzzy-matching-falsification/versions/v2/results/2026-08-07-api-candidate-benchmark.md`
  → organization-span parsing + controlled query fallback + veto/scorer
  comparator DONE (v3 141/141 institution labels, 0 wrong automatic resolutions),
  see `benchmarks/fuzzy-matching-falsification/versions/v3/results/2026-08-07-api-decision-benchmark.md`
  → production request-scoped shadow adapter + post-resolution ROR→OpenAlex bridge
  → S2AFF profile →
  normalizer consolidation + shared scorer in small independently shippable increments →
  card status band + Details disclosure + footer split → coauthor verdict →
  institution-COI sort-to-bottom + audited override.
- **The two "COI"s are different in kind and must be split.** Institution COI is the
  authoritative server gate (recomputed at save, rejects even when the client claims
  otherwise) → belongs in the status band, cards sort to the END of the list, override
  exists but is rare and must be an audited server path. Coauthor COI blocks NOTHING
  (appends a note to reasoning and saves) → an advisory pill expanding to the per-author
  breakdown with a recorded verdict, replacing the `gradeCoauthorCOI` threshold constant.
- **Coauthor verdicts are request-scoped**, never person-scoped: a judgement about one
  proposal's author set must not carry onto a different one. It is durable state and
  needs the address-attestation treatment (who/when/evidence, server-recorded, re-read)
  plus a defined lifetime — a verdict on 4 shared papers must not survive to 15.
- **Advisory notes collapse fully** into one "Details — N notes" disclosure (notes above
  evidence). The earlier notes-vs-evidence two-chip split was rejected: "institution
  mismatch" is a note whose content IS a comparison of two evidence items, so two
  controls served one question.
- Sort-to-bottom has a precedent to copy: `aiFlaggedNotRelevant` rows are already moved
  to the end of the enriched list (`ReviewerSearchSection.js`).

## Hazards

- The evidence block keeps its own framing on identity-unresolved rows (retrieved for a
  NAME, not confirmed about a PERSON; no mailto; Scholar name-search not profile link).
  That is why evidence stays a coherent section instead of dissolving into the notes.
- This work is the exact shape of the S395 debacle — see
  [[feedback-latency-plan-scope-accretion-postmortem]]. Every increment must be
  independently shippable; no pass may attempt to unify all ~25 predicates at once.
- Fail-closed remedies, identity-before-address ordering, and contact/bibliometric
  suppression on unresolved identity are safety properties, not styling —
  [[project-reviewer-verify-fail-dangerous]], [[feedback-affordance-consistency-beats-deduplication]].
