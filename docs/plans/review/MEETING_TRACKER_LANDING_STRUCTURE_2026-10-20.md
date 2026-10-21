---
title: Meeting Tracker Landing Structure and Mockups
domain: product
kind: plan
status: proposed
summary: Meeting layout explorations and newer Workbench-first audience flow; terminology is provisional and app implementation remains pending.
canonical: false
owner: product-engineering
related:
  - docs/plans/review/PROPOSAL_WORKFLOW_VOCABULARY_2026-10-19.md
---

# Meeting Tracker landing structure and mockups

## Current organizing direction

[VERIFIED via owner direction, 2026-10-20] The newer [audience flow map](meeting-tracker-2026-10-20/workbench-audience-flow.md) makes the Workbench the PDs’ main entry for meeting information, agendas, materials and post-meeting video/transcript/summary links. Duncan and superusers handle preparation, including transcript assignments. This supersedes the mixed-audience organization implicit in the earlier mockups; it does not approve implementation or settle terminology. Earlier screen layouts remain design explorations to revisit against this flow.

## Earlier layout decisions and boundary

[VERIFIED via owner decisions in the Codex chat, 2026-10-20] The owner agreed to a cycle schedule landing page whose primary job is to scan the cycle’s requests and open the next task. Sessions have a separate task view within Meeting Tracker. Both session and visit actions remain visible for every request, including on narrow screens.

[VERIFIED via owner instruction, 2026-10-20] Save the structure and mockups. Further layout design can continue with provisional labels; final terminology and app implementation remain pending. Meeting names and related labels are provisional. This is approval of the structure for design continuation, not authorization to change the application. No application code is changed by this handoff.

## Saved artifacts

- [Workbench-first audience flow map](meeting-tracker-2026-10-20/workbench-audience-flow.md) — current organizing direction, design only.

- [Standalone responsive HTML mockup](meeting-tracker-2026-10-20/index.html) — open locally in a browser; controls are static.
- [Desktop screenshot, 1440px wide](meeting-tracker-2026-10-20/desktop.png).
- [Narrow-screen screenshot, 390px wide](meeting-tracker-2026-10-20/narrow.png).
- [Sessions HTML mockup](meeting-tracker-2026-10-20/sessions.html), [desktop screenshot](meeting-tracker-2026-10-20/sessions-desktop.png), and [narrow-screen screenshot](meeting-tracker-2026-10-20/sessions-narrow.png).
- [Session detail HTML mockup](meeting-tracker-2026-10-20/session-detail.html), [desktop screenshot](meeting-tracker-2026-10-20/session-detail-desktop.png), and [narrow-screen screenshot](meeting-tracker-2026-10-20/session-detail-narrow.png).
- [Visit detail HTML mockup](meeting-tracker-2026-10-20/visit-detail.html), [desktop screenshot](meeting-tracker-2026-10-20/visit-detail-desktop.png), and [narrow-screen screenshot](meeting-tracker-2026-10-20/visit-detail-narrow.png).
- [Original audit](../../../.impeccable/critique/2026-10-19T22-21-01Z__nts-meeting-tracker-meetingtrackerlist-js-ef43d395.md) — dated source and production inspection, not a fresh runtime assessment.
- [Vocabulary review](PROPOSAL_WORKFLOW_VOCABULARY_2026-10-19.md) — proposed names and owner-edited deck, awaiting colleague feedback.

All records, institutions, proposal titles and dates in the mockups are illustrative. The screenshots show the proposed composition, not production. There are no remote assets, live reads or write actions in the HTML.

## Earlier agreed landing structure — subject to audience-flow revision

1. **Cycle schedule is the default view; Sessions is a separate view.** Keep the main page focused on request lookup and scheduling visibility. The Sessions view will carry session creation and session navigation; its initial proposed layout is saved below for owner review.
2. **Compact request rows.** Show request number, institution and proposal title; separate session and visit columns show the relevant date and explicit Open/Schedule action. Preserve test-request distinctions when eventually implementing against real records.
3. **One scope toolbar.** Program, cycle, My/All scope and request search sit above the list. Keep result counts and one materials-status filter near the list. Do not put summary cards ahead of the requests.
4. **Materials support the task.** Show the precise materials status without implying that one completed artifact means the request is complete. The proposed menu keeps existing status meanings and counts; zero-result choices should be disabled.
5. **Progressive detail.** PD/PI context can appear in row details. Artifact history, share state, locations and meeting links belong on the relevant detail surface rather than expanding every landing row.
6. **Narrow-screen layout.** Stack request identity above labeled session and visit sections, with both actions visible together; materials follow. Preserve established neutral WMKF styling and restrained semantic colors.

## Review evidence and limits

[VERIFIED via standalone browser rendering] Both saved widths rendered without horizontal document overflow; all six illustrative records retained both actions (12 actions total). An independent screenshot review returned ship for mockup review after mobile metadata and badges were raised to 12px.

This is visual composition evidence only. Live interactions, authorization, result announcements, keyboard behavior, runtime accessibility and other widths have not been accepted or verified by these mockups.

Desktop rows are approximately 80px, compared with the design system’s approximately 64px target; the first record also starts below its preferred queue position. Resolve density and header height before implementation rather than changing DESIGN.md to match the mockup.

## Sessions tab — proposed layout, 2026-10-20

[VERIFIED via owner instruction] Continue designing the other tabs and screens now, using provisional labels; do not change the app. The owner requested the Sessions mockups and repository save, but has not yet approved this tab’s composition.

The proposed desktop layout has a session list and a selected agenda preview beside it. The narrow version stacks the preview after the list; the preview link targets that region. Each session shows date, start/end time and time zone, location, Planned/Held status and an Open session action. Same-day sessions remain distinguishable by time and location. Create session is the primary action. Upcoming sessions precede held sessions in the illustrative list.

Scope is explicitly independent of the cycle schedule’s program and request filters. [VERIFIED via source inspection] `pages/api/meeting-tracker/sessions/index.js` GET calls `listDeliberationSessions`; that service returns projected sessions without cycle/program membership filtering, while the adapter excludes cancelled sessions by default. This inspection establishes the current list contract only; no live session reads were performed.

[PLANNED — mockup only] Date-range/status filtering, search including agenda requests, and the list-level selected agenda preview are proposed interactions. Agenda content exists on the session detail surface; integrating it into a list preview requires a separately reviewed data-loading design. No API extension, session name field, cycle-membership mapping or persistence change is approved here. The existing status words are provisional display copy for this mockup, not a decision to alter persisted statuses.

The screenshots use four illustrative sessions, including two on the same day, and a three-request agenda. Both widths were rendered without horizontal document overflow. Controls are static except local navigation/preview anchors; screenshots are visual evidence, not proof of working filters or switching previews. Session detail now has its own proposed read-view mockup below. Agenda editing/sending, creation forms, empty/loading/error states and long-list behavior remain outside the Sessions-tab mockup.

The standalone HTML files link between Cycle schedule and Sessions. No app code, vocabulary decision, session handoff, or design-system files were changed. Further layout work may proceed before vocabulary approval; app implementation still needs explicit scope.

## Session detail — proposed read view, 2026-10-20

[VERIFIED via owner instruction] Create and save desktop and narrow-screen session detail mockups with provisional labels; do not change the app. This screen’s layout remains a proposal for owner review. The owner subsequently found it busy and is willing to iterate later; it is a working draft, not an approved final layout.

The proposed read view leads with date, start/end time and time zone, status and Join meeting. A compact summary contains location, duration, attendee count and Edit session details. Proposal order is the main working area, with calculated start times, allocated minutes, request identity and request/briefing actions. The missing-briefing case uses Check briefing, not direct creation. Attendees, notes and agenda sharing sit in a desktop sidebar and follow the agenda on narrow screens. Edit proposal order remains separate from the read view.

[VERIFIED via source inspection] `shared/components/meeting-tracker/SessionEditor.js` provides session summary/editing, attendee editing, proposal order editing and briefing links. `shared/components/meeting-tracker/SessionAgendaPanel.js` provides agenda recipient/message review and preview before sending. These sources ground the capabilities; the proposed composition, derived per-item times and provisional labels are design decisions rather than claims of current UI behavior. Open request and Check briefing destinations require implementation review. Attendee editing would retain the existing session-details save contract unless explicitly changed later.

Prepare agenda is a static entry point to a future reviewed composer layout. No live meeting joins, recipients, emails, records or send receipts are used. The illustrative example has six attendees and three 30-minute proposals in a 90-minute session. Both saved widths rendered without horizontal document overflow. Independent visual review returned ship for mockup review; a final copy correction changed Create briefing to Check briefing.

Edit forms, reordering/moving/removing proposals, cancellation, conflict/over-capacity warnings, missing links, unavailable briefings, attendee issues, agenda-send uncertainty, loading/errors/empty states and long agendas are not designed or runtime-verified here. Preserve those existing behaviors when a separately authorized implementation is scoped. This mockup is not acceptance of keyboard accessibility, interaction behavior, data loading or sending.

Only the selected illustrative session and its preview link to this detail; the detail links back to Sessions. All names and related labels remain provisional. No app, API, persistence, design-system or vocabulary decision changes are included.

## Visit detail — quieter proposed read view, 2026-10-20

[VERIFIED via owner instruction] Create and save desktop and narrow-screen visit detail mockups with provisional labels and no application changes. The composition is proposed for owner review; it is not implementation approval.

The proposal responds to the owner’s feedback that session detail still looks busy. Request identity, visit time/time zone, virtual location/organizer and Join meeting remain visible. Attendees and notes collapse under one disclosure. Applicant materials is expanded in this illustrative pre-visit state. Recording setup, Presentation, Staff discussion and Board materials follow in the existing work order as collapsed sections, each with a visible summary and provisional status. Disclosure sections open locally in the HTML; uploads, sends and joins are inert.

[VERIFIED via source inspection] `shared/components/meeting-tracker/SiteVisitEditor.js` provides visit logistics, organizer, required/optional attendees and notes, followed by applicant-materials and recording/result components. The existing Site Visit surface brief (`.impeccable/surfaces/onents-meeting-tracker-sitevisiteditor-js-e5657c91.md`) specifies Recording setup → Presentation → Staff discussion → Board materials. `SiteVisitMaterialsCard.js` provides checklist receipt states, due/invitation metadata, uploads and reminder actions. `RecordingAndTranscriptCard.js` provides the separate follow-up sections. These capabilities ground the mockup; the new collapsed composition and section-level rollups are proposed, not current runtime behavior.

The synthetic example has one received file and one missing file, before its due date, six attendees, no recording outputs and no Board link. Checklist item names are illustrative and do not redefine actual required materials. Waiting, Not started, Not ready and No link are scoped display examples, not new persisted states or a universal readiness algorithm. Join meeting is not a confirmation of calendar invitations or attendance.

Before implementation, define section summaries against the existing per-artifact states. Attention, failed upload/transcription, unavailable state, privacy/publication readiness, partial success and unresolved sends must remain visible even when a section is collapsed. Do not let quiet styling hide actionable failures. Do not infer a publishable Board bundle from aggregate readiness. Reminder/invitation actions retain their review steps; no messages are sent by these artifacts.

Detailed upload/transcription/speaker-review/output/Board-link flows, edit forms, in-person and unscheduled states, loading/errors and long content remain outside this first layout. Opening a collapsed mock section reveals explanatory content rather than a completed functional design. Both default screenshots and expanded Board-section checks rendered without horizontal overflow at the two captured widths. This does not establish full accessibility or runtime acceptance.

The first illustrative Open visit action in Cycle schedule links to this example; other request links remain static. Labels remain provisional. No application, API, schema, design-system or vocabulary changes are included.

## Before implementation, after vocabulary is settled

1. Obtain the owner-approved meeting names from the vocabulary decision; do not assume the proposed table is final.
2. Update mockup tabs, column headings and action labels consistently, and review wrapping at both saved widths.
3. Revisit screen compositions against the Workbench-first audience flow. Resolve desktop density, owner review of the Sessions layout, request-detail affordances and session identity/scope. Verify actual session membership before showing a session list as cycle-filtered.
4. Include loading, empty, error and filter-result announcements in an implementation brief. Preserve workflow status meanings and existing authorization boundaries.
5. Obtain explicit implementation scope before changing the app. Naming approval alone does not authorize route, API, database or internal identifier migrations.

## Coordination and bounded reconciliation

Owner: Codex for these new design artifacts. Claude retains the Research Institution at Award workstream and shared session handoff documentation. No edits to SESSION_PROMPT.md, the vocabulary review, the original audit, DESIGN.md or application source are part of this save.

Changed-fact sweep scope: owner-selected landing structure and the existence of these saved mockups. Authoritative evidence is the owner’s chat decisions and the rendered standalone artifacts; runtime persistence/consumer hops are not applicable to this design-only decision. The original audit remains historical evidence. The older SESSION_PROMPT.md asks the owner to choose a landing task; that prompt is now superseded on this decision by this document, but is deliberately left to Claude’s current handoff ownership. Whole-repository reconciliation is therefore not claimed. At the next coordinated handoff, link this document and replace that older open design question. Other search matches concerning Workbench rows are unrelated.
