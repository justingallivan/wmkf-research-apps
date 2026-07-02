---
title: "Reviewer / BILL deep-pass hardening findings — 2026-05-29"
domain: reviewer-workbench
kind: audit
status: historical
summary: "- contactEdits validation (was P3): respond.js now bounds each field's length + checks email shape, returning a clean 400 instead of a Dataverse 500."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
related:
  - "pages/api/external/review/[token]/respond.js"
  - lib/bill/onboard-reviewer-service.js
  - lib/external/rate-limit.js
  - lib/bill/internal-call-auth.js
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

## Hardening design (S198 prep — implement at chunk-4)

**Verified API fact (2026-05-29):** BILL's v3 `POST /v3/vendors` (`createVendor`)
does **not** accept an idempotency-key header — its only documented headers are
`sessionId` + `devKey`. The `X-Idempotent-Key` (UUID4) header exists in BILL v3
but is scoped to newer endpoints (e.g. `/v3/spend/subscriptions`), not vendor
create. Sources: BILL "Create a vendor" reference
(https://developer.bill.com/reference/createvendor) and the v3 idempotency note
surfaced via developer.bill.com search. **So a Stripe-style idempotency key on
the create call is NOT an option** — the design must make the create idempotent
*around* the unguarded call.

### Fix #1/#2 — duplicate vendor on retry
Root cause: the field that records "a vendor already exists" (`contact.wmkf_billcomid`,
written in step 3) is downstream of the create (step 2) and may fail-and-continue,
so the pre-read guard misses it on retry.

1. **Persist `vendorId` to a durable store the moment `createBillVendor` returns,
   BEFORE the contact PATCH.** Natural home: a field on the honorarium
   `akoya_request` (the unit chunk-4 creates) or a small Postgres staging row keyed
   by `honorariumRequestId`. The pre-read idempotency guard then checks *that*
   store first, so a failed contact PATCH no longer causes a duplicate on the next
   invocation. (Reorder: create → persist vendorId → contact PATCH → … .)
2. **Best-effort pre-create lookup** as a backstop for the lost-response case
   (create succeeded on BILL but the HTTP response never arrived, so we never got
   the vendorId to persist): query BILL vendors by name+email before creating.
   *Residual:* BILL vendor matching is fuzzy, so this can't fully close the
   lost-response window — document it as a known, low-probability gap rather than
   claiming idempotency is airtight.

### Fix #3 — torn cross-system state
True 2-phase atomicity is impossible across BILL + Dynamics. Pattern: idempotent
steps + a durable resume marker.
1. **Retry `patchAkoyaRequestSuccess` / `patchAkoyaRequestNoMatch` with backoff**
   (today: success path 0 retries, no-match path 0 retries) so a transient
   Dynamics blip stops tearing.
2. **Write a durable "BILL-onboarded, Dynamics-pending" marker + the PNI** on the
   request when the BILL side succeeded but the Dynamics PATCH failed, so a
   sweep/retry can resume and complete the PATCH idempotently instead of relying
   on an alert + manual ops.

### Sequencing note
The clean implementation traces chunk-4's actual retry trigger (create honorarium
`akoya_request` → PATCH junction `wmkf_HonorariumRequest` → call onboard) and
builds idempotent-create + resume-marker into that wiring, rather than patching
the service in isolation now.

## OPEN — lower severity (consider with the chunk-4 / reviewer-hardening pass)
- **P2** no-match request PATCH has no retry (`:179`, `patchAkoyaRequestNoMatch`).
- **P2** `notify()` failures are swallowed to console with no escalation fallback
  (`safeNotify`, `:362-373`).
- **P3** contact PATCH: 1 retry, no backoff; request PATCH: 0 retries.
- **P3** option-set assert + Dynamics pre-read early-exit both fail *closed* (correct,
  but a transient Dynamics blip fails the whole onboarding — acceptable).
- **P3** BILL error responses include `vendorId`/`pni` in the body (not secrets, but
  unnecessary exposure if the caller logs the response).
