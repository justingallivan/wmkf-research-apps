---
title: Meeting Tracker Landing Structure and Mockups
domain: product
kind: plan
status: in-progress
summary: Approved Meeting Tracker design references; functional workflow released, with the omitted compact landing and focused task workspace now implemented on the UI completion branch with actual-page visual verification and Opus review passed; candidate release is tracked separately.
canonical: false
owner: product-engineering
related:
  - docs/plans/review/PROPOSAL_WORKFLOW_VOCABULARY_2026-10-19.md
---

# Meeting Tracker landing structure and mockups

## Current implementation status — 2026-10-24

[VERIFIED via source and release receipts] The functional meeting workflow is released for ordinary eligible requests. The earlier release did **not** implement the approved compact cycle landing or desktop task rail. Its horizontal task tabs were only a partial workspace implementation.

[VERIFIED via branch source and actual built Next pages] `codex/meeting-ui-completion` implements the compact cycle schedule, request search, single materials select, separate global Sessions view with selected agenda preview, and focused Meeting coordination task workspace. Desktop uses a left task rail; narrow screens keep task selectors above the active content and both request actions visible. The selected landing view is URL-addressable. Final review passed; release evidence is owned by [the UI completion receipt](../../audits/MEETING_UI_COMPLETION_2026-10-24.md); this design record does not independently claim deployment.

The approved composition remains the saved [cycle schedule](meeting-tracker-2026-10-20/index.html), [Sessions](meeting-tracker-2026-10-20/sessions.html), [preparation workspace](meeting-tracker-2026-10-20/preparation-workspace.html) and [transcript preparation](meeting-tracker-2026-10-20/transcript-preparation.html). Mockup dates, queue counts, people and artifacts are synthetic. Runtime uses existing request/session scopes and capability checks, with no invented queue counts. Session search names its supported date/time/location/status fields; agenda text search was an exploratory control, not an existing list API contract. No membership or persistence change is implied.

[VERIFIED via owner instruction, 2026-10-24] Finish this approved landing-page/workspace design, have Claude Opus review it, and compare the actual rendered UI to the mockups before completion. This supersedes the design-only boundary recorded below. Required video, retained approved editions through corrections, immediate withdrawal and Coordinator ownership remain settled in the [implementation plan](../MEETING_COORDINATION_IMPLEMENTATION_PLAN_2026-10-23.md).

<details>
<summary>Historical design-only record — October 20–23, before implementation</summary>

All implementation-pending statements, source snapshots and next-step checklists within this historical record describe those dates. They are not current operating instructions or evidence that the released functional workflow is unbuilt. Current status and remaining release work are defined above and in the linked UI receipt.

[PLANNED] The staged [implementation plan](../MEETING_COORDINATION_IMPLEMENTATION_PLAN_2026-10-23.md) carries the settled product decisions into proposed persistence, recovery, approval, consumer and release contracts. Runtime implementation and live-state verification remain pending.

## Organizing direction at design time

[VERIFIED via owner direction, 2026-10-20] The newer [audience flow map](meeting-tracker-2026-10-20/workbench-audience-flow.md) makes the Workbench the PDs’ main entry for meeting information, agendas, materials and post-meeting video/transcript/summary links. Duncan and superusers handle preparation, including transcript assignments. This supersedes the mixed-audience organization implicit in the earlier mockups; it does not approve implementation or settle terminology. Earlier screen layouts remain design explorations to revisit against this flow.

The owner’s later hierarchy correction is controlling for the PD Workbench: **working writeup and review first, supporting materials second, meeting logistics behind a compact link**. The [revised mockup](meeting-tracker-2026-10-20/workbench-pd-writeup.html) explores that direction; the earlier materials-first Workbench mockup is superseded and retained only as history.

## Preparation and Board approval decisions — 2026-10-23

[VERIFIED via explicit owner decisions in this session; PLANNED application behavior]

- **Required video:** Research presentations are expected to have video. Missing video requires recovery; there is no audio-only Board approval path. This product requirement does not assert that audio and video failures are technically coupled.
- **Corrections:** Keep the approved presentation materials Board-accessible while corrections are drafted. A replacement requires review and explicit approval before becoming Board-visible. Provide a separate immediate **Withdraw from Board** action for material that must no longer be accessible.
- **Returning later:** Persist checked speaker names, presentation ending and summary drafts. Processing continues after leaving the page; returning shows current progress. Preserve successful outputs and retry only failed or unfinished work. Approval remains a separate explicit action.
- **Responsibility:** The assigned **Program Coordinator** reviews the presentation summary and approves materials for the Board. No additional PD review is required by this product decision. Resolve the coordinator through the existing shared role assignment; do not hardcode a person. Existing superuser preparation access is a separate capability, not a newly granted approval role.

[VERIFIED via explicit owner decisions, 2026-10-23; PLANNED runtime behavior] Remove the separate summary-provider acknowledgement too; this is intentional. Preserve historical acknowledgement records and record new initiation truthfully without fabricated consent. Manual transcript/audio plus matching MP4 must support Board approval as a rare recovery path; Zoom API import remains preferred. Permit an explicit coordinator retry of an unrecoverable unknown summary attempt after a possible-duplicate-charge warning, never an automatic retry. The assigned Program Coordinator personally sends materials requests and reminders; other authorized preparers may prepare/review drafts but cannot dispatch on the coordinator's behalf. Enforce this through authenticated role checks in the implementation.

These resolve the three cases parked on 2026-10-21 and the presentation-summary/approval ownership questions. Application implementation, persistence design, permission enforcement and end-to-end verification remain pending. The saved HTML previews predate these decisions.

[VERIFIED via owner direction] Materials collection belongs to the assigned **Program Coordinator** in Admin; requests, reminders and confirmations should come from that person (Duncan currently, per owner). Resolve the role at runtime rather than hardcoding Duncan or inferring ownership from a Meeting Tracker permission. The shared Program Coordinator role was added by the concurrent role workstream; consumer wiring remains unbuilt and requires source/role verification when implementation resumes.

## Transcript preparation — simplified preparation and approval build change, 2026-10-21

[VERIFIED via owner direction] Replace the separate save/publish/generate sequence in the new layout with **Save and prepare materials** after speaker and presentation-end review. Collapse the saved review into a checked summary with an Edit action. Show two result sections: **Presentation** and **Staff discussion · Internal only**. This is an approved design/build requirement; application implementation remains pending.

[PLANNED — coordinated behavior change] The action saves the checked names and presentation end, then prepares both derived transcripts, drafts both summaries, and creates the presentation video. Preparation does not itself authorize Board access. Review/edit the presentation summary and check the video ending before a separate **Approve for Board** action and explicit final confirmation. Internal transcript and summary remain staff only; the internal summary retains its review/edit/save action.

[VERIFIED via inspected current UI handlers] `RecordingAndTranscriptCard.js` currently separates saved edits (`saveNames`), transcript publication (`publishJob` / `publishCorrection`), derivative generation (`generatePresentationTranscript`), summary draft/publication and presentation-video approval. The proposed combined action changes that contract, rather than merely relabeling a button. Current Board-readiness logic can recognize a bound presentation transcript or published summary individually; implementation must prevent preparation from making those new outputs Board-visible before the new approval step.

[VERIFIED via owner direction] Provide a separate **Save draft** action for the presentation summary, so edits can be saved without Board approval. Retain the video-ending and summary-review checkboxes for now; revisit their burden after use rather than removing them in this build. [PLANNED] Runtime draft saving must persist edits without granting Board access; the mockup only acknowledges a local simulated save.

[PLANNED — implementation acceptance requirements]

- Trace save → transcript publication/version → derived transcripts → summary drafts/video → Board consumer before implementation; use the existing authorized services and explicit presentation/internal boundaries. Resolve the approval/persistence contract through the architecture/data review, including version-consistent replacement approval and immediate withdrawal. Draft corrections must not revoke the existing approved version. No schema or route design is settled by the mockup.
- Coordinate preparation durably against the saved transcript/boundary version. Show per-item progress and failures, preserve successful outputs, and retry only unfinished/failed work. Reloads and repeat clicks must not create duplicate processing or charges. A changed source/boundary must invalidate stale draft derivatives and draft approval eligibility; never approve a mixed-version bundle. Preserve the separately approved version until replacement approval or explicit withdrawal.
- Missing video, preparation failures, uncertain paid submissions and partial publication must retain visible recovery paths. Do not infer completion or retry safety from a successful save alone. Missing video blocks Board approval until recovered; do not offer audio-only approval.
- Test both import paths, resumed preparation, partial failure/retry, duplicate clicks, stale edits, approval/revocation and Board access. Verify that preparation exposes neither new unapproved presentation artifacts nor internal discussion through the Board page. Preserve unrelated access, recovery and review safeguards.

[VERIFIED via mockup source] The standalone [transcript mockup](meeting-tracker-2026-10-20/transcript-preparation.html) demonstrates the combined action, collapsed review receipt, two result groups, editable summaries, simulated Preparing/Ready/Failure states, retry and separate simulated Board approval. Preview state buttons advance examples without real jobs, paid calls, persistence or sharing. The video is the synthetic source excerpt, not a generated trimmed output. Earlier screenshots and workspace descriptions are dated explorations, not this flow's implementation evidence.

Changed-fact sweep scope: this owner-approved future flow and its standalone preview. Authority: owner instruction and inspected UI handlers; persistence/route changes and runtime verification remain pending. Existing application descriptions remain evidence of current behavior until the build changes it.

## Transcript preparation — playback review, 2026-10-21

[VERIFIED via owner direction] Put video playback beside the speaker/transcript review on desktop and above it on narrow screens. Provide **Use current playback time as presentation end** and allow audio playback during preparation if useful. The 2026-10-23 owner decision requires video for Board approval; audio playback does not satisfy that requirement. Applying a playback time must update the editable presentation-end value and clear the prior review confirmation, just like editing the time directly.

[VERIFIED via mockup source] The [review-stage mockup](meeting-tracker-2026-10-20/transcript-preparation.html) includes a local synthetic, silent 38-second video excerpt representing recording times 00:41:52–00:42:30. Applicant tiles disappear at 00:42:18. Video and audio fallback share the recording-time offset; switching pauses the previous player and transfers position. These media files demonstrate controls only, without meeting footage, voices or external access. Application playback integration, real media availability/error handling and authorized media delivery remain pending. Earlier screenshots predate these playback controls.

## Transcript preparation — acknowledgement removal build requirement, 2026-10-21

[VERIFIED via owner direction] The new layout omits the non-sensitive/provider/paid-credits acknowledgement checkbox. Keep manual import available through the subdued, initially collapsed **Import manually** disclosure below Import from Zoom, as shown in the [transcript preparation mockup](meeting-tracker-2026-10-20/transcript-preparation.html).

[PLANNED — application implementation pending] Remove the checkbox dependencies together when building this layout; hiding the control alone would block imports. Treat this as one coordinated change covering both Zoom import and manual audio transcription:

- Remove acknowledgement state, disabled-button conditions and action-handler guards in `shared/components/meeting-tracker/RecordingAndTranscriptCard.js`.
- Update the `nonSensitiveAcknowledged` request contract and matching validation in the Zoom-import and transcription-start API routes, the Zoom import service, and the Meeting Tracker transcription queue path. Trace internal Zoom-to-transcription calls as well as browser requests so no downstream caller still requires the removed value.
- Reconcile writes to `transcription_jobs.non_sensitive_acknowledged_at`: do not fabricate an acknowledgement timestamp after the checkbox is removed. Decide the treatment of new jobs while preserving existing historical records; any schema change requires separate implementation review. Shared transcription-pilot code also serves the admin pilot, so do not remove that separate workflow's acknowledgement implicitly.
- Update tests for both entry paths to prove import/transcription can start without the checkbox or acknowledgement payload, and that normal access, upload validation, recovery and processing safeguards still apply. Keep the separate speaker/presentation-end review confirmation and unrelated acknowledgements intact. The owner subsequently explicitly removed the separate summary-provider confirmation too (2026-10-23); implement that coordinated compatibility change as specified in the linked implementation plan.

[VERIFIED via source inspection, 2026-10-21] Current application dependencies exist in `RecordingAndTranscriptCard.js` (`uploadAndStart` and `importSelected`), `pages/api/meeting-tracker/visits/[requestId]/zoom-imports.js`, `pages/api/meeting-tracker/visits/[requestId]/transcriptions/[jobId]/start.js`, `lib/services/meeting-tracker-recordings/import-service.js`, `lib/services/meeting-tracker-transcription/service.js`, and `lib/services/transcription-pilot/runtime.js` / `store.js`. The mockup removes its local checkbox and button dependency only; production contracts remain unchanged.

Changed-fact sweep scope: this owner-directed future build requirement, recorded in this layout plan. Existing implementation references describe current behavior and remain valid until the coordinated application change lands. No runtime, schema or historical-data change is authorized by this documentation update.

## Invitations — layout review, 2026-10-21

[VERIFIED via owner feedback] The owner finds the overall Invitations layout good. For both Proposal discussion session and Research presentation, carry the selected staff, board members and consultants from Meeting setup into Invitations. The recipient list, count and email review must reflect the same selection; an empty group must not silently restore default recipients.

[VERIFIED via mockup source] The linked standalone setup and Invitations previews share illustrative attendee selections through browser-tab session storage. Direct Invitations entry without saved selections uses illustrative defaults for both meeting types. Returning to setup retains attendee choices in that tab. This demonstrates local layout continuity only; the application build and actual email delivery remain pending.

Changed-fact sweep scope: Invitations layout feedback and attendee continuity. Authority: current owner instruction and the two mockup sources. Earlier static workspace descriptions below remain dated explorations. No application persistence, authorization or delivery change is claimed.

## Agenda ordering — build decision, 2026-10-21

[VERIFIED via owner direction] Use `@hello-pangea/dnd` for agenda drag ordering when the Meeting coordination build is authorized. Follow Proposal Ranking’s existing integration in `shared/components/proposal-ranking/AssessmentWorkflow.js`: dedicated handles, keyboard support, preservation of the library’s drag styles, its reduced-motion drop-transition handling, and protection against applying a drop to a changed list. The existing dependency is declared in `package.json`; no new drag package is needed.

[PLANNED — application implementation pending] Retain numeric allotted minutes, Change position, move-to-session, removal and allocated-time/overrun feedback. Agenda changes retain the existing save-as-you-go contract; Done leaves editing. The owner explicitly does not require demonstrating the package in a mockup. The [setup mockup](meeting-tracker-2026-10-20/meeting-setup.html) remains a local layout/controls preview using basic browser dragging, not acceptance of the eventual drag interaction or application persistence.

Changed-fact sweep scope: this package choice only. Authority: owner instruction and inspected Proposal Ranking source/package declaration. Producer: owner decision; persistence: this design record; consumer: future Meeting coordination implementation. No runtime change or external-state probe applies. Repository searches found no competing agenda package decision; broader design history remains outside this decision’s scope.

## Earlier layout decisions and boundary

[VERIFIED via owner decisions in the Codex chat, 2026-10-20] The owner agreed to a cycle schedule landing page whose primary job is to scan the cycle’s requests and open the next task. Sessions have a separate task view within Meeting Tracker. Both session and visit actions remain visible for every request, including on narrow screens.

[VERIFIED via owner instruction, 2026-10-20] Save the structure and mockups. Layout design continues with the owner-approved terminology of 2026-10-21, including Draft writeup. App implementation remains pending. This is approval of the structure for design continuation, not authorization to change the application. No application code is changed by this handoff.

## Saved artifacts

- [Duncan/superuser preparation workspace](meeting-tracker-2026-10-20/preparation-workspace.html) — four locally selectable task views; see captures below.

- [Workbench-first audience flow map](meeting-tracker-2026-10-20/workbench-audience-flow.md) — current organizing direction, design only.

- [Standalone responsive HTML mockup](meeting-tracker-2026-10-20/index.html) — open locally in a browser; controls are static.
- [Desktop screenshot, 1440px wide](meeting-tracker-2026-10-20/desktop.png).
- [Narrow-screen screenshot, 390px wide](meeting-tracker-2026-10-20/narrow.png).
- [Sessions HTML mockup](meeting-tracker-2026-10-20/sessions.html), [desktop screenshot](meeting-tracker-2026-10-20/sessions-desktop.png), and [narrow-screen screenshot](meeting-tracker-2026-10-20/sessions-narrow.png).
- [Session detail HTML mockup](meeting-tracker-2026-10-20/session-detail.html), [desktop screenshot](meeting-tracker-2026-10-20/session-detail-desktop.png), and [narrow-screen screenshot](meeting-tracker-2026-10-20/session-detail-narrow.png).
- [Visit detail HTML mockup](meeting-tracker-2026-10-20/visit-detail.html), [desktop screenshot](meeting-tracker-2026-10-20/visit-detail-desktop.png), and [narrow-screen screenshot](meeting-tracker-2026-10-20/visit-detail-narrow.png).
- [Revised writeup-first PD Workbench](meeting-tracker-2026-10-20/workbench-pd-writeup.html), [desktop screenshot](meeting-tracker-2026-10-20/workbench-writeup-desktop.png), and [narrow-screen screenshot](meeting-tracker-2026-10-20/workbench-writeup-narrow.png) — current PD layout proposal.
- [Superseded materials-first PD Workbench HTML mockup](meeting-tracker-2026-10-20/workbench-pd-materials.html), [desktop screenshot](meeting-tracker-2026-10-20/workbench-pd-desktop.png), and [narrow-screen screenshot](meeting-tracker-2026-10-20/workbench-pd-narrow.png).
- [Original audit](../../../.impeccable/critique/2026-10-19T22-21-01Z__nts-meeting-tracker-meetingtrackerlist-js-ef43d395.md) — dated source and production inspection, not a fresh runtime assessment.
- [Vocabulary review](PROPOSAL_WORKFLOW_VOCABULARY_2026-10-19.md) — approved names and updated owner-edited deck, including Draft writeup.

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

[VERIFIED via owner instruction] Continue designing the other tabs and screens now, using approved labels; do not change the app. The owner requested the Sessions mockups and repository save, but has not yet approved this tab’s composition.

The proposed desktop layout has a session list and a selected agenda preview beside it. The narrow version stacks the preview after the list; the preview link targets that region. Each session shows date, start/end time and time zone, location, Planned/Held status and an Open session action. Same-day sessions remain distinguishable by time and location. Create session is the primary action. Upcoming sessions precede held sessions in the illustrative list.

Scope is explicitly independent of the cycle schedule’s program and request filters. [VERIFIED via source inspection] `pages/api/meeting-tracker/sessions/index.js` GET calls `listDeliberationSessions`; that service returns projected sessions without cycle/program membership filtering, while the adapter excludes cancelled sessions by default. This inspection establishes the current list contract only; no live session reads were performed.

[PLANNED — mockup only] Date-range/status filtering, search including agenda requests, and the list-level selected agenda preview are proposed interactions. Agenda content exists on the session detail surface; integrating it into a list preview requires a separately reviewed data-loading design. No API extension, session name field, cycle-membership mapping or persistence change is approved here. The existing status words are provisional display copy for this mockup, not a decision to alter persisted statuses.

The screenshots use four illustrative sessions, including two on the same day, and a three-request agenda. Both widths were rendered without horizontal document overflow. Controls are static except local navigation/preview anchors; screenshots are visual evidence, not proof of working filters or switching previews. Session detail now has its own proposed read-view mockup below. Agenda editing/sending, creation forms, empty/loading/error states and long-list behavior remain outside the Sessions-tab mockup.

The standalone HTML files link between Cycle schedule and Sessions. No app code, vocabulary decision, session handoff, or design-system files were changed. Further layout work may proceed before vocabulary approval; app implementation still needs explicit scope.

## Session detail — proposed read view, 2026-10-20

[VERIFIED via owner instruction] Create and save desktop and narrow-screen session detail mockups with approved labels; do not change the app. This screen’s layout remains a proposal for owner review. The owner subsequently found it busy and is willing to iterate later; it is a working draft, not an approved final layout.

The proposed read view leads with date, start/end time and time zone, status and Join meeting. A compact summary contains location, duration, attendee count and Edit session details. Proposal order is the main working area, with calculated start times, allocated minutes, request identity and request/briefing actions. The missing-briefing case uses Check briefing, not direct creation. Attendees, notes and agenda sharing sit in a desktop sidebar and follow the agenda on narrow screens. Edit proposal order remains separate from the read view.

[VERIFIED via source inspection] `shared/components/meeting-tracker/SessionEditor.js` provides session summary/editing, attendee editing, proposal order editing and briefing links. `shared/components/meeting-tracker/SessionAgendaPanel.js` provides agenda recipient/message review and preview before sending. These sources ground the capabilities; the proposed composition, derived per-item times and provisional labels are design decisions rather than claims of current UI behavior. Open request and Check briefing destinations require implementation review. Attendee editing would retain the existing session-details save contract unless explicitly changed later.

Prepare agenda is a static entry point to a future reviewed composer layout. No live meeting joins, recipients, emails, records or send receipts are used. The illustrative example has six attendees and three 30-minute proposals in a 90-minute session. Both saved widths rendered without horizontal document overflow. Independent visual review returned ship for mockup review; a final copy correction changed Create briefing to Check briefing.

Edit forms, reordering/moving/removing proposals, cancellation, conflict/over-capacity warnings, missing links, unavailable briefings, attendee issues, agenda-send uncertainty, loading/errors/empty states and long agendas are not designed or runtime-verified here. Preserve those existing behaviors when a separately authorized implementation is scoped. This mockup is not acceptance of keyboard accessibility, interaction behavior, data loading or sending.

Only the selected illustrative session and its preview link to this detail; the detail links back to Sessions. Names now follow the approved terminology table. No app, API, persistence or design-system implementation changes are included.

## Visit detail — quieter proposed read view, 2026-10-20

[VERIFIED via owner instruction] Create and save desktop and narrow-screen visit detail mockups with approved labels and no application changes. The composition is proposed for owner review; it is not implementation approval.

The proposal responds to the owner’s feedback that session detail still looks busy. Request identity, visit time/time zone, virtual location/organizer and Join meeting remain visible. Attendees and notes collapse under one disclosure. Applicant materials is expanded in this illustrative pre-visit state. Recording setup, Presentation, Staff discussion and Board materials follow in the existing work order as collapsed sections, each with a visible summary and provisional status. Disclosure sections open locally in the HTML; uploads, sends and joins are inert.

[VERIFIED via source inspection] `shared/components/meeting-tracker/SiteVisitEditor.js` provides visit logistics, organizer, required/optional attendees and notes, followed by applicant-materials and recording/result components. The existing Site Visit surface brief (`.impeccable/surfaces/onents-meeting-tracker-sitevisiteditor-js-e5657c91.md`) specifies Recording setup → Presentation → Staff discussion → Board materials. `SiteVisitMaterialsCard.js` provides checklist receipt states, due/invitation metadata, uploads and reminder actions. `RecordingAndTranscriptCard.js` provides the separate follow-up sections. These capabilities ground the mockup; the new collapsed composition and section-level rollups are proposed, not current runtime behavior.

The synthetic example has one received file and one missing file, before its due date, six attendees, no recording outputs and no Board link. Checklist item names are illustrative and do not redefine actual required materials. Waiting, Not started, Not ready and No link are scoped display examples, not new persisted states or a universal readiness algorithm. Join meeting is not a confirmation of calendar invitations or attendance.

Before implementation, define section summaries against the existing per-artifact states. Attention, failed upload/transcription, unavailable state, privacy/publication readiness, partial success and unresolved sends must remain visible even when a section is collapsed. Do not let quiet styling hide actionable failures. Do not infer a publishable Board bundle from aggregate readiness. Reminder/invitation actions retain their review steps; no messages are sent by these artifacts.

Detailed upload/transcription/speaker-review/output/Board-link flows, edit forms, in-person and unscheduled states, loading/errors and long content remain outside this first layout. Opening a collapsed mock section reveals explanatory content rather than a completed functional design. Both default screenshots and expanded Board-section checks rendered without horizontal overflow at the two captured widths. This does not establish full accessibility or runtime acceptance.

The first illustrative Open visit action in Cycle schedule links to this example; other request links remain static. Labels now follow the approved terminology table. No application, API, schema or design-system implementation changes are included.

## Historical PD Workbench materials-first exploration — superseded, 2026-10-20

[VERIFIED via owner instruction] Mock up the PD-facing meeting/materials area in the Workbench with easily found video, transcript and summary links; save alongside the earlier designs without changing the app.

[HISTORICAL — rejected hierarchy] The owner found that this draft buried the working writeup/review, the product of staff deliberations. It is not the basis for implementation. This first draft places Meetings and materials within Staff Deliberations, keeping that existing tab name. Placement and the surrounding illustrative navigation are not final. Two compact meeting entries show session time, the request’s slot within a multi-request agenda, and the presentation time. Presentation video, transcript and summary links are directly visible, separate from internal staff-discussion transcript/summary links. A pending discussion summary has plain availability text rather than a dead link or generation button. Preparation controls for Duncan/superusers are omitted.

The screenshots depict a synthetic post-meeting state, not live records or output readiness. No Join action is shown for ended meetings; before-meeting/active-meeting, unscheduled, failed and unavailable states still need design. All names, dates, agenda membership and availability are illustrative. Available means usable in this example, not formally approved or shared with the Board. Internal is an audience cue, not a new security mechanism.

Meeting documents are disclosed below the direct output links. Working writeup and review is represented as a separate out-of-scope disclosure, not a proposed removal, relocation approval or replacement of existing review workflow. [VERIFIED via source inspection] `shared/components/workbench/StaffDeliberationsTab.js` already coordinates meeting context, briefing/writeup lifecycle and follow-up components; the proposed artifact layout has not been implemented or checked against a complete data/security contract.

Local agenda navigation points to the earlier session-detail exploration for context only; that screen still contains preparation controls and is not the final PD-only agenda destination. Full agenda access must retain request restrictions when designed for a multi-request session. Artifact links are inert. Nothing is uploaded, generated, joined or sent. A future implementation must reuse authorized artifacts and enforce presentation/internal discussion boundaries, rather than copy documents or treat display state as access permission.

Desktop uses side-by-side presentation and staff-discussion groups; narrow screens stack them. Both rendered without horizontal document overflow, with the active request tab fully visible. The intended consumption path is Workbench request → meeting/agenda/materials → direct outputs, without a required trip through Meeting Tracker processing controls. Future review must resolve placement, surrounding tabs, active-meeting Join behavior, actual artifact eligibility/availability and preservation of the existing writeup/review flow.

## Revised PD Workbench — writeup first, 2026-10-20

[VERIFIED via owner direction] Put working writeup and review first, supporting materials second, and meeting logistics behind a compact link. Save the revision without changing the app. The hierarchy is owner-directed; the resulting composition still needs owner review.

The revised standalone mockup uses a synthetic lead-PD drafting state. The first visible work area contains the working writeup, an Edit writeup in Word action, a Ready for group review confirmation entry point and a plain drafting → group review → leadership review progression. Supporting presentation video/transcript/summary and internal staff-discussion links follow. Pending output remains non-linked. Meeting time and agenda is one compact link that opens and scrolls to a logistics disclosure below the supporting material area.

[VERIFIED via source inspection] `shared/components/workbench/StaffDeliberationsTab.js` has Word editing, Ready for group review confirmation, and group/leadership review states. This is a layout proposal, not a complete verified transition or permission contract. Do not offer lead-PD drafting actions to every PD or assume all documents are visible before review. The mockup preserves the distinction that group review starts only through an explicit confirmed action. Actual active group/leadership work continues to use its existing Final Writeup contract; the progression is informational, not new navigation or a replacement workflow.

The earlier materials-first artifacts are preserved as superseded history. Request shell/tab placement and surrounding navigation remain proposed; display names follow the approved terminology. Editing, review confirmation, actual document/media links, all lifecycle variants, failure states, accessibility and authorization are outside this static mockup. The same direct artifact/audience boundaries described above continue to apply.

Both screenshot widths rendered without horizontal document overflow; the compact meeting link was exercised and opened the logistics disclosure at both widths. No application source, runtime routes, permissions or live data changed.

## Duncan and superusers — Meeting coordination workspace proposal, 2026-10-20

[VERIFIED via owner direction] Create and save a preparation workspace covering setup, invitations, materials collection and transcript preparation. No application changes. The layout remains a proposal, with approved labels and synthetic examples.

[VERIFIED via owner naming correction] The provisional workspace title is Meeting coordination, since transcript work happens after the meeting. Navigation groups setup, invitations and collection under Before the meeting, and transcript preparation under After the meeting. The broader meeting vocabulary was approved after colleague review on 2026-10-21.

The standalone workspace separates four tasks; one task is open at a time. Desktop uses a left task selector, while narrow screens put four compact selectors above the selected task. Each task has one illustrative work item and a focused detail panel. Queue counts are synthetic navigation examples, not an implemented aggregation contract or exhaustive list.

| Task | Desktop | Narrow |
|---|---|---|
| Meeting setup | [Preview](meeting-tracker-2026-10-20/prep-setup-desktop.png) | [Preview](meeting-tracker-2026-10-20/prep-setup-narrow.png) |
| Invitations | [Preview](meeting-tracker-2026-10-20/prep-invitations-desktop.png) | [Preview](meeting-tracker-2026-10-20/prep-invitations-narrow.png) |
| Materials collection | [Preview](meeting-tracker-2026-10-20/prep-materials-desktop.png) | [Preview](meeting-tracker-2026-10-20/prep-materials-narrow.png) |
| Transcript preparation | [Preview](meeting-tracker-2026-10-20/prep-transcripts-desktop.png) | [Preview](meeting-tracker-2026-10-20/prep-transcripts-narrow.png) |

Setup shows time/duration/location, attendees and agenda checking. Invitations demonstrates an agenda email with recipient/message review before sending; calendar invitation delivery remains a separate unresolved contract, never inferred from saving logistics. Materials shows received/missing items and reminder preparation with message review. Transcript preparation shows a generated transcript’s speaker assignments and presentation end, with review before changes. Different task views use different illustrative meetings; changing task does not imply the same request changes lifecycle state.

[VERIFIED via prior source inspection] Existing SessionEditor/SessionAgendaPanel, SiteVisitMaterialsCard and RecordingAndTranscriptCard ground the capabilities. The task queue, combined workspace and review controls shown are proposals, not built state. Transcript example uses a generated transcript: do not infer that uploaded transcript files support speaker reassignment/splitting. Recording intake, transcription generation, source selection, approval and output creation flows still need fuller design. No paid processing was run.

Duncan and superusers are the intended preparation audience, but runtime authorization is not changed or verified by this mockup. Preserve existing access restrictions, upload recovery, uncertain-send handling, draft/speaker editing, presentation/internal discussion boundaries and separate Board sharing. PDs receive authorized output links in the writeup-first Workbench view; readiness here does not itself publish anything. The assigned Program Coordinator reviews the presentation summary and approves materials for the Board, per the 2026-10-23 owner decision; runtime enforcement remains to be implemented.

Task switching was exercised at 1440px and 390px, with no horizontal document overflow in all four task views. All eight captures received independent visual review, ship for mockup review. The source is standalone; only task switching, selects and local links/disclosures respond. Save, review, send, upload, processing and publication actions are inert. Full keyboard/assistive-technology behavior and end-to-end contracts are unverified. DESIGN.md and application files remain unchanged.

## Historical pre-implementation checklist

1. Obtain the owner-approved meeting names from the vocabulary decision; do not assume the proposed table is final.
2. Update mockup tabs, column headings and action labels consistently, and review wrapping at both saved widths.
3. Revisit screen compositions against the Workbench-first audience flow. Resolve desktop density, owner review of the Sessions layout, request-detail affordances and session identity/scope. Verify actual session membership before showing a session list as cycle-filtered.
4. Include loading, empty, error and filter-result announcements in an implementation brief. Preserve workflow status meanings and existing authorization boundaries.
5. Obtain explicit implementation scope before changing the app. Naming approval alone does not authorize route, API, database or internal identifier migrations.

## Coordination and bounded reconciliation

Owner: Codex for these new design artifacts. Claude retains the Research Institution at Award workstream and shared session handoff documentation. No edits to SESSION_PROMPT.md, the vocabulary review, the original audit, DESIGN.md or application source are part of this save.

Changed-fact sweep scope: owner-selected landing structure and the existence of these saved mockups. Authoritative evidence is the owner’s chat decisions and the rendered standalone artifacts; runtime persistence/consumer hops are not applicable to this design-only decision. The original audit remains historical evidence. The original handoff asked the owner to choose a landing task. At owner-authorized stop, the current SESSION_PROMPT.md links this design record and preserves Claude’s newer data work as a separate historical carryover. Whole-repository reconciliation is not claimed. Other search matches concerning Workbench rows are unrelated.

</details>
