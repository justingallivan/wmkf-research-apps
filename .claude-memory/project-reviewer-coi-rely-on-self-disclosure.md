---
name: project-reviewer-coi-rely-on-self-disclosure
description: "Reviewer COI philosophy (Justin S240 + approved Contract 5 Phase C): hard-act on self-evident POLICY conflicts (proposal authors + corroborated CURRENT same-institution); rely on reviewer SELF-DISCLOSURE for relationship/inferred conflicts. The only approved institution soft flag is a read-only, unsaveable row for a single low-trust affiliation match contradicted by current-affiliation evidence. HISTORICAL/former-shared institution does NOT count."
metadata:
  node_type: memory
  type: project
  status: active
  scope: reviewer
  last_verified: 2026-07-03 via Contract 5 Phase C owner approval
---

## Recall Rule
Read before any reviewer-finder COI work that DROPS, FLAGS, or SURFACES a conflict — institution COI,
co-author COI, the model `POTENTIAL_CONCERNS` advisory, or "should we warn the PD about X."

## The principle (Justin, S240)
[VERIFIED 2026-07-27 via owner decisions and current COI/save enforcement in
`lib/services/reviewer-finder/save-candidates-service.js` plus reviewer
candidate-card consumers.]
- **Hard-act only on self-evident POLICY conflicts** the PD does not need to verify: proposal authors
  (PI + co-Is) and corroborated **CURRENT** same-institution. These stay hard drops (foundation policy
  — also the S238 exception in [[project-reviewer-recall-over-precision]]).
- **Approved narrow exception (Contract 5 Phase C, 2026-07-03):** a current-institution match from exactly
  one low-trust affiliation string may surface as a read-only, unsaveable flag when independent current
  affiliation evidence contradicts it. This is not a waiver: `hasInstitutionCOI` remains true, the Find UI
  keeps it unselectable, and `save-candidates` rejects it.
- **Rely on reviewer self-disclosure for relationship/inferred conflicts.** Reviewers reliably disclose
  ("Professor X was my former colleague and we're ongoing friends") and reviewers over-recuse. The
  accept/decline flow is where these surface.
- **Do NOT emit other PD-unverifiable soft flags.** A flag the PD can't/won't check ("potential conflict —
  former shared institution") *looks* helpful but, per Justin, PDs don't verify whether the flag is
  wrong → it just adds manual-search burden, which is the exact cost the product exists to remove. An
  unverifiable flag is net-negative, not neutral.
- **HISTORICAL / former-shared institution does NOT count** — neither drop nor flag.

## Build status (S240)
**Chunk 2a = SHIPPED to prod (S240, `fcbb258`): institution COI.** Current same-institution
became a HARD DROP on both tracks against the PI-institution UNION; historical/former-shared COI
RETIRED; authoritative save-gate in `save-candidates`; canonical institution maps in the agent-wiki
`reviewer-identity` topic + `docs/REVIEWER_FINDER_COI_CHUNK2_DESIGN.md`. **Contract 5 Phase C =
APPROVED/IMPLEMENTED 2026-07-03:** default hard drop remains, but single low-trust matches contradicted
by current-affiliation evidence surface as read-only, unsaveable flags. **Chunk 2b = SHIPPED (S254):
retired the AI `POTENTIAL_CONCERNS` advisory** — removed from prompt/validator/repair/render/persist;
the parser keeps `POTENTIAL_CONCERNS` only as a REASONING terminator (parse-and-discard) so a lingering
emission can't bleed into reasoning; prod Dataverse `analyze` reseed (`--execute --only=analyze`) is
Justin's step. Co-author COI KEPT.

## What this changes / implicates (verify before acting — touches shipped S229 work)
- **[DONE Chunk 2a]** ~~REMOVE historical-institution COI~~ (S229, da60679): `markInstitutionCOI` is now
  current-only; `institutionCOIDetails.historical` + the "Former shared institution" badge removed
  (legacy `.historical` scrubbed on read via `sanitizeInstitutionCOIDetails`). Shipped in Chunk 2a.
- **[DONE Chunk 2b — S254]** ~~RETIRE the model `POTENTIAL_CONCERNS` amber advisory~~ (S229, Justin S240): the model
  was freelancing inferred "potential concern" notes — the canonical PD-unverifiable flag. Removed the
  capture (`parseAnalysisResponse` no longer extracts it; `isNoConcernText` deleted), both cards' amber note,
  and `pruneCandidateForRoster` persistence, plus the validator/repair tokens and the prompt instruction
  that routed COI→POTENTIAL_CONCERNS. The parser keeps `POTENTIAL_CONCERNS` ONLY as a REASONING terminator
  so a lingering field (e.g. a not-yet-reseeded prod row) is dropped, not folded into reasoning. The
  analyze prompt is Dataverse-resolved at runtime — prod `analyze` row reseed (`--execute --only=analyze`)
  is Justin's step (see [[project-reviewer-coi-concern-surfacing]] + [[reviewer-finder-prompt-dataverse-migration]]).
- **KEEP co-author COI** grading (Justin S240): shared-paper counts are *factual* and the PD can see the
  shared papers → verifiable, not an inferred-relationship flag.
- Does NOT change Chunk 1 (identity + name exclusion).

## Why (the asymmetry)
The S229 stance optimized "never hide a real concern." Justin's S240 refinement: that's right for
*verifiable* conflicts but wrong for *inferred/relationship* ones, because the PD won't re-verify a system
flag and the product's value is cutting manual search. So the costly failure flips: an unverifiable flag
costs PD time without adding signal self-disclosure doesn't already provide.

Narrows [[project-reviewer-coi-concern-surfacing]] (the S229 work). Related:
[[project-reviewer-recall-over-precision]], [[project-applicant-exclusion-policy-pending]],
[[project-reviewer-pi-identity-structured]].
