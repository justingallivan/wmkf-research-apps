---
version: 1
slug: "onents-meeting-tracker-sitevisiteditor-js-e5657c91"
primary_target: "shared/components/meeting-tracker/SiteVisitEditor.js"
related_targets: ["shared/components/meeting-tracker/PostPresentationMaterialsCard.js"]
---

# Meeting Tracker transcription extension

Scope: extend the existing Site Visit editor, not a new page or redesign. Mode: Operate. Staff review a request-bound recording, name speakers, and deliberately publish final materials. Shared drafts, manual name entry, retained TXT/VTT and later corrections are owner-approved. Keep manual uploads and Zoom links unchanged; no automatic identification or new Workbench editor.

## Direction contract

THESIS: Make the transition from recording to reviewed transcript explicit, with one clear next action and no suggestion that draft content is published.

OWN-WORLD: Inherit DESIGN.md and existing SiteVisitEditor/PostPresentationMaterialsCard controls, neutral surfaces, ink primary actions and semantic error states. No new visual identity.

STORY: Staff upload and start, wait for processing, assign detected speakers from grouped suggestions or manual names, save, review and publish. Published TXT/VTT downloads and a separate correction action remain discoverable.

FIRST VIEWPORT: The existing request and Site Visit context remains above the materials area. Add a compact transcription section beside the existing material workflow, with current state and primary action first. In review, show detected count then labeled speaker controls and excerpts; transcript text follows with minute headings. Stack controls on mobile without horizontal overflow.

FORM: Narrow code-led extension of the incumbent surface; no concept-seed or alternate visual direction applies. The signature interaction is choosing a known attendee while retaining a visible manual-name option and explicit saved/unsaved state.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

Verification: synthetic content only; keyboard labels/focus, long names, missing candidate sources, stale save conflicts, navigation during requests, processing/unknown/publish/reconciliation states and desktop/mobile layouts. No new raster assets or DESIGN.md rewrite are planned.
