# Reviewer Identity: ORCID-Name-Confirmed Promotion — Design Plan

**Status:** PROPOSED (pre-implementation; awaiting Codex design review)
**Author:** Claude (S265)
**Scope:** `lib/services/reviewer-identity-evidence.js` (anchor build), `lib/services/reviewer-identity-resolver.js` (spine classifier)
**Safety surface:** fail-dangerous identity resolver (`project-reviewer-verify-fail-dangerous`). Promotion only; never weakens a contradiction gate.

## 1. Problem (grounded, verified by probe)

Prominent, unquestionably-real reviewers are intermittently dropped by the discover-path identity
verifier (the OpenAlex/ORCID spine) and never reach the surfaced list — so the new email tier never
even sees them. Verified case: **Philip Bucksbaum** (request 1002794). He surfaced + verified
`confirmed` in one run, then was **absent** in later runs.

Reproduced `ReviewerIdentityEvidence.evaluateSuggestion("Philip Bucksbaum", field=attosecond physics)`,
varying only the claimed institution:

| `suggestedInstitution` | Verdict | Anchors |
|---|---|---|
| `"SLAC National Accelerator Laboratory"` | **confirmed** | affiliation_match **strong** + orcid_employment_corroborated **strong** + topic + orcid_present + cross_source |
| `"Stanford University"` | **probable** | affiliation_match weak + topic weak |
| **`null` / omitted** | **unresolved → DROPPED** | topic[weak] + orcid_present[weak] + cross_source_orcid_agreement[weak] |

**Root cause:** the spine verdict hinges almost entirely on the **claimed institution string** Claude
supplies. The institution token-overlap (`institutionMatchesAny`, `selected.affiliationMatched`) is
the gate to the only strong non-authorship anchors (`affiliation_match`, `orcid_employment_corroborated`).
Claude's `suggestedInstitution` for a given person is **non-deterministic** (present one run, absent the
next) and frequently **mismatched-but-correct** (his ORCID employment is `SLAC National Accelerator
Laboratory`; he is commonly listed as `Stanford` — the two strings share **no token**, so even a correct
"Stanford" only earns a *weak* affiliation_match). When the institution is omitted, only weak anchors
remain → `unresolved` → filtered out before surfacing.

**The latent, unused signal:** in the `null`-institution case the spine still **selects the right
OpenAlex record carrying ORCID `0000-0003-1258-5571`**, and that ORCID **cross-source-agrees**
(OpenAlex inline ORCID == independent ORCID search) and resolves (ORCID API) to
**given="Philip", family="Bucksbaum"** — an *authoritative full-name confirmation* of the suggestion's
forename. Today that is only a `weak` `orcid_present` anchor and is never used to promote.

> Note: the OpenAlex record's `displayName` is **"P. H. Bucksbaum"** (initials), so the existing
> forename gate (`forenameFullyAgrees(suggestion.name, record.displayName)` at evidence.js:535)
> returns **false** — an initial can't confirm "Philip". The ORCID record's *full* given name can.

## 2. Goal / Non-goals

**Goal:** make a prominent ORCID-bearing reviewer verifiable from the **ORCID identity itself** when the
claimed institution is missing or imprecise — recovering the class of researchers the institution-token
gate drops — **without** weakening any namesake protection.

**Non-goals:** institution-alias bridging (SLAC↔Stanford, JILA↔Colorado) — a separate, harder fix
(ROR domains / alias map); reaching `confirmed` on this path (probable-ceiling only); changing the
PubMed (Track-A) verifier or the `resolveIdentity` (enrichment-path) classifier.

## 3. The fix

### 3a. New STRONG anchor `orcid_name_confirmed` (`reviewer-identity-evidence.js: buildAnchors`)

Emit when ALL hold:
1. the selected OpenAlex record carries an ORCID (`record.orcid`), and the ORCID profile resolved
   (`orcidProfile` — already fetched at evidence.js:505 via `fetchSelectedOrcidProfile`);
2. **cross-source ORCID agreement** holds (the same `directId === orcid` condition that gates
   `cross_source_orcid_agreement` today) — two independent sources concur on the ORCID; and
3. the **ORCID profile's full given+family name forename fully agrees** with the suggestion:
   `forenameFullyAgrees(suggestion.name, \`${orcidProfile.givenNames} ${orcidProfile.familyName}\`)`
   — using the AUTHORITATIVE ORCID full name, NOT the (initialized) OpenAlex displayName.

`anchor('orcid_name_confirmed', 'strong', orcid, { givenName: orcidProfile.givenNames, … })`.

### 3b. New promotion path (`reviewer-identity-resolver.js: classifySpineEvidence`)

Add, after the existing employment-strong path (resolver.js:294):

```
const orcidNameConfirmed = hasAnchor(anchors, 'orcid_name_confirmed', 'strong');
if (orcidNameConfirmed && topic && spine.forenameContradicts !== true) {
  return { status: 'probable', competitors: [] };
}
```

- Requires `topic_match` (the person is in the proposal's research area) — never promotes on identity alone.
- Gated on `spine.forenameContradicts !== true` (the existing displayName-based contradiction gate): if
  OpenAlex's *full* displayName forename actively contradicts the suggestion, the two sources disagree →
  do not promote (defer to ambiguous/unresolved).
- **`probable` ceiling** — selectable-with-verify, never auto-trusted `confirmed`.

For Bucksbaum (null institution): `orcid_name_confirmed[strong]` + `topic_match[weak]`,
`forenameContradicts=false` → **probable** → surfaces. (With an institution he still reaches
probable/confirmed via the existing paths — unchanged.)

## 4. Why this is safety-preserving (cannot reopen the namesake hole)

- It **adds** an authoritative identity check (ORCID full-name forename match), it does not relax any
  gate. A wrong-forename namesake's ORCID would resolve to a different given name → anchor not emitted.
- Double-locked: requires **cross-source ORCID agreement** (two sources concur the ORCID) AND the
  ORCID's **full** name forename match — strictly stronger than the initial-based `forenameAgrees` it
  bypasses. (ORCID is a unique per-person id; two distinct real "Philip Bucksbaum" with the same ORCID
  is impossible, and same-name-different-ORCID is excluded by selecting the record's own ORCID.)
- Still gated on `forenameContradicts !== true`, so a source disagreement blocks it.
- `probable` ceiling keeps the human verify-before-outreach step.
- Records with **no ORCID** are unaffected — the existing affiliation/employment/authorship paths and
  the `unresolved` floor are untouched.

## 5. Open questions for Codex

1. Is requiring **cross-source agreement** (§3a.2) the right safety floor, or is the selected record's
   own ORCID + full-name forename match sufficient (the cross-source search adds latency)? Trade-off:
   dropping it would also recover records OpenAlex has an ORCID for but the direct search didn't echo.
2. Should the promotion also require `orcid_present`/the record's `worksCount`/h-index above a floor, to
   avoid promoting a low-footprint ORCID record, or is `topic_match` + cross-source ORCID enough?
3. `forenameFullyAgrees` currently compares against a single display string; is
   `\`${givenNames} ${familyName}\`` a safe reconstruction, or should it compare forename tokens
   directly (handles ORCID `creditName` vs given/family edge cases, hyphenated/middle names)?
4. Anything that makes `orcid_name_confirmed` emit for a WRONG person (e.g. OpenAlex record with a
   mis-attributed ORCID; ORCID profile name in a different script/transliteration)?
5. Is `probable` correct, or could ORCID-name + cross-source + employment-corroborated ever justify
   `confirmed`? (Proposal: keep `probable`.)
6. Should we ALSO log/surface a note so a PD sees "verified via ORCID identity (institution not
   supplied)" — useful given these are exactly the borderline cases?

## 6. Testing

- Unit (`reviewer-identity-evidence`): `buildAnchors` emits `orcid_name_confirmed` when ORCID +
  cross-source + ORCID-full-name forename agree; does NOT when forename differs, no cross-source, no
  ORCID, or ORCID name forename is only an initial.
- Unit (`reviewer-identity-resolver`): `classifySpineEvidence` → `probable` for
  orcid_name_confirmed + topic; stays `unresolved` without topic; stays blocked when
  `forenameContradicts === true`; never `confirmed` on this path; existing verdicts unchanged
  (regression: the affiliation/employment/authorship matrices).
- Fixture/integration: a Bucksbaum-shaped suggestion (null institution, selected record initials +
  ORCID, ORCID full name "Philip") → probable. A wrong-forename namesake ("Peter Bucksbaum", same
  ORCID record whose name is "Philip") → NOT promoted.
- Gates: `npm test`, `npm run lint`, `npm run build`; `check:status-enum-parity` if any status string
  surface changes (it shouldn't — reuses existing `probable`).
