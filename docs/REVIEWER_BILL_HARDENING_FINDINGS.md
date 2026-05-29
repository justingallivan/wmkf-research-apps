---
fact_consistency: point-in-time
---
# Reviewer / BILL deep-pass hardening findings — 2026-05-29

Output of the S198 "likely under-covered" deep read of the external-reviewer
state machine (`pages/api/external/review/[token]/respond.js`) and the BILL
honorarium onboarding (`lib/bill/onboard-reviewer-service.js`). Two read-only
`Explore` agents produced findings; each was then verified against the actual
code (Explore agents read excerpts and over-claim, so treat unverified items
skeptically). **Severity is the verified severity, not the agent's.**

## Shipped this session (commit pending)
- **Optimistic locking wired end-to-end** (was P1 "dead code"): `context.js` now
  returns `suggestion._etag`; `Stage2aView`/`DeclineFormView` round-trip it as an
  `If-Match` header; `respond.js`'s existing 412 handling now actually fires. This
  also closes the practical TOCTOU in the state-machine guard (a concurrent staff
  edit between page-load and submit now 412s instead of clobbering).
- **`contactEdits` validation** (was P3): `respond.js` now bounds each field's
  length + checks email shape, returning a clean 400 instead of a Dataverse 500.

## Verified FALSE POSITIVES (no action — agent mischaracterized)
- **"PII leak in BILL alert metadata"**: `notifyAlertOnly` is the *BILL-disabled,
  ops-must-onboard-manually* alert — ops **needs** the reviewer name/email/phone/
  address to do the manual onboarding. Title is redacted (preview surface); the
  metadata detail is intentional and necessary. Internal-admin recipients only.
- **"Webhook dedup race"**: the agent self-corrected — `INSERT … ON CONFLICT DO
  NOTHING RETURNING` is atomic in Postgres; duplicate webhooks are correctly dropped.

## Deliberate tradeoffs (documented in-code; leave unless posture changes)
- **Rate limit fails open** on a Postgres fault (`lib/external/rate-limit.js`) — a
  documented "never lock out a legitimate reviewer on infra fault" choice that
  raises an alert on sustained failure.
- **HMAC replay window = ±300s, no nonce store** (`lib/bill/internal-call-auth.js`)
  — the skew window *is* the replay defense (Vercel instances don't share memory).
  Could tighten to 60s if desired; not a bug.

## OPEN — BILL P1s, deferred to the chunk-4 build (flow is pre-launch; reviewers ≥ 2026-06-17)
These are real, money-adjacent, and CONFIRMED in code. They are deferred (not
ignored) because the BILL honorarium flow is not yet live and the chunk-4 build
(`wmkf_honorariumrequest` wiring) is the right place to fix them with the actual
retry triggers traced. **Do not close without addressing these.**

1. **Duplicate vendor on retry** — `onboard-reviewer-service.js:104-123`. The
   contact PATCH (`wmkf_billcomid`) is the *sole* idempotency primitive; on its
   failure (after 1 retry) the flow continues with only a warning. A re-invocation's
   pre-read then sees an empty `wmkf_billcomid` and **creates a second BILL vendor**.
   *Fix options:* a BILL-side idempotency key, or a pre-create existence query by
   name+email, or persist the vendorId before the contact PATCH.
2. **No idempotency guard on vendor create beyond the contact pre-read**
   (`lib/bill/index.js` createBillVendor + `:71-88`). Same root cause as #1.
3. **Torn cross-system state** — `onboard-reviewer-service.js:140-169`. BILL invite
   succeeds, then the `akoya_request` PATCH (`wmkf_paymentnetworkidpni` +
   `wmkf_exisitngbillcomaccount`) fails with **no retry**: invite sent but unrecorded.
   `status:'partial'` is surfaced, but there's no auto-reconcile marker.

## OPEN — lower severity (consider with the chunk-4 / reviewer-hardening pass)
- **P2** no-match request PATCH has no retry (`:179`, `patchAkoyaRequestNoMatch`).
- **P2** `notify()` failures are swallowed to console with no escalation fallback
  (`safeNotify`, `:362-373`).
- **P3** contact PATCH: 1 retry, no backoff; request PATCH: 0 retries.
- **P3** option-set assert + Dynamics pre-read early-exit both fail *closed* (correct,
  but a transient Dynamics blip fails the whole onboarding — acceptable).
- **P3** BILL error responses include `vendorId`/`pni` in the body (not secrets, but
  unnecessary exposure if the caller logs the response).
