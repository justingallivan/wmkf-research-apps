---
title: Deliberations Vocabulary — Options Sheet for the Group Decision
domain: product
kind: plan
status: proposed
summary: "One-page options sheet for the owner's after-D26 group decision on Staff Deliberations wording: the eight concepts, the variants in use with current counts, a suggested name for each, and the code names that stay unless the group chooses to migrate them. Pick up mid-November 2026."
canonical: false
owner: product-engineering
related:
  - docs/NOMENCLATURE_GLOSSARY.md
---

# Deliberations vocabulary: options sheet

**Prepared 2026-10-08 (Session 584) for the owner. Pick up mid-November 2026** (owner request), ahead
of the group discussion after the D26 cycle. Nothing here is decided. The decision, and the record
of it, belong in `docs/NOMENCLATURE_GLOSSARY.md` § "Deliberations workflow vocabulary", which holds
the full inventory and the owner direction: settle the names as a group, then rename across the
whole suite in one pass.

**How the counts were taken:** case-insensitive matches in `.js` files under `shared/components` and
`pages` (excluding `pages/api`), on `main` at `fd3366f5e`. Multi-word phrases are reliable; single
words such as "presentation" and "briefing" also match variable names, so treat those as rough.

## The workflow in order (owner, 2026-10-05/06)

PD writes a briefing → staff meet to discuss it → the applicant presents → staff revise the
writeup → group review → leadership review. Each step below needs one name.

| # | Concept | Variants in use (count) | Suggested name | Why |
|---|---|---|---|---|
| 1 | The PD's document shared before the staff meeting | "briefing" (~127), "Deliberation briefing" (9), "pre-site briefing" (4), "Generate Brief" (4), "Pre-Research Presentation Brief" (3) | **Deliberation briefing** | Names the meeting it serves; already the header of the external briefing page Board members open (`pages/external/briefing/[token].js`); does not depend on whether #2 is called a site visit or a presentation. "Briefing" alone is fine as the short form. |
| 2 | The applicant's event | "site visit" (64), "research presentation" (12), "presentation" (rough, ~430), "post-visit" (11) | **Research presentation** | Says what happens; "presentation" is already the Workbench stage word ("Before/After presentation"). "Site visit" stays in code and Dataverse (`wmkf_sitevisit`). |
| 3 | The internal staff meeting before the event | "deliberation session" (16), "Meeting session" (3), "PC deliberation session" (1) | **Deliberation session** | Already dominant. Only the "Meeting session" page title (`SessionEditor.js:613`) needs changing. |
| 4 | The staff working document that becomes the Final Writeup | "working writeup" (15), "working draft" (4), "Word Draft" (3), "Pre-Site Visit Writeup" (2), "post-presentation writeup" (1), "Site Visit working document" (1) | **Writeup**, with the step titled **Post-presentation writeup** (owner, 2026-10-06) | One noun from draft to Final ("writeup" → "Final writeup"); drops "draft", "Word Draft" and "Pre-Site Visit". |
| 5 | The applicant's slides and bios | "presentation materials" (17, of which 8 are "research presentation materials"), "site visit materials" (10) | **Presentation materials** | Matches #2; shortest; already the most used. |
| 6 | The recording and transcripts afterwards | "recording and transcripts" (2), "post-presentation materials" (2), "Board presentation link" (2) | **Recording and transcripts** | Already the Workbench step title; plain. |
| 7 | The point in a recording where the presentation ends and staff discussion starts | "presentation end" (25, shared with the scheduled end of #2), "last turn of the presentation" (1) | **Discussion start** | Today "presentation end" means two things: the scheduled end that triggers writeup preparation, and the split point in the recording. A different word for the split ends the clash. |
| 8 | The Workbench area | "Staff Deliberations" (17; request tab) vs "Staff deliberations" (9; list view) | **No change needed** | Not a conflict: request tabs use Title Case ("Final Writeup", "Review Panel"; `pages/workbench/[requestId].js:57-59`) and the list views use sentence case (`WorkbenchViewsNav.js:26`). Confirm the group is happy with that convention. |

## What a rename does not touch unless the group chooses to

These are code and storage names, not wording staff see. Leave them and document the mapping:
API paths (`/api/workbench/pre-site-visit*`, `/api/workbench/pre-rp-brief*`,
`/api/workbench/site-visit/*`), services under `lib/services/pre-site-visit/`,
`lib/services/pre-rp-brief/` and `lib/services/site-visit-materials/`, the Dataverse `wmkf_sitevisit`
activity and Meeting Tracker records, Request Document artifact types
(`shared/config/requestDocument.js`), card anchors (`#deliberations-status|briefing|writeup`), and
SharePoint file names such as "… Site Visit Presentation.pdf".

## After the group decides

1. Record each choice as a `canonicalName` in the glossary, with the other variants as
   `legacyAliases`.
2. Rename across the suite in one pass (Workbench, Meeting Tracker, Board pages, email copy and
   settings defaults, Admin, docs), on a branch. Recount with the method above to confirm no
   variant is left in user-facing text.
3. Email copy held in admin settings (seeded defaults) changes by editing the setting, not code.
