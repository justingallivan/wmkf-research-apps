---
title: Meeting Tracker Landing Structure and Mockups
domain: product
kind: plan
status: proposed
summary: Owner-agreed landing structure with desktop and narrow-screen mockups; terminology is provisional and app implementation remains pending.
canonical: false
owner: product-engineering
related:
  - docs/plans/review/PROPOSAL_WORKFLOW_VOCABULARY_2026-10-19.md
---

# Meeting Tracker landing structure and mockups

## Decision and boundary

[VERIFIED via owner decisions in the Codex chat, 2026-10-20] The owner agreed to a cycle schedule landing page whose primary job is to scan the cycle’s requests and open the next task. Sessions have a separate task view within Meeting Tracker. Both session and visit actions remain visible for every request, including on narrow screens.

[VERIFIED via owner instruction, 2026-10-20] Save the structure and mockups for resumption after meeting names are settled. Meeting names and related labels are provisional. This is approval of the structure for design continuation, not authorization to change the application. No application code is changed by this handoff.

## Saved artifacts

- [Standalone responsive HTML mockup](meeting-tracker-2026-10-20/index.html) — open locally in a browser; controls are static.
- [Desktop screenshot, 1440px wide](meeting-tracker-2026-10-20/desktop.png).
- [Narrow-screen screenshot, 390px wide](meeting-tracker-2026-10-20/narrow.png).
- [Original audit](../../../.impeccable/critique/2026-10-19T22-21-01Z__nts-meeting-tracker-meetingtrackerlist-js-ef43d395.md) — dated source and production inspection, not a fresh runtime assessment.
- [Vocabulary review](PROPOSAL_WORKFLOW_VOCABULARY_2026-10-19.md) — proposed names and owner-edited deck, awaiting colleague feedback.

All records, institutions, proposal titles and dates in the mockups are illustrative. The screenshots show the proposed composition, not production. There are no remote assets, live reads or write actions in the HTML.

## Agreed structure

1. **Cycle schedule is the default view; Sessions is a separate view.** Keep the main page focused on request lookup and scheduling visibility. The Sessions view will carry session creation and session navigation; its detailed design remains pending.
2. **Compact request rows.** Show request number, institution and proposal title; separate session and visit columns show the relevant date and explicit Open/Schedule action. Preserve test-request distinctions when eventually implementing against real records.
3. **One scope toolbar.** Program, cycle, My/All scope and request search sit above the list. Keep result counts and one materials-status filter near the list. Do not put summary cards ahead of the requests.
4. **Materials support the task.** Show the precise materials status without implying that one completed artifact means the request is complete. The proposed menu keeps existing status meanings and counts; zero-result choices should be disabled.
5. **Progressive detail.** PD/PI context can appear in row details. Artifact history, share state, locations and meeting links belong on the relevant detail surface rather than expanding every landing row.
6. **Narrow-screen layout.** Stack request identity above labeled session and visit sections, with both actions visible together; materials follow. Preserve established neutral WMKF styling and restrained semantic colors.

## Review evidence and limits

[VERIFIED via standalone browser rendering] Both saved widths rendered without horizontal document overflow; all six illustrative records retained both actions (12 actions total). An independent screenshot review returned ship for mockup review after mobile metadata and badges were raised to 12px.

This is visual composition evidence only. Live interactions, authorization, result announcements, keyboard behavior, runtime accessibility and other widths have not been accepted or verified by these mockups.

Desktop rows are approximately 80px, compared with the design system’s approximately 64px target; the first record also starts below its preferred queue position. Resolve density and header height before implementation rather than changing DESIGN.md to match the mockup.

## Resume after vocabulary is settled

1. Obtain the owner-approved meeting names from the vocabulary decision; do not assume the proposed table is final.
2. Update mockup tabs, column headings and action labels consistently, and review wrapping at both saved widths.
3. Resolve desktop density, Sessions-view composition, request-detail affordances and session identity/scope. Verify actual session membership before showing a session list as cycle-filtered.
4. Include loading, empty, error and filter-result announcements in an implementation brief. Preserve workflow status meanings and existing authorization boundaries.
5. Obtain explicit implementation scope before changing the app. Naming approval alone does not authorize route, API, database or internal identifier migrations.

## Coordination and bounded reconciliation

Owner: Codex for these new design artifacts. Claude retains the Research Institution at Award workstream and shared session handoff documentation. No edits to SESSION_PROMPT.md, the vocabulary review, the original audit, DESIGN.md or application source are part of this save.

Changed-fact sweep scope: owner-selected landing structure and the existence of these saved mockups. Authoritative evidence is the owner’s chat decisions and the rendered standalone artifacts; runtime persistence/consumer hops are not applicable to this design-only decision. The original audit remains historical evidence. The older SESSION_PROMPT.md asks the owner to choose a landing task; that prompt is now superseded on this decision by this document, but is deliberately left to Claude’s current handoff ownership. Whole-repository reconciliation is therefore not claimed. At the next coordinated handoff, link this document and replace that older open design question. Other search matches concerning Workbench rows are unrelated.
