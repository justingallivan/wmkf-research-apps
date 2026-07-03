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
decisions). Written in response to a PD report on req 1002926 (see §Origin). Pending a
Codex plan review before implementation.

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
No enum change. In `provenanceLabelForCandidate`:
- `REFERRED`: `Referred by ${referredBy}` / `Referred` → **`Externally-Referred ·
  ${referredBy}`** / `Externally-Referred`. Relabels ALL referred rows (contacted-reviewer
  referrals too) — intentional umbrella.
- `APPLICANT_SUGGESTED`: `Applicant-suggested` → **`Applicant-Referred`**.
No behavior change beyond the label; both kinds keep their existing grouping/selection/
ranking.

### B. Structured input — `shared/components/reviewers/ReviewerSearchSection.js`
- New "Externally-referred reviewers" textarea (consultants/colleagues — **not** the
  applicant), **separate** from `additionalNotes` (notes stays for instructions). One
  entry per line, tolerant parse to `referredSeeds: [{ name, email?, affiliation?, url? }]`.
- POST `referredSeeds` to the find flow alongside `additionalNotes`. Applicant picks need
  no input here — they arrive through the existing applicant-suggested pipeline.

### C. Guaranteed seed injection — the find flow (`analyze.js` / `discover.js`)
- **Dedup first:** match each seed against existing roster rows / suggestions using the
  SAME lookup the manual **Add or Refer** panel uses (reuse it — do not hand-roll a name
  match), so a seed that is already a candidate updates rather than duplicating (avoids
  the recurring duplicate-person hazard).
- **Inject before the count cap:** add each surviving seed to the candidate pool with
  `provenance.kind = 'referred'` (`seedRole: 'referred_by'`, carry `referredBy` if given)
  **before** the `DEFAULT_REVIEWER_COUNT` merge, so it can never be crowded out.
  **[LOCATE — not yet traced this session]** the exact injection seam: analyze emits
  suggestions → discover verifies/ranks → the per-request pool is assembled somewhere in
  that chain; the seed merge must land where it survives the cap and reaches
  `displayCandidates`/save. Pinning this seam is the first implementation task (and a key
  thing for the plan review to confirm).
- **Enrich, never drop:** run the normal contact/identity enrichment on seeds. Because
  `referred` is **identity-review-exempt** [VERIFIED via reviewer-provenance.js:212-218,
  225-226], a seed routes to `cited_or_proposal_named` (selectable-with-verify) **even
  when unresolved** — it is NOT sent to `needs_identity_review`. A bare/unresolved seed
  therefore stays visible and selectable with the "verify identity" affordance; the SAVE
  path force-nulls its contact/bibliometrics until identity is confirmed/probable
  (`save-candidates` anchor-or-abstain), so it cannot carry a wrong email.
- **Seed-only:** do NOT add seed names to the analyze prompt.

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
1. **Labels (A)** — relabel both kinds in `provenanceLabelForCandidate`; unit-test the
   label function for `referred` (with/without `referredBy`) and `applicant_suggested`.
2. **Section title (D)** — retitle the grounded `provenanceSections` entry.
3. **Input (B)** — add the textarea + `referredSeeds` state + line parser; POST it.
4. **Seed injection (C)** — dedup (reuse manual-Add lookup) → inject as `referred` before
   the count cap → enrich → rely on existing exempt routing + save force-null.
5. **Docs/gates** — update `reviewer-workbench-lifecycle` + `reviewer-origination` wiki;
   run lint/build + `check:agent-wiki`. (No `status-enum-parity` change.)

### Test plan
- **Unit:** `provenanceLabelForCandidate` (both relabels); the seed line parser
  (name-only, name+email, name+email+url, junk line); dedup collapses a seed that matches
  an existing suggestion.
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
- **Risk:** low. The `referred` kind — its grounded ranking, exempt routing, save
  force-null, and persistence — already exists and is live (the manual Add-or-Refer path).
  Main care point: the seed **dedup** must reuse the manual-Add lookup to avoid the
  duplicate-person hazard; the injection point must be **before** the count cap.
- **Gates:** `check:agent-wiki`, plus lint/build. No `status-enum-parity` change.
