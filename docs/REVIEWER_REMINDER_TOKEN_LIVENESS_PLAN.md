---
title: "Reviewer Reminder Token-Liveness Guard Plan"
domain: reviewer-workbench
kind: plan
status: draft
summary: "Fail-closed review-due reminder token checks, staff guidance, and a read-only audit before lifting the manual-send freeze."
canonical: false
cataloged: 2026-09-01
owner: product-engineering
related:
  - docs/REVIEWER_ENGAGEMENT_SPEC.md
  - lib/services/reviewer-manual-reminder.js
  - lib/services/reviewer-reminder-sweep.js
  - lib/services/review-manager/reviewers-service.js
  - shared/components/workbench/ReviewsTab.js
  - pages/api/review-manager/send-review-reminder.js
---

# Reviewer Reminder Token-Liveness Guard Plan

## 1. Decision and scope

Add a fail-closed token-state eligibility guard to every accepted-reviewer
review-due reminder path before the reminder marker is claimed or an email is
sent. This is a defense-in-depth follow-up to the 2026-09-01 reviewer-token
incident remediation.

This plan does **not**:

- restore `/api/cron/reviewer-reminders` to the Vercel cron registry;
- lift the manual review-due reminder freeze by itself;
- mint, rotate, reconstruct, expose, or store a plaintext reviewer token;
- add a token or reviewer URL to review-due reminder copy;
- change invitation, respond-by reminder, Materials, or explicit regeneration
  token semantics;
- delete or alter a saved review draft; or
- add Dataverse columns, Postgres tables, API routes, or migrations.

The production reviewer-reminder schedule remains absent and guarded by
`scripts/check-reviewer-reminder-hold.js`. The manual freeze remains in force
until the implementation, tests, production deployment, and read-only audit in
this plan are complete and the owner explicitly lifts it.

## 2. Verified current state

1. [VERIFIED via `lib/services/reviewer-manual-reminder.js:38-55,68-85`]
   The manual review-due path freshly reads selection, revocation, acceptance,
   lifecycle, and completion fields, but its projection omits
   `wmkf_externaltokenhash` and `wmkf_externaltokenexpires`. It therefore cannot
   reject a missing, malformed, or expired current token.
2. [VERIFIED via `lib/services/reviewer-reminder-sweep.js:199-205,218-253`]
   The scheduled review-due sweep has the same omission. Its query does not
   select token hash or expiry and it proceeds from date/config eligibility to
   the shared sender.
3. [VERIFIED via `lib/services/reviewer-reminder-sweep.js:264-359`]
   `sendOneReminder` claims `wmkf_remindersentat` and increments
   `wmkf_remindercount` before transport. For `reviewdue`, it preserves token
   authority and does not mint, but it currently performs no token-liveness
   check before that irreversible marker write.
4. [VERIFIED via `lib/services/review-manager/reviewers-service.js:92-99,328-334`]
   The reviewer DTO already emits `tokenState`, `tokenExpiresAt`, and
   `tokenRevoked`. Its current state derivation treats a nonempty hash with a
   missing or malformed expiry as active, which is not fail closed.
5. [VERIFIED via `shared/components/workbench/ReviewsTab.js:598-665`]
   The Reviews-tab button is currently enabled whenever Materials have been
   sent; it does not use the DTO's token state. The route remains the authority,
   but the UI invites a request that the planned server guard would reject.
6. [VERIFIED via production Vercel deployment
   `dpl_cwuEZhxhtHkwpVtpAB5i3qnWW5cw`, commit `733a3a2f`, 2026-09-01]
   The token-remediation build is live. Its prebuild hold gate passed, and the
   deployed cron registry does not contain `/api/cron/reviewer-reminders`.
7. [VERIFIED via `lib/external/verify-suggestion-token.js:161-190`]
   The external verifier currently rejects a missing hash, hash mismatch,
   revocation, and a finite stored expiry at or before now, but it does **not**
   reject a missing or malformed stored expiry. Therefore `invalid` metadata is
   not proof that the reviewer link is dead; blindly regenerating from that
   state could rotate a link that still works.
8. [VERIFIED via `lib/services/reviewer-reminder-sweep.js:332-384`]
   An unknown `kind` currently takes the review-due marker branch, claims the
   marker, and fails later during rendering/send selection. The planned
   allowlist closes a pre-existing write-before-refusal defect.

## 3. Change surface

- **Entry points:** Reviews-tab `Send reminder now`; the dormant
  `/api/cron/reviewer-reminders` route; a new read-only operator audit command.
- **Client state:** reviewer DTO `tokenState` remains pure current-token
  liveness; a separate `reviewDueReminderEligibility` field drives the reminder
  button and recovery guidance.
- **Request:** existing `{ requestId, suggestionId, kind:'reviewdue' }` contract;
  no new client-asserted token facts.
- **Route:** existing authenticated
  `POST /api/review-manager/send-review-reminder`; add explicit response mapping
  for token-state refusal reasons.
- **Services:** one canonical pure token-state evaluator; a distinct review-due
  reminder-eligibility evaluator; manual reminder authorization; scheduled
  sweep eligibility; shared final pre-claim guard.
- **Persistence:** reads existing Dataverse suggestion fields. Eligible sends
  retain the existing ETag-guarded reminder marker write. Blocked sends perform
  no write. No new persistence.
- **Consumers:** Reviews tab, Reviewer Manage Panel token badge/actions, cron
  dry-run/result logging, tests, and the production audit report.
- **Prior finding:** review-due reminders can currently be sent and marked sent
  when the reviewer's current token is missing, malformed, or expired.

## 4. Invariants

| Invariant | Likely files | Verification |
|---|---|---|
| Pure `tokenState` answers only whether authoritative token metadata describes a link that is live now; it does not include the reminder runway policy. | token-state helper; reviewers DTO; Reviewer Manage Panel | Revoke remains available for a live token even when reminder runway is insufficient. |
| A review-due reminder is eligible only when pure token state is active, the effective due date exists, and expiry covers the required reminder access window. | reminder-eligibility helper; manual reminder service; reminder sweep | Unit table covers every state, null due date, and exact time boundaries. |
| Missing or malformed token metadata blocks reminders but does not imply the current reviewer link is unusable. | token-state helper; reminder eligibility; recovery copy | Tests prove invalid metadata blocks reminder writes/sends and never invokes regeneration. |
| Review-due liveness checks never mint, rotate, reconstruct, or include a token/link. | reminder sweep shared sender; email renderer | Existing mint/refusal suites plus new negative assertions with mint and transport spies. |
| A blocked reminder writes neither `wmkf_remindersentat` nor `wmkf_remindercount` and sends no email. | manual reminder service; shared sender; scheduled sweep | Guard-removal-sensitive tests supply an otherwise eligible row with each bad token state. |
| The final server check runs after the manual path's fresh read and before the ETag-bound marker claim. | manual reminder service; shared sender | Ordering tests prove read → classify → claim → transport and prove no claim on refusal. |
| A concurrent token change cannot be overwritten or ignored. | shared sender; Dataverse adapter | Existing `If-Match`/412 tests remain green; new tests prove token fields are part of the fresh projection. |
| The UI is advisory and matches the server without becoming an authority. Generic token actions use pure `tokenState`; only the Reviews-tab reminder uses `reviewDueReminderEligibility`. | reviewers service; ReviewsTab; ReviewerManagePanel | Revoke/action-menu tests remain valid; direct API tests still reject stale/forged client state. |
| The current-cycle audit is read-only and cannot send email or mutate reminder/token state. | new audit script | Static/test guard rejects imports/calls to mail, lifecycle update, mint, or mutation helpers; operator run uses production-read authorization only. |
| Neither the manual freeze nor cron hold is lifted implicitly by merging this work. | Vercel config; hold gate; release checklist | Hold gate and self-test remain green; production cron registry inspected after deploy. |

## 5. State contracts

### 5.1 Pure token state

Implement one canonical pure evaluator over the authoritative Dataverse token
fields. It accepts an injected `nowMs` so tests and audit output are
deterministic. It answers only whether stored metadata describes a token that is
live **now**; it does not apply reminder runway policy.

Precedence is explicit and total:

| State | Definition |
|---|---|
| `revoked` | `wmkf_externaltokenrevoked === true`, regardless of hash/expiry. This preserves the security meaning and staff compromise-response UI. |
| `not_minted` | not revoked, and token hash is missing, non-string, empty, or whitespace-only. |
| `invalid` | hash is present, but expiry is missing, malformed, or non-finite. |
| `expired` | hash and finite expiry are present, and expiry is exactly equal to or earlier than `nowMs`. |
| `active` | hash is nonblank, not revoked, expiry is finite, and expiry is strictly later than `nowMs`. |

`invalid` is a data-integrity state, not proof that the link is dead. The
current external verifier admits a matching signed token when the stored expiry
is missing or malformed. Staff guidance must therefore say **data repair / hold
and investigate**, not “regenerate.” Automatic or casual regeneration from this
state would recreate the incident pattern by rotating a potentially working
link.

### 5.2 Review-due reminder eligibility

Add a separate evaluator and DTO field named
`reviewDueReminderEligibility`. It combines pure token state with the effective
review due date and reminder runway. It must not replace or overload
`tokenState`, because the Reviewer Manage Panel uses `tokenState === 'active'`
to expose the Revoke compromise-response action.

| Eligibility | Definition and action |
|---|---|
| `eligible` | Pure token state is active, effective due date exists, and expiry is strictly later than the required access boundary. |
| `token_revoked` | Pure state revoked. Block; require an explicit owner decision before restoring access. |
| `token_not_minted` | Pure state not minted. Block; investigate the Materials/token inconsistency, then use explicit replacement delivery if warranted. |
| `token_invalid_data` | Pure state invalid. Block; data repair/incident adjudication only—do not regenerate automatically. |
| `token_expired` | Pure state expired. Block; explicit replacement delivery is safe only as a deliberate recovery action. |
| `token_insufficient_window` | Token works now but expires at or before the required boundary. Block the generic reminder; if staff deliberately replaces it, the replacement message must clearly deliver the new link. |
| `due_date_missing` | No effective review due date can be resolved. Block; repair campaign/due-date data before reminding. |

For review-due reminders, the proposed required access boundary is the later
of:

1. the effective review due date at 23:59:59 UTC; and
2. 24 hours after the eligibility check.

Expiry equal to the boundary is insufficient; it must be strictly later. The
24-hour floor is a recommended minimum and remains an **owner decision before
implementation**. Normal accepted-reviewer Materials tokens extend about 90
days beyond the review due date, so ordinary current-cycle rows should clear it
comfortably. A production read-only audit should report how many rows would be
blocked at 24 hours and at any longer candidate runway; it must not silently
choose policy from the data.

Neither evaluator proves that a reviewer still possesses the plaintext JWT or
that a specific email was delivered. The application cannot reconstruct the
JWT from its hash. The claim is deliberately narrower: authoritative server
state describes a matching token that should remain usable if the reviewer
presents its plaintext JWT.

## 6. Implementation sequence

### 6.1 Canonical classification

1. Add a small pure token-state helper under `lib/external/` and a separate
   review-due reminder-eligibility helper in the reminder service layer.
2. Make unknown/missing inputs fall into a blocked state; no final fall-through
   may return `active` without satisfying every positive condition.
3. Replace the private `deriveTokenState` in
   `lib/services/review-manager/reviewers-service.js` with the shared helper.
4. Add only the pure `invalid` state to the generic token badge. Compute and
   emit `reviewDueReminderEligibility` separately with the request's effective
   due date and the approved runway.
5. Preserve `tokenState === 'active'` for a currently working token even when
   reminder runway is insufficient, so Revoke remains available. Unknown UI
   states must render as a warning, not silently as `not_minted` or `active`.

### 6.2 Manual reminder guard

1. Add `wmkf_externaltokenhash` and `wmkf_externaltokenexpires` to the manual
   service's fresh suggestion projection. Keep the existing revoked field.
2. Extend the review-due refusal classifier with explicit
   `token_not_minted`, `token_invalid`, `token_expired`, and
   `token_insufficient_window` reasons, plus `due_date_missing`.
3. Run classification on both the initial read and the existing fresh
   `authorizeClaim` read. The second read remains authoritative.
4. Map those reasons to conflict responses in the existing route; do not add a
   route or trust a token-state value supplied by the browser.

### 6.3 Shared final pre-claim guard

1. In `sendOneReminder`, explicitly allow only `respond` and `reviewdue`; reject
   unknown kinds before any write.
2. For `reviewdue`, classify `effectiveRow` immediately before rendering and
   claiming the marker. This is the final backstop for every current or future
   caller.
3. A blocked state must return a specific refusal/skip reason before
   `updateLifecycle`, `mintAndStore`, or email transport is invoked.
4. Keep the existing ETag claim. If token metadata changes concurrently after
   the read, the stale ETag must still produce a 412/no-send outcome.
5. The `respond` path remains intentionally exempt because it atomically mints
   its permitted pre-acceptance token; that exemption is enforced solely by the
   explicit `kind === 'respond'` branch.

### 6.4 Scheduled sweep guard and observability

1. Add token hash, expiry, and revoked state to the review-due sweep projection.
2. Classify candidates before expensive sender/reviewer hydration, then rely on
   the shared final pre-claim guard as the second check.
3. Add result counts by blocked token state so a dry run distinguishes missing,
   revoked, invalid, expired, and insufficient-window rows from unrelated
   skips. These are ordinary blocked counters, not `errors`; an expected blocked
   row must not make the maintenance run appear failed. Do not include plaintext
   tokens or reviewer email addresses in logs.
4. Do not restore the Vercel schedule. The route remains cron-secret protected
   and the hold gate remains unchanged.

### 6.5 Staff UI

1. Enable `Send reminder now` only when Materials were sent **and** the separate
   DTO `reviewDueReminderEligibility` value is `eligible`.
2. Render a specific explanation for each blocked state. Direct staff toward
   the state-specific adjudication action. In particular, `token_invalid_data`
   directs staff to hold and investigate; it must not recommend regeneration.
   Do not regenerate from the reminder button.
3. Preserve server error handling for stale UI: if the token changes after
   render, the API reason replaces the optimistic client state with an
   actionable message.
4. Keep the Reviewer Manage Panel action menu driven by pure `tokenState`, not
   reminder eligibility, so Revoke remains available for any currently active
   token.

### 6.6 Read-only current-cycle audit

Add a focused read-only audit command that reuses the sweep's exported candidate
filter and the same downstream eligibility evaluator. It must not reconstruct a
similar-but-different filter. Apply an explicit current-cycle restriction after
the shared candidate selection without weakening any sweep predicate.
It reports:

- total rows examined;
- counts for every pure token state and reminder-eligibility outcome;
- request number and suggestion id for blocked rows; and
- the as-of timestamp and required-window policy used.

The audit must not import or call email transport, token mint/regeneration,
`updateLifecycle`, or any Dataverse write helper. Production execution requires
the existing explicit `DATAVERSE_ALLOW_PROD_READS=yes` authorization and no
write bypass. It must not call the cron route: even `?dryRun=1` creates a
`maintenance_runs` row. The audit invokes only read-only service/query seams and
produces a local report. A future cron reactivation dry run may intentionally
write maintenance evidence under the separate engagement-spec procedure.

## 7. Whole-flow contract

### Manual path

`ReviewsTab` → existing authenticated POST route → manual reminder service →
fresh suggestion read → pure token classification + reminder-eligibility
classification → final shared pre-claim eligibility check → ETag-guarded
reminder marker write → link-free email transport → route response → UI
feedback/reload.

### Scheduled path

Dormant cron route → shared review-due candidate query → token/reminder
classification → request and reviewer hydration → final shared pre-claim
eligibility check → ETag-guarded reminder marker write → link-free email
transport → aggregate result and maintenance-run evidence.

### Partial-success and async behavior

- The unit of success remains one suggestion. A blocked row is not claimed and
  remains available for explicit recovery.
- A transport failure after a successful marker claim retains the existing
  at-most-once behavior; this plan does not redesign reminder retry semantics.
- The Reviews tab already guards stale request loads with a monotonic fetch id.
  The button's local send state remains row-local; after success or refusal it
  reloads authoritative reviewer state.
- No background or fire-and-forget token operation is added.

## 8. Tests and gates

### Required tests

1. Pure classifier table: blank hash, revoked, missing expiry, malformed expiry,
   exact-now expiry boundary, expired, active, unknown input, whitespace hash,
   and blank-plus-revoked precedence.
2. Reminder-eligibility table: null effective due date, exact required-window
   boundary, insufficient window, active/eligible, and every blocked pure state.
3. Manual service: each blocked state returns its exact reason before marker,
   mint, or transport; active state preserves the existing order and succeeds.
4. Fresh-read race: UI/initial row active but the authorization read becomes
   revoked, expired, invalid, or insufficient; no write/send occurs.
5. Shared sender: a direct/future `reviewdue` caller cannot bypass the final
   guard; a valid `respond` caller still follows its existing mint contract;
   unknown kinds fail closed before `updateLifecycle` or transport.
6. Scheduled sweep: bad token states are counted separately as blocked—not
   errors—and never hydrated, claimed, or sent; an eligible row still uses the
   link-free path.
7. Route: every new refusal reason has the intended response shape/status.
8. DTO/UI: pure active state continues to expose Revoke while insufficient
   reminder runway disables only the reminder button; invalid metadata shows
   data-repair guidance; stale UI still handles a server refusal.
9. Audit command: read-only enforcement, fixture-based counts, exact shared
   candidate-filter reuse, and proof that it does not call MaintenanceService.
10. Existing eligible-path fixtures are updated with a nonblank hash and a
   sufficiently long finite expiry; failures caused by the new fail-closed
   default are not papered over with production-code exceptions.
11. Guard-removal sensitivity: negative tests contain an otherwise eligible
   token-defective row and fail if the liveness branch is removed.

### Required verification

Run the focused reminder/token suites, then the incident suite set, targeted
lint, the reviewer-reminder hold gate and self-test sequentially, the relevant
API/security and documentation gates, the full test suite, and a production
build. A known unrelated failure must be named and independently reproduced; it
must not be waived merely because it existed before.

No verification step may deliver a real reviewer email. Use mocks or explicit
test doubles for email assertions; the reminder transport has no capture mode.

## 9. Owner decisions before implementation

1. **Reminder runway:** approve the proposed 24-hour minimum or choose a longer
   named interval. The audit may compare counts, but it does not choose policy.
2. **Blocked-state adjudication:** approve the following operator contract or
   replace it explicitly:
   - revoked → remain blocked unless an owner deliberately restores access;
   - not minted → investigate the Materials/token inconsistency, then perform
     explicit first/replacement delivery if warranted;
   - invalid data → hold and repair/adjudicate metadata; do not regenerate as
     the default response because the current link may work;
   - expired → deliberate replacement delivery is permitted;
   - insufficient window → generic reminder stays blocked; any deliberate
     replacement must itself communicate the new link and supersession;
   - missing due date → repair campaign data before reminding.
3. **Freeze lift:** confirm that resuming manual review-due reminders requires a
   written owner decision after release evidence; deployment alone never lifts
   the freeze.

## 10. Release and freeze-lift checklist

1. Claude reviews this plan read-only and either approves it or names required
   corrections.
2. Codex incorporates accepted corrections and implements on a preview branch.
3. The complete implementation receives a fresh read-only review.
4. Preview build and non-delivery smoke checks pass; no reviewer email is sent.
5. Production promotion is explicit. Post-deploy evidence confirms the exact
   commit, the hold gate, cron absence, health, and recent error scan.
6. Run the current-cycle audit read-only in production.
7. Adjudicate every blocked row before staff resume review-due reminders.
8. Run the mocked-transport integration test locally/CI proving: no token mint,
   no URL, and marker claim occurs only after liveness validation. There is no
   production capture mode, so no production or preview reminder send is part
   of verification.
9. The owner explicitly lifts the **manual review-due reminder freeze**. Cron
   remains paused until all separate reactivation prerequisites in
   `docs/REVIEWER_ENGAGEMENT_SPEC.md` are satisfied.

## 11. Residual risks and deferred work

- A valid stored hash/expiry does not prove that the reviewer retained the
  matching email or plaintext JWT. Staff must use explicit replacement-link
  recovery when a reviewer reports access failure.
- A matching signed token with missing/malformed stored expiry may currently be
  admitted by `verify-suggestion-token`. This plan blocks reminders and routes
  the row to data adjudication; changing verifier semantics is a separate
  security/data-remediation change and must not be smuggled into this build.
- The existing marker-before-transport at-most-once contract can leave a row
  marked after an ambiguous transport failure. That is outside this liveness
  plan and remains a separate reminder-delivery reliability decision.
- Durable Materials-delivery idempotency after an ambiguous post-transport
  receipt failure remains separate work.
- Long review-date extensions that exceed signed token expiry still require
  explicit replacement-link recovery.
- Reminder flag defaults, staff configuration controls, armed-row backfill, and
  cron reactivation remain governed by the broader engagement spec and are not
  solved here.
