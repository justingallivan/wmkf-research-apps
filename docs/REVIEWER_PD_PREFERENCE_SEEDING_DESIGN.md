---
title: "Reviewer PD-Preference Seeding & Provenance Design"
domain: reviewers
kind: plan
status: draft
summary: "Guarantee PD-recommended names into the reviewer-finder pool and tag them PD-preferred — via a code-owned seed path, not prompt wording."
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

# Reviewer PD-Preference Seeding & Provenance Design

**Status: DRAFT / proposed — not approved for build.** Written in response to a PD
report on req 1002926 (see "Origin" below). Decide the open questions in §6 before
implementing.

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
already has these people). PD-recommended names enter through a dedicated, code-owned
seed path that:
- **always surfaces them** (own results group, never crowded out),
- **enriches/verifies for contact but never silently drops** (consistent with the
  established recall-over-precision posture: "surface, don't silently drop"),
- **tags provenance `pd_preferred`** so they are labeled, ranked with the grounded
  bonus, and persisted with that origin.

## Proposed changes (seams)

### A. New provenance kind `pd_preferred`
`lib/utils/reviewer-provenance.js`:
- Add `PD_PREFERRED: 'pd_preferred'` to `PROVENANCE_KINDS`.
- Add it to `GROUNDED_RANKING_BONUS_KINDS` (a strong human signal, like `REFERRED` /
  `PROPOSAL_NAMED`) so it ranks above literature-retrieved.
- Add a display label in the sanitizer (`… 'PD-recommended' …`) and a `SEED_ROLES`
  entry (e.g. `PD_PREFERRED: 'pd_preferred'`).
- Treat as **selectable-with-verify** and **never auto-excluded**.

### B. Structured input (distinct from freeform notes)
`shared/components/reviewers/ReviewerSearchSection.js`:
- New "PD-recommended reviewers" textarea, **separate** from `additionalNotes`
  (keep notes for actual instructions). One entry per line, tolerant format:
  `Name <tab/comma> optional email <tab/comma> optional affiliation/URL`.
- Parse to `pdRecommended: [{ name, email?, affiliation?, url? }]`; POST to the find
  flow alongside `additionalNotes`.

### C. Guaranteed seed injection (the code guarantee)
`pages/api/reviewer-finder/analyze.js` + `discover.js`:
- Seed each `pdRecommended` entry into the candidate pool with
  `provenance.kind = 'pd_preferred'` **before** the count-capped merge, so it is
  never crowded out.
- Run the normal contact/identity **enrichment** on seeds, but **surface-don't-drop**:
  a seed that can't be confidently resolved routes to a "PD-recommended — confirm
  identity" affordance (reuse the existing `needs_identity_review` confirm flow),
  it is *not* discarded.
- Optionally still pass the names to Claude's analyze as trusted context so it can add
  *related* peers — but the guarantee comes from the seed path, not the prompt.

### D. Display + persistence
- `provenanceGroupOf` → new group `pd_preferred`; add a "PD-recommended" section in
  `ReviewerSearchSection.js` (mirrors the section work already shipped for the sort
  toggle) at the top of the list.
- `pages/api/reviewer-finder/save-candidates.js` → map `pd_preferred` into
  `wmkf_sources` (e.g. `staff_manual,pd_preferred`) so the origin persists to
  Dataverse and shows on the Invite tab + Excel export.

## Interim path available today (no build)

For names the PD *already has*, the manual **Add or Refer a Reviewer** panel works
now: enter the person and put the PD's name in **"Referred by"** — that tags the row
`referred` (a grounded, never-dropped signal) and the note field holds the webpage.
This does not give a dedicated "PD preference" label or bulk paste, but it reliably
adds a known person without fighting the discovery pipeline. (This is what the PD
effectively did for Hafezi; the dedup correctly reused the existing person — no
duplicate was created.)

## Open questions (decide before build)

1. **New `pd_preferred` kind vs. reuse `referred`?** A distinct kind gives a clear
   "PD preference" label and its own section but touches the provenance enum,
   status-enum-parity gate, and persistence mapping. Reusing `referred` is cheaper
   but conflates PD preference with contacted-reviewer referrals. *Recommendation:
   new kind — the label is the whole point of the request.*
2. **Bypass Claude entirely for seeds, or also feed analyze?** *Recommendation: seed
   directly (the guarantee) AND pass as trusted context (bonus related peers).*
3. **Bulk paste format** — freeform lines (tolerant parse) vs. a stricter CSV. Start
   tolerant; names-only is the common case.
4. **Identity resolution for bare names** — a name with no email/URL may not resolve;
   confirm the surface-don't-drop routing (confirm-identity affordance) is acceptable
   UX, or require at least an email/affiliation per seed.

## Effort / risk

- **Effort:** medium. Provenance enum + one UI input + a seed-merge in the find flow
  + one persistence mapping + one display section. No new table, no new route.
- **Risk:** low-moderate. Touches the provenance enum (run `check:status-enum-parity`)
  and the find-flow merge (dedup seeds against existing suggestions to avoid the
  duplicate-person hazard — reuse the same lookup the manual Add panel uses).
- **Gates:** `check:status-enum-parity`, `check:agent-wiki` (update
  `reviewer-workbench-lifecycle` / `reviewer-origination`), plus lint/build.
