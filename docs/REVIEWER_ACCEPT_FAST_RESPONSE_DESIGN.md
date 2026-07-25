---
title: "Reviewer Accept Fast Response Design"
domain: reviewer-workbench
kind: spec
status: active
summary: "SHIPPED as the reviewer_acceptance_jobs queue + drain: reviewer Stage 2a accept returns fast, post-accept side effects run durably."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
related:
  - docs/REVIEWER_ENGAGEMENT_SPEC.md
  - docs/BILL_CHUNK_4_DESIGN.md
  - lib/db/migrations/009_submission_jobs.sql
  - pages/api/external/review/[token]/respond.js
  - shared/components/external/Stage2aView.js
---

# Reviewer Accept Fast Response Design

## Status: Shipped

This design is **built and live**. The sections below are retained as the design
of record; they describe the shipped architecture, with these deltas between the
original proposal and what landed:

- **Table name:** shipped as **`reviewer_acceptance_jobs`**
  (`lib/db/migrations/024_reviewer_acceptance_jobs.sql`), not the proposed
  `reviewer_accept_followup_jobs`. Shape and intent match the design.
- **Insert-before-PATCH (stricter variant) was chosen.** The job is enqueued as
  `accept_pending` *before* the accept PATCH, then marked `queued` after the PATCH
  succeeds; a 412 conflict cancels the staged job. This is the stricter option
  raised in "Recommended Design" / Open Question, and it closes the
  "accepted but no job" hole. See `lib/services/external-review/respond-service.js`
  (the `DRAIN CONTRACT` comment locks the `accept_pending → queued` handshake).
- **Durable drain worker:** `lib/services/reviewer-acceptance-drain.js`
  (`processReviewerAcceptanceJob`) runs honorarium capture, ORCID capture, board
  identity, contact name/title sync, email + affiliation mismatch alerts,
  once-only acceptance confirmation email, and quota check — idempotently, with
  lease tokens and per-step completion markers. Job store:
  `lib/services/reviewer-acceptance-job-service.js`. Cron entry:
  `pages/api/cron/drain-reviewer-acceptances.js`.
- **Client transition (optional part) NOT adopted.** `Stage2aView` still awaits a
  fresh `/context` after `/respond` (`pages/external/review/[token].js`
  `onResponseSubmitted`) rather than transitioning purely from the `/respond`
  JSON. This was labeled optional in "Client Transition"; the core latency win is
  realized server-side because the slow post-accept tail now runs in the drain, so
  the follow-up `/context` read is cheap.

## Audience

This is an implementation spec for Claude. It is intentionally conservative: make the reviewer-facing accept path fast, but do not lose data that currently exists only in the Stage 2a POST body.

## Problem

Reviewer Stage 2a accept can remain in the submitting state for roughly 20 seconds before the modal goes away. The accept intent is not the only work in that wait.

Current browser flow:

```text
Stage2aView submits POST /api/external/review/{token}/respond
respond.js validates and PATCHes the reviewer-suggestion accept state
respond.js awaits many non-fatal post-accept side effects
respond.js returns 200
Stage2aView awaits parent onAccepted()
ExternalReviewPage refetches /context
the accepted-pre-materials view renders
```

The user-visible wait is therefore the accept PATCH plus the post-accept tail plus a second context read.

## Verified Current State

- [VERIFIED via `shared/components/external/Stage2aView.js:238-260`] The client POSTs `action: 'accept'`, `contactEdits`, `honorariumOptOut`, optional `address`, `boardIdentity`, and `policyAcks` to `/respond`.
- [VERIFIED via `shared/components/external/Stage2aView.js:303-308`] After `/respond` succeeds, the client awaits `onAccepted()` before the Stage 2a component unblocks or unmounts.
- [VERIFIED via `pages/external/review/[token].js:95-102`] `onAccepted()` clears the local override and awaits a fresh `/context` fetch.
- [VERIFIED via `pages/api/external/review/[token]/context.js:56-57`] `/context` verifies the token and records token outcome before returning.
- [VERIFIED via `lib/external/verify-suggestion-token.js:127-131`] Token verification reads the suggestion row with expanded request and potential reviewer data from Dataverse.
- [VERIFIED via `pages/api/external/review/[token]/respond.js:514-524`] Fresh accept calls `applyStage2aResponse()` with the client's ETag before post-accept side effects.
- [VERIFIED via `lib/dataverse/adapters/reviewer-suggestion.js:1054-1091`] `applyStage2aResponse()` writes the core accept intent: policy acks, honorarium opt-out, `wmkf_accepted`, `wmkf_responsetype`, `wmkf_responsereceivedat`, and engagement-scoped contact edits.
- [VERIFIED via `pages/api/external/review/[token]/respond.js:553-640`] Non-opt-out accepts await honorarium contact/address capture and deferred-honorarium notifications before returning.
- [VERIFIED via `pages/api/external/review/[token]/respond.js:668-716`] The route then awaits ORCID capture, board identity capture, contact name/title sync, and email/affiliation mismatch alerts.
- [VERIFIED via `pages/api/external/review/[token]/respond.js:722-747`] Fresh accept awaits the reviewer acceptance confirmation email before returning.
- [VERIFIED via `pages/api/external/review/[token]/respond.js:755-766`] Fresh accept awaits the reviewer quota notification check before returning.
- [VERIFIED via `lib/services/dynamics-service.js:185-199`] The generic Dataverse write helper does not intentionally throttle writes; it only retries once for impersonation 403 fallback.
- [VERIFIED via `lib/services/dynamics-service.js:824-846`] `DynamicsService.updateRecord()` performs a direct PATCH through `_writeFetch()`.
- [VERIFIED via `lib/services/dynamics-service.js:1698-1714`] Dataverse fetches have a 30 second timeout, not an app-level queue or sleep.
- [VERIFIED via `lib/bill/onboard-reviewer-service.js:54-60` and `lib/bill/onboard-reviewer-service.js:430-445`] The BILL request-side patch helper has a small explicit retry backoff, but BILL onboarding is not wired for this current use case.

Conclusion: the likely latency source is serial awaited post-commit work plus the follow-up `/context` read, not a deliberate Dataverse write throttle around the accept intent.

## Data-Loss Analysis

Do not implement this by simply calling asynchronous work after `res.status(200).json(...)`. On serverless runtimes, post-response work can be frozen, killed, or silently abandoned. Fire-and-forget is not an acceptable persistence boundary.

Safe to return after:

- The core accept PATCH has succeeded.
- Any request-body values that cannot be reconstructed later have been durably captured somewhere.

Not safe to drop:

- `address` and `address.phone`: currently only arrive in the POST body and are later written to the CRM contact.
- `boardIdentity`: academic rank, primary department, and main institution are required at accept but currently written later to the potential reviewer person row.
- `contactEdits` details needed by downstream contact sync or mismatch checks if they are not already persisted on the suggestion row.
- Follow-up workflow obligations: acceptance confirmation email, quota check/PD notification, and mismatch alerts. These are not user-entered data loss, but missed side effects still need retry and staff visibility.

## Recommended Design

Create a durable post-accept follow-up queue, modeled after the intake `submission_jobs` pattern rather than an in-memory promise.

[VERIFIED via `lib/db/migrations/009_submission_jobs.sql:1-24`] The existing intake design stores a frozen payload snapshot in Postgres, returns quickly, and lets a cron drain advance the durable job with idempotency and retries. The reviewer accept follow-up should reuse that architectural shape.

### Synchronous Request Path

In `pages/api/external/review/[token]/respond.js`, keep all existing fail-closed validation before the accept write:

1. Rate limit, token verification, and token outcome recording.
2. Request body validation for `contactEdits`, address shape, policy acks, and board identity.
3. State-machine checks for withdrawn, materials-sent, review-received, accepted/declined transitions.
4. Active policy version lookup for fresh accept.
5. `applyStage2aResponse()` with the client `If-Match` header.

After the accept PATCH succeeds:

1. Insert or upsert one durable reviewer accept follow-up job.
2. Include every payload value the follow-up cannot safely reconstruct:
   - `suggestionId`
   - `requestId`
   - `potentialReviewerId`
   - original token-derived reviewer/request summary needed for email rendering, or enough IDs to re-read it
   - `contactEdits`
   - `honorariumOptOut`
   - `address`
   - `boardIdentity`
   - `policyVersionIds`
   - `acceptedAt`
   - `isAcceptRepeat`
3. Return `200` immediately with the existing shape:

```js
{
  ok: true,
  idempotent: isAcceptRepeat,
  engagementState: { view: 'accepted-pre-materials', accepted: true, declined: false },
  followupQueued: true
}
```

If the follow-up job insert fails, do not pretend the fast path is safe. Return `503` with a reviewer-friendly retry message, because otherwise address and board identity payloads may be lost. The accept PATCH has already landed, so this error is awkward; the implementation should log and alert loudly. A stricter variant is to insert the job before the accept PATCH, then mark it `accepted_committed` only after the PATCH succeeds. That avoids "accepted but no job" but requires stale-job cleanup.

### Client Transition

In `Stage2aView`, use the successful `/respond` JSON to transition immediately rather than requiring a fresh `/context` read before unmount.

Minimum client change:

- Let `onAccepted(json.engagementState)` update the parent state to `accepted-pre-materials`.
- Do not block the modal on `/context` for this transition.
- Optionally schedule a non-blocking `/context` refresh after the view changes if the page needs fresh server data.

At design time, the accepted-pre-materials view did not require the full Stage
2a context payload, so the POST response had enough state to remove the
submitting modal. As shipped, that optional client transition was not adopted
(see the status delta above), and the confirmation now consumes the additive
`programDirector` name/email from a fresh verified `/context` response. Any
future immediate transition must retain that refresh or carry the same
server-resolved contact without weakening the token boundary.

### Durable Follow-Up Worker

Add a small worker/drain path that processes queued post-accept jobs idempotently. This can be a Vercel cron route, a route invoked by an existing maintenance sweep, or a reusable service called by both.

Recommended table shape:

```sql
CREATE TABLE reviewer_accept_followup_jobs (
  id BIGSERIAL PRIMARY KEY,
  suggestion_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  potential_reviewer_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'queued',
  payload JSONB NOT NULL,
  completed_steps JSONB NOT NULL DEFAULT '{}'::jsonb,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_token TEXT,
  lease_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
```

Use an idempotency key like `accept-followup:{suggestionId}:{acceptedAtOrResponseReceivedAt}`. For repeat accepts, either reuse the existing active job or create a retry job only for missing follow-up work.

Suggested statuses:

- `queued`
- `contact_captured`
- `identity_captured`
- `notifications_sent`
- `completed`
- `failed`
- `cancelled`

Each step must be safe to run more than once. Store step completion in `completed_steps` so retry skips work that already landed.

### Follow-Up Step Mapping

Move these out of the blocking reviewer response path:

| Current work | Current location | Follow-up behavior |
|---|---|---|
| Honorarium contact ensure and address PATCH, with BILL still deferred | `respond.js` -> `ensureHonorariumOnboarding()` | Process from frozen `address` and reviewer IDs; never call BILL unless the existing env gates say it is enabled |
| ORCID self-report capture | `captureReviewerSelfReportedOrcid()` | Retry idempotently; conflict behavior remains unchanged |
| Board identity capture | `captureSelfReportedReviewerIdentity()` | Retry from frozen `boardIdentity`; alert if exhausted |
| Contact name/title sync | `syncReviewerNameTitle()` | Retry from persisted suggestion/contact data |
| Email mismatch alert | `alertReviewerEmailMismatch()` | Retry and dedupe via existing autoResolveKey |
| Affiliation mismatch alert | `alertReviewerAffiliationMismatch()` | Retry and dedupe via existing autoResolveKey |
| Acceptance confirmation email | `sendAcceptanceConfirmationEmail()` | Send once for fresh accept; add a durable sent marker or make the job step exactly-once |
| Reviewer quota check | `maybeNotifyQuotaReached()` | Run after accept commit; existing quota marker makes threshold notification idempotent |

## Implementation Invariants

| Invariant | Verification |
|---|---|
| A reviewer is not shown success until `wmkf_accepted` and `wmkf_responsetype=accepted` are persisted | Test `respond.js` still awaits `applyStage2aResponse()` before returning `ok:true` |
| Values that only exist in the POST body are durably captured before the fast response | Test the follow-up job payload contains `address`, `boardIdentity`, `contactEdits`, and IDs |
| No post-response fire-and-forget is required for correctness | Code review: no un-awaited promise is the only carrier of address/identity/email/quota work |
| Follow-up worker is idempotent | Retry the same job twice; second run skips completed steps and does not duplicate emails or alerts |
| Missing follow-up job is visible | Job insert failure returns non-2xx or emits a staff alert with enough IDs to repair |
| Client leaves submitting state without a blocking `/context` fetch | Browser/unit test: successful `/respond` response renders `accepted-pre-materials` immediately |
| `/context` remains authoritative on refresh | Manual/browser test: refreshing after accept still renders accepted state from Dataverse |
| BILL remains disabled/deferred unless existing env gates enable it | Unit test with current env posture confirms no BILL vendor/network calls |

## Tests

Add or update tests at the lowest useful layer:

1. `respond.js` accept route:
   - fresh accept writes the suggestion row, inserts a follow-up job with frozen payload, and returns `ok:true`.
   - job insert failure does not silently lose address/board identity.
   - repeat accept behavior remains idempotent.
   - 412 concurrent modification still returns 412 and does not enqueue follow-up work.
2. Follow-up worker/service:
   - processes a queued job through contact/address capture, identity capture, acceptance email, and quota check with mocked adapters.
   - retry after partial success skips completed steps.
   - persistent failure records `attempts`, `last_error`, and eventually alerts.
   - duplicate job/idempotency key does not duplicate email sends.
3. Client:
   - `Stage2aView` transitions after successful `/respond` without waiting for `/context`.
   - error responses still keep the form mounted and show the existing messages.
4. Browser E2E:
   - accept flow posts the right payload and the accept button/modal disappears promptly after the mocked `/respond` response.
   - refresh after accept still derives accepted state from `/context`.

## Gates

Because this adds durable Postgres state and a route/cron or worker, Claude must run the relevant gates for changed surfaces:

- `npm run check:docs-catalog`
- `npm run check:atlas` if Atlas or durable state docs are updated
- `npm run check:api-routes` if a new API/cron route is added
- targeted unit tests for `respond.js`, the follow-up store/worker, and `Stage2aView`
- targeted reviewer Playwright accept test if the client transition changes

Run each gate and its self-test sequentially when applicable, per `docs/CI_GATES_REFERENCE.md`.

## Build Notes For Claude

- Start with a read-first buildability gate. Confirm whether an existing queue abstraction can be reused before adding a new table.
- Do not trust plan prose as proof of built behavior; cite source lines before editing.
- Preserve the external token security boundary. Do not accept user/profile identity from the request body.
- Keep `applyStage2aResponse()` on the blocking path.
- Do not move address or board identity solely into an in-memory async callback.
- If implementing a new table, add a migration and update `lib/db/migrations-manifest.json`.
- If adding a new cron/API route, update `docs/API_ROUTE_SECURITY_MATRIX.md`.
- If changing durable state, reconcile `docs/APPLICATION_STATE_ATLAS.md` and the matching `docs/atlas/` page.
- Keep reviewer-facing copy simple: the reviewer should see that their acceptance is confirmed, not internal sync progress.

## Open Questions

1. Should `address` and `boardIdentity` also be persisted on the suggestion row as a permanent audit snapshot, or is the follow-up job payload enough until completion?
2. Should acceptance confirmation email get a Dataverse marker to enforce exactly-once sending across retries, or should the follow-up job's completed step be the only marker?
3. Should quota notification remain in the same follow-up job or run in a separate quota-specific worker?
4. What is the acceptable follow-up delay before staff should see an alert: first failure, retry exhaustion, or age-based SLA?
