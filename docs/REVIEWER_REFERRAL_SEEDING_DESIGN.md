---
title: "Reviewer Referral Seeding & Provenance Design"
domain: reviewers
kind: plan
status: draft
summary: "Guarantee consultant-referred names into the reviewer pool via a code-owned seed path; tag them 'Referral' (reuse existing referred provenance kind)."
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

# Reviewer Referral Seeding & Provenance Design

**Status: DRAFT / proposed — not approved for build.** Written in response to a PD
report on req 1002926 (see "Origin" below). Decide the remaining open questions
before implementing.

**Resolved decision (S318):** the tag is **"Referral"**, implemented by **reusing the
existing `referred` provenance kind** — NOT a new `pd_preferred` kind. A consultant/
colleague recommending a name is a referral; the `referred` kind is already grounded,
never-dropped, and ranking-bonused. The referrer's name (e.g. "Doug N") rides along as
detail via the existing `referredBy`. This drops the provenance-enum change entirely
(no `status-enum-parity` churn). Sections below reflect this.

## Origin (the report)

A PD pasted a consultant-supplied list of names into the reviewer-finder **notes**
field at the start of a find, expecting the tool to (a) definitely surface those
people and (b) mark them as PD-recommended. Observed instead: only *some* of the
names came back, no assurance they were used vs. independently re-found, and even
editing the underlying prompt to "use these with high confidence" did not force them
in. She then added one (Mohammad Hafezi) via the manual **Add or Refer** panel.

## Root cause (verified in code, S318)

The notes field **is** sent to Claude — injected as `ADDITIONAL CONTEXT FROM USER`
near the top of the analyze prompt (`shared/config/prompts/reviewer-finder.js:71`,
`lib/services/reviewer-prompt-composer.js:27`). But nothing **guarantees** those
names survive, and three code-owned mechanisms *downstream of the prompt* actively
work against a prompt-only guarantee:

1. **Fixed target count** (`DEFAULT_REVIEWER_COUNT`, default 15) — Claude returns a
   capped best-fit set mixing the PD's names with its own; extras get crowded out.
2. **Code-owned anti-fabrication block** (`ANALYZE_INTEGRITY_BLOCK`, appended to
   *every* prompt incl. Dataverse/UI overrides) tells the model to return **FEWER**
   real reviewers rather than include a name it can't confidently identify — a bare
   name + webpage is exactly what it will drop.
3. **Discover-stage verification** (`pages/api/reviewer-finder/discover.js`) re-checks
   each name against real publication profiles and ranks it; unresolved names rank
   low or fall away.

**Conclusion: the guarantee cannot live in prompt wording — it must live in code, as
a seed path that bypasses the count cap and the drop.** The finder is a discovery +
verification engine; PD-recommended names are *already known* and should not be
subject to discovery economics at all.

## Design principle

Separate **discovery** (find unknown reviewers) from **known-name entry** (the PD
already has these people, referred by consultants/colleagues). Referred names enter
through a dedicated, code-owned seed path that:
- **always surfaces them** (own results group, never crowded out),
- **enriches/verifies for contact but never silently drops** (consistent with the
  established recall-over-precision posture: "surface, don't silently drop"),
- **tags provenance `referred`** (display label **"Referral"**) so they are labeled,
  ranked with the grounded bonus, and persisted with that origin.

## Proposed changes (seams)

### A. Reuse the existing `referred` provenance kind (no new enum)
`lib/utils/reviewer-provenance.js` already has everything needed — no enum change:
- `PROVENANCE_KINDS.REFERRED` exists, is in `GROUNDED_RANKING_BONUS_KINDS` (ranks above
  literature-retrieved), and has the `REFERRED_BY` seed role.
- **Only change:** relabel the display in `provenanceLabelForCandidate` from
  `Referred by ${referredBy}` / `Referred` to **`Referral · ${referredBy}`** / `Referral`.
  This relabels **all** referred rows (contacted-reviewer referrals too) — an
  intentional, consistent umbrella. Treated as **selectable-with-verify** and
  **never auto-excluded** (already true for `referred`).

### B. Structured input (distinct from freeform notes)
`shared/components/reviewers/ReviewerSearchSection.js`:
- New "Reviewers referred to you" textarea, **separate** from `additionalNotes`
  (keep notes for actual instructions). One entry per line, tolerant format:
  `Name <tab/comma> optional email <tab/comma> optional affiliation/URL`.
- Parse to `referredSeeds: [{ name, email?, affiliation?, url?, referredBy? }]`; POST to
  the find flow alongside `additionalNotes`.

### C. Guaranteed seed injection (the code guarantee)
`pages/api/reviewer-finder/analyze.js` + `discover.js`:
- Seed each entry into the candidate pool with `provenance.kind = 'referred'`
  (`seedRole: 'referred_by'`) **before** the count-capped merge, so it is never
  crowded out.
- Run the normal contact/identity **enrichment** on seeds, but **surface-don't-drop**:
  a seed that can't be confidently resolved routes to a "Referral — confirm identity"
  affordance (reuse the existing `needs_identity_review` confirm flow), it is *not*
  discarded.
- Optionally still pass the names to Claude's analyze as trusted context so it can add
  *related* peers — but the guarantee comes from the seed path, not the prompt.

### D. Display + persistence (mostly already exists)
- `provenanceGroupOf` currently routes `referred` into the **`cited_or_proposal_named`**
  group [VERIFIED via lib/utils/reviewer-provenance.js: REFERRED is identity-review-exempt
  → returns `cited_or_proposal_named`]. To give referrals their **own "Referrals" section**
  at the top (so the PD sees their list distinctly), split them out in the
  `provenanceSections` array in `ReviewerSearchSection.js` (a small change; mirrors the
  section work already shipped for the sort toggle). If a separate section isn't wanted,
  they already appear in the top "Cited / proposal-named" section with the "Referral" badge.
- Persistence needs **no new mapping**: `save-candidates.js` writes the source list via
  `saveSourceListForCandidate(candidate)` and `referred` already flows through [VERIFIED
  via save-candidates.js:252,418 + the live req-1002926 probe: the manual Hafezi row
  persisted `wmkf_sources = "staff_manual,referred"`]. Origin reaches Dataverse + the
  Invite tab + Excel export as-is.

## Interim path available today (no build)

For names the PD *already has*, the manual **Add or Refer a Reviewer** panel works
now: enter the person and put the PD's name in **"Referred by"** — that tags the row
`referred` (a grounded, never-dropped signal) and the note field holds the webpage.
This works one-at-a-time but has no **bulk paste**, and (pre-relabel) shows "Referred
by X" rather than "Referral". (This is what the PD effectively did for Hafezi; the
dedup correctly reused the existing person — no duplicate was created.) The build below
adds the bulk field + the guarantee on top of this same `referred` mechanism.

## Open questions (decide before build)

1. ~~New kind vs. reuse `referred`?~~ **RESOLVED (S318): reuse `referred`, label
   "Referral"** (see top). No new enum, no `status-enum-parity` churn.
2. **Own "Referrals" section, or fold into the existing top group?** Referred rows
   currently render inside "Cited / proposal-named". A dedicated section makes the PD's
   list scannable but needs the small `provenanceSections` split in §D. *Recommendation:
   dedicated section — the whole point is seeing your referred list at a glance.*
3. **Bypass Claude entirely for seeds, or also feed analyze?** *Recommendation: seed
   directly (the guarantee) AND pass as trusted context (bonus related peers).*
4. **Bulk paste format** — freeform lines (tolerant parse) vs. a stricter CSV. Start
   tolerant; names-only is the common case.
5. **Identity resolution for bare names** — a name with no email/URL may not resolve;
   confirm the surface-don't-drop routing (confirm-identity affordance) is acceptable
   UX, or require at least an email/affiliation per seed.

## Effort / risk

- **Effort:** small-to-medium. One relabel (`provenanceLabelForCandidate`) + one UI
  input + a seed-merge in the find flow + an optional section split. **No new provenance
  kind, no new persistence mapping, no new table, no new route.**
- **Risk:** low. The `referred` kind, its grounded ranking, and its persistence already
  exist and are live (the manual Add-or-Refer path). Main care point: dedup seeds against
  existing suggestions to avoid the duplicate-person hazard — reuse the same lookup the
  manual Add panel uses.
- **Gates:** `check:agent-wiki` (update `reviewer-workbench-lifecycle` /
  `reviewer-origination`), plus lint/build. (No `status-enum-parity` change — the enum
  is untouched.)
