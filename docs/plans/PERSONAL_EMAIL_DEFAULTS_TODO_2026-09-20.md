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

[PLANNED; owner agreed; not built.] The pre-discussion agenda defaults plan is
`docs/plans/PERSONAL_EMAIL_MEETING_AGENDA_DEFAULTS_PLAN_2026-10-24.md`. PCs normally send, with other Meeting Tracker staff permitted
as backup, using their own mailbox/defaults. Save subject and optional opening
only; generated agenda details stay server-owned. To/Cc remain one-send edits.
Use the adopted collapsed **Your default wording** editor with separate raw
template fields and **Save as my default** / **Clear my default** actions;
neither changes the open email. Empty saved opening differs from Clear.
Fallback, session-date placeholders, fresh reopen, session drift and original
unresolved-send recovery follow the linked plan.

## Email interface consistency review — queued 2026-10-24

- [ ] Have **Impeccable review email interfaces across the app suite for
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
  safety. This is a queued review, not approval for suite-wide implementation,
  live sends or DESIGN.md changes; it does not block slice 6.

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
