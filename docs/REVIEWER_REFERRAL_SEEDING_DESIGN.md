---
title: "Reviewer Referral Seeding & Provenance Plan"
domain: reviewers
kind: plan
status: active
summary: "Locked build plan: guarantee externally-referred seed names into the reviewer pool (seed-only, folded-in); relabel two existing kinds, no new enum."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
related:
  - shared/components/reviewers/ReviewerSearchSection.js
  - lib/utils/reviewer-provenance.js
  - pages/api/reviewer-finder/analyze.js
  - pages/api/reviewer-finder/discover.js
  - pages/api/reviewer-finder/save-candidates.js
  - shared/config/prompts/reviewer-finder.js
---

# Reviewer Referral Seeding & Provenance Plan

**Status: LOCKED — ready to build (S318).** All design questions resolved (see §Locked
decisions). Written in response to a PD report on req 1002926 (see §Origin). **Codex
plan review incorporated (S318):** 6 claims CONFIRMED, 1 REFUTED (no post-discovery
count cap — corrected injection seam in §C), 3 RISKs folded in (bulk-dedup policy §C,
display-vs-durable-string split §A, relabel consumer fan-out §A).

## Locked decisions

1. **Two referral lanes on two EXISTING provenance kinds — no new enum.**
   - **Externally-Referred** = the `referred` kind — names from consultants/colleagues
     (and contacted-reviewer referrals). This is what the new seed field feeds. Already
     grounded, never-dropped, ranking-bonused; the referrer ("Doug N") rides along via
     `referredBy`.
   - **Applicant-Referred** = the existing `applicant_suggested` kind — names the
     *applicant* put forward. Already end-to-end; deliberately **not auto-selected**
     (defaults to needing PD promotion) — the right posture for a possibly-biased pick.
2. **Folded-in layout.** Externally-Referred rows render **inside** the top grounded
   group (retitled "Cited, named & referred"), not a separate section. This is the
   existing routing (`referred` already groups there) — so it needs only the badge
   relabel, no `provenanceSections` split. Applicant-Referred keeps its own section.
3. **Seed-only discovery.** Seeds are injected directly into the candidate pool; they are
   **NOT** added to Claude's analyze prompt. Discovery stays an independent second
   opinion. (A future "also use these to find related reviewers" checkbox is possible but
   out of scope.)
4. **Bare names: surface-with-verify, never dropped.** A seed with no email / unresolved
   identity still appears (selectable) in the grounded group with the existing "verify
   identity" affordance; the save path force-nulls its contact until identity is
   confirmed/probable, so it can never carry a wrong email (see §C for the mechanism).
5. **Bulk paste format:** tolerant freeform lines (`Name`, optional email, optional
   affiliation/URL). Names-only is the common case.

## Origin (the report)

A PD pasted a consultant-supplied list of names into the reviewer-finder **notes**
field, expecting the tool to (a) definitely surface those people and (b) mark them as
recommended. Observed: only *some* came back, no assurance they were used vs.
independently re-found; even editing the underlying prompt to "use these with high
confidence" did not force them in. She then added one (Mohammad Hafezi) via the manual
**Add or Refer** panel.

## Root cause (verified in code, S318)

The notes field **is** sent to Claude — injected as `ADDITIONAL CONTEXT FROM USER` near
the top of the analyze prompt (`shared/config/prompts/reviewer-finder.js:71`,
`lib/services/reviewer-prompt-composer.js:27`). But nothing **guarantees** those names
survive, and three code-owned mechanisms *downstream of the prompt* defeat a prompt-only
guarantee:

1. **Fixed target count** (`DEFAULT_REVIEWER_COUNT`, default 15) — Claude returns a
   capped best-fit set mixing the PD's names with its own; extras get crowded out.
2. **Code-owned anti-fabrication block** (`ANALYZE_INTEGRITY_BLOCK`) tells the model to
   return **FEWER** real reviewers rather than include a name it can't confidently
   identify — a bare name + webpage is exactly what it will drop.
3. **Discover-stage verification** (`discover.js`) re-checks each name against real
   publication profiles and ranks it; unresolved names rank low or fall away.

**Conclusion: the guarantee must live in code (a seed path that bypasses the count cap
and the drop), not prompt wording.** The finder is a discovery + verification engine;
referred names are *already known* and should not be subject to discovery economics.

## Build (seams + sequence)

### A. Relabel two existing provenance kinds — `lib/utils/reviewer-provenance.js`
No enum change. In `provenanceLabelForCandidate` (the **display** surface):
- `REFERRED`: `Referred by ${referredBy}` / `Referred` → **`Externally-Referred ·
  ${referredBy}`** / `Externally-Referred`. Relabels ALL referred rows (contacted-reviewer
  referrals too) — intentional umbrella.
- `APPLICANT_SUGGESTED`: `Applicant-suggested` → **`Applicant-Referred`**.

**CRITICAL — display label ≠ durable string (Codex risk).** The relabel touches the
**display** only. The persisted `wmkf_matchreason` prefix **must stay `Referred by …`**:
`my-candidates.js` reparses `^Referred by …` on reload to reconstruct `referredBy` when
`wmkf_sources` includes `referred` [Codex: my-candidates.js:199,203]. Do NOT change the
persisted prefix or the reload parser — only the badge/label the UI renders.

**Consumer fan-out to update in the same change (Codex):** these assert/emit the old
label strings and must move with the relabel —
- `tests/unit/reviewer-provenance.test.js:137` (exact label assertion),
- `tests/unit/reviewer-candidate-export.test.js:63` (export string),
- `ReviewerSearchSection.js:1260` (UI/export fallback string).
No behavior change beyond the label; both kinds keep their existing grouping/selection/
ranking.

### B. Structured input — `shared/components/reviewers/ReviewerSearchSection.js`
- New "Externally-referred reviewers" textarea (consultants/colleagues — **not** the
  applicant), **separate** from `additionalNotes` (notes stays for instructions). One
  entry per line, tolerant parse to `referredSeeds: [{ name, email?, affiliation?, url? }]`.
- POST `referredSeeds` to the find flow alongside `additionalNotes`. Applicant picks need
  no input here — they arrive through the existing applicant-suggested pipeline.

### C. Guaranteed seed injection — `pages/api/reviewer-finder/discover.js`
- **Injection seam (corrected — Codex REFUTED the count-cap framing).** There is **no
  post-discovery `DEFAULT_REVIEWER_COUNT` pool cap** to inject before — the count is a
  Stage-1 prompt/validation input and `rankAllCandidates` combines/ranks without slicing
  [Codex: discovery-service.js:2309]. The guarantee comes from injecting seeds into the
  **ranked** set, not from beating a cap. **Exact seam (Codex):** in `/discover`, after
  verification/COI filtering and before the result frame, merge seeds into
  `verifiedWithCOI` before `combinedResults` / `rankAllCandidates`
  [Codex: discover.js:436, discover.js:491] so they reach `data.ranked` → enrichment →
  `setCandidates` → `save-candidates` [Codex: ReviewerSearchSection.js:669, 1025].
  **Do NOT put seeds into `analysisResult.reviewerSuggestions`** — unresolved Track-A
  items land in `unverified`, which `rankAllCandidates` excludes, so they'd never reach
  `displayCandidates` [Codex: discovery-service.js:478, 2310].
- Tag each injected seed `provenance.kind = 'referred'` (`seedRole: 'referred_by'`, carry
  `referredBy` if given).
- **Bulk-dedup policy (corrected — Codex risk).** The server-side identity lookup
  `lookupReviewerIdentity` exists but is **interactive**: it can return `candidates`
  requiring a staff choice, and the manual Add form stops for that confirmation
  [Codex: reviewer-identity-lookup.js:242, ReviewerFindPanel.js:288]. A bulk paste cannot
  stop per-name, so the policy is:
  - **Confident single match** → reuse that person (merge into the existing candidate/
    suggestion; no duplicate).
  - **Ambiguous (`candidates`) / conflict / no match** → inject as an **unresolved**
    `referred` row (do NOT auto-merge a guess). It surfaces selectable-with-verify (next
    bullet); the PD resolves identity in-panel with the existing affordance. This keeps
    the guarantee (never dropped) without risking a wrong-person merge.
- **Enrich, never drop.** Because `referred` is **identity-review-exempt** [VERIFIED via
  reviewer-provenance.js:212-218, 225-226; Codex-confirmed], a seed routes to
  `cited_or_proposal_named` (selectable-with-verify) **even when unresolved** — NOT to
  `needs_identity_review`. A bare/unresolved seed stays visible and selectable with the
  "verify identity" affordance; the SAVE path force-nulls its contact/bibliometrics until
  identity is confirmed/probable (`save-candidates` anchor-or-abstain), so it cannot carry
  a wrong email.
- **Seed-only.** Do NOT add seed names to the analyze prompt. (Codex confirmed Find
  currently sends only `blobUrl`/`excludedNames`/`reviewerCount`/`additionalNotes` to
  `/analyze` — keep it that way.)

### D. Display + persistence — mostly already exists
- **Folded-in section:** `provenanceGroupOf` already routes `referred` into
  `cited_or_proposal_named` [VERIFIED via reviewer-provenance.js:225-226 +
  isIdentityReviewExemptProvenance]. Only change: retitle that `provenanceSections` entry
  in `ReviewerSearchSection.js` from "Cited / proposal-named" to **"Cited, named &
  referred"**. No split. (The indigo "Externally-Referred" badge distinguishes rows.)
- **Applicant-Referred section already exists:** `provenanceGroupOf` routes
  `applicant_suggested` to its own group [VERIFIED via reviewer-provenance.js:231] which
  renders as its own section — only the label changes.
- **Persistence: no new mapping.** `save-candidates.js` writes the source list via
  `saveSourceListForCandidate(candidate)` and `referred` already flows through [VERIFIED
  via save-candidates.js:252,418 + the live req-1002926 probe: the manual Hafezi row
  persisted `wmkf_sources = "staff_manual,referred"`]. Origin reaches Dataverse + the
  Invite tab + Excel export as-is.

### Implementation sequence
1. **Labels (A)** — relabel both kinds in `provenanceLabelForCandidate` (DISPLAY only);
   leave the durable `wmkf_matchreason` "Referred by …" prefix and the `my-candidates`
   reload parser UNCHANGED. Update the three old-label consumers listed in §A (two tests +
   the `ReviewerSearchSection.js:1260` fallback string). Unit-test the label function for
   `referred` (with/without `referredBy`) and `applicant_suggested`.
2. **Section title (D)** — retitle the grounded `provenanceSections` entry to
   "Cited, named & referred".
3. **Input (B)** — add the textarea + `referredSeeds` state + line parser; POST alongside
   `additionalNotes`. (Seed-only: do NOT add to the `/analyze` body.)
4. **Seed injection (C)** — in `/discover`, dedup each seed via `lookupReviewerIdentity`
   (confident match → reuse; ambiguous/conflict/none → inject unresolved), merge survivors
   into `verifiedWithCOI` **before** `rankAllCandidates` (NOT into
   `analysisResult.reviewerSuggestions`), tagged `referred` — then rely on existing exempt
   routing + save force-null.
5. **Docs/gates** — update `reviewer-workbench-lifecycle` + `reviewer-origination` wiki;
   run lint/build + `check:agent-wiki`. (No `status-enum-parity` change.)

### Test plan
- **Unit:** `provenanceLabelForCandidate` (both relabels); the seed line parser
  (name-only, name+email, name+email+url, junk line); dedup — a seed with a confident
  match reuses the person, an ambiguous match injects unresolved (no auto-merge).
- **Regression:** `my-candidates` reload still reconstructs `referredBy` from the
  unchanged `Referred by …` prefix (durable string not relabeled).
- **Integration:** seed 3 names (2 resolvable, 1 bare) → all 3 surface in the grounded
  group, tagged Externally-Referred; the bare one is selectable-with-verify and NOT
  dropped; saving the bare one force-nulls contact until identity is confirmed; the
  Claude analyze prompt is byte-unchanged (seed-only).
- **Verify (drive it):** run a find with seeds; confirm the folded section, the badges,
  save → `wmkf_sources` carries `referred`, Excel shows Externally-Referred.

## Interim path available today (no build)

For a single known name, the manual **Add or Refer a Reviewer** panel works now: enter
the person, put the referrer in **"Referred by"** (tags `referred`), webpage in the note.
No bulk paste, and pre-relabel it shows "Referred by X" not "Externally-Referred". (This
is what the PD did for Hafezi; dedup correctly reused the existing person — no duplicate.)

## Effort / risk

- **Effort:** small. Two label changes + one section retitle + one UI input + a seed-merge
  in the find flow. **No new provenance kind, no new persistence mapping, no
  `provenanceSections` split, no new table, no new route.**
- **Risk:** low-moderate (raised slightly by the Codex review). The `referred` kind — its
  grounded ranking, exempt routing, save force-null, and persistence — already exists and
  is live (the manual Add-or-Refer path). Care points: (1) inject into `verifiedWithCOI`
  before `rankAllCandidates`, NOT into `reviewerSuggestions` (else seeds never reach
  `ranked`); (2) the bulk **dedup** must handle `lookupReviewerIdentity`'s interactive
  ambiguous/conflict outcomes non-interactively (inject-unresolved, never auto-merge a
  guess); (3) relabel the DISPLAY only — leave the durable `wmkf_matchreason` "Referred
  by …" prefix + reload parser intact; move the three old-label consumers (§A).
- **Gates:** `check:agent-wiki`, plus lint/build. No `status-enum-parity` change.
