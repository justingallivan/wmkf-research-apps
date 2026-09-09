---
title: Reviewer Release Reason — Codex Brief (2026-09-09)
domain: reviewers
kind: plan
status: active
summary: "Codex build brief: let a Program Director record WHY a pending invitation is released (no longer needed vs. no response), using the two response types that already exist, so reviewer reliability evidence is not silently neutralised."
cataloged: 2026-09-09
last_verified: 2026-09-09
owner: product-engineering
related:
  - lib/services/review-manager/withdraw-sufficient-service.js
  - lib/services/reviewer-engagement/withdraw-pending-invitation.js
  - lib/dataverse/adapters/reviewer-suggestion.js
  - shared/components/reviewers/ReleaseEmailModal.js
  - shared/components/reviewers/ReviewerInvitePanel.js
  - docs/REVIEWER_TERMINAL_STATUS_AND_DUE_DATE_PLAN.md
  - docs/atlas/dataverse-wmkf-appreviewersuggestion.md
---

# Reviewer Release Reason — Codex Brief (2026-09-09)

## Where you are

Create your own worktree from `origin/main` (tip `1ddc870c` or later) and stay in it:

```
cd /Users/gallivan/Code/WMKF_Apps
git fetch origin
git worktree add ../WMKF_Apps-codex -b codex/reviewer-release-reason origin/main
cd ../WMKF_Apps-codex && npm ci
```

Run `/start` there. Claude works in the main checkout on other branches; do not check out other
branches, touch that directory, or push to `main`. Push your branch after each meaningful commit
(`git push -u origin codex/reviewer-release-reason`); pushing a feature branch does not deploy.
Do not merge, deploy, or edit `SESSION_PROMPT.md`. Record your handoff at the bottom of this brief.

## Why (owner, 2026-09-09)

On Request 1002959 a reviewer was invited on 2026-08-01, reminded twice, and never answered.
Four other reviewers completed. The only way to close the open invitation is **Release invitee**
on the Invite Reviewers tab, which records `withdrawn_sufficient` — "WMKF had enough" — and the
reliability contract treats that as **neutral** evidence about the reviewer
[VERIFIED via `.claude-memory/project-reviewer-reliability-data.md` "Current contract" and
`docs/REVIEWER_TERMINAL_STATUS_AND_DUE_DATE_PLAN.md`]. The fact that the reviewer sat on the
invitation for five weeks is lost. The owner wants the release to carry **why**, so that a
non-response is recorded as a non-response.

## Goal

When a PD releases still-pending invitees, they choose one reason, and the record reflects it:

| Reason (UI label) | Response type written | Courtesy email | Reliability reading |
|---|---|---|---|
| **No longer needed** — we have enough reviewers (default; today's behaviour) | `withdrawn_sufficient` (100000003) | sent, as today | neutral (WMKF's choice) |
| **No response** — the reviewer never answered the invitation | `no_response` (100000002) | optional, default **off** | negative-leaning (reviewer unresponsive) |

No new Dataverse field. Both response types already exist on `wmkf_responsetype`
[VERIFIED via `shared/config/reviewerLifecycle.js:11-17` and
`docs/atlas/dataverse-wmkf-appreviewersuggestion.md:69,281`]. The change is: which one the release
writes, and what the surfaces say about it.

## Current state you are changing (all [VERIFIED 2026-09-09 via source])

- **UI entry.** `ReviewerInvitePanel.js` computes `selectedPending` (invited, not accepted, not
  declined, no response type) and the **Release invitee (N)** button opens `ReleaseEmailModal`
  with `{ requestId, suggestionIds }` (`:465-476`, `:792-804`).
- **Modal.** `ReleaseEmailModal.js` renders editable courtesy-email previews from
  `POST /api/review-manager/render-withdraw-emails`, then posts
  `{ requestId, suggestionIds, overrides? }` to `POST /api/review-manager/withdraw-sufficient`
  (`:55-61`, `:72`, `:129-146`).
- **Route.** `pages/api/review-manager/withdraw-sufficient.js` validates `requestId`,
  `suggestionIds` (non-empty, ≤ `MAX_BATCH`), and `overrides`, then calls the service (`:44-53`).
- **Service.** `withdrawSufficient({ requestId, suggestionIds, actingUserSystemId, overrides })`
  in `lib/services/review-manager/withdraw-sufficient-service.js:219` re-reads each row, guards
  still-pending per row, writes state **before** the email via
  `withdrawPendingInvitation({ id, nowIso, ifMatch: s._etag, actingUserSystemId })` (`:269`),
  then renders and sends the courtesy email, accumulating per-row statuses
  (`withdrawn_emailed | withdrawn_email_failed | withdrawn_email_skipped | withdrawn_no_email |
  withdrawn_no_pd | not_found | wrong_request | not_pending | changed_skipped | write_failed |
  invalid_override | recipient_changed | sender_changed`) (`:1-30`).
- **Write.** `lib/services/reviewer-engagement/withdraw-pending-invitation.js` calls
  `suggestionAdapter.updateLifecycle(id, { responseType: 'withdrawn_sufficient',
  withdrawnSufficientAt: nowIso, respondReminderSentAt: null }, { actingUserSystemId, ifMatch })`.
  `updateLifecycle` also accepts `responseReceivedAt` (`lib/dataverse/adapters/reviewer-suggestion.js:1879-1887`).
- **The existing no-response writer** is the cycle-close sweep:
  `suggestionAdapter.expireInvitationResponse(id, nowIso, { ifMatch })` sets
  `wmkf_responsetype = no_response` and `wmkf_responsereceivedat = nowIso`
  (`reviewer-suggestion.js:1424-1430`), called from `lib/services/reviewer-suggestion-sweep.js`
  only for rows whose request meeting date is past. Mirror its stamps exactly.
- **Consumers already treat both types as "engagement ended without a decline".**
  `lib/services/reviewer-rollup.js:102-104` folds `withdrawn_sufficient`, `no_response`, and the
  terminal review statuses into `progress.released`; `lib/services/review-synthesis-readiness.js:24-28`
  treats both as resolved; `shared/components/reviewers/ReviewerInvitePanel.js:59-66` labels them
  "Released — no longer needed" and "No response".
- **History drawer copy assumes only the sweep writes `no_response`:**
  `shared/components/reviewers/reviewer-activity-history.js:163-167` labels it
  "No response recorded at cycle close" with the note "Recorded by automated cycle close".
  That becomes false once a PD can record it.

## Owned file surface (the safety boundary)

You may change:

- `shared/components/reviewers/ReleaseEmailModal.js` — reason selector, email checkbox, request body.
- `shared/components/reviewers/ReviewerInvitePanel.js` — only if the button/label needs the reason
  passed through; keep `selectedPending` semantics.
- `pages/api/review-manager/withdraw-sufficient.js` — accept and validate `reason`.
- `lib/services/review-manager/withdraw-sufficient-service.js` — thread `reason`; gate the email.
- `lib/services/reviewer-engagement/withdraw-pending-invitation.js` — write by reason.
- `shared/components/reviewers/reviewer-activity-history.js` — copy for PD-recorded `no_response`.
- `shared/config/reviewerLifecycle.js` — only to export a `RELEASE_REASONS` constant if you want
  one shared name for the two values; do not change existing maps.
- Tests listed below, plus new ones.
- `docs/API_ROUTE_SECURITY_MATRIX.md` row for `/api/review-manager/withdraw-sufficient` (input
  column: the new `reason` field and its allowed values).
- `docs/atlas/dataverse-wmkf-appreviewersuggestion.md` at `wmkf_responsetype` / `:274`: add the
  PD-recorded `no_response` writer beside the sweep.
- `docs/REVIEWER_TERMINAL_STATUS_AND_DUE_DATE_PLAN.md` "Shipped terminal-status contract": one
  paragraph stating how a PD-recorded `no_response` is read for reliability.

Do **not** touch: `reviewer-suggestion-sweep.js`, `reviewer-rollup.js`, `review-synthesis-readiness.js`,
the external reviewer portal, email templates in `shared/config/editableTextDefaults.js`, the
Track Reviewers panel, Dataverse schema, or anything under `lib/dataverse/schema/`.

## Contracts that must hold

1. **Still-pending only, per row, from a fresh read, with `If-Match`.** Unchanged. A reviewer
   who accepts between read and write still 412s to `changed_skipped`
   (`withdraw-sufficient-service.test.js:154`).
2. **State before email.** Unchanged. For `no_response` with the email unchecked, the result
   status is a new `withdrawn_email_skipped`-class outcome that says the skip was **by choice**,
   not a defaults failure; add `withdrawn_no_email_by_reason` (or reuse `withdrawn_email_skipped`
   only if you also make the reason visible in the result). Do not report a deliberate skip as a
   failure.
3. **Stamps by reason.**
   - `no_longer_needed` → exactly today's write: `responseType: 'withdrawn_sufficient'`,
     `withdrawnSufficientAt: nowIso`, `respondReminderSentAt: null`.
   - `no_response` → `responseType: 'no_response'`, `responseReceivedAt: nowIso`,
     `respondReminderSentAt: null`, **and `externalTokenRevoked: true`**, all in the one
     ETag-guarded `updateLifecycle` call (the field map already accepts `externalTokenRevoked`
     [VERIFIED via `lib/dataverse/adapters/reviewer-suggestion.js:1872-1900`]). Do **not** set
     `withdrawnSufficientAt`. The first two stamps mirror the sweep's
     `expireInvitationResponse`; readers tell a PD-recorded non-response from a sweep-recorded one
     by the revoked flag and by actor (`actingUserSystemId` flows through `updateLifecycle`).
4. **The link must be dead for a `no_response` release — and today it would not be.** This is
   the one place the two reasons differ in mechanism, so read it carefully:
   - The token chokepoint `lib/external/verify-suggestion-token.js:134-200` refuses only
     `revoked`, applicant-excluded, expired, and hash mismatches. It does **not** look at
     `wmkf_responsetype`.
   - The portal's respond service refuses **only** `withdrawn_sufficient` with 409
     (`lib/services/external-review/respond-service.js:218-224`), and the engagement-state view
     special-cases **only** `withdrawn_sufficient`
     (`lib/external/review-engagement-state.js:46-58`). That is why today's release never revokes
     the token: the response type itself locks the portal.
   - `no_response` has no such lock anywhere in the portal. The sweep gets away with it because
     it runs after the meeting date, when tokens have usually expired. A PD-recorded
     `no_response` with a live token would still verify and could still accept.
   - Therefore the `no_response` write **must** carry `externalTokenRevoked: true` (contract 3),
     which the chokepoint already enforces as `revoked`. Do not extend the portal to treat
     `no_response` as a lock; the portal is outside your surface and the revoke is sufficient.
   - Add a test that the `no_response` patch includes `externalTokenRevoked: true` and the
     `no_longer_needed` patch does not (it must stay byte-identical to today's).
5. **Default is unchanged behaviour.** With no `reason` in the body, the route behaves exactly as
   today (`withdrawn_sufficient`, email sent). Existing callers and tests must not need edits to
   keep passing; a missing field is `no_longer_needed`, an unknown value is 400.
6. **Reason is a closed set.** `reason ∈ { 'no_longer_needed', 'no_response' }`. Reject
   anything else with 400 before any read.
7. **No PII in results.** Results keep the existing `{ suggestionId, status }` shape plus
   `reason`; no names or addresses.

## User-facing copy rules

- Modal heading stays. Add a radio group above the previews:
  - **No longer needed** — "We have enough reviewers. A courtesy note goes to each released
    reviewer." (default)
  - **No response** — "The reviewer never answered the invitation. This is recorded on their
    reviewer history." Below it, a checkbox "Also send a courtesy note", default unchecked.
- When **No response** is chosen and the checkbox is off, hide the preview editor and show one
  line: "No email will be sent. The link is disabled and the invitation is recorded as
  unanswered."
- Button label: "Release (N)" for either reason; the reason radio makes the verb clear. Keep
  "Release invitee (N)" on the panel button.
- History drawer: `no_response` label becomes **"No response to invitation"**; the note
  distinguishes actor: "Recorded by <PD name>" when the row carries an acting user, otherwise
  "Recorded by automated cycle close". If the DTO does not expose the actor for this stamp, use
  "Recorded by staff" vs "Recorded by automated cycle close" keyed on `withdrawnSufficientAt`
  being null AND `responseReceivedAt` being set before the meeting date — and say in the handoff
  that a proper actor field is missing.
- Sentences, not labels with colons. No exclamation marks. Voice per
  `.claude-memory/feedback-user-facing-error-copy-voice.md`.

## Decisions that are the owner's, not yours

- Whether `no_response` should visibly lower a reviewer's standing anywhere (Find card, roster,
  future reliability score). This brief records it as **negative-leaning evidence in the plan
  doc only**; do not build a score or a badge.
- Whether the Track Reviewers pending-invites group (shipped 2026-09-09, PR #216) gets an inline
  release action. Out of scope here.
- Whether the sweep's cycle-close `no_response` should itself send a courtesy email. Out of scope.

## Method

1. `/start`, then read in full: the modal, the route, the service, the pending-invitation writer,
   the adapter's `updateLifecycle` and `expireInvitationResponse`, and the history drawer.
2. Baseline before changing anything:
   `npx jest tests/unit/withdraw-sufficient tests/unit/withdraw-pending-invitation.test.js tests/unit/release-email-modal.test.js tests/unit/reviewer-invite-panel-release-button.test.js tests/unit/reviewer-activity-history.test.js`
3. Small commits, one concern each: (a) service + writer + route with tests; (b) modal + panel
   with tests; (c) history copy; (d) docs (matrix row, Atlas, plan paragraph).
4. Before calling it done: `npm run lint` (0 errors), `npm run check:types`,
   `npm run check:api-routes && npm run check:api-routes:self-test`,
   `npm run check:status-enum-parity && npm run check:status-enum-parity:self-test`,
   `npm run check:atlas && npm run check:atlas:self-test`, `npm run check:docs-catalog`,
   `npm run check:doc-symbol-refs`, and `git diff --check`. Gates run sequentially with their
   self-tests, never in parallel.
5. Do not run `/stop`. Fill in the handoff below and push.

## Tests

Existing (must stay green or be re-pinned with a one-line reason in the commit):
`tests/unit/withdraw-sufficient-service.test.js`, `withdraw-sufficient-route.test.js`,
`withdraw-sufficient-route-overrides.test.js`, `withdraw-sufficient-preview.test.js`,
`withdraw-sufficient-service-delegation.test.js`, `withdraw-pending-invitation.test.js`,
`release-email-modal.test.js`, `reviewer-invite-panel-release-button.test.js`.

Add, with the discriminating fixture in each (the case that would pass with the guard deleted
is decorative and does not count):

- Service: `reason: 'no_response'` writes `no_response` + `responseReceivedAt`, never
  `withdrawnSufficientAt`; with email unchecked, no render and no send are attempted and the
  status names the deliberate skip; with email checked, the send happens after the write.
- Service: a `no_response` release against a row that accepted between read and write still
  yields `changed_skipped` and no email.
- Route: unknown `reason` → 400 before the service is called; missing `reason` → service called
  with `no_longer_needed` semantics (assert the exact argument).
- Writer: the two reasons produce the two exact `updateLifecycle` patches; `ifMatch` and
  `actingUserSystemId` are forwarded unchanged for both; only `no_response` carries
  `externalTokenRevoked: true`.
- Chokepoint (existing test file for `verify-suggestion-token`, or a new one): a row with
  `wmkf_responsetype = no_response` and `wmkf_externaltokenrevoked = true` returns
  `{ ok: false, reason: 'revoked' }` — the discriminating fixture is the same row with the flag
  false, which today still verifies; assert that too, so the guard is proven load-bearing.
- Modal: default radio is No longer needed with previews shown; choosing No response hides
  previews and unchecks the note; the posted body carries `reason` and, for No response with
  the note on, the `overrides`.
- History drawer: a PD-recorded `no_response` renders the new label and the staff attribution;
  a sweep-recorded one keeps "automated cycle close".

## Handoff (fill in at the end)

- Commits on `codex/reviewer-release-reason`: `12e3d01a` (service, writer, route,
  lifecycle constants, and tests); `981a1a0f` (release reason controls and tests);
  `6f6deb46` (history copy and attribution tests); `a287f196` (API matrix, Atlas,
  and terminal-status documentation); `e775935e` (initial handoff); and
  `54af336d` (modal decoupling, stable result sanitization, and discriminating
  tests); `37902746` (handoff and P1 residual-risk record); `8daef53f`
  (deferred-preview test cleanup); `d45d4021` (handoff verification update);
  `483af4e9` (single-proposal no-response history reachability and attribution);
  `5233ef5c` (post-meeting automated attribution regression test); `f0a16e8b`
  (no-response non-actionable status hardening); `6e55563e` (history handoff
  closure); `7b39352f` (history handoff evidence correction); `3df82bc2`
  (branch-drift record); `36f43a82` (complete prior commit inventory); and
  `98e065d7` (terminal token-regeneration guard, lifecycle projection, and
  discriminating service/route/UI tests); `4ac8e722` (token-regeneration
  handoff documentation); `1cb5ecb4` (remote-main drift verification); and
  `fe63ddc8` (ETag-bound regeneration, 412 mapping, unknown-lifecycle DTO
  validity, and concurrency/UI regressions). The implementation and handoff
  commits are pushed to
  `origin/codex/reviewer-release-reason`.
- Files changed: `lib/services/review-manager/withdraw-sufficient-service.js`,
  `lib/services/reviewer-engagement/withdraw-pending-invitation.js`,
  `lib/services/review-manager/regenerate-token-service.js`,
  `lib/dataverse/adapters/reviewer-suggestion.js`,
  `pages/api/review-manager/withdraw-sufficient.js`,
  `shared/config/reviewerLifecycle.js`,
  `shared/components/reviewers/ReleaseEmailModal.js`,
  `shared/components/reviewers/ReviewerInvitePanel.js`,
  `shared/components/reviewers/TokenActionsMenu.js`,
  `shared/components/reviewers/reviewer-activity-history.js`, the focused unit and
  integration tests for service/route/writer/modal/history, including
  `tests/unit/reviewers-service.test.js` and
  `tests/unit/reviewer-manage-actions-menu.test.js`,
  `tests/unit/regenerate-token-service.test.js`,
  `tests/integration/review-manager-token-routes.test.js`,
  `tests/unit/reviewer-suggestion-token-regeneration.test.js`, and the API matrix,
  Atlas, and terminal-status plan docs. The regeneration named read now selects
  `wmkf_responsetype` and `wmkf_reviewstatus`; the server rejects mapped terminal
  response outcomes, post-accept terminal statuses, and unknown non-null lifecycle
  values with stable `{ ok: false, reason: 'not_eligible' }` before request lookup
  or mint. The menu mirrors the existing response-type map and terminal review-
  status constants, so terminal rows cannot expose Regenerate. No portal, schema,
  sweep, rollup, readiness, or session-prompt files were changed.
- Verification run and results: the focused release suite passes cleanly with 103
  tests across 8 suites; the route and release-button characterization suites pass
  with 20 tests across 2 suites. The latter retains only the pre-existing React
  `act(...)` warning from the `ReviewerInvitePanel` VIP-load effect. The P1
  service/component/history command passes with 137 tests across 4 suites. The
  token-regeneration command passes with 150 tests across 6 suites (including the
  terminal response complement, unknown-state fall-through, missing-ETag and
  exact-ifMatch controls, conditional 412 race mapping, revoked no-response
  route fixture, adapter annotation projection, lifecycle DTO signal, token
  forwarding, and UI menu assertions);
  `npm run lint`;
  `npm run check:types`;
  `check:api-routes` + self-test; `check:status-enum-parity` + self-test;
  `check:atlas` + self-test; `check:docs-catalog`; `check:doc-symbol-refs`;
  `check:reviewer-engagement-boundary` + self-test;
  `check:route-service-boundary` + self-test; `check:route-lifecycle-auth` +
  self-test; and `git diff --check` all pass.
- Open questions / recommendations for the owner: the branch was based on
  `a3bda092`; unrelated `origin/main` advanced to `936b6a55` during the build,
  so this branch remains four commits behind `main` by design. The requested
  release branch is pushed and ready for review; do not merge it here.
- P1 history reachability/attribution is resolved within the authorized scope.
  `reviewers-service.js:202-204` retains accepted and review-received rows and
  additionally includes `no_response` lifecycle rows. `reviewers-service.js:290-293`
  projects those rows as `released` when they have no explicit review status, and
  `reviewers-service.js:342-346` carries the trusted request `meetingDate` onto each
  row. The existing panel history trigger at `ReviewerManagePanel.js:480-482` can
  therefore find the row, while its accepted-only selection/release controls remain
  excluded. The history helper reports `Recorded by staff` for a no-response stamp
  before the meeting date and keeps `Recorded by automated cycle close` for the
  post-meeting sweep fallback. Dataverse actor/modified-by data is not selected for
  this DTO; no adapter expansion was required for history because the permitted
  timestamp marker is available from the existing request projection. The separate
  token-regeneration P1 is also resolved within the authorized scope: its named
  Dataverse read now includes the lifecycle fields, the service independently blocks
  all mapped terminal response outcomes plus terminal/unknown statuses before any
  request read or mint, and the UI hides the action for those rows.
