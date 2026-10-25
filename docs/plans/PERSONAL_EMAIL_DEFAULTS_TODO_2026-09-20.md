---
title: Personal email defaults and editable previews
domain: platform
kind: plan
status: active
summary: Owner-requested personal email defaults across the suite. Meeting Tracker slice #320 is Production-verified; grantee invitation #330 and reviewer reminders #332 are merged and verified through source and test inspection, while broader adoption remains open and live delivery for those merged slices is unverified.
owner: product-engineering
related:
  - docs/CURRENT_WORK_QUEUE.md
  - docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md
---

# Personal email defaults and editable previews

## Owner requirements — 2026-09-20

[PLANNED; explicit owner direction]

- Every user with permission to use the relevant app can save their own email
  modifications; this is not restricted to Duncan or administrators.
- Meeting Tracker must support this for both the original applicant-materials
  invitation and the reminder, including subsequent invitation sends.
- The preview must remain editable after personal defaults are applied, so the
  sender can adjust tone to their familiarity with the recipient and the need
  to encourage submission.
- Record the same personal-default capability across all email cases in the
  app suite as a to-do. Inventory existing support and gaps before implementation;
  do not assume all senders currently behave the same way.

## Proposed interaction contract

[Owner contract; Meeting Tracker implementation Production-live]

Shared default → sender's saved default → edits for this particular send → send.
Invitation and reminder defaults are separate. Saving personal defaults is an
explicit action; editing or sending one personalized message must not silently
overwrite those defaults or another user's settings. Shared administrator
templates remain the starting point when no personal default is saved.

Preserve server-controlled recipients, upload links, current required/missing
items, authorization and truthful send outcomes. Required content must remain
correct when the surrounding wording is personalized. Reuse the suite's existing
preference and preview mechanisms after tracing their contracts. The Meeting
Tracker implementation selects its own route and existing preference store; this note
does not select an API or generalized editor for suite-wide use.

## Slice 2 owner decisions — 2026-10-24

[PRODUCTION-VERIFIED via PR #521, 687994c2a, 2026-10-24.] Reviewer deadline emails follow
`docs/plans/PERSONAL_EMAIL_REVIEWER_DEADLINE_DEFAULTS_PLAN_2026-10-24.md`.
Only the assigned PD may change/restore the deadline or retry/resend its email;
there is no superuser exception. From/To stay server-controlled; optional Cc is
for one send only. Unlike required-content policies in other families, the PD may
edit or delete all body content, including signature and deadline placeholders,
leaving an empty/whitespace-only one-send or saved personal body. An empty saved
body remains a configured override; Clear restores Admin fallback. Synthetic test
requests reject every Cc before deadline writes and again at dispatch. The linked
plan includes the OAuth Opus review corrections and post-write retry proofs.
The authoritative saved date/calendar remain server-controlled. Review precedes
save/send, restore and resend; explicit defaults, fallback notices, local retry
wording/Cc and customizable subjects are specified in that plan. Released; Production subject seed and empty-body sending verified with Dynamics Sent status; limits are in the linked build audit.

## Slice 6 owner decisions — 2026-10-24

[PRODUCTION-VERIFIED via PR #522 / 9d12b24ce, 2026-10-24.] The pre-discussion agenda defaults plan is
`docs/plans/PERSONAL_EMAIL_MEETING_AGENDA_DEFAULTS_PLAN_2026-10-24.md`. PCs normally send, with other Meeting Tracker staff permitted
as backup, using their own mailbox/defaults. Save subject and optional opening
only; generated agenda details stay server-owned. To/Cc remain one-send edits.
Use the adopted collapsed **Your default wording** editor with separate raw
template fields and **Save as my default** / **Clear my default** actions;
neither changes the open email. Empty saved opening differs from Clear.
Fallback, session-date placeholders, fresh reopen, session drift and original
unresolved-send recovery follow the linked plan. OAuth Opus returned READY WITH
NAMED CHANGES on the original plan; the revised plan incorporates all eight
findings, with raw-template, full freshness, privacy and async requirements.
The revised plan is implemented on `codex/meeting-agenda-email-defaults`;
corrected runtime passed full tests/build and OAuth Opus recheck (PASS).
Production shared wording validated unchanged; one isolated synthetic agenda
email reached Sent. Owner confirmed inbox receipt and correct appearance.
Released through PR #522 as `9d12b24ce`; Production READY and signed-in
agenda composer/default-editor read-only smoke passed.
Evidence: `docs/audits/MEETING_AGENDA_DEFAULTS_BUILD_2026-10-24.md`.

## Slice 7 planning — deliberation-distribution defaults

[PLANNED — owner requested review and draft only, 2026-10-25.]
Bounded source review and proposed contract:
`docs/plans/PERSONAL_EMAIL_DISTRIBUTION_DEFAULTS_PLAN_2026-10-25.md`.
This covers own-sender subject/message defaults before the existing frozen
preview. Runtime is unchanged. The owner confirmed non-empty messages and fresh
ordinary reopen with a warning before discarding edits (2026-10-25). The plan
now specifies exact unresolved-send preservation, open/reset ownership, close-path
warnings, retained source-paused drafts and pair-specific status. First Claude
review is preserved in
`docs/audits/DISTRIBUTION_DEFAULTS_PLAN_CLAUDE_REVIEW_2026-10-25.md`;
Claude re-review confirmed the original findings addressed; four refinements
(no-activity proof, concrete navigation guard, stable auth scope and async lanes)
are incorporated, with a focused final recheck pending before coding.
No database work, runtime changes or live sends.

## Existing pre-discussion calendar events — Duncan walkthrough pending 2026-10-25

- [x] Investigate whether the generated agenda can update an existing invitation.
- [ ] Walk through Duncan's scheduling process with the owner, then resolve the
  questions below before drafting an implementation plan. [OWNER-DIRECTED
  2026-10-25.] No walkthrough date is set. Implementation is on hold; the
  agenda-section proposal below has not been adopted. This follow-up is separate
  from the released slice 6.

### Meeting checklist — pre-discussion calendar agenda

Start by having Duncan show how he creates a pre-discussion invitation and adds
the proposal list.

**What we found**

- The example invitation showed **Shared Calendar** as organizer and **Research
  Staff** as invitee. It already contained Zoom details, notes and a manual
  proposal list.
- Microsoft supports updating an existing invitation, provided the app has the
  correct access.
- Meeting Tracker generates agenda timings and briefing links but currently
  sends a separate email; it has no connection to the calendar event.
- We have not confirmed the actual organizing account, edit permissions or
  whether these are recurring meetings. Evidence and limits are recorded below.

**Walkthrough and decisions**

- [ ] **Show the scheduling process.** Where does Duncan create the invitation?
  Who owns the calendar, and who can edit when he is absent? Separate events or
  a recurring series?
- [ ] **Connect the correct meeting.** How should staff select and confirm the
  invitation belonging to a Meeting Tracker session? Which system controls the
  time and attendees?
- [ ] **Agree on agenda content.** Would an app-managed Agenda section work,
  preserving Zoom details and other notes? How should the first update replace
  the manual proposal list?
- [ ] **Confirm the audience.** Who receives Research Staff invitations? Should
  everyone receive the briefing links, which grant access through the link?
- [ ] **Choose notification behavior.** Should a calendar update replace the
  separate agenda email, or should both remain available?
- [ ] **Agree on control and recovery.** Who previews and applies updates? What
  should happen if Duncan edits the invitation afterward, reschedules it or an
  update fails?

**Outcome:** Record the agreed workflow here, then prepare an implementation plan
and test it on a synthetic invitation before changing real meetings.

### Findings to bring to the walkthrough

- [VERIFIED via read-only Outlook inspection, 2026-10-25.] The owner-selected
  example, **Pre-RP discussions**, was September 24, 2026, 1:30–3:00 PM. It showed
  **Shared Calendar** as organizer and **Research Staff** as invitee. Its body
  already contained Zoom joining information, an attendance note and a manually
  written proposal list. The inspected item was the owner's accepted attendee
  copy; it does not establish organizer-side access. Calendar type, organizing
  account, recurrence and backup editing rights remain [UNVERIFIED]. The owner
  identifies Duncan as the scheduler; his creation process has not been observed.
- [VERIFIED via Microsoft documentation.] Updating an existing event body is
  supported, subject to the correct calendar identity and permissions. Shared or
  delegated calendar access is supported, but the correct model depends on the
  actual calendar type. Preserve the current online-meeting information when
  editing the body. Recurring-event updates can cause multiple notifications;
  silent updates are not established. Sources:
  [Update event](https://learn.microsoft.com/en-us/graph/api/event-update?view=graph-rest-1.0),
  [shared/delegated calendars](https://learn.microsoft.com/en-us/graph/outlook-get-shared-events-calendars).
- [VERIFIED via tracked schema, adapter and agenda service.] Meeting Tracker
  sessions currently have no Outlook mailbox/calendar/event binding. The agenda
  service already generates ordered proposal details, timings and briefing links,
  but dispatches a separate Dynamics email. Evidence:
  `lib/dataverse/schema/wave28-meeting-tracker/wmkf_deliberationsession.json`,
  `lib/dataverse/adapters/deliberation-session.js`,
  `lib/services/meeting-tracker/agenda-service.js`.
- [VERIFIED via source.] Existing calendar attachments use informational
  `METHOD:PUBLISH`; they are not an organizer update channel. Staff sign-in does
  not request calendar permissions. The existing Graph service uses application
  credentials; actual tenant calendar grants remain [UNVERIFIED]. Evidence:
  `lib/external/calendar-invite.js`, `pages/api/auth/[...nextauth].js`,
  `lib/services/graph/auth.js`.
- [VERIFIED via source.] Briefing links grant token-based access. The calendar's
  Research Staff audience may differ from the agenda email's To/Cc audience;
  intended access and forwarding exposure need review before inserting links.
  Evidence: `pages/external/briefing/[token].js` and
  `lib/services/deliberation-briefing/briefing-link-service.js`.

### Questions to resolve with Duncan

1. **Scheduling and ownership:** How does he create the blocks, and in which
   organizing account/calendar? Is it a shared mailbox, delegated calendar or
   group? Who can edit, and who covers absences? Are sessions separate events,
   copied events or occurrences of a recurring series?
2. **Connecting the records:** How should staff confirm the exact existing event
   for each Meeting Tracker session? Which system controls meeting times and
   attendees when the records differ? Should an update affect only one occurrence?
3. **Content and first conversion:** When does Duncan add or revise the manual
   proposal list? Would a clearly marked app-managed Agenda section fit, preserving
   Zoom details and other notes? How should the first update replace the manual
   list without duplicates? Which proposal details, times and links belong there?
4. **Audience and notifications:** Who is in Research Staff, and should everyone
   receive briefing links? Should calendar attendees remain unchanged? What
   calendar update notifications are expected, and should the standalone agenda
   email remain optional, remain routine or be replaced for this workflow?
5. **Action and recovery:** Who should preview and explicitly apply an update?
   How should later Outlook edits, rescheduling, deleted/cancelled events and
   uncertain failures be handled? Confirm permissions/admin requirements and
   verify changed-event detection, readback and retry behavior on a synthetic
   event before any real invitation update.

[PLANNED.] Record the walkthrough answers here, then review a bounded plan.
Technical feasibility is established in principle; actual organizer access and
safe end-to-end update behavior are not verified. No calendar edits, permission
changes or notification sends were made or authorized by this follow-up.

## Email interface consistency — Production released and verified

- [x] Have **Impeccable review email interfaces across the app suite for
  consistency**. Inventory and inspect current rendered compose/defaults/preview/
  confirmation/recovery interfaces, including reviewer invitations, reminders,
  release courtesies, deadline updates, grantee invitations/scheduled messages,
  Meeting Tracker materials/agenda and deliberation distribution. Include
  relevant Profile Settings and shared Admin wording entry points. Compare
  labels, placement, control hierarchy, sender/recipient visibility, template
  versus one-send boundaries, Save/Clear/reset semantics, placeholders, fallback,
  loading/error/success/uncertain states, accessibility and narrow-screen usability.
  Start with the adopted **Your default wording** pattern; distinguish justified
  workflow differences from accidental inconsistency. Produce a source-backed
  visual audit and prioritized, bounded harmonization plan for owner review.
  Preserve family-specific permissions, required/generated content and transport
  safety. This completed review is not approval for suite-wide implementation,
  live sends or DESIGN.md changes; it did not block slice 6.
  [VERIFIED via rendered components, source review and 120 focused tests.]
  Completed report: `docs/audits/EMAIL_INTERFACE_CONSISTENCY_AUDIT_2026-10-24.md`.
  Nine findings (three P1, six P2). Accessible dialog/labels/contrast first, then
  future-only default actions, truthful sender/source summaries and control/target
  consistency. Product UI is unchanged at plan creation; owner approved all nine recommendations
  with an explicit desktop-first constraint.
- [x] Review the audit recommendations with the owner; all nine agreed.
- [x] Independently review and implement the three-pass contract in
  `docs/plans/EMAIL_INTERFACE_CONSISTENCY_IMPLEMENTATION_PLAN_2026-10-24.md`.
  Released and Production-smoke verified through PR #523 (`5de197918`); checks/limits in
  `docs/audits/EMAIL_INTERFACE_CONSISTENCY_BUILD_2026-10-24.md`.
  Preserve desktop density; no phone-driven redesign. Calendar-event updates
  and remaining personal-default slices remain separate.

## Current evidence and next work

[VERIFIED via source, tests, merge and Production evidence 2026-09-20]
`shared/config/editableTextDefaults.js` registers shared subject/body defaults
for `email.site_visit_materials_invite` and `email.site_visit_materials_reminder`.
Meeting Tracker provides a personal-template preference route,
separate invitation/reminder own-profile override keys, and an editable preview
for the first invitation, later invitation, and manual reminder. Preview does
not create the collection or send; explicit Send is bound to a short-lived
server-signed proof and renders the contributor URL server-side. The automatic
reminder's template remains the shared Admin default. PR #320 promoted the
implementation at merge `834b83d8382`. GitHub CI passed 1,050 suites / 15,513
tests; Production deployment
`dpl_FRtcw4uqBB12jAH7Ug1aPfYTB8nQ` reached Ready. The four shared Admin values
were saved only after runtime promotion and independently read back exact against
the tracked seeds. No email was sent.

- [x] Trace the existing personal-template persistence and preview/send contracts.
- [x] Finish review, tests, and acceptance of the Meeting Tracker feature-branch
  personal defaults and editable previews, including cross-user isolation and
  partial/uncertain send outcomes.
- [ ] Track the inherited personal-preference read limitation: the shared
  Dataverse preference reader maps read errors to an empty result, so a transient
  failure can make an existing personal override appear absent. The explicit
  Save action is still required to change that override; see the feature
  execution plan's residuals.
- [x] Inventory suite-wide email flows and record each gap against this requirement.
  See `docs/plans/PERSONAL_EMAIL_DEFAULTS_INVENTORY_2026-09-24.md` (the Sep 24
  counts and case table are a historical source baseline; slices #330 and #332
  are now merged, and remaining suite-wide follow-ups remain open).
- [ ] Extend the capability consistently in bounded, reviewed follow-ups.

## Current implementation update — 2026-10-19

[VERIFIED via current Git ancestry, source, and focused test inspection; implementation status only]

- **Grantee abstract invitation, slice 4:** PR #330 is merged on `main` as
  `185c9f35f`. `shared/components/workbench/AwardeeTab.js` applies the sender's
  saved subject/body preferences over Admin defaults while retaining editable
  compose. Relevant focused tests include
  `tests/unit/profile-settings-email-signature.test.js` and
  `tests/unit/grantee-send-invite-workbench-service.test.js`.
- **Reviewer reminders, slice 1:** PR #332 is merged on `main` as
  `bab0d3989`. Manual respond/review-due previews use per-kind personal defaults
  via `shared/components/reviewers/RespondReminderModal.js` and
  `lib/services/reviewer-manual-reminder.js`. Automatic `respond` and
  `reviewdue` sweeps load the sending PD's default in
  `lib/services/reviewer-reminder-sweep.js`. Focused tests include
  `tests/unit/reviewer-reminder-personalization.test.js`,
  `tests/unit/reviewer-manual-reminder.test.js`, and
  `tests/unit/reviewer-reminder-sweep.test.js`.

These checks do not establish Production deployment or live email delivery for
#330/#332. The Sep 24 inventory counts have not been recalculated. Other email
families remain in the inventory's follow-up table, so the suite-wide initiative
is still open.

The separate Test Request Factory platform status is tracked in
`docs/plans/CONNOR_TEST_REQUEST_FACTORY_HANDOFF_2026-09-19.md`; it does not
block the personal-email-defaults work described here.
