---
title: Personal reviewer release-courtesy defaults
domain: reviewer-engagement
kind: plan
status: built-in-branch
summary: Slice 3 of the personal email defaults initiative — saved per-PD wording for the pending-reviewer withdrawal and accepted-reviewer release courtesy emails; built on branch claude/session-2026-10-22, not merged or deployed.
owner: product-engineering
related:
  - docs/plans/PERSONAL_EMAIL_DEFAULTS_TODO_2026-09-20.md
  - docs/plans/PERSONAL_EMAIL_DEFAULTS_INVENTORY_2026-09-24.md
  - docs/plans/PERSONAL_EMAIL_REVIEWER_REMINDERS_PLAN_2026-09-24.md
  - docs/API_ROUTE_SECURITY_MATRIX.md
---

# Personal reviewer release-courtesy defaults

Slice 3 in the owner-accepted order (4 → 1 → **3** → 2 → 6 → 7 → 5) of
`docs/plans/PERSONAL_EMAIL_DEFAULTS_INVENTORY_2026-09-24.md`. Slices 4 and 1 are
merged. The reminder slice (PR #332, plan
`docs/plans/PERSONAL_EMAIL_REVIEWER_REMINDERS_PLAN_2026-09-24.md`) is the pattern.

## Verified baseline — `origin/main` at `23d09e482`

- [VERIFIED via source] Two courtesy emails, each with an editable per-recipient preview and
  shared Admin defaults only:
  - **Pending withdrawal** (`email.reviewer_withdraw.*`): `ReleaseEmailModal` (opened from
    `ReviewerInvitePanel`) → `POST /api/review-manager/render-withdraw-emails` →
    `renderWithdrawPreviews` → staff edit rendered subject/body per reviewer →
    `POST /api/review-manager/withdraw-sufficient` with complete `overrides`.
  - **Accepted release** (`email.reviewer_release.*`): `AcceptedReviewerReleaseModal` (opened
    from `ReviewerManagePanel`) → `POST /api/review-manager/terminal-transition` with
    `preview: true` → `renderAcceptedReleasePreviews` → same route without `preview`, with
    `overrides`.
- [VERIFIED via source] Both preview services render the Admin template server-side through
  `buildWithdrawSufficientBodyText` with the same four body tokens
  (`{{greeting}}`, `{{reviewerName}}`, `{{proposalClause}}`, `{{signature}}`); both subjects
  take no tokens (`shared/config/editableTextDefaults.js`). Sender is the request's PD;
  `to`/`from`/`senderId` are returned as expected-value guards and re-derived at send.
- [VERIFIED via source] The modals always send complete `overrides` whenever an email is
  sent (`ReleaseEmailModal` builds overrides whenever `showPreviews`, which is exactly when
  `sendEmail` is true). The send services therefore never render a template for these UI
  paths. `withdrawSufficient` keeps a legacy no-override render path reachable only by a
  direct API call; no in-repo caller uses it.
- [VERIFIED via source] Authorization differs: `terminal-transition` calls
  `authorizeReviewerRequestMutation` (lead PD for every target, or superuser) before preview
  or transition. `render-withdraw-emails` and `withdraw-sufficient` check only
  `requireAppAccess('review-manager', 'reviewers')`. The UI already shows the pending-release
  action only under `canManage` (`computeCanManage`: lead PD or superuser) in
  `ReviewerInvitePanel`, so the server is looser than the UI.
- [VERIFIED via `git show 4720980ed` on `codex/memory-audit-followups`, unmerged]
  Codex's in-flight change to `reviewer-request-authorization.js` only adds a
  `programDirectorByRequestId` field to the return value; the call contract used here is
  unchanged.

## Owner decisions — 2026-10-22

1. **Preview and send of the pending withdrawal become lead PD or superuser**, matching the
   accepted release and the reminder slice. Rationale: the preview will now reveal the
   assigned PD's saved wording. The UI already hides the action from other staff, so this
   aligns the server with the UI (`feedback-ui-gates-must-mirror-server-guards`).
2. **Defaults are saved in the dialog**, like the reminder composer: a "Your default
   wording" section with the raw template (placeholders), Save and Clear. Per-recipient edits
   to the rendered email are never saved.
3. **Unreadable or damaged saved wording falls back to the Admin wording with a notice**;
   staff can still edit and send. (These are manual sends only; there is no automatic send in
   this slice.)

## Planned contract

1. **Preference keys.** Add `REVIEWER_WITHDRAW_TEMPLATE` and `REVIEWER_RELEASE_TEMPLATE` to
   `PREFERENCE_KEYS` in `shared/config/reviewerFinderPreferences.js`, stored in
   `wmkf_appuserpreferences` as `{ subject, body }` JSON, owner = exact Dataverse
   `systemuserid`. No schema change.
2. **Personalization module.** New `lib/services/reviewer-release-personalization.js`,
   parallel to `reviewer-reminder-personalization.js` (which stays untouched): kinds
   `withdraw` and `release`; validator with the same rules (subject/body bounded and
   non-blank, subject single-line and token-free, body tokens limited to the four above,
   no malformed braces, no links); `sharedReleaseTemplate(kind)` from Admin;
   `loadSenderReleaseTemplate(systemId, kind, shared)` via the strict
   `findByOwnerAndKey` adapter (absent → Admin, configured: false; read error →
   `preference_unavailable`; encrypted/unparseable/invalid → `preference_invalid`);
   `saveOwnReleaseTemplate` / `clearOwnReleaseTemplate` keyed to the session `systemuserid`.
3. **Preference route.** New `GET/PUT/DELETE /api/review-manager/release-email-preferences`
   (`kind ∈ {withdraw, release}`), shaped exactly like `reminder-email-preferences.js`:
   `requireAppAccess('review-manager', 'reviewers')`, `withDalContext`, own session
   `systemuserid` only, unexpected body fields rejected, GET returns `shared`, `configured`,
   `template`, `ownSystemId` (409 with shared copy on an invalid own row so it can be
   repaired). `pages/api/user-preferences.js` reserves both new keys for read and write.
4. **Preview services.** `renderWithdrawPreviews` and `renderAcceptedReleasePreviews` load the
   **sending PD's** template (server-resolved `pd.systemuserid`) once per call and render it
   in place of the Admin template. Each `ok` draft adds `templateSource`
   (`personal` | `shared` | `shared_fallback`) and, for `shared_fallback`, a
   `templateNotice` (`preference_unavailable` | `preference_invalid`). Admin missing remains
   `defaults_unavailable` as today. Preview stays a pure read.
5. **Send services unchanged.** Overrides already carry the exact reviewed copy with
   recipient/sender guards; no preview proof is added (the reminder slice needed one only
   because it converted a direct send). The legacy no-override path in `withdrawSufficient`
   keeps Admin wording and is documented as such.
6. **Authorization.** `render-withdraw-emails` and `withdraw-sufficient` call
   `authorizeReviewerRequestMutation({ profileId, callerSystemId, requestIds: [requestId],
   suggestionIds })` inside `withDalContext` before any read or write, mirroring
   `terminal-transition`. This applies to release-without-email (`no_response`) too, since
   both share the route.
7. **Dialogs.** Each modal gains a collapsed "Your default wording" section: loads own
   template via GET; raw subject/body editors with a placeholder legend; Save and Clear
   (Clear only when configured); plain-language validation errors. When the acting user is
   not the sender PD (superuser), it states that the email starts from the PD's wording and
   that saving changes only the actor's own default. After a successful Save/Clear by the
   sender, drafts re-render if there are no per-recipient edits; otherwise a "Use saved
   wording" action re-renders after confirming that unsent edits will be discarded. Drafts
   with `shared_fallback` show the notice. Generation guards cover load/save/clear/re-render
   across close.
8. **Re-render replaces email copy only.** [Codex plan review 2026-10-22] In the accepted
   release dialog, the preview also seeds `internalNote` and the `expectedNotes` concurrency
   baseline that `terminal-transition` checks. A wording re-render updates only the drafts'
   subject/body (and `templateSource`/notice); it never resets the staff-typed note and never
   advances `expectedNotes`. A colleague's concurrent note change therefore still surfaces as
   the existing `notes_changed` rejection at release.

## Contract-reconcile, Mode A

Change surface: two modals, two existing preview services, two existing routes (auth only),
one new route, one new service, preference key registry, generic preference route.
Persistence: `wmkf_appuserpreferences` on explicit Save/Clear only. Consumers: the two
preview services; send paths consume only the reviewed overrides.

Whole flow: own-profile route → validated preference row. Modal → authorized preview route →
PD resolved server-side → strict PD preference read → Admin fallback on absence or failure
→ rendered drafts with source → staff edits → authorized send route → fresh row read and
recipient/sender guards → lifecycle write → Dynamics send → truthful per-row result.

Partial success: unchanged — lifecycle write commits before the email; per-row statuses
remain. Async state: modal generations for preference and re-render. Helper semantics: the
new loader returns only subject/body, never sender or recipient. Durable surfaces: route
matrix rows (new route; tightened guards on two existing rows), route lifecycle config,
service catalog, inventory slice status. No migration, no cron, no shared helper changed.

| Invariant | Files likely touched | Verification |
| --- | --- | --- |
| Only the owner can save or clear; another user's row never loads into their editor | new route/service, key registry, generic preference route | route isolation tests; reserved-key tests |
| Preview starts from the sender PD's saved wording; absent → Admin | both preview services | service tests per source |
| Read failure / damaged row → Admin wording with notice, never a block | both preview services, modals | service and modal tests |
| Per-recipient edits never persist | modals | modal tests assert no preference write on send |
| Non-lead, non-superuser staff cannot preview or send the pending withdrawal | two withdraw routes | route tests (403, service not called) |
| Wording re-render keeps the unsaved internal note and the original `expectedNotes` baseline | accepted-release modal | modal tests: unsaved note survives re-render; a server-side note change during re-render still yields `notes_changed` |
| Existing send guards and statuses unchanged | send services | existing characterization suites stay green |

Mode A verdict: READY, pending owner review of this plan. No external state probed.

## Release and verification

Tier 2 runtime change: branch `claude/session-2026-10-22` (or a dedicated feature branch),
PR, independent read-only review, CI, then deliberate promotion per
`docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md`. Gates for the touched surfaces, each
with its self-test, sequentially: api-routes, route-lifecycle-auth, route-service-boundary,
reviewer-engagement-boundary, dataverse-access-layer, trust-boundary-guid, fact-consistency,
doc-symbol-refs, docs-catalog, doc-currency, types, secret-scan. Live behavior (real PD
wording, delivery) stays unverified until an authorized smoke test.

## Branch implementation evidence

[VERIFIED via branch source and local commands, 2026-10-22] Built on
`claude/session-2026-10-22` as planned: preference keys, `reviewer-release-personalization.js`,
`/api/review-manager/release-email-preferences`, generic-route reservation, sender-PD wording in
both preview services, lead-PD/superuser authorization on `render-withdraw-emails` and
`withdraw-sufficient`, and the shared `ReleaseWordingDefault` section in both dialogs. The
accepted-release refresh updates only subject/body/source and leaves the internal note and
`expectedNotes` untouched. Route matrix, service catalog and canonical counts updated.

Tests: new `reviewer-release-personalization`, `release-email-preferences-route`,
`render-withdraw-emails-route-auth` and `release-wording-default` suites; wording-source cases
added to `withdraw-sufficient-preview` and `terminal-transition-service`; the withdraw route
suites now stub authorization and cover the 403 path; reserved-key tests cover both new keys.
The reviewer-related run passed 376 suites / 6,820 tests. ESLint (quiet) is clean. Types, API
route, lifecycle auth, route-service, reviewer-engagement, DAL, GUID, OData, context, fact
consistency, canonical pointer, doc symbol, build-claim, catalog, currency, Atlas, secret,
scaffolding, harness-framing, reminder-hold and prompt-injection gates passed, each with its
self-test run sequentially. No Dataverse, email or other live service was called.

## Codex build review follow-up

[VERIFIED via Codex adversarial review of `821d374cf` and branch source] Codex found that a
slow Save/Clear invoked the dialog's refresh callback captured at click time, so email edits
typed meanwhile could be overwritten without the replace confirmation, and the accepted
dialog could refresh after Release had started. `ReleaseWordingDefault` now reports
`onBusyChange`, both dialogs lock their email fields and Release button while a Save/Clear is
in flight, and the section calls the parent's latest callbacks (and releases the lock if it
unmounts mid-save). Deferred-response tests in both dialogs assert the lock and the refresh;
removing the lock makes the accepted-dialog test fail. The reviewer-related run passed
376 suites / 6,822 tests; lint, types, secret, scaffolding and harness gates passed with
self-tests; `npm run build` passed.

## Coordination

Codex currently owns documentation. The inventory slice-status row and the
`CURRENT_WORK_QUEUE.md` corrections found on 2026-10-22 (Zoom picker, busy card, PD on
follow-up cards, Site Visit materials, video vCPUs) are handed to the owner/Codex rather
than edited here.
