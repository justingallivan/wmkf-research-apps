# Reviewer Identity Spine: trust ORCID-employment over OpenAlex institution drift — Design

Date: 2026-06-08 (S235)
Status: IMPLEMENTED 2026-06-08 (branch `reviewer-identity-orcid-employment`). Codex
design-reviewed (READY WITH NAMED CHANGES); all 4 folded in:
1. **Forename gate** (`reviewer-identity-evidence.js` `forenameFullyAgrees`) — before the
   resolver may promote on a selected record's ORCID-employment, the selected OpenAlex
   `displayName` must FULLY agree with the suggestion's given name (initial-only fails closed);
   passed to the resolver as `spine.forenameAgrees`.
2. **Promotion rule** (`reviewer-identity-resolver.js` `classifySpineEvidence`): strong
   `orcid_employment_corroborated` + `topic_match` + `spine.forenameAgrees` → `probable`
   (probable-only; no new `confirmed` path).
3. **Regression tests** (`reviewer-identity-evidence.test.js`): Smirnova drift → probable;
   wrong-forename namesake → unresolved; initial-only displayName → unresolved.
4. **Sticky-`confirmed` discrepancy flagged** (not fixed here) — see §3 + the memory note.

**Live-verified:** Smirnova → `probable` with the full institution name. **Known caveat (NOT
fixed):** with a short/empty institution string she still abstains at SELECTION
(`openalex_collision`, 114 namesakes) before the promotion runs — Codex Q3, a separate
selection-hardening follow-up (prefer a direct ORCID lookup when the suggestion carries one).

## 0. The bug (live-probed)

A real, well-known reviewer (Prof. Olga Smirnova, attosecond theory, Max-Born-Institute
Berlin) is being EXCLUDED — "Identity not verified" — on a fresh Find-tab search. The user
confirms she is still at MBI (a short Technion sabbatical aside); her ORCID, Google Scholar,
and the proposal all say MBI.

NOT a recent regression in our code: the spine (`reviewer-identity-evidence.js` /
`reviewer-identity-resolver.js`) is unchanged since S233, before S234 when she resolved fine.
This is OpenAlex data drift exposing a resolver gap.

### Live probe evidence (OpenAlex, 2026-06-08)
- `searchAuthors('Olga Smirnova')` → **114** authors of that name.
- Her physics record `A5003420285` (ORCID `0000-0002-7746-5733`, 341 works, atomic-physics/
  laser) now has OpenAlex `last_known_institution` = **Technion**, NOT Max-Born-Institute.
- `evaluateSuggestion({name:'Olga Smirnova', suggestedInstitution:'Max-Born-Institute'})` →
  **abstain** (`openalex_collision`): the short institution string can't pick a record out of
  114 namesakes, so no record is even selected.
- With the FULL institution name, the spine DOES select her correct record and scores anchors:
  `topic_match[weak]`, `orcid_present[weak]`, **`orcid_employment_corroborated[STRONG]`**,
  `cross_source_orcid_agreement[weak]` — yet still returns **`unresolved`**.

### Root cause
`reviewer-identity-resolver.js` `classifySpineEvidence` only promotes to `probable`/`confirmed`
when there is an OpenAlex **`affiliation_match`** anchor (`:172`, `:175`; `strongAffiliation`
at `:158-159` requires `affiliation_match` in both branches). A **strong
`orcid_employment_corroborated`** anchor (her ORCID's OWN employment record lists MBI = the
claimed institution) plus `topic_match`, WITHOUT an OpenAlex `affiliation_match`, falls through
to `unresolved` (`:178`). But OpenAlex `last_known_institution` is exactly the field that drifts
with a sabbatical / most-recent-paper affiliation — whereas the ORCID-employment corroboration
is more authoritative. The resolver's OWN header comment says an "institution-corroborated
public ORCID … [is] sufficient ALONE to reach `probable`" (`:12-17`) — the code does not
implement that intent.

## 1. Proposed fix (minimal, to `probable` only)

In `classifySpineEvidence`, treat a **strong `orcid_employment_corroborated`** anchor as a
promotion-sufficient signal even without an OpenAlex `affiliation_match`:
- Add it to the `strongAffiliation` definition (`:158`) — OR add an explicit branch:
  `if (employment-strong && topic_match) → probable`.
- **Target `probable` only**, never `confirmed`, to stay clear of the sticky-confirmed sentinel
  (§3). So do NOT route it through the `confirmed` branches at `:166`/`:173`.

Rationale: an ORCID is a unique identifier and the employment record is the person's own
attestation of where they work; when it corroborates the claimed institution it uniquely
disambiguates among namesakes far better than OpenAlex's drifting `last_known_institution`.

This also wants the **selection step** to find her record despite the short institution string
(the `openalex_collision` abstain). Possibly: when the suggestion carries an ORCID, do a DIRECT
ORCID lookup (the spine already has a `directOrcid` path, `:138`) rather than relying on a
fuzzy institution-token match. (Codex Q3.)

## 2. The fail-dangerous hazard (the reason the spine is conservative)
`[[project-reviewer-verify-fail-dangerous]]`: a fabricated wrong-forename name can name-match a
real same-initial namesake; the spine has no forename gate. So promoting on
`orcid_employment_corroborated` is only safe if the SELECTED record is reliably the right
person — the employment check runs against the SELECTED record's ORCID profile, so a wrong
selection yields a wrong (but corroborated-looking) ORCID. The promotion must not weaken the
namesake protection.

## 3. The sticky-confirmed tension (flag, don't break)
`[[project-reviewer-self-report-orcid-sticky-confirmed]]` (S218) states the automated resolver
"only ever emits probable/unresolved/ambiguous — `confirmed` is NOT reachable from it" and
`confirmed` is a reserved sticky human-attestation sentinel. But `classifySpineEvidence`
(S232/S233, later) HAS `confirmed` branches (`:166`, `:173`). Either the memory is stale or the
spine's `confirmed` is downgraded before persistence. This design targets `probable` only and
does NOT add a new `confirmed` path, so it doesn't worsen the tension — but Codex should confirm
the spine's existing `confirmed` emission vs the sticky sentinel (separate finding).

## Q. Questions for Codex
1. Is promoting `orcid_employment_corroborated[strong]` (+ `topic_match`) to `probable` without
   an OpenAlex `affiliation_match` safe against the fail-dangerous namesake hazard, given the
   employment check runs against the SELECTED record's ORCID profile? Does the selection step
   have (or need) a forename gate before we trust its ORCID?
2. How reliable is `orcid_employment_corroborated` as a disambiguator — exactly how is it
   computed (`institutionMatchesAny(suggestion.suggestedInstitution, orcidProfile)`,
   `reviewer-identity-evidence.js:198`), and can a namesake's ORCID employment coincidentally
   match a claimed institution?
3. The `openalex_collision` abstain (short institution string → no record selected among 114):
   should selection prefer a DIRECT ORCID lookup when the suggestion carries an ORCID, or
   improve institution-token matching, or both? Is that in scope for this fix or separate?
4. Should this be `probable` only (my choice), or is `confirmed` ever appropriate here? Confirm
   the spine's existing `confirmed` branches vs the sticky human-attestation sentinel.
5. Any candidate this would now wrongly promote (regression in the safe direction)? Anything
   mis-scoped or a simpler path to "stop excluding a correctly-ORCID-corroborated reviewer
   when OpenAlex's last_known_institution has drifted."
