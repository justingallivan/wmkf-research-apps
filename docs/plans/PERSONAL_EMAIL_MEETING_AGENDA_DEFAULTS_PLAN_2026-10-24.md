---
title: Personal meeting agenda email defaults — slice 6
domain: meeting-tracker
kind: plan
status: planned
summary: Owner-agreed personal subject and optional opening message for pre-discussion agenda emails, with sender-owned defaults, separate one-send edits, familiar default-wording disclosure and unchanged exact-send recovery.
owner: product-engineering
related:
  - docs/plans/PERSONAL_EMAIL_DEFAULTS_INVENTORY_2026-09-24.md
  - docs/plans/PERSONAL_EMAIL_DEFAULTS_TODO_2026-09-20.md
  - docs/plans/AGENDA_EMAIL_DEFAULTS_BUILD_BRIEF_2026-09-10.md
  - docs/API_ROUTE_SECURITY_MATRIX.md
---

# Personal meeting agenda email defaults — slice 6

## Status and scope

[PLANNED; owner decisions agreed 2026-10-24.] This is the implementation plan
for personal defaults for the agenda of the pre-discussion before the site visit /
research presentation. Product decisions are settled; this document does not
claim implementation, independent implementation review, deployment or live delivery.
The September Admin-defaults build brief describes earlier shared-default work;
it is not the personal-default implementation plan.

Change surface: agenda composer, sender-owned preference read/save/clear,
optional opening validation and fresh preview rendering. Entry points:
`shared/components/meeting-tracker/SessionAgendaPanel.js` and
`pages/api/meeting-tracker/sessions/[id]/agenda.js`. Persistence: existing
Dataverse `wmkf_appuserpreferences` for personal defaults and
`wmkf_appsystemsettings` for shared defaults; existing PostgreSQL
`deliberation_agenda_sends` for exact email snapshots and recovery. Consumers:
composer, preview, Dynamics transport and unresolved-send reconciliation.
No new table, migration, cron or generalized email-editor framework is proposed.

## Agreed owner decisions

1. **PC normally sends; backup staff permitted.** PCs primarily handle these
   emails. Keep Meeting Tracker access as the permission boundary so another
   authorized staff member can cover illness or absence. Send from the acting
   user's own Dynamics mailbox and use that user's defaults. No assigned-PD-only,
   PC-only or on-behalf-of restriction is introduced.
2. **Personal scope is subject and opening only.** Save a reusable subject and
   opening message. Session date/time, time zone, meeting link, location, ordered
   proposals, durations, lead PDs and briefing links remain generated from current
   session/slot data. Show the full exact email for review before sending.
   Generated content is not part of the saved template or editable opening.
3. **Explicit own-user Save/Clear.** Editing or sending changes only that email.
   Save changes only the acting user's future drafts. Clear removes that override
   and restores shared Admin wording for future drafts. Neither operation changes
   recipients, session data, the open one-send draft or a frozen pending email.
4. **Empty opening allowed.** Require a nonblank subject; opening may be empty or
   whitespace-only for one send and as a saved default. A saved empty opening is
   a configured preference, not Clear. Sending with no introduction still includes
   all generated session details and agenda. Never silently insert deleted prose.
5. **Recipients belong to one send.** Initially populate To from current session
   attendees and start Cc empty. Both remain editable, validated and visible in
   the exact preview. Never store To/Cc in personal defaults. Keep existing
   recipient validation and transport safety; slice 2's synthetic-request Cc ban
   is not automatically imported into this distinct session workflow.
6. **Fallback with notice.** If personal defaults are unreadable or damaged, show
   shared Admin wording with a visible notice, without modifying the saved row.
   Missing override normally uses Admin wording and is not an error. If shared
   wording also cannot load, show empty fields and a notice; staff may enter a
   subject and optionally an opening, preview and send. Shared failure must not
   prevent using a valid personal pair or repairing/clearing personal settings.
7. **Reusable placeholders.** Support optional `{{sessionDate}}` in subject and
   opening, resolved to the current session date in its time zone. Saved defaults
   retain the raw token, not a concrete date from the current email. Literal copy
   without a placeholder is allowed. No additional placeholders are selected.
8. **Unresolved sends retain original content.** Reopen the original frozen
   recipients, subject, rendered body and agenda. Changes to defaults apply only
   to new drafts, never alter a pending email, create a replacement automatically
   or cause an automatic resend. Retain original-sender recovery and transport
   reconciliation against the same Dynamics activity.
9. **Fresh on reopen.** Closing an ordinary unsent composer discards one-send
   edits. Reopen with current defaults, current attendees in To and empty Cc.
   An unresolved send is the exception and reopens its original frozen email.
   No additional durable draft store is introduced.
10. **Session drift requires new review.** If time, zone, proposal order,
    durations, location or links change before sending, retain one-send wording
    and recipient edits, regenerate agenda and any retained `{{sessionDate}}`,
    and require a fresh exact preview and confirmation. Literal dates manually
    entered by staff are their copy; do not guess or rewrite them. Never reload
    defaults over open edits during this refresh.
11. **Adopt the newer default-wording interface.** Beneath the one-send fields
    and above preview, use a collapsed **Your default wording** section, matching
    reviewer release/deadline emails. It has separate **Subject** and
    **Opening message (optional)** template fields, optional `{{sessionDate}}`
    guidance, **Save as my default**, and **Clear my default** when configured.
    Explain: “Used for future agenda emails. Edits to the email above are not
    saved here.” Confirm that Save/Clear leaves the current email unchanged.
    Quietly identify personal/shared wording when loaded; use warning treatment
    for failed-load fallback. Preference actions stay secondary to preview/send.
    No separate Profile Settings destination or additional modal is needed.

## Verified baseline and gaps

[VERIFIED via source and 47 passing tests in two agenda suites during this review.]
`agenda-service.js` reads shared `email.deliberation_agenda.subject` and `.body`,
resolves `{{sessionDate}}` in GET, validates compose input, appends generated
session/agenda details and persists exact text/HTML before sending. Current
`composeInput` and panel preview guards require a nonempty opening: those must
change. There is no agenda personal-default key in the current preference
registry. Baseline tests are not coverage of the planned additions.

The agenda route derives sender email and Dynamics actor from the authenticated
session under `requireAppAccess('meeting-tracker')` and DAL context. The send
service freezes sender/recipients/copy, rejects changed agenda facts, keeps
original-sender dispatch and reconciles pending activity status before resuming.
The existing ledger is load-bearing; retain it rather than copying slice 2's
short-lived preview-proof mechanism.

[VERIFIED via read-only agent source inspection and successful Impeccable context.]
The suite has multiple incumbent patterns, not one universal component. Reviewer
release/deadline use a separate raw-template disclosure; materials/reminder flows
use footer actions; grantee defaults use Profile Settings. Owner chose the newer
disclosure for agenda. This was a source-based consistency review, not a rendered
visual or live-delivery audit. Preserve DESIGN.md and the established Operate
hierarchy: familiar controls, restrained state feedback, clear send commitment.

## Implementation contract

[PLANNED technical design; verify against current source before building.]

- Add a bounded agenda-only subject/opening pair to the existing preference
  registry and own-user store. Plan an app-gated
  `GET/PUT/DELETE /api/meeting-tracker/agenda-email-preferences` route with DAL
  context, strict own-user reads, exact input allowlists and session-derived
  identity. No client owner/profile/systemuser selector. Reserve private reads
  and writes in the generic preference route as appropriate to its current
  contract; distinguish absent, invalid and unavailable data. Permit Save/Clear
  independent of failed shared reads. Update route matrix/counts/Atlas/catalog
  only for implemented surfaces, not as if this planned route already exists.
- Keep raw personal/shared template data separate from resolved compose output.
  Resolve retained tokens server-side against fresh session facts during preview.
  Do not initialize or save reusable templates from already rendered date text.
  Preserve raw token provenance through one-send edits and drift refresh so a
  session date change can update tokens without replacing user edits. Reject
  unknown/malformed tokens; preserve plain-text escaping and bound expanded copy.
  Retain the current 500-character subject and 20,000-character opening limits
  unless implementation review identifies a concrete mismatch; align parser
  limits with serialized UTF-8 payload size. Opening presence/type checks must
  accept empty strings; require a nonblank single-line final subject.
- Keep template editing and one-send editing independent. Save/Clear/load responses
  must not replace compose fields, invalidate an otherwise exact preview or send
  an email. Lock conflicting writes/actions while in flight and use mounted /
  session / actor / generation guards for every success, failure and finally
  update. Close/context changes clear ordinary draft and stale preview state.
- Keep exact snapshot preparation, confirmation, sender binding, concurrency
  lease, correlation recovery and no-duplicate-activity rules. Send uses only the
  reviewed frozen email; it never reloads current defaults. Distinguish a stale
  prepared preview requiring refresh from an unresolved transport attempt that
  must first reconcile its original snapshot. Preserve definite, uncertain,
  accepted and terminal outcomes; acceptance is not inbox confirmation.
- Reuse interaction/visual vocabulary from `DeadlineWordingDefault.js` and
  `ReleaseWordingDefault.js`, not their entire family-specific validation,
  identity, endpoints or current-email refresh callbacks. Use shared control
  primitives per DESIGN.md. Keep broader interface harmonization in the
  separate suite-review to-do, not this build.

## Acceptance and contract verification

| Invariant | Required evidence before completion |
| --- | --- |
| PCs and backup staff use their own identity | Meeting Tracker app gate retained; session actor/mailbox; user A cannot read/write B's private defaults or send B's prepared draft |
| Only wording persists as personal settings | Explicit Save/Clear; no recipient/session/agenda data in preference; send never saves; empty saved opening differs from Clear |
| Raw tokens remain reusable | Save/load retains `{{sessionDate}}`; different sessions/zones and changed date resolve correctly; literals unchanged; unknown/malformed tokens rejected |
| Optional opening remains optional | Empty/whitespace personal, shared and one-send cases; generated details/agenda still present; nonblank final subject required |
| Fallback preserves work | Missing/invalid/unavailable personal and shared reads; visible notice; valid personal usable; own repair works; no silent writes |
| Independent default editor | Save/Clear/deferred load leaves one-send wording, To/Cc and frozen preview unchanged; labels/feedback match adopted pattern |
| Fresh session data needs review | Time/zone/order/duration/location/link drift refuses stale send, preserves raw wording/recipient edits and requires new confirmation |
| Unresolved send remains exact | Changed defaults and close/reopen never rebase pending snapshot; original sender, same activity, no blind duplicate or automatic resend |
| Async and reopen behavior | Session/actor change, unmount, close, late responses and failures cannot leak old state; fresh ordinary reopen versus frozen unresolved reopen |

Trace UI → app/identity validation → strict preferences/shared templates →
raw one-send draft → fresh session rendering → frozen PostgreSQL preview →
confirmation → existing Dynamics transport/reconciliation → truthful UI result.
Partial success is per preference action or exact agenda operation, never a
blanket success after an unconfirmed write/send. Schema migration is N/A unless
implementation proves an existing-store incompatibility; shared-helper changes
must preserve sibling families. Audit raw preference key, DTO/status/reason
consumers, both generic preference guards and every agenda reset path.

Extend agenda service/route/panel tests and add preference validation/isolation
coverage. Run scoped lint/types and affected route, Atlas, fact, lifecycle,
Dataverse/context, status and documentation gates with sequential self-tests.
Use Impeccable for bounded desktop/narrow UI verification, then independent
implementation review. Follow the Tier 2 branch/promotion procedure. No live
seed, migration, email or deployment is authorized by this planning task.

## Documentation reconciliation — 2026-10-24

Sweep Mode A, scope: the agreed personal agenda-default product contract and
separate suite email-interface review task. Authority: owner decisions in this
conversation, with source/agent inspection for baseline and compatibility.
Updated the inventory's slice-6 row/description, suite to-do and session pointer.
September inventory case rows remain explicitly historical. Earlier Admin build
brief remains its own completed shared-default work. Unrelated slice numbers,
email-family permissions and old release receipts are outside this change.
Product intent is PLANNED; no personal agenda implementation is claimed. No
product decision remains open; technical review and build verification remain.
