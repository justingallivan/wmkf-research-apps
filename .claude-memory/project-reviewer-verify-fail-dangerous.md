---
name: project-reviewer-verify-fail-dangerous
description: "HAZARD (verified S231): the reviewer verify path confirmed a fabricated wrong-forename against a real same-initial namesake, no forename gate. LARGELY CLOSED S235-S236: forename gates now on BOTH verify paths (PubMed nameEvidence/hasFullForenameMatch demotes to unresolved; spine promotions classifySpineEvidence :172/:175 gated on forenameAgrees!==false). Principle still a forward guard for new identity work."
metadata:
  node_type: memory
  type: project
  status: active
  scope: reviewer
  last_verified: 2026-06-08
---

## Status update (S236) — forename gate now on both verify paths
The original S231 reproduction was on the PubMed path; it is now gated. As of S236
BOTH verify paths fail-close on a wrong forename:
- **PubMed path:** `evaluateNameEvidence`/`hasFullForenameMatch` demotes a no-full-
  forename-match suggestion to `unresolved` (test `fabricated Alfred Laederach does
  not verify` in `discovery-verification-status.test.js`).
- **Spine path (S236):** `classifySpineEvidence` promotions `:172` (confirmed) and
  `:175` (probable) are gated on `spine.forenameAgrees !== false`
  ([[project-reviewer-field-aware-verification]] / `docs/REVIEWER_FIELD_AWARE_VERIFICATION_DESIGN.md`).
  `!== false` (not `=== true`) so non-Track-A callers that leave forenameAgrees
  undefined are unaffected. `forenameFullyAgrees` hard-fails initial-only records —
  the accepted abstain-not-mis-verify cost (PI-named-selectable S235 mitigates).
This memory stays `active` because the **principle** (fail-closed forename gate;
initial-only must not verify a full-name candidate without a 2nd signal) remains
the guard for any future identity/name-matching/COI work.

## Recall Rule
Read before touching reviewer verification / name-matching / COI in
`lib/services/discovery-service.js` or extending the identity resolver. The
original hazard is largely closed (see status update above); treat the fix
direction below as the standing invariant, not unbuilt work.

## The hazard (reproduced live, S231)
A **fabricated wrong-forename of a real, active researcher verifies as that real
person.** Demonstrated: running the real `verifyClaudeSuggestions` on a synthetic
"Dr. Alfred Laederach" (the real person is **Alain** Laederach) returned VERIFIED,
`confidence 100%`, with Alain's 8 papers + real UNC affiliation attached and
`institutionMismatch=false`.

Mechanism (all in source):
- `generateNameVariants` emits an initial variant ("A Laederach"); PubMed
  `[Author]` is order-insensitive ("A Laederach" == "Laederach A"); `namesMatch`
  matches "a laederach" == "alain laederach" via a first-initial rule
  (`discovery-service.js:~1102`).
- Verify accepts on `>= MIN_PUBLICATIONS` (=3) with **no forename check**
  (`:~327`). `institutionMismatch`/`expertiseMismatch` only set a field — the
  candidate is still pushed to `verified:true` (`:~337,363`). Both safeguards miss
  because only the *forename* was wrong (institution/field were right).

Why "≥N papers by LastName+initial" is unsafe as identity (VERIFIED): PubMed
returns paper CITATIONS, not person records. For common names it conflates
namesakes (e.g. "David Yong" = 1 real ASTRO-3D paper + 8 biomedical namesakes →
mis-verifies with a wrong affiliation); for distinctive names it can be
sparse-real but below threshold (false-negative). Related: `pubmed-service.js:226`
derives `year` from `DateCompleted||DateRevised||PubDate` (record-maintenance
dates, not publication date) → corrupts recency.

Also seen in the wild (analyze output): wrong-forename hallucinations on real
people — "Phillip"/Peter Clote, "Matthew"/Michael Pluth, "Sigal"/Shalev Itzkovitz;
~20% of analyze runs fail/degrade (empty response or 1 suggestion); placeholder
padding.

## How to apply (fix direction)
- **Forename-equality gate, fail closed:** a full-name suggestion verifies only if
  a recent topical cluster's author forename *exactly* matches (initials Claude
  itself supplied / nicknames / accents allowed). **Initial-only matches must
  never verify a full-name candidate** without a 2nd independent signal
  (ORCID / co-author / affiliation).
- **Demote `institutionMismatch`/`expertiseMismatch`** from advisory to
  confidence-lowering / `unresolved` — route verify through identity STATES, not
  bare `verified:true`. Reuse/extend `lib/services/reviewer-identity-resolver.js`.
- Cross-source-zero (PubMed+OpenAlex+ORCID+S2 all zero) is the reliable
  hallucination filter; a single source's zero is not.
- Full analysis + plan: `docs/REVIEWER_FINDER_RETRIEVAL_REDESIGN_PLAN.md` §2,§5.
