---
title: Personal email defaults and editable previews
domain: platform
kind: plan
status: active
summary: Owner-requested personal email defaults across the suite, with editable applicant-materials invitation and reminder previews as the immediate use case.
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

[PLANNED; implementation design still required]

Shared default → sender's saved default → edits for this particular send → send.
Invitation and reminder defaults are separate. Saving personal defaults is an
explicit action; editing or sending one personalized message must not silently
overwrite those defaults or another user's settings. Shared administrator
templates remain the starting point when no personal default is saved.

Preserve server-controlled recipients, upload links, current required/missing
items, authorization and truthful send outcomes. Required content must remain
correct when the surrounding wording is personalized. Reuse the suite's existing
preference and preview mechanisms after tracing their contracts; no new schema,
API, persistence strategy or generalized editor has been selected by this note.

## Current evidence and next work

[VERIFIED via source read 2026-09-20] `shared/config/editableTextDefaults.js`
registers shared subject/body defaults for `email.site_visit_materials_invite`
and `email.site_visit_materials_reminder`. `SiteVisitMaterialsCard.js` currently
invokes create/invite/remind directly, and its API accepts actions plus waiver
fields, not custom email content. `InviteEmailModal.js` documents an existing
editable-preview workflow and per-user settings precedent. These are reuse
candidates, not proof of an interchangeable shared implementation.

- [ ] Trace the existing personal-template persistence and preview/send contracts.
- [ ] Design and implement personal defaults plus editable previews for Meeting
  Tracker invitations and reminders, with cross-user isolation and draft tests.
- [ ] Inventory suite-wide email flows and record each gap against this requirement.
- [ ] Extend the capability consistently in bounded, reviewed follow-ups.

The owner confirms Connor has not yet responded about the Test Request Factory.
That separate platform dependency remains open. It does not prevent mocked UI
rehearsal or design of these email controls; this note authorizes no production
test-request creation or real email send.
