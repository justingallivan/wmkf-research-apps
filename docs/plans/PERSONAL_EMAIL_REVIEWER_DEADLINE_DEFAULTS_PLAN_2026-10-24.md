---
title: Personal reviewer deadline email defaults — slice 2
domain: reviewer-engagement
kind: plan
status: planned
summary: Owner-approved slice 2 decisions for assigned-PD-only deadline changes, editable preview and personal wording, optional one-send Cc, and truthful retry outcomes. Implementation has not started.
owner: product-engineering
related:
  - docs/plans/PERSONAL_EMAIL_DEFAULTS_INVENTORY_2026-09-24.md
  - docs/plans/PERSONAL_EMAIL_DEFAULTS_TODO_2026-09-20.md
  - docs/plans/PERSONAL_EMAIL_REVIEWER_RELEASE_COURTESIES_PLAN_2026-10-22.md
  - docs/API_ROUTE_SECURITY_MATRIX.md
---

# Personal reviewer deadline email defaults — slice 2

## Status and scope

[PLANNED; explicit owner decisions in the 2026-10-24 conversation.] This is the
implementation plan for slice 2. Product decisions below are agreed; runtime
implementation, new preference keys/routes, configuration and acceptance tests are
not built by this document update. No email or external record was changed.

Change surface: reviewer deadline editor, deadline preview/save/retry service and
route, own-user wording preferences, and shared Admin subject/body registration.
Entry points: `ReviewerDueDateEditor` and `/api/review-manager/review-due-extension`.
Persistence: existing Dataverse reviewer-suggestion deadline fields; existing
`wmkf_appuserpreferences` for explicit personal-default saves; existing Admin
settings for shared wording. Consumers: editor, notification transport and calendar
attachment. Prior finding: the inventory described the scope but left these
product decisions unresolved.

## Agreed owner decisions

1. **Assigned PD only.** Only the request's currently assigned PD may change or
   restore a reviewer deadline, retry its notification, or resend the deadline
   email. There is no superuser exception. Enforce this in the interface and on
   every preview and mutation request. Do not globally remove the superuser
   exception from unrelated reviewer workflows. Personal wording starts from
   this PD's own saved default; explicit Save/Clear changes only the actor's own
   settings. There is no on-behalf-of workflow in this slice.
2. **Review before action.** Choose a date, edit and preview the email, then click
   **Save deadline and send**. Preview changes no date and sends no email.
   Restoring the original deadline follows the same review flow. Resend also
   requires review but performs no deadline write. Cancel before the final
   action leaves the deadline unchanged.
3. **Visible addressing and one-send Cc.** Show read-only From and To, including
   the reviewer's full email address, above the subject/body. Add optional editable
   Cc for this send only. Validate every submitted Cc address server-side; show
   the exact validated addresses in the preview. Cc must reach the actual transport
   and be included in preview freshness validation and test-recipient safety
   checks. Never store Cc in a personal wording preference.
4. **Fully editable body.** The PD may edit or delete any body content, including
   greeting, deadline text and signature. All body placeholders are optional;
   absence of a signature or date placeholder must not block preview, saving a
   personal default, or sending. Do not append deleted sections automatically.
   Supported placeholders, when retained, resolve server-side to current values.
   The saved deadline and calendar attachment remain authoritative regardless
   of what prose the PD chooses. From/To remain system-controlled.
5. **Fallback with notice.** If personal wording is unreadable or damaged, use
   Admin wording with a visible notice: “Your saved wording couldn’t be loaded.
   Shared wording is shown below.” Staff may edit, preview and send it. Do not
   alter the saved personal row. If required shared configuration is unavailable,
   stop before changing the deadline. A missing personal row normally uses Admin
   wording and is distinct from a failed preference read.
6. **Retry retains the open draft.** If the deadline saves but dispatch definitely
   fails, keep the edited wording and Cc while the dialog stays open. Retry reads
   the currently saved deadline and does not write the date again. If the deadline
   or delivery details changed, require review of a refreshed preview first.
   Closing and reopening starts a new draft from current defaults with Cc empty;
   do not introduce durable per-send draft storage. Unconfirmed delivery displays
   uncertainty and directs the PD to check reviewer activity before resending;
   do not offer a blind automatic retry.
7. **Customizable subject.** Preserve “Updated review deadline: [proposal title]”
   as the starting copy (retain the current no-title fallback). Add an Admin
   subject default, a saved personal subject and one-send subject editing.
   Support `{{proposalTitle}}` as an optional subject placeholder. Sending edited
   copy never saves it as a default.
8. **Explicit defaults only.** Shared Admin default → PD's explicitly saved
   subject/body → edits for this send → editable preview. Save/Clear wording is
   separate from the deadline action. It neither changes a deadline nor sends
   email. Saving or clearing defaults must not silently overwrite one-send edits.

## Verified baseline and differences to implement

[VERIFIED via source review and 52 passing focused tests in this conversation.]
`lib/services/reviewer-due-extension.js` prepares notification prerequisites,
conditionally writes the deadline through
`lib/services/reviewer-engagement/change-review-deadline.js`, then dispatches.
It returns `saved: true, notified: false` after a post-write email failure.
Retry reads the stored effective date and performs no deadline write.
`ReviewerDueDateEditor` has mounted/context/generation guards for async responses.
These behaviors must survive the new preview and preference interactions.

[VERIFIED via source.] The current route uses
`authorizeReviewerRequestMutation`, which permits a superuser; the current body
requires greeting/date/signature tokens; subject is fixed in code; and the route
accepts save/retry without a preview or Cc. Those are existing behaviors to change,
not the target contract. The current route body limit is 8 KB: select bounded
subject/body/Cc/proof limits and align the parser limit with their serialized size.

## Planned implementation contract

1. Add an extension-specific own-user subject/body preference in the existing
   Dataverse store, following strict exact-owner reads from the release/reminder
   slices. Plan a dedicated app-gated preference endpoint before coding it; reserve
   its key against generic preference-route bypass. Do not add a table/migration.
   Save/Clear identity comes from the authenticated session, never request input.
2. Add the shared subject registration/seed and update extension-body Admin
   validation/help to remove mandatory body placeholders. Existing stored shared
   wording remains valid. Use one deadline-update wording family for grant,
   change, restore and resend, with current action/date resolved during preview.
3. Extend the existing deadline route with a pure preview operation and an
   action-specific freshness binding. Bind actor, suggestion/request, operation,
   proposed or currently stored date, expected state, sender, To, Cc, subject/body
   and calendar-relevant facts. Reauthorize the assigned PD and re-read facts
   before final action. Changed date, assignment, recipient, operation or copy
   invalidates the preview. Editing after preview requires another preview.
4. Keep the conditional deadline write and original eligibility/date/token gates.
   The existing fresh-read ETag alone does not prove the earlier user preview is
   still current: compare preview state before the conditional write. Recheck
   transport recipient safety for To and every Cc. Never combine an email for one
   deadline with a calendar attachment for another.
5. Render reviewed copy from the explicit one-send subject/body; do not reload a
   newer personal/Admin template at dispatch and silently replace reviewed words.
   Keep optional placeholders optional through every validator and renderer.
   Reject unsupported/malformed placeholders with plain-language feedback;
   preserve existing escaping and plain-text-to-HTML safety.
6. Keep partial and uncertain results explicit. Preview/preflight failures perform
   no date write; post-write dispatch failures retain the saved deadline. Retry
   refreshes durable date and assignment, retains local copy/Cc, and returns no
   date write. Do not add automatic resend or a new background job.
7. Extend async context guards to preference loads/saves/clears, preview, save and
   retry, including failure/finally paths. Changing reviewer/request/permission,
   closing the dialog, editing copy/Cc/date, or beginning final submission must
   prevent late responses from replacing current edits or reviving a stale preview.

## Acceptance and contract audits

| Invariant | Required verification |
| --- | --- |
| Assigned PD only, including superusers who are not that PD | Preview/save/restore/retry/resend return denial before side effects; UI mirrors server; unrelated workflows retain their own rules |
| One user's wording never changes another's | Preference-route session isolation, reserved-key tests, explicit Save/Clear only |
| Body sections may be deleted | Save, preview and dispatch tests omit greeting/date/signature while proving no automatic reinsertion; calendar date remains correct |
| Cc is one-send only | Invalid-address rejection; exact preview-to-transport Cc; safety binding covers Cc; no Cc in preference writes; close/reopen clears it |
| Exact preview precedes every action | No preview side effects; edits and changed server facts invalidate; no stale authorization exemption |
| Deadline and email outcomes remain separate | Definite post-write failure retains date; retry performs no date write; uncertain result never presents a confirmed failure or blind retry |
| Personal failure fallback is visible | Absent, unavailable and malformed preference cases; shared-config failure stops before write |
| Defaults never replace one-send edits silently | Deferred Save/Clear/load/preview tests across edits, close, context change and submission |

Whole-flow audit: UI → authenticated app route → assigned-PD check → validated
copy/Cc and fresh state → preview → final revalidation → conditional date write
(save/restore only) → Dynamics email/calendar → truthful result → current UI.
Partial-success and async audits are covered above. Helper extraction: reuse
patterns without changing other workflows' authorization or required-token rules.
Durable-surface audit: update route matrix/lifecycle registration for changed/new
routes, preference registry/reservations, Admin registry/seed, service catalog,
Atlas ownership descriptions if needed and relevant tests. Symbol-consumer audit:
search raw preference key, extension template keys, deadline fields and all
preview/result reasons across readers/writers; no new database field is proposed.

Run focused deadline service/route/editor/delegation suites plus new preference,
Cc, preview and PD-only cases; then affected policy gates and their self-tests
sequentially, types and relevant UI validation. Independent implementation review
and deliberate branch/PR promotion are required before runtime release. No live
email, configuration write or business-record edit is authorized by this plan.

## Documentation reconciliation record — 2026-10-24

Sweep Mode A: changed product intent for personal-email slice 2. Authority is the
owner's explicit decisions in this conversation; existing source is baseline
behavior only. Updated the inventory's slice-2 status/description, suite to-do
exception and session routing pointer. The September inventory case row is an
explicit historical baseline, not a current permission requirement. Other slice
numbers are unrelated; slice-3 historical implementation status is outside this
change. No current runtime/security-matrix claim is changed to describe unbuilt
behavior. Product decisions are PLANNED, not deployment evidence.
