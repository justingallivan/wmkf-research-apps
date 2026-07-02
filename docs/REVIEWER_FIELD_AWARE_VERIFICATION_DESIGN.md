---
title: "Field-Aware Track-A Verification Routing — Design Spec"
domain: reviewer-workbench
kind: spec
status: active
summary: "- The verifier is gated only by the PubMed checkbox, not by field: pubMedVerificationContract(options) returns { enabled: false } iff..."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
related:
  - lib/services/discovery-service.js
  - tests/unit/reviewer-identity-resolver.test.js
  - docs/REVIEWER_FINDER_RETRIEVAL_REDESIGN_PLAN.md
  - lib/utils/reviewer-provenance.js
---

# Field-Aware Track-A Verification Routing — Design Spec

> **Status:** **IMPLEMENTED & SHIPPED S236** through the full Codex loop (design
> review NO-GO → revised → pre-impl GO-WITH-CHANGES → impl → post-impl FIX-FIRST →
> fixed). Both changes committed. Live-state claims are marked `[VERIFIED via
> source]`; design choices are marked `[PROPOSED]`.
>
> **Post-impl review outcome (Codex):** CHECK 1-3 + 5 CONFIRMED-OK (rename clean,
> truth-table correct, gate doesn't regress non-Track-A callers, inert guard
> harmless). **CHECK 4 (SHOULD-FIX) FIXED:** `mapSpineVerificationResult` omitted
> `affiliationHistory`, so spine-verified (non-biomedical) reviewers silently
> skipped the former-institution COI scan (`deduplication-service.js:288`). Now
> plumbs ORCID employment history (`reviewer-identity-evidence.js` →
> `orcidAffiliations` → `affiliationHistory`); a strict improvement that also
> closes the same pre-existing gap for PubMed-off spine users. CHECK 6 covered by
> 2 new tests.
>
> **Objective:** Stop dumping every Claude-suggested reviewer for a
> non-biomedical (e.g. physics) proposal into the read-only "Unverified
> suggestions" bucket. Route Track-A verification of Claude's named suggestions
> to the domain-agnostic OpenAlex/ORCID identity spine when the proposal's field
> is clearly non-biomedical, instead of PubMed (which is biomedical-only).

## Problem (reported)

A PD ran a reviewer search on a **physics** proposal and saw:
1. The phrase "PubMed couldn't confirm these; not selectable" on the Unverified
   section. *(UI wording — already fixed separately to "couldn't confirm these in
   the literature"; this spec is about the underlying routing.)*
2. Effectively all of Claude's suggested physicists landing in that read-only
   bucket — none selectable.

## Root cause `[VERIFIED via source]`

- Track-A (verify Claude's named suggestions) is **PubMed-only in the default
  path.** `DiscoveryService.verifyClaudeSuggestions` queries
  `PubMedService.search` across name variants
  (`lib/services/discovery-service.js:501-526`). Physicists rarely have PubMed
  records → they fail the `MIN_PUBLICATIONS` gate → pushed to `unverified`
  (`discovery-service.js:695-707`).
- The verifier is gated **only** by the PubMed checkbox, not by field:
  `pubMedVerificationContract(options)` returns `{ enabled: false }` **iff**
  `options.searchPubmed === false` (`discovery-service.js:714-719`).
- When disabled, verification already routes to the **OpenAlex/ORCID identity
  spine** (`ReviewerIdentityEvidence.evaluateSuggestion` →
  `mapSpineVerificationResult`, `discovery-service.js:454-471`, `817-866`). That
  path is domain-agnostic (OpenAlex covers physics) and **produces real verified
  candidates** when the spine returns `confirmed`/`probable`
  (`discovery-service.js:823-846`), abstaining otherwise (fail-safe).
- Track-B *discovery* already honors arXiv (`searchArxiv`,
  `discovery-service.js:183`). Only **Track-A verification of named suggestions**
  is PubMed-bound — and for PubMed-blind fields, Claude's suggestions are
  *currently the only recall* (`[[project-reviewer-finder-retrieval-redesign]]`).

This matches the verified coverage model already in memory: **PubMed = biomedical
depth only; the cross-field spine is OpenAlex + ORCID.**

## Existing field detection `[VERIFIED via source]`

`discovery-service.js:1001-1010` already ships the exact gate this needs:

- `isPhysicalOrEngineeringResearchArea(area)` — positive allowlist: physics,
  quantum, laser, optical, photon, engineering, materials, astronomy,
  astrophysics, cosmology, chemistry, chemical, computer science, mathematics.
- `isClearlyBiomedicalResearchArea(area)` — biomedical allowlist.
- `isClearlyNonBiomedicalVerifierArea(area)` = physical/eng match **AND NOT**
  biomedical.

`proposalInfo.primaryResearchArea` is an established, relied-upon field
(`evaluateCrossFieldNamesakeGuard:270`, `isCrossFieldDiscoveredContamination:887`,
the per-source query builders). Because the non-biomedical test requires a
*positive* physical/eng match, `'Not specified'`/empty → `false` → **stays on the
conservative PubMed default** (no false routing of unknown-field proposals).

## Proposed change `[PROPOSED]` — REVISED after Codex design review

The original "one function" edit (make `pubMedVerificationContract` itself return
`enabled:false` for non-biomedical) was **NO-GO**: that contract is *also* the gate
for the PubMed coauthorship-COI check at `discover.js:244-245`, so flipping it
would silently disable COI detection for non-biomedical proposals (Codex E.2,
`[VERIFIED via source]`). The contract conflates two questions — "is PubMed
available at all?" and "which verifier should Track-A use?" — that this change
must keep separate.

**Revised design = two decoupled changes + one companion safety fix:**

### Change 1 — a SEPARATE verifier-routing decision (does not touch the COI gate)

Leave `pubMedVerificationContract` keyed on `searchPubmed` only (so the COI gate at
`discover.js:244` is byte-for-byte unchanged). Add a distinct decision consumed
ONLY by `verifyClaudeSuggestions`:

```js
// Which verifier confirms Claude's named suggestions. Distinct from
// pubMedVerificationContract (which gates "is PubMed usable at all", incl. the
// coauthorship-COI check). Non-biomedical → the domain-agnostic spine; PubMed
// cannot see physicists/chemists/etc.
static suggestionVerifierRouting(options = {}) {
  if (options.searchPubmed === false) return { verifier: 'spine', reason: this.VERIFICATION_SKIPPED_REASON };
  if (this.isClearlyNonBiomedicalVerifierArea(options.proposalInfo?.primaryResearchArea)) {
    return { verifier: 'spine', reason: 'Non-biomedical proposal — verifying via OpenAlex/ORCID spine instead of PubMed' };
  }
  return { verifier: 'pubmed', reason: null };
}
```

`verifyClaudeSuggestions` branches on `suggestionVerifierRouting(...).verifier ===
'spine'` (replacing today's `!verificationContract.enabled` check at
`discovery-service.js:454`). The PubMed-off case still maps to the spine, so
existing behavior is preserved; the COI gate keeps using the unchanged
`pubMedVerificationContract`. **Coauthorship-COI behavior is therefore unchanged
by this work** (out of scope: improving non-biomedical coauthorship COI, which
PubMed can't serve anyway — tracked, not regressed).

**Side-effect — the PubMed cross-field namesake guard becomes inert (acknowledged,
not removed).** `evaluateCrossFieldNamesakeGuard` (`discovery-service.js:1023`)
demotes only on the PubMed path AND only for `isPhysicalOrEngineeringResearchArea`
proposals with biomedical-looking namesake articles. After Change 1, physical/eng
proposals never reach the PubMed path (they route to the spine), so that guard no
longer fires for the population it was written for — the spine's abstention
supersedes it (and is safer: it never *verifies* a wrong namesake in the first
place). The guard code is **left in place** (harmless; still covers any future
PubMed-path edge) rather than deleted in this pass; the test that previously
asserted it (`discovery-verification-status.test.js`) is rewritten to assert the
spine-routing behavior. **Post-impl review item:** decide whether to retire the now-
inert guard in a follow-up (destructive — verify no other caller first).

### Change 2 — close the forename-gate gap BEFORE widening the spine population

Codex E.1 `[VERIFIED via source]`: `reviewer-identity-resolver.js:175` promotes
`(anyAffiliation && topic) || strongAffiliation` → `probable` with **no forename
gate**; only the ORCID-employment path (`:188`) requires `spine.forenameAgrees`.
A fabricated wrong-forename suggestion that lands an `affiliation_match` +
`topic_match` on a same-surname namesake is promoted to `probable` →
`verified:true` → selectable. This is the live hazard in
`[[project-reviewer-verify-fail-dangerous]]`. It already affects PubMed-OFF spine
users; routing all non-biomedical Track-A here **widens the exposed population**,
so it is a **non-deferrable companion fix**, not a follow-up.

**IMPLEMENTED (S236) after Codex pre-impl review (GO-WITH-CHANGES):** gate BOTH
ungated promotion paths in `classifySpineEvidence` — `:172`
(`strongAffiliation && employment && topic` → confirmed) AND `:175`
(`(anyAffiliation && topic) || strongAffiliation` → probable). The hazard spans
both, not just the probable path: the spine anchor builder never emits
`authorship_grounded`, so for the Track-A spine the live confirmed path is `:172`
(not the `authorshipGrounded` paths `:165-169`, which are dead for the spine and
live only for `reviewer-work-author-resolver`).

**Gate semantic = `spine.forenameContradicts !== true`** (blocks a full-forename
CONTRADICTION only — both names full and different, e.g. "Alfred" vs "Alain" — NOT
an initial-only record). The first cut shipped `forenameAgrees !== false`, which
hard-failed initial-only OpenAlex records and **regressed real, strongly-corroborated
reviewers** (Ursula Keller → "U. Keller", Robert Sang → "R. T. Sang"): both had
`affiliation_match[strong]` + `orcid_employment_corroborated[strong]` yet were demoted
confirmed → unresolved. Fixed same session — these promotions already require
affiliation_match (the "2nd independent signal" that the
`[[project-reviewer-verify-fail-dangerous]]` rule says makes an initial-only match
safe), so only an explicit contradiction should demote. `!== true` so non-Track-A
callers (`reviewer-work-author-resolver.js:128-130`, `contact-enrichment-service.js:735`)
that leave `forenameContradicts` **undefined** are unaffected. A contradicting Track-A
row falls through to `unresolved` (not `ambiguous` — that's reserved for cross-source
ORCID disagreement / multi-candidate conflict, `resolver.js:145`). The `:188`
ORCID-employment-only path (no affiliation_match) keeps the stricter
`forenameAgrees === true`. Tests in `tests/unit/reviewer-identity-resolver.test.js`
(contradiction blocks; initial-only + strong anchors still confirms; undefined passes).

**Recall/safety tradeoff to flag:** gating on `forenameAgrees` will abstain on a
real reviewer whose selected OpenAlex record carries only an initial (no full
forename). That is the documented, intended posture (abstain-not-mis-verify) but
the design review should confirm `forenameAgrees` treats "initial-only, not
contradicted" correctly rather than hard-failing legitimate initial-only records.

**Behavior matrix (verifier routing) after Change 1:**

| Proposal field | PubMed checkbox | Verifier (before) | Verifier (after) |
|---|---|---|---|
| Biomedical | on | PubMed | PubMed *(unchanged)* |
| Physics/chem/CS/astro/math | on | **PubMed (fails)** | **OpenAlex/ORCID spine** |
| Unset / "Not specified" | on | PubMed | PubMed *(unchanged, conservative)* |
| any | off | spine | spine *(unchanged)* |

Net: only the **clearly-non-biomedical** cell changes. Biomedical depth and the
ambiguous-field default are untouched.

## Why this is safe (fail-dangerous posture)

- The spine is the **anchor-or-abstain** path
  (`[[project-reviewer-verify-fail-dangerous]]`,
  `[[project-reviewer-contact-enrichment-anchoring]]`): it returns `verified:
  true` only on `confirmed`/`probable` identity, otherwise abstains to
  `unresolved`/`ambiguous`. Change 1 reaches the *existing* spine path via a field
  signal instead of a checkbox — but it is **not** "the same code path, unchanged":
  Change 2 deliberately **tightens** the `probable` promotion with the forename
  gate first, so the widened population is routed into a *safer* resolver than the
  PubMed-OFF users get today. Net fail-dangerous exposure goes **down**, not up.
- We are **not** loosening any gate. Suggestions the spine can't anchor still land
  read-only in "Unverified suggestions" — but now the genuinely-resolvable
  physicists (real ORCID/OpenAlex identity) become selectable instead of *all* of
  them being unconditionally barred by a database that structurally can't see them.

## Out of scope (explicitly)

- The full retrieval redesign (demote Claude from generator → field-routed
  retrieval) — `docs/REVIEWER_FINDER_RETRIEVAL_REDESIGN_PLAN.md` /
  `[[project-reviewer-finder-retrieval-redesign]]`. This spec is a **routing fix
  within the current architecture**, not that redesign. It is compatible with it
  (and reduces the physics-recall cliff the redesign warns about in the interim).
- Adding NASA ADS / arXiv / INSPIRE / DBLP as Track-A *verifiers*. The spine
  (OpenAlex+ORCID) is the cross-field presence check; field-depth verifiers are a
  later phase.
- Bibliometric completeness/metrics from the spine path — memory notes "trust OA
  for presence, NOT completeness/metrics." Ranking impact discussed below.

## Open questions for design review

1. **Metrics/ranking gap — largely resolved `[VERIFIED via source]`.** The
   OpenAlex backfill runs on `[...results.verified, ...results.discovered]`
   (`discovery-service.js:336`); its `isTrusted` filter accepts `verified===true`
   / `PROBABLE` / `VERIFIED` (`:397-400`), so spine-verified Track-A suggestions
   **are** covered — it fills the candidate's `c.publications` array + <!-- drain-table:ignore reason=js-candidate-field-not-pg-table -->
   `publicationCount5yr` field from the
   resolved OpenAlex author. **Caveat:** backfill requires `c.openAlexId`
   (`:404`); the spine sets `openAlexId` only when it selected an OpenAlex record
   (`:839`), so a `probable`-via-ORCID-employment result with *no* selected
   OpenAlex record would still have empty metrics and could rank low. Worth a
   reviewer eye on whether that edge needs a fallback; not a blocker.
2. **`probable` vs `confirmed` selectability — confirmed OK by Codex review
   `[VERIFIED via source]`.** `provenanceGroupOf`
   (`lib/utils/reviewer-provenance.js:204-206`) treats `verificationStatus ===
   'probable'` as positively resolved; the UI filters only `needs_identity_review`;
   `save-candidates.js:64` hard-rejects only `needsIdentification === true`. So
   spine `probable` Track-A suggestions flow through as selectable and Slice-E does
   not re-bar them. (Re-verify after Change 2, since tightening the forename gate
   shifts some `probable` → `unresolved`, which correctly become non-selectable.)
3. **Should ambiguous/unset field stay on PubMed?** Proposed: yes (conservative —
   avoids degrading biomedical-ish proposals whose area string is vague). Alt:
   run *both* and union. Recommend NOT unioning in this pass (latency + the
   PubMed namesake-conflation hazard for non-bio names).
4. **Mixed-field proposals** (e.g. biophysics) match *both* allowlists →
   `isClearlyNonBiomedicalVerifierArea` returns `false` (biomedical wins) → stays
   on PubMed. Is that the right call, or should biophysics prefer the spine?
   Proposed: keep on PubMed (biomedical depth) for this pass.

## Test plan `[PROPOSED]`

Unit (`tests/unit/` — no live calls; mock the spine + PubMed service):
- `suggestionVerifierRouting` (new): biomedical+on → `pubmed`; physics+on →
  `spine`; "Not specified"+on → `pubmed`; empty+on → `pubmed`; physics+off →
  `spine` (checkbox precedence).
- **`pubMedVerificationContract` UNCHANGED**: a regression test asserting it still
  returns `enabled:true` for physics+on, so the `discover.js:244` COI gate is not
  disturbed (guards against E.2 regressing).
- `verifyClaudeSuggestions` with a physics `proposalInfo`: asserts the spine path
  is taken (no `PubMedService.search` call) and a `confirmed` spine result yields
  a selectable verified candidate; an abstaining spine result yields an
  `unverified` row.
- **Change 2 (resolver):** wrong-forename suggestion with `affiliation_match` +
  `topic_match` now resolves `unresolved` (was `probable`); a forename-agreeing
  affiliation+topic suggestion still resolves `probable`; the initial-only
  legitimate record is NOT hard-failed.
- Regression: biomedical `proposalInfo` still hits the PubMed path; COI check still
  runs for physics+on.

Smoke: re-run a known physics request and confirm previously-all-unverified
suggestions now split into verified (spine-anchored) + unverified (un-anchorable),
and that coauthor-COI badges still appear.

## Files touched (anticipated)

| File | Change |
|---|---|
| `lib/services/discovery-service.js` | New `suggestionVerifierRouting`; `verifyClaudeSuggestions` branches on it instead of `!pubMedVerificationContract.enabled`. `pubMedVerificationContract` itself **unchanged**. |
| `lib/services/reviewer-identity-resolver.js` | Change 2 — forename-gate the `(anyAffiliation && topic) \|\| strongAffiliation` → `probable` promotion (`:175`). |
| `tests/unit/*` | Routing tests, COI-gate-unchanged regression, resolver forename-gate tests. |
| `docs/atlas/*` / memory | Only if a durable read/write-path claim changes (likely none — same persistence). Update `[[project-reviewer-verify-fail-dangerous]]` if Change 2 closes that hazard. |

## Cross-references

- `[[project-reviewer-finder-retrieval-redesign]]` — broader direction; this is an
  interim, compatible routing fix.
- `[[project-reviewer-verify-fail-dangerous]]`,
  `[[project-reviewer-contact-enrichment-anchoring]]` — fail-safe spine posture.
- `docs/REVIEWER_ORCID_SPINE_SPEC.md` — the spine being reused.
