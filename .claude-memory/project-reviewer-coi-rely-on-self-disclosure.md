---
name: project-reviewer-coi-rely-on-self-disclosure
description: "Reviewer COI philosophy (Justin S240): the system HARD-ACTS only on self-evident POLICY conflicts (proposal authors + CURRENT same-institution); rely on reviewer SELF-DISCLOSURE for relationship/inferred conflicts. Do NOT emit PD-unverifiable soft flags — PDs won't verify them and the product's whole point is to REDUCE manual searching, so an unverifiable flag adds the cost it's meant to remove. HISTORICAL/former-shared institution does NOT count. Narrows S229 'default to RENDER'."
metadata:
  node_type: memory
  type: project
  status: active
  scope: reviewer
  last_verified: 2026-06-10 via Justin (S240 design dialogue)
---

## Recall Rule
Read before any reviewer-finder COI work that DROPS, FLAGS, or SURFACES a conflict — institution COI,
co-author COI, the model `POTENTIAL_CONCERNS` advisory, or "should we warn the PD about X."

## The principle (Justin, S240)
- **Hard-act only on self-evident POLICY conflicts** the PD does not need to verify: proposal authors
  (PI + co-Is) and **CURRENT** same-institution. These stay hard drops (foundation policy — also the
  S238 exception in [[project-reviewer-recall-over-precision]]).
- **Rely on reviewer self-disclosure for relationship/inferred conflicts.** Reviewers reliably disclose
  ("Professor X was my former colleague and we're ongoing friends") and reviewers over-recuse. The
  accept/decline flow is where these surface.
- **Do NOT emit PD-unverifiable soft flags.** A flag the PD can't/won't check ("potential conflict —
  former shared institution") *looks* helpful but, per Justin, PDs don't verify whether the flag is
  wrong → it just adds manual-search burden, which is the exact cost the product exists to remove. An
  unverifiable flag is net-negative, not neutral.
- **HISTORICAL / former-shared institution does NOT count** — neither drop nor flag.

## Build status (S240)
**Chunk 2a = SHIPPED to prod (S240, `fcbb258`): institution COI.** Current same-institution
is now a HARD DROP on both tracks against the PI-institution UNION; historical/former-shared COI
RETIRED; authoritative save-gate in `save-candidates`; canonical institution maps in the agent-wiki
`reviewer-identity` topic + `docs/REVIEWER_FINDER_COI_CHUNK2_DESIGN.md`. **Chunk 2b = NOT BUILT:
retire the AI `POTENTIAL_CONCERNS` advisory** (coupled prompt/validator/repair/render/persist +
prod Dataverse reseed Justin runs). Co-author COI KEPT.

## What this changes / implicates (verify before acting — touches shipped S229 work)
- **[DONE Chunk 2a]** ~~REMOVE historical-institution COI~~ (S229, da60679): `markInstitutionCOI` is now
  current-only; `institutionCOIDetails.historical` + the "Former shared institution" badge removed
  (legacy `.historical` scrubbed on read via `sanitizeInstitutionCOIDetails`). Shipped in Chunk 2a.
- **[NOT BUILT — Chunk 2b]** RETIRE the model `POTENTIAL_CONCERNS` amber advisory (S229, Justin S240): it's the model
  freelancing inferred "potential concern" notes — the canonical PD-unverifiable flag. Remove the
  capture/render (`parseAnalysisResponse` POTENTIAL_CONCERNS normalize, both cards' amber note,
  `pruneCandidateForRoster` persistence) AND the prompt instruction that routes COI→POTENTIAL_CONCERNS
  (the analyze prompt is Dataverse-resolved at runtime — reseed, don't just edit source; see
  [[project-reviewer-coi-concern-surfacing]] + [[reviewer-finder-prompt-dataverse-migration]]).
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
