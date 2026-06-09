---
name: project-reviewer-finder-proposal-doc-context
description: Reviewer-finder gets thin proposal signal from Phase I (narrative only, NO bibliography) → under-delivers reviewers. NEXT cycle combines Phase I+II with richer text + a real bibliography — build a Power Automate flow to assemble ONE clean reviewer-finding doc (narrative + bibliography; drop budget/board/biosketches) to feed Claude.
metadata:
  type: project
  status: active
  scope: reviewer
  last_verified: 2026-06-09 via Justin (request 1002852 diagnosis)
---

## Recall Rule
Read this when: touching reviewer-finder proposal loading (`pages/api/reviewer-finder/load-proposal.js` / document selection), Claude reviewer-suggestion yield, or onboarding the next (combined Phase I+II) grant cycle's intake.

## Current-state problem (diagnosed 2026-06-09 on request 1002852, a Phase I app)
Reviewer-finder under-delivered: asked for 12 reviewers, surfaced ~6 (all "literature-retrieved"). Root cause is THIN PROPOSAL SIGNAL for Phase I, not a single bug:
- Phase I assembles a ~1.4MB "Research Phase I Application" = free-text + budget PDF + budget Excel + governing-board + project narrative + biosketches. **Most of that is noise for reviewer-finding** (budget/board are irrelevant; biosketches are the *applicant's* pubs/collaborators = COI signal, not reviewer signal).
- `load-proposal` reuses grant-reporting's `classifyFile`, which maps any "Phase I" doc → `other` (correct for a Phase II goals-assessment, WRONG for reviewer-finding). So the 1.4MB package is excluded and only the 136KB `ProjectDescription.pdf` (narrative) loads. That's actually ~the right content — but…
- **Phase I collects NO separate bibliography.** "Authors from references/citations" is normally one of Claude's two strongest reviewer sources (prompt priority #2 in `shared/config/prompts/reviewer-finder.js`), so with no bibliography Claude has far less proposal-grounded signal → fewer suggestions. A comparison request (1002794) reportedly returned many more reviewers — presumed (not verified) to be a fuller proposal whose doc carried references.
- Separate, compounding UX issue: in the **Workbench Find tab**, a verified Claude suggestion is re-tagged `literature_retrieved` (discovery-service `provenanceOriginForVerifiedSuggestion`) and shown indistinguishably from a DB hit — no "Claude" label — so Claude's contribution looks like "all databases." The standalone Reviewer Finder keeps a distinct Claude block via `isClaudeSuggestion`; the Workbench groups by provenance kind only.

## Forward plan / ACTION ITEM (next grant cycle)
The next cycle **combines Phase I + Phase II into a single submission** with **richer proposal text (>3 pages)** AND **a separate bibliography**.
**DO (don't forget):** build a **Power Automate flow that assembles ONE clean reviewer-finding document** = project narrative + bibliography, **dropping** budget PDF/Excel, governing board, and biosketches. Feed THAT to Claude via `load-proposal`/`analyze`. More + cleaner context (esp. the bibliography → cited-author reviewers) should restore full reviewer yield.

## Why
Reviewer-finder quality is gated by the proposal context it sees. Phase I's thin, bibliography-less narrative starves Claude's named/cited reviewer sources. The combined cycle is the moment to fix the INPUT (richer text + bibliography + a PA-assembled clean doc), which is higher-leverage than tweaking the discovery code.

## How to apply
- When the combined-cycle intake/documents are being built: create the PA assembly flow and point `load-proposal` at the assembled doc (or update the picker to select it).
- Also fix the cross-purpose `classifyFile` reuse so Phase-I docs aren't wrongly demoted for reviewer-finding — give the Reviewer Finder its own selector instead of grant-reporting's Phase-II-assessment classifier.
- Consider surfacing Claude-origin (and the greyed "needs identity review" Claude names) in the Workbench Find tab the way the standalone does, so the PD can see what Claude found.

Related: [[project-grant-phasing-evolution]], [[project-reviewer-finder-retrieval-redesign]], [[project-reviewer-finder-next-topics]].
