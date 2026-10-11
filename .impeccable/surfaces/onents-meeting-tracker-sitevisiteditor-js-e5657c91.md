---
version: 1
slug: "onents-meeting-tracker-sitevisiteditor-js-e5657c91"
primary_target: "shared/components/meeting-tracker/SiteVisitEditor.js"
related_targets: ["shared/components/meeting-tracker/RecordingAndTranscriptCard.js", "shared/components/meeting-tracker/SiteVisitMaterialsCard.js", "shared/components/meeting-tracker/ArtifactRow.js", "shared/components/meeting-tracker/AttendeePicker.js"]
---

# Site Visit page (Record Detail)

Scope: the whole Site Visit page was redesigned under DESIGN.md's Page Structure rules on branch `claude/site-visit-redesign` (2026-10-11; plan `docs/plans/SITE_VISIT_PAGE_REDESIGN_PLAN_2026-10-10.md`). Mode: Operate. Page type: Record Detail. This supersedes the earlier "transcription extension, not a redesign" scope. Staff schedule the visit, collect applicant materials, import the Zoom recording, check speakers and the presentation end, and publish what the Board sees.

## Direction contract

THESIS: Every finished artifact is one row. Its name is the link, status is a chip, re-run and replace actions live in a "…" menu, and only the next step is a visible action. Results are organized for staff, who all use this page: a Presentation card and a Staff discussion card. The Board, used rarely, gets one card at the bottom with its link and a status-only list of what it shows.

OWN-WORLD: Inherit DESIGN.md (Clear Workbench). Neutral surfaces, ink primary only for confirmations, semantic chips, and the shared `Button` and Workbench `OverflowMenu`. No new visual identity.

STORY: The header names the request (number, institution, title, program, cycle). Visit details is read first, with editing behind Edit. In the edit form, organizer and attendees are search pickers, with each person Required or Optional. In Applicant materials, each item is a row and the heading shows the one next step. Then four cards in work order (owner, 2026-10-11): Recording setup (steps 1 and 2, one line each once done, and the one Refresh), Presentation (video, summary, transcript), Staff discussion (summary, transcript), and Board materials (link actions plus a readiness list).

FIRST VIEWPORT: Header, the Visit details summary, and the top of Applicant materials. Desktop first; narrow widths only avoid overflow.

FORM: `ArtifactRow` (name link, status chip, detail, inline action or menu) is the shared row for Results and Applicant materials. Consent to send material to the LLM provider is asked in an inline confirmation at the moment of Summarize, never kept on screen.

FINISH: unreviewed and undocumented is unfinished. Each build slice had Codex adversarial review; the detector run on 2026-10-11 found no issues. Open: the header status chip (plan §9.6 commit 7) and a live desktop check on a real request (owner-run, because the page reads Production).

Verification: synthetic content in jsdom suites for every slice; mutation checks for each behavior fix. No new raster assets; DESIGN.md is unchanged.
