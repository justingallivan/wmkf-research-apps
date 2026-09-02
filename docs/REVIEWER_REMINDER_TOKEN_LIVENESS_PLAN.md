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

## 3. Change surface

- **Entry points:** Reviews-tab `Send reminder now`; the dormant
  `/api/cron/reviewer-reminders` route; a new read-only operator audit command.
- **Client state:** reviewer DTO `tokenState`; button enabled/disabled state and
  recovery guidance.
- **Request:** existing `{ requestId, suggestionId, kind:'reviewdue' }` contract;
  no new client-asserted token facts.
- **Route:** existing authenticated
  `POST /api/review-manager/send-review-reminder`; add explicit response mapping
  for token-state refusal reasons.
- **Services:** one canonical token-state evaluator; manual reminder
  authorization; scheduled sweep eligibility; shared final pre-claim guard.
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
| A review-due reminder is eligible only when the authoritative suggestion has a nonblank current token hash, is not revoked, and has a valid expiry that covers the required access window. | shared token-state helper; manual reminder service; reminder sweep | Unit table covers every state and exact time boundary. |
| Missing or malformed token metadata fails closed. | token-state helper; reviewers DTO | Tests prove a hash with missing/malformed expiry is not `active`. |
| Review-due liveness checks never mint, rotate, reconstruct, or include a token/link. | reminder sweep shared sender; email renderer | Existing mint/refusal suites plus new negative assertions with mint and transport spies. |
| A blocked reminder writes neither `wmkf_remindersentat` nor `wmkf_remindercount` and sends no email. | manual reminder service; shared sender; scheduled sweep | Guard-removal-sensitive tests supply an otherwise eligible row with each bad token state. |
| The final server check runs after the manual path's fresh read and before the ETag-bound marker claim. | manual reminder service; shared sender | Ordering tests prove read → classify → claim → transport and prove no claim on refusal. |
| A concurrent token change cannot be overwritten or ignored. | shared sender; Dataverse adapter | Existing `If-Match`/412 tests remain green; new tests prove token fields are part of the fresh projection. |
| The UI is advisory and matches the server without becoming an authority. | reviewers service; ReviewsTab; ReviewerManagePanel | UI tests cover active and every blocked state; direct API tests still reject stale/forged client state. |
| The current-cycle audit is read-only and cannot send email or mutate reminder/token state. | new audit script | Static/test guard rejects imports/calls to mail, lifecycle update, mint, or mutation helpers; operator run uses production-read authorization only. |
| Neither the manual freeze nor cron hold is lifted implicitly by merging this work. | Vercel config; hold gate; release checklist | Hold gate and self-test remain green; production cron registry inspected after deploy. |

## 5. Token-state contract

Implement one canonical evaluator over the authoritative Dataverse fields. It
accepts an injected `nowMs` so tests and audit output are deterministic.

States:

| State | Definition | Reminder behavior |
|---|---|---|
| `not_minted` | token hash is missing or blank | Block; staff must use explicit replacement-link recovery. |
| `revoked` | `wmkf_externaltokenrevoked === true` | Block; preserve the existing withdrawn-access semantics. |
| `invalid` | expiry is missing, malformed, or non-finite | Block; do not guess or repair automatically. |
| `expired` | parsed expiry is at or before `nowMs` | Block; explicit recovery required. |
| `insufficient_window` | expiry is live now but does not cover the required access window | Block; explicit recovery required. |
| `active` | all checks pass | The reminder may proceed if every non-token eligibility check also passes. |

For review-due reminders, the required access window is the later of:

1. the effective review due date at 23:59:59 UTC; and
2. 24 hours after the eligibility check.

This buffer avoids sending a chase that points the reviewer back to a link that
is technically live at send time but about to expire. Normal accepted-reviewer
Materials tokens extend about 90 days beyond the review due date, so ordinary
current-cycle rows should clear this rule comfortably. Claude should explicitly
review whether 24 hours is the correct owner-facing buffer; changing that
number is a policy decision, not an implementation detail.

The evaluator does **not** prove that a reviewer still possesses the plaintext
JWT or that a specific email was delivered. The application cannot reconstruct
the JWT from its hash. The claim is deliberately narrower: authoritative server
state says a current token exists and should remain usable for the required
window if the reviewer presents the matching JWT.

## 6. Implementation sequence

### 6.1 Canonical classification

1. Add a small pure token-state helper under `lib/external/`.
2. Make unknown/missing inputs fall into a blocked state; no final fall-through
   may return `active` without satisfying every positive condition.
3. Replace the private `deriveTokenState` in
   `lib/services/review-manager/reviewers-service.js` with the shared helper.
4. Add the new `invalid` and `insufficient_window` states to the token badge and
   every consumer that branches on `tokenState`. Unknown UI states must render
   as a warning, not silently as `not_minted` or `active`.

### 6.2 Manual reminder guard

1. Add `wmkf_externaltokenhash` and `wmkf_externaltokenexpires` to the manual
   service's fresh suggestion projection. Keep the existing revoked field.
2. Extend the review-due refusal classifier with explicit
   `token_not_minted`, `token_invalid`, `token_expired`, and
   `token_insufficient_window` reasons.
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
   skips. Do not include plaintext tokens or reviewer email addresses in logs.
4. Do not restore the Vercel schedule. The route remains cron-secret protected
   and the hold gate remains unchanged.

### 6.5 Staff UI

1. Enable `Send reminder now` only when Materials were sent **and** the DTO
   reports an active token covering the required window.
2. Render a specific explanation for each blocked state. Direct staff toward
   the existing explicit replacement-link action; do not regenerate from the
   reminder button.
3. Preserve server error handling for stale UI: if the token changes after
   render, the API reason replaces the optimistic client state with an
   actionable message.

### 6.6 Read-only current-cycle audit

Add a focused read-only audit command that applies the same shared classifier to
accepted, Materials-sent/under-review, not-submitted current-cycle suggestions.
It reports:

- total rows examined;
- counts for every token state;
- request number and suggestion id for blocked rows; and
- the as-of timestamp and required-window policy used.

The audit must not import or call email transport, token mint/regeneration,
`updateLifecycle`, or any Dataverse write helper. Production execution requires
the existing explicit `DATAVERSE_ALLOW_PROD_READS=yes` authorization and no
write bypass.

## 7. Whole-flow contract

### Manual path

`ReviewsTab` → existing authenticated POST route → manual reminder service →
fresh suggestion read → token-state classification → final shared pre-claim
classification → ETag-guarded reminder marker write → link-free email transport
→ route response → UI feedback/reload.

### Scheduled path

Dormant cron route → review-due query → token-state classification → request and
reviewer hydration → final shared pre-claim classification → ETag-guarded
reminder marker write → link-free email transport → aggregate result and
maintenance-run evidence.

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
   exact expiry boundary, expired, insufficient window, active, and unknown
   input.
2. Manual service: each blocked state returns its exact reason before marker,
   mint, or transport; active state preserves the existing order and succeeds.
3. Fresh-read race: UI/initial row active but the authorization read becomes
   revoked, expired, invalid, or insufficient; no write/send occurs.
4. Shared sender: a direct/future `reviewdue` caller cannot bypass the final
   guard; a valid `respond` caller still follows its existing mint contract;
   unknown kinds fail closed.
5. Scheduled sweep: bad token states are counted separately and never hydrated,
   claimed, or sent; an active row still uses the link-free path.
6. Route: every new refusal reason has the intended response shape/status.
7. DTO/UI: malformed metadata is visibly blocked; the button is disabled with
   the correct guidance; a stale active UI still handles a server refusal.
8. Audit command: read-only enforcement test and fixture-based state counts.
9. Guard-removal sensitivity: negative tests contain an otherwise eligible
   token-defective row and fail if the liveness branch is removed.

### Required verification

Run the focused reminder/token suites, then the incident suite set, targeted
lint, the reviewer-reminder hold gate and self-test sequentially, the relevant
API/security and documentation gates, the full test suite, and a production
build. A known unrelated failure must be named and independently reproduced; it
must not be waived merely because it existed before.

No verification step may deliver a real reviewer email. Use mocks/capture mode
for email assertions.

## 9. Release and freeze-lift checklist

1. Claude reviews this plan read-only and either approves it or names required
   corrections.
2. Codex incorporates accepted corrections and implements on a preview branch.
3. The complete implementation receives a fresh read-only review.
4. Preview build and non-delivery smoke checks pass; no reviewer email is sent.
5. Production promotion is explicit. Post-deploy evidence confirms the exact
   commit, the hold gate, cron absence, health, and recent error scan.
6. Run the current-cycle audit read-only in production.
7. Adjudicate every blocked row before staff resume review-due reminders.
8. Run one capture-mode manual review-due reminder test proving: no token mint,
   no URL, marker claim occurs only after liveness validation, and no real
   transport.
9. The owner explicitly lifts the **manual review-due reminder freeze**. Cron
   remains paused until all separate reactivation prerequisites in
   `docs/REVIEWER_ENGAGEMENT_SPEC.md` are satisfied.

## 10. Residual risks and deferred work

- A valid stored hash/expiry does not prove that the reviewer retained the
  matching email or plaintext JWT. Staff must use explicit replacement-link
  recovery when a reviewer reports access failure.
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
