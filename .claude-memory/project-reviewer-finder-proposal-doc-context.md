---
name: project-reviewer-finder-proposal-doc-context
description: Current-cycle Reviewer Finder keeps its exact Reviewer Materials/Phase I resolver; next cycle should use a clean narrative version containing the initial-submission bibliography.
metadata:
  type: project
  status: active
  scope: reviewer
  last_verified: 2026-08-16 via owner direction, current source, prompt source, and prior live current-cycle probe
---

## Recall Rule
Read this when: touching reviewer-finder proposal loading (`pages/api/reviewer-finder/load-proposal.js` / document selection), Claude reviewer-suggestion yield, or onboarding the next (combined Phase I+II) grant cycle's intake.

## Historical diagnosis (2026-06-09, request 1002852, Phase I)
Reviewer-finder under-delivered: asked for 12 reviewers, surfaced ~6 (all "literature-retrieved"). Root cause is THIN PROPOSAL SIGNAL for Phase I, not a single bug:
- Phase I assembles a ~1.4MB "Research Phase I Application" = free-text + budget PDF + budget Excel + governing-board + project narrative + biosketches. **Most of that is noise for reviewer-finding** (budget/board are irrelevant; biosketches are the *applicant's* pubs/collaborators = COI signal, not reviewer signal).
- At that time, `load-proposal` reused grant-reporting's `classifyFile`; the
  best-guess path selected the 136KB `ProjectDescription.pdf` narrative rather
  than a governed reviewer package.
- **Phase I collects NO separate bibliography.** "Authors from references/citations" is normally one of Claude's two strongest reviewer sources (prompt priority #2 in `shared/config/prompts/reviewer-finder.js`), so with no bibliography Claude has far less proposal-grounded signal → fewer suggestions. A comparison request (1002794) reportedly returned many more reviewers — presumed (not verified) to be a fuller proposal whose doc carried references.
- Separate, compounding UX issue: in the **Workbench Find tab**, a verified Claude suggestion is re-tagged `literature_retrieved` (discovery-service `provenanceOriginForVerifiedSuggestion`) and shown indistinguishably from a DB hit — no "Claude" label — so Claude's contribution looks like "all databases." The standalone Reviewer Finder keeps a distinct Claude block via `isClaudeSuggestion`; the Workbench groups by provenance kind only.

## Current contract and forward action

For the final separate Phase II cycle, Power Automate publishes the outbound
reviewer package at exactly:

`Reviewer Materials/Proposal_{Request#}.pdf`

Reviewer Finder's default load prefers that exact file in the active
Dynamics-associated request folder. When it is absent, the current-cycle
compatibility rule selects exactly one active `Phase I/ProjectDescription.pdf`.
It does not use `classifyFile`, best-guess selection, archive files, or
neighboring PDFs. A duplicate canonical file remains an error; a missing or
ambiguous fallback returns the server-listed picker before download/Blob write.
An explicit authenticated `fileKey` remains available only for deliberate
historical/ad-hoc staff analysis.

**Current branch status (2026-08-01; not deployed):**
`codex/reviewer-proposal-binding-refresh` persists a deliberate authenticated
dropdown choice in validated `?proposalFile=` navigation state. Refresh replays
the exact file key, the server re-lists the request's files before accepting it,
and the existing cache contract prevents a new random Blob URL for the same key
from rerunning applicant enrichment. A stale or cross-request key fails closed
and returns to the picker. The same branch now implements the automatic exact
fallback while preserving canonical-first precedence. Request `1003010` has no
canonical package and does have that exact Phase I file, so the patched resolver
selects it without staff input. [VERIFIED via source + focused tests; request
file availability verified 2026-08-01 via owner correction + read-only
Dataverse/SharePoint probe]

Initial Assessment and Field Primer no longer share that source. Their exact
internal input is `AI Materials/ProposalNarrative_{Request#}.pdf`; the
current-cycle Reviewer Finder resolver above is intentionally unchanged.

The next cycle combines Phase I + Phase II into a single submission and will
collect a bibliography at initial submission. Reviewer Finder should then key
off a version of the clean AI narrative that includes that bibliography,
dropping budget PDF/Excel, governing-board material, and biosketches. The
existing reviewer prompt ranks names mentioned in the proposal first and
authors from references/citations second, so the bibliography should improve
proposal-grounded reviewer yield. This is a planned source cutover; the exact
version/path contract is not yet implemented.

## Why
Reviewer-finder quality is gated by the proposal context it sees. Phase I's thin, bibliography-less narrative starves Claude's named/cited reviewer sources. The combined cycle is the moment to fix the INPUT (richer text + bibliography + a PA-assembled clean doc), which is higher-leverage than tweaking the discovery code.

## How to apply
- When the combined-cycle intake/documents are built, define the exact
  Reviewer Finder version/cutover rule for the clean narrative-plus-
  bibliography input. Do not assume the current outbound package path remains
  its long-term analysis source.
- Preserve the dedicated exact Reviewer Finder selector; do not reintroduce
  cross-purpose `classifyFile` or heuristic selection. The only automatic
  compatibility fallback is the exact current-cycle
  `Phase I/ProjectDescription.pdf` rule above; other files remain deliberate,
  server-validated dropdown choices. `Project Narrative.pdf` was an owner-
  corrected naming mistake and is not the current-cycle fallback.
- Consider surfacing Claude-origin (and the greyed "needs identity review" Claude names) in the Workbench Find tab the way the standalone does, so the PD can see what Claude found.

Related: [[project-grant-phasing-evolution]], [[project-reviewer-finder-retrieval-redesign]], [[project-reviewer-finder-next-topics]].
