---
title: Personal reviewer deadline email defaults — slice 2
domain: reviewer-engagement
kind: plan
status: implemented
summary: Owner-approved slice 2 decisions for assigned-PD-only deadline changes, editable preview and personal wording, optional empty bodies, one-send Cc barred on synthetic requests, and truthful retry outcomes. Released through PR #521 (687994c2a); checks, OAuth Opus build re-review, subject seed and isolated inbox delivery passed.
owner: product-engineering
related:
  - docs/plans/PERSONAL_EMAIL_DEFAULTS_INVENTORY_2026-09-24.md
  - docs/plans/PERSONAL_EMAIL_DEFAULTS_TODO_2026-09-20.md
  - docs/plans/PERSONAL_EMAIL_REVIEWER_RELEASE_COURTESIES_PLAN_2026-10-22.md
  - docs/API_ROUTE_SECURITY_MATRIX.md
---

# Personal reviewer deadline email defaults — slice 2

## Status and scope

[PRODUCTION-VERIFIED via PR #521 and linked build audit; owner decisions agreed 2026-10-24.] This is the
implementation plan for slice 2. Product decisions below are agreed; runtime
implementation and acceptance tests are now built on `codex/reviewer-deadline-email-defaults`; verification and OAuth Opus build re-review passed. Owner-authorized release preflight subsequently seeded the Production subject and verified empty-body sending with Dynamics Sent status; exact evidence is recorded in the linked build audit. Runtime shipped as `687994c2a` through PR #521; Production domain/deployment and authenticated read-only smoke check passed.

Change surface: reviewer deadline editor, deadline preview/save/retry service and
route, own-user wording preferences, and shared Admin subject/body registration.
Entry points: `ReviewerDueDateEditor` via the Workbench request page
(`pages/workbench/[requestId].js` → reviewer panels) and follow-up dashboard
(`ReviewerFollowUpPanel` → reviewer panels), plus
`/api/review-manager/review-due-extension`.
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
   checks. Never store Cc in a personal wording preference. **Synthetic test
   requests reject any nonempty Cc list**, even an allowlisted address; report
   this before any deadline write. Ordinary requests retain optional Cc.
4. **Fully editable body.** The PD may edit or delete any body content, including
   greeting, deadline text and signature. All body placeholders are optional;
   absence of a signature or date placeholder must not block preview, saving a
   personal default, or sending. **An entirely empty or whitespace-only body is
   allowed**, both for one send and as an explicitly saved personal default.
   Saving an empty body is not Clear: it remains a configured override, while
   Clear removes the override and restores Admin fallback. Use presence/type
   checks rather than truthiness or `trim()` to select the personal body.
   Do not append deleted sections automatically.
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

## Implementation contract

The following is the agreed contract; branch source now implements it. Verification
and independent build review are recorded separately below; deployment completed through PR #521; the Production shared subject was seeded and validated before promotion. The earlier Opus review covered the plan only.

1. **Own-user preference and fallback.** Add
   `PREFERENCE_KEYS.REVIEWER_DEADLINE_UPDATE_TEMPLATE` (stored key
   `reviewer_deadline_update_template`) as a bounded `{ subject, body }` pair.
   Plan `GET/PUT/DELETE /api/review-manager/deadline-email-preferences`, gated by
   `requireAppAccess('review-manager', 'reviewers')`, DAL context and a valid
   session actor. Never accept an owner/profile ID from input. Use strict
   exact-owner reads and the **release** slice's fallback-with-notice pattern;
   do not copy the reminder slice's blocking personal-read-failure policy.
   GET returns own identity, shared copy, configured state and own template;
   a damaged own row returns 409 `preference_invalid` with shared copy (or
   `sharedUnavailable: true` and null shared copy) so Save/Clear can repair it
   independently of shared configuration. Preview reports `personal`, `shared` or `shared_fallback`
   and a notice for unavailable/invalid personal data. Add the key to both
   `RESERVED_WRITE_KEYS` and `PRIVATE_REMINDER_KEYS` in the generic preference
   route, with reserved read/write tests. No new table or migration.
2. **Extension-specific validation and Admin defaults.** Subject must be
   nonblank, single-line and at most 500 characters before and after expansion;
   only optional `{{proposalTitle}}` is supported in subjects. Body is a string
   of 0–12,000 characters; empty/whitespace-only is valid. Supported optional
   body placeholders are `greeting`, `reviewerName`, `proposalTitle`,
   `reviewDueDate`, `signature`. Reject unknown/malformed placeholders; keep
   escaping/plain-text HTML safety. Do not inherit sibling required-body-token
   rules or a link ban that was not requested for this email family.
   Add `email.reviewer_extension.subject`; retain the current body key.
   Remove extension `requiredPlaceholders` and the fixed-subject description
   from `editableTextDefaults.js`, and the service's `requiredTokens` check.
   Make extension Admin validation and reads distinguish a present empty/null body value
   from a missing/unavailable key. The generic `readRequiredEmailDefaults`
   rejects blank values: use an extension-specific strict read/validation path
   for the body, without changing other email families. Missing/unavailable or
   invalid shared configuration blocks before any write; an intentionally empty
   body is valid configuration. Validate shared, personal and one-send templates
   consistently. Do not claim existing stored Admin copy passes without checking
   it at the authorized release preflight.
3. **Subject resolution.** Seed `Updated review deadline: {{proposalTitle}}`.
   Strip CR/LF from the derived title and enforce the final subject bounds.
   With no title, remove a terminal colon/separator directly preceding the
   missing title token, so the seeded subject becomes exactly
   `Updated review deadline`; do not substitute the body's `the proposal`
   fallback into a subject. Test custom subjects with and without a title.
   Use one wording family for grant/change/restore/resend, resolving the current
   date during preview; no new action placeholder is introduced.
4. **Assigned-PD authorization at route and service.** Deny a missing/invalid
   session actor before domain reads. In the deadline route, compare the actor
   against `programDirectorByRequestId` returned by the existing authorization
   helper; its superuser result is insufficient. Leave the shared helper's
   behavior unchanged elsewhere. Inside notification preparation and final
   save/retry/resend paths, compare the actor to the PD resolved from the same
   fresh request context used for rendering/write/dispatch; sender system ID
   must equal that actor and From must match that PD's current mailbox. Recheck
   on preview and immediately before write/dispatch; assignment/sender drift
   returns `sender_changed` or `preview_stale`, never an on-behalf-of send.
5. **UI permissions in both mounting paths.** Thread a separate assigned-PD-only
   capability through Workbench and follow-up dashboard into the editor, derived
   from current actor/PD identity equality. Include it and PD identity in the
   editor's context/generation key. Do not narrow shared `canManage` for sibling
   actions. Hiding controls is supplementary to server enforcement.
6. **Explicit actions and preview proof.** The deadline endpoint accepts
   `preview` with target operation `save`, `restore`, `retry` or `resend`, and
   the corresponding final operations. Restore clears the override; save sets
   the proposed date; retry/resend never write a date. Reject unknown actions
   and unexpected input fields. Use extension-specific proof helpers based on
   the existing `mintScopedToken`/`verifyToken` pattern, with audience
   `reviewer-deadline-preview`, operation-bound claims and a five-minute expiry.
   Do not call the existing reminder proof helper unchanged: its audience is
   fixed. Bind actor, request/suggestion, target operation, proposed/current
   dates, suggestion ETag, lifecycle/token eligibility facts, current request
   date/title/PD, reviewer name, resolved signature, sender ID/mailbox, To,
   normalized Cc, raw subject/body and rendered output/calendar facts. Editing
   copy/Cc/date or changing any bound fact requires another preview. Project
   business rows from fixed selected field lists, excluding formatted display
   annotations; use stable object-key ordering for digest serialization.
7. **Conditional write and post-write retry proof.** Compare fresh request fields
   and suggestion state with the preview immediately before the write, and pass
   the preview's expected suggestion ETag to `changeReviewDeadline`'s If-Match.
   Retain original eligibility/date/token gates. After a successful write and
   definite notification failure, return `saved:true, notified:false` plus a
   fresh **retry** proof for the resulting stored state and the reviewed copy/Cc.
   Obtain the post-write ETag/state without rebasing onto unrelated concurrent
   changes: if post-write confirmation fails or other bound facts drift, still
   report the saved deadline truthfully but require a fresh retry preview.
   Do not reuse the pre-write proof or waive freshness for retry. A further
   definite retry failure may renew the retry proof only against unchanged
   checked state. Reopened resend requires its own fresh preview/proof.
   Unconfirmed delivery never receives a ready-to-retry path. The suggestion
   If-Match does not atomically lock request fields; compare them as late as
   possible before write/dispatch and document the remaining cross-record race
   window in implementation review. Do not call that window owner-accepted or
   eliminated by the suggestion ETag.
8. **Cc validation and test isolation.** Normalize and deduplicate bounded Cc
   addresses; cap at 20, reject malformed entries or entries equal to To/From,
   and return the exact normalized list in preview and transport. Derive test
   state server-side and reject any Cc for synthetic requests before preview,
   before date writes, and again at dispatch, independent of allowlist membership.
   Unknown test state fails closed. Pass all recipients `[to, ...cc]` through
   reviewer-directed binding/general allowlist checks too; checking only To is
   insufficient. Treat recipient-policy refusal as non-retryable with unchanged
   addresses: instruct staff to correct Cc and obtain a new preview. If refusal
   occurs after the date write, retain `saved:true, notified:false`; never recast
   the date as unsaved. Cc recipients receive the same calendar attachment as To.
9. **Exact copy, empty-body transport and truthful outcomes.** Render/send only
   the explicitly reviewed subject/body, including `body: ''`; never silently
   reload or insert Admin/personal wording after preview. Carry an empty body
   safely through HTML rendering and actual transport without reintroducing a
   required signature/date/greeting or a body-truthiness fallback. Preview and
   preflight failures write no deadline. Definite post-write failure retains
   the date; retry refreshes durable state without a date write. No automatic
   resend or background job.
10. **Error/status/UI parity and limits.** Register new reasons in both route
    `REASON_STATUS` and editor `messageForReason`: `assigned_pd_required` (403),
    `sender_changed`/`preview_stale` (409), `invalid_preview`/`invalid_cc` (400),
    `cc_not_allowed_for_test_request`/recipient-policy refusal (409), and relevant
    preference/shared-configuration failures. Preserve existing definite versus
    uncertain result fields. New preference GET follows the 409 damaged-row
    repair contract; unavailable reads report a distinct reason. Bound proof
    size and serialized payload, then raise the 8 KB route parser limit to
    accommodate the 500-character subject, 12,000-character body, 20 Cc entries,
    proof and JSON/UTF-8 overhead; reject oversized input consistently.
11. **Async and local draft lifecycle.** Extend context/mounted/generation guards
    to every preference load/save/clear, preview and final action, including
    failure/finally writes. Close clears subject/body, Cc, proof, preference and
    notice state. Invalidate preview immediately on edits. Prevent Save/Clear
    and late refresh responses from replacing one-send edits or changing a draft
    during submission; disable conflicting actions while a final send is in
    flight. Reopening loads current defaults with Cc empty. No durable draft.

## Acceptance and contract audits

| Invariant | Required verification |
| --- | --- |
| Assigned PD only, including superusers who are not that PD | Missing actor denied; PD reassignment between route/service reads refuses; preview/save/restore/retry/resend denied before side effects; both UI entry paths mirror server; unrelated workflows unchanged |
| One user's wording never changes another's | Preference-route session isolation, reserved-key tests, explicit Save/Clear only |
| Body may be entirely empty | Save/load/preview/transport tests for empty and whitespace-only bodies; saved empty override stays configured and differs from Clear; no automatic reinsertion; calendar date remains correct |
| Cc is one-send only and prohibited on synthetic requests | Normalize/dedupe/cap and To/From exclusions; exact preview-to-transport Cc; synthetic request with a real nonempty allowlisted Cc is refused before write; changed test state at dispatch refuses safely; no Cc in preferences; close/reopen clears it |
| Exact preview precedes every action | No preview side effects; edits and changed server facts invalidate; no stale authorization exemption |
| Deadline and email outcomes remain separate | Changed post-write ETag receives a new retry proof, old save proof is refused; post-write read failure remains saved with fresh-preview requirement; retry performs no date write; uncertain outcome has no blind retry |
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

## Release order and review follow-up

[VERIFIED via owner-authorized Production preflight; see build audit.] Completed the non-overwriting seed
of the new shared subject key and strict readback/validation of subject and
body with the candidate validator. Existing body wording was preserved exactly.
No-title rendering remains covered by passing branch tests. Do not deploy runtime that requires the new subject before
that key is present and valid. The seed preserves any present extension body,
including empty, whitespace-only and null-stored empty values. Missing/invalid configuration blocks promotion;
this plan does not itself authorize the seed or live readback. Use a branch/PR
and deliberate promotion; do not alter shared helper behavior for sibling flows.

[VERIFIED via completed OAuth Claude Opus 5.5 review of commit `c597aad55`;
receipt `SLICE2_OPUS_PLAN_REVIEW_2026_10_24`.] Parent verified HEAD and plan hash
unchanged after review. The review verdict was READY WITH NAMED CHANGES, not
approval of this revised document. Owner subsequently allowed empty bodies and
rejected all Cc on synthetic requests. This revision incorporates P1-1 through
P3-13: service/route sender equality and null actor; post-write retry proof and
request-state comparisons; pre-write Cc isolation/refusal classification; both
UI mounting paths; explicit actions/reason maps; release-style fallback; no-title
subject validation; all mandatory-token removal sites; subject seed order;
shared-template validation; both preference reservations; removal of the unused
action-placeholder implication; close/save-clear guards and parser limits.
No product decision remains open in this scope. Proof and race handling still
require implementation verification; the revised plan has not been re-reviewed
by Opus. The existing 52-test baseline does not test these unbuilt additions.

## Documentation reconciliation record — 2026-10-24

Sweep Mode A: changed product intent for personal-email slice 2. Authority is the
owner's explicit decisions in this conversation; existing source is baseline
behavior only. Updated the inventory's slice-2 status/description, suite to-do
exception and session routing pointer. The September inventory case row is an
explicit historical baseline, not a current permission requirement. Other slice
numbers are unrelated; slice-3 historical implementation status is outside this
change. No current runtime/security-matrix claim is changed to describe unbuilt
behavior. Product decisions specify the contract, not deployment evidence.

Follow-up Mode A reconciliation: owner now explicitly allows empty/whitespace
bodies for one send and personal defaults; Clear remains distinct. Synthetic
requests refuse all Cc before writes and at dispatch. Updated this plan,
inventory slice-2 summary and suite to-do exception; current runtime docs now identify branch-built behavior separately from deployment. Opus findings were checked against
named source paths; no shared-helper audience reuse, mandatory nonblank personal
body rule or blanket stored-copy validity assertion survives in this plan.

## Build verification and first Opus build review — 2026-10-24

[VERIFIED via local source/tests; not deployed.] Candidate `a79003426` passed
25,143 tests / five snapshots (247 skipped), production build, changed-file lint,
scoped policy gates/self-tests and desktop/mobile synthetic UI checks. Its OAuth
Opus build review (`SLICE2_OPUS_BUILD_REVIEW_2026_10_24`) found a blocking
formatted-annotation comparison defect plus smaller issues. The fixes now project
only selected business fields with stable digest ordering; accept present null
Admin bodies as empty; preserve empty Admin bodies during seed; use saved-state
error wording; preserve non-retryable recipient-policy reasons; map non-PD errors
and request mismatch; and permit own-default repair even with broken shared
configuration. Regression cases for those changes pass (131 focused tests).
Fresh OAuth Opus verification of corrected runtime candidate `26010e1b0` returned
PASS with no P1/P2 remaining or new actionable regressions. Final isolated broad
run passed 25,175 tests / five snapshots (247 skipped), with matching start/end
HEAD; production build, changed-file lint, scoped gates/self-tests and the second
desktop/mobile confirmation passed. Full receipt:
`docs/audits/REVIEWER_DEADLINE_EMAIL_BUILD_2026-10-24.md`.
