---
name: project-reviewer-finder-proposal-doc-context
description: Reviewer Finder currently defaults to the exact canonical Reviewer Materials proposal; the proposed stabilization plan adds one exact legacy Project Narrative fallback, which the Session 393 Fable challenge must independently evaluate before implementation.
metadata:
  type: project
  status: active
  scope: reviewer
  last_verified: 2026-08-01 via source, branch tests, and live read-only request 1003010 SharePoint probe
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

For the final separate Phase II cycle and going forward, Power Automate
publishes one clean proposal package at exactly:

`Reviewer Materials/Proposal_{Request#}.pdf`

Reviewer Finder's default load now requires that exact file in the active
Dynamics-associated request folder. It does not use `classifyFile`, best-guess
selection, the Proposal tab's `Phase I/ProjectDescription.pdf`, archive files,
or neighboring PDFs. Missing or duplicate active canonical files fail before
download/Blob write. An explicit authenticated `fileKey` remains available
only for deliberate historical/ad-hoc staff analysis.

**Current branch status (2026-08-01; not deployed):**
`codex/reviewer-proposal-binding-refresh` persists a deliberate authenticated
dropdown choice in validated `?proposalFile=` navigation state. Refresh replays
the exact file key, the server re-lists the request's files before accepting it,
and the existing cache contract prevents a new random Blob URL for the same key
from rerunning applicant enrichment. A stale or cross-request key fails closed
and returns to the picker. [VERIFIED via source + focused tests]

The automatic fallback proposal remains open: preserve the canonical reviewer
package as first priority, then (if separately implemented) select exactly one
server-listed file named `Project Narrative.pdf`. A duplicate canonical file
must remain an error. This is not permission to restore `classifyFile`,
best-guess PDFs, or broad filename heuristics. Request `1003010` currently has
neither canonical nor `Project Narrative.pdf`; its one substantive proposal is
`Phase I/ProjectDescription.pdf`, so it continues through the deliberate picker
whose validated binding now survives reload. [VERIFIED 2026-08-01 via read-only
Dataverse + SharePoint probe]

The next cycle combines Phase I + Phase II into a single submission with richer
proposal text and a separate bibliography. Power Automate should still
assemble the canonical file as project narrative + bibliography, dropping
budget PDF/Excel, governing board, and biosketches. More and cleaner context,
especially the bibliography, should improve cited-author reviewer yield.

## Why
Reviewer-finder quality is gated by the proposal context it sees. Phase I's thin, bibliography-less narrative starves Claude's named/cited reviewer sources. The combined cycle is the moment to fix the INPUT (richer text + bibliography + a PA-assembled clean doc), which is higher-leverage than tweaking the discovery code.

## How to apply
- When the combined-cycle intake/documents are built, keep the PA output at
  the same exact canonical path; the legacy fallback does not change the
  outbound package contract.
- Preserve the dedicated exact Reviewer Finder selector; do not reintroduce
  cross-purpose `classifyFile` or heuristic selection. The only proposed
  automatic compatibility fallback is the exact legacy
  `Project Narrative.pdf` rule above; other files remain deliberate,
  server-validated dropdown choices.
- Consider surfacing Claude-origin (and the greyed "needs identity review" Claude names) in the Workbench Find tab the way the standalone does, so the PD can see what Claude found.

Related: [[project-grant-phasing-evolution]], [[project-reviewer-finder-retrieval-redesign]], [[project-reviewer-finder-next-topics]].
