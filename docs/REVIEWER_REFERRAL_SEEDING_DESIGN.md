---
title: "Reviewer Referral Seeding & Provenance Design"
domain: reviewers
kind: plan
status: draft
summary: "Guarantee externally-referred names into the reviewer pool via a code-owned seed path; two labels (Externally-Referred / Applicant-Referred) on existing kinds."
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

**Resolved decision (S318):** distinguish **two** referral lanes, each on an
**existing** provenance kind — NO new enum:
- **Externally-Referred** = the `referred` kind — names from consultants/colleagues (and
  contacted-reviewer referrals). This is what the new seed field feeds. Already grounded,
  never-dropped, ranking-bonused; the referrer ("Doug N") rides along via `referredBy`.
- **Applicant-Referred** = the existing `applicant_suggested` kind — names the *applicant*
  put forward in their proposal. Already has its own pipeline (enrich-recommended,
  promote-applicant-reviewer) and, deliberately, is **not auto-selected** (defaults to
  needing PD promotion) — the right posture for a possibly-biased applicant pick.

The change is purely a **display relabel** of both kinds (see §A) plus the seed field;
the applicant lane already exists end-to-end. No `status-enum-parity` churn.

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

Separate **discovery** (find unknown reviewers) from **known-name entry** (names the PD
already has, referred by consultants/colleagues). Externally-referred names enter through
a dedicated, code-owned seed path that:
- **always surfaces them** (own results group, never crowded out),
- **enriches/verifies for contact but never silently drops** (consistent with the
  established recall-over-precision posture: "surface, don't silently drop"),
- **tags provenance** so they are labeled (**"Externally-Referred"** for the seed lane;
  the parallel **"Applicant-Referred"** lane is the pre-existing `applicant_suggested`
  kind), ranked appropriately, and persisted with that origin.

## Proposed changes (seams)

### A. Relabel two existing provenance kinds (no new enum)
`lib/utils/reviewer-provenance.js` already has both kinds — no enum change:
- `REFERRED` — in `GROUNDED_RANKING_BONUS_KINDS`, `REFERRED_BY` seed role; the **seed
  lane** (consultants/colleagues + contacted-reviewer referrals).
- `APPLICANT_SUGGESTED` — own group, deliberately **NOT** in the grounded-bonus set and
  **not auto-selected** (defaults to needing PD promotion) [VERIFIED via
  reviewer-provenance.js:34-38 (bonus set) + ReviewerSearchSection.js:1012 +
  isApplicantOriginCandidate]; the **applicant lane**.
- **Only change: relabel the display** in `provenanceLabelForCandidate`:
  - `REFERRED`: `Referred by ${referredBy}` / `Referred` → **`Externally-Referred ·
    ${referredBy}`** / `Externally-Referred`. Relabels all referred rows (contacted-reviewer
    referrals too) — intentional umbrella.
  - `APPLICANT_SUGGESTED`: `Applicant-suggested` → **`Applicant-Referred`**.
  No behavior change beyond the label; both kinds keep their existing selection/ranking.

### B. Structured input (distinct from freeform notes)
`shared/components/reviewers/ReviewerSearchSection.js`:
- New "Externally-referred reviewers" textarea (consultants/colleagues — **not** the
  applicant), **separate** from `additionalNotes` (keep notes for actual instructions).
  One entry per line, tolerant format:
  `Name <tab/comma> optional email <tab/comma> optional affiliation/URL`.
- Parse to `referredSeeds: [{ name, email?, affiliation?, url?, referredBy? }]`; POST to
  the find flow alongside `additionalNotes`. (Applicant picks need no input here — they
  arrive through the existing applicant-suggested pipeline.)

### C. Guaranteed seed injection (the code guarantee)
`pages/api/reviewer-finder/analyze.js` + `discover.js`:
- Seed each entry into the candidate pool with `provenance.kind = 'referred'`
  (`seedRole: 'referred_by'`) **before** the count-capped merge, so it is never
  crowded out.
- Run the normal contact/identity **enrichment** on seeds, but **surface-don't-drop**:
  a seed that can't be confidently resolved routes to an "Externally-Referred — confirm
  identity" affordance (reuse the existing `needs_identity_review` confirm flow), it is
  *not* discarded.
- Optionally still pass the names to Claude's analyze as trusted context so it can add
  *related* peers — but the guarantee comes from the seed path, not the prompt.

### D. Display + persistence (mostly already exists)
- **Externally-Referred section:** `provenanceGroupOf` currently routes `referred` into
  the **`cited_or_proposal_named`** group [VERIFIED via reviewer-provenance.js: REFERRED
  is identity-review-exempt → returns `cited_or_proposal_named`]. To give it its **own
  "Externally-Referred" section** at the top, split it out in the `provenanceSections`
  array in `ReviewerSearchSection.js` (small change; mirrors the sort-toggle section work).
- **Applicant-Referred section already exists:** `provenanceGroupOf` routes
  `applicant_suggested` to its own `applicant_suggested` group [VERIFIED via
  reviewer-provenance.js:231], which already renders as its own section — only the label
  changes.
- **Persistence needs no new mapping:** `save-candidates.js` writes the source list via
  `saveSourceListForCandidate(candidate)` and `referred` already flows through [VERIFIED
  via save-candidates.js:252,418 + the live req-1002926 probe: the manual Hafezi row
  persisted `wmkf_sources = "staff_manual,referred"`]. Origin reaches Dataverse + the
  Invite tab + Excel export as-is.

## Interim path available today (no build)

For names the PD *already has*, the manual **Add or Refer a Reviewer** panel works
now: enter the person and put the PD's name in **"Referred by"** — that tags the row
`referred` (a grounded, never-dropped signal) and the note field holds the webpage.
This works one-at-a-time but has no **bulk paste**, and (pre-relabel) shows "Referred
by X" rather than "Externally-Referred". (This is what the PD effectively did for Hafezi;
the dedup correctly reused the existing person — no duplicate was created.) The build
below adds the bulk field + the guarantee on top of this same `referred` mechanism.

## Open questions (decide before build)

1. ~~New kind vs. reuse existing?~~ **RESOLVED (S318): two lanes on two existing kinds —
   `referred` → "Externally-Referred", `applicant_suggested` → "Applicant-Referred"**
   (see top). No new enum, no `status-enum-parity` churn.
2. **Own "Externally-Referred" section, or fold into the existing top group?** Referred
   rows currently render inside "Cited / proposal-named". A dedicated section makes the
   consultant list scannable but needs the small `provenanceSections` split in §D.
   (Applicant-Referred already has its own section.) *Recommendation: dedicated section —
   the whole point is seeing your referred list at a glance.*
3. **Bypass Claude entirely for seeds, or also feed analyze?** *Recommendation: seed
   directly (the guarantee) AND pass as trusted context (bonus related peers).*
4. **Bulk paste format** — freeform lines (tolerant parse) vs. a stricter CSV. Start
   tolerant; names-only is the common case.
5. **Identity resolution for bare names** — a name with no email/URL may not resolve;
   confirm the surface-don't-drop routing (confirm-identity affordance) is acceptable
   UX, or require at least an email/affiliation per seed.

## Effort / risk

- **Effort:** small-to-medium. Two label changes (`provenanceLabelForCandidate`) + one UI
  input + a seed-merge in the find flow + an optional section split. **No new provenance
  kind, no new persistence mapping, no new table, no new route.**
- **Risk:** low. The `referred` kind, its grounded ranking, and its persistence already
  exist and are live (the manual Add-or-Refer path). Main care point: dedup seeds against
  existing suggestions to avoid the duplicate-person hazard — reuse the same lookup the
  manual Add panel uses.
- **Gates:** `check:agent-wiki` (update `reviewer-workbench-lifecycle` /
  `reviewer-origination`), plus lint/build. (No `status-enum-parity` change — the enum
  is untouched.)
