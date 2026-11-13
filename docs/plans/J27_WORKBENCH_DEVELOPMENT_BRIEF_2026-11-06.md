---
title: J27 Workbench development branch brief
domain: workbench
kind: plan
status: superseded
summary: Superseded 2026-11-13. Historical design brief for the first J27 Workbench slice (Reports, Deliberations, Final Assessment, Overview); the slice was built on the J27 line and the production rollout plan now holds its current state.
canonical: false
owner: product-engineering
related:
  - docs/plans/J27_WORKBENCH_PRODUCTION_ROLLOUT_2026-11-07.md
  - docs/plans/WORKBENCH_SINGLE_SUBMISSION_STRATEGY_BRIEF_2026-11-04.md
  - docs/plans/J27_CYCLE_INFORMATION_PLAN_2026-11-04.md
  - docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md
---

# J27 Workbench development branch brief

> **Superseded (2026-11-13).** Kept as the historical design record. The
> slice described here was built on the J27 line and rehearsed on the
> sandbox Preview. For current state, read
> `docs/plans/J27_WORKBENCH_PRODUCTION_ROLLOUT_2026-11-07.md`. Later
> decisions that override this brief:
>
> - Admission is any linked cycle of 2027 or later, not the literal `J27`
>   (owner, 2026-11-10; alignment log D64).
> - The release adds five Request fields (schema waves 37 to 40): four
>   memos, `wmkf_staffreviewsummary`, `wmkf_staffvisitassessment`,
>   `wmkf_confirmedmeetingroster` (on the Request, not the presentation
>   activity) and `wmkf_initialassessmentrationale`, plus the evidence
>   fingerprint `wmkf_staffreviewevidencehash`. No offramp-justification
>   field is in the release, and the formal offramp outcome remains open.
> - The Initial Assessment rationale was built in this release, not a
>   later slice.
> - Manual attendance is the release path; Zoom roster suggestions stay off
>   in Production.
>
> The body below is unchanged from 2026-11-06.

**Status at writing [PLANNED].** Design and review only. Build later in a separate
checkout on a development branch cut from freshly verified main. The
Semi-finalist branch at `62f007ef7` is separate and its deployment remains
on hold. Keep the current-cycle experience available while testing J27.

## Experience and first slice

Workbench has Overview plus four phases: Initial Assessment, Peer Review,
Deliberations and Final Assessment. Peer Review contains Panel and Reports.
Keep existing Find, Invite and Track capabilities reachable within Panel.
Initial Assessment is a later build slice with one staff rationale serving
both advancement and triage. This brief does not retire the legacy document
or its historical access paths.

| Surface | Staff task and handoff |
|---|---|
| Reports | Read the full reports and compare scores through the current Reviews capabilities. Generate a factual paragraph from current submitted reports with reviewer names, institutions and ratings. Save staff interpretation separately. Refresh facts as reports arrive without changing that interpretation. |
| Deliberations | Open the saved review record on demand. After a presentation, confirm the attendee roster and write the staff assessment of the visit, including its tone and what staff took away. Existing transcripts and published summaries are evidence. Staff can write their assessment without a transcript. For a proposal that stops before presentation, save a short offramp justification. |
| Final Assessment | Open the existing Word writeup and read the saved upstream material on demand. Keep the Board recommendation in Word. Defer document generation and Word reconciliation to the end. |
| Overview | Show where the request stands using authoritative data and link to the relevant record. A saved offramp justification may appear as a cue. Its presence does not establish that the proposal formally stopped. |

The formal offramp outcome and its Dataverse field/value are open pending
Sarah and Connor. The slice neither writes a formal outcome nor maps an
existing status to an offramp. Keep any separate presentation question field,
Finder redesign and new Board-facing distribution out of this slice.

## Pre-build findings and proposed contracts

- **Reports [VERIFIED via source and request 1002852 readback].** The current
  Reviews surface reads reviewer/answer snapshots and can copy composed
  writeup paragraphs. `composeScoreSentence` and `composeReviewerSentence`
  in `shared/utils/review-writeup-paragraphs.js` provide starting points.
  Verify exact text with missing ratings, unknown affiliation and
  received-without-file records. The richer composer can include AI themes
  and quotations. The factual block should use only verified reviewer facts.
  The AI synthesis memo is a separate generated input. **[PLANNED]** Derive
  the factual paragraph from the current visible submitted-report projection
  and store staff interpretation with a fingerprint of the submitted evidence
  it was saved against. Include stable suggestion IDs and the material inputs
  used in the facts so a corrected rating can also trigger the cue. Show that
  evidence changed without replacing staff prose. Received-without-file
  entries count as received under the existing projection. Show missing
  ratings as missing. Do not copy old AI text or Word text automatically.
- **Deliberations [VERIFIED via source and 1002852 readback].** Meeting Tracker
  can edit and publish distinct presentation and staff-discussion summaries.
  The reader binds them to the relevant transcript and preserves the
  staff-only discussion boundary. The published material is available as
  evidence. **[PLANNED]** Save a human-authored visit assessment independently
  of transcript availability. Save offramp justification separately so one
  does not replace the other. Production metadata confirmed the existing
  Invite/Decline Notes memo, but current export treats it as decline
  rationale. Provision a dedicated memo for justification.
- **Meeting roster [VERIFIED via source].** The Zoom client reads a report by
  meeting UUID. The existing attendance review groups display names, tracks
  timing and distinguishes waiting-room-only entries. Its discussion
  attribution is a different use. The scheduled attendee references provide
  identity and category hints, not proof of attendance. **[PLANNED]** Bind
  suggestions server-side to the exact request and presentation occurrence.
  The current Zoom path uses the verified transcript publication to resolve
  the meeting UUID. Verified alignment and presentation bounds are required
  to infer in-meeting presence during the applicant presentation. The
  first slice falls back to manual entry when that source is unavailable. Show ambiguous, shared-device and partial-report
  cases for confirmation. Keep WMKF attendees and consultants distinct and
  exclude applicant-side attendees from the opening sentence. Allow manual
  correction or entry with no Zoom data. Save the confirmed roster against
  the presentation occurrence. Use confirmed references from the scheduled
  attendee map (`wmkf_attendeerefsjson`) or the staff directory where
  available. Zoom supplies display names and presence evidence. It supplies
  no stable person reference through the current client. Keep display labels
  for historical rendering and source/confirmation provenance. Do not persist raw Zoom logs. Generate a copyable sentence
  from the confirmed roster. A new occurrence or changed timing must not
  silently inherit the old confirmation.
- **Final Assessment [VERIFIED via source].** The current Final Writeup reads
  the Word pointer and its permissions. `POST /api/workbench/final-writeup` starts group review and
  can stage a notification. **[PLANNED]** Reuse the read and Word launch
  behavior. Keep draft-field saves independent of the existing transition,
  email and Board distribution actions.

## Data and permissions

**[PLANNED]** Three request-scoped Dataverse memos for staff review summary,
staff visit assessment and offramp justification, plus review evidence
fingerprint metadata saved atomically with the summary. Exact names and
provisioning remain pending. Use the Site Visit activity ID as the
presentation anchor and bind confirmed attendance to the specific occurrence
and timing evidence. Verify the presentation activity schema before choosing
an attribute or child record. Apply the linked-cycle J27 gate to all new
writes and the redesigned navigation. An explicit read-only development
fixture can show historical 1002852 without enabling any new writes to it.

**[PLANNED, owner decision]** Any authenticated staff member with existing
Workbench access to the request can edit the new J27 staff records, including
the meeting roster. No separate Program Coordinator, lead-PD or
program-assignment check is required for these edits. Enforce the existing
access gate, linked-cycle check and read-only mode server-side, and attribute
writes to the authenticated actor. Existing Word, reviewer, publication and
review transition permissions retain their own contracts.

Use the request row ETag for memo saves. An intervening update to the request,
including another memo or an AkoyaGO edit, returns a conflict. Preserve the
unsaved text, reload the authoritative record, and let staff review before
retrying. Save the roster against its own record version and recheck the
occurrence binding. Fence async UI responses by request identity.

## Development proof

1. Keep a separate checkout and branch. Begin with existing authenticated
   read paths and mocked editor states. For the 1002852 walkthrough, use
   explicitly authorized read-only access to current data. In a
   production-backed preview, treat server-side read-only enforcement as a
   build prerequisite. The current page prop restricts selected UI controls.
   Prove each new mutation route rejects direct requests in read-only
   mode. Keep the Dataverse interlock on and verify production-write
   exceptions are absent. Separately fence SharePoint/Graph and Zoom
   mutations, mail, AI generation and job dispatch, and production Postgres
   and Blob writes. Use read-only credentials where available and omit
   surfaces whose boundaries cannot be proved. Never change or copy a real request into a writable rehearsal
   environment without explicit scope.
2. In an isolated writable sandbox, use synthetic proposals for staff saves,
   stale-write races, missing transcripts, manually corrected rosters, report
   refresh and the offramp justification path. Verify that a later phase
   reads the same saved text, and a refresh changes reviewer facts without
   changing staff interpretation. Test an authorized staff member who is neither
   the lead PD nor a PC, and verify denial without existing Workbench access.
   Check that draft saves produce no notifications,
   workflow transitions or Board release.
3. Check 1002852's three ratings and current Word recommendation against
   the read-only views. Verify that the proposed offramp path can preserve
   prose without assigning a formal outcome. Keep the current-cycle
   navigation, saved documents, and reviewer functionality available.
4. Before release, document API authorization and data ownership in the
   route security matrix and Atlas (Request plus the Site Visit activity or
   its roster child), run the relevant repository gates, and
   rehearse both paths. No production promotion is implied by this brief.

## Pre-build decisions remaining

- Confirm Dataverse provisioning and the canonical meeting occurrence
  reference for the roster. No new metadata has been provisioned.
- Verify an isolated preview's backend credentials and mutation boundaries
  before connecting current data. No preview was deployed for this brief.

## Independent review

Claude Fable 5.1 reviewed the draft against tracked source. The plan now
specifies request-row concurrency, linked-cycle isolation and a server-side
read-only preview prerequisite. Fable flagged that Coordinator personas
do not establish request scope. The owner subsequently chose the existing
Workbench access boundary for these new staff edits.
It also distinguishes Zoom presence from staff identity, identifies the
manual roster fallback, and records how staff are alerted when review
evidence changes. The review did not re-run the live 1002852 readback. This is a reviewed draft with
pre-build prerequisites, not release approval.
