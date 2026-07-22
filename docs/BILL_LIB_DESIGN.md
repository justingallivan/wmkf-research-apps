---
title: "`lib/bill.js` — Design (v3)"
domain: finance-honoraria
kind: spec
status: historical
summary: "Historical BILL API wrapper design retained as implementation history; automated BILL integration was tabled on 2026-07-12."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
related:
  - docs/BILL_HONORARIUM_INTEGRATION_DESIGN.md
  - lib/services/llm-client.js
  - lib/utils/safe-fetch.js
  - pages/api/webhooks/bill.js
---

# `lib/bill.js` — Design (v3)

> **Historical design.** Automated BILL API integration was tabled by the owner
> on 2026-07-12 and must not be revived without a new owner decision. Retain this
> document only as implementation history for the dormant code.

**Author:** Justin Gallivan
**Date:** 2026-05-25 (v3 — second Codex pre-impl review folded)
**Status:** Pre-impl design; ready for Codex final-pass review
**Scope:** Slice 1 of the reviewer-honorarium-onboarding build (per `docs/BILL_HONORARIUM_INTEGRATION_DESIGN.md`). Covers the BILL.com API wrapper + unit tests + a webhook **handler scaffold** (signature verify + dedup + structured log + 200 OK; **no Dataverse writes in this slice**). The webhook's Dataverse PATCH lands in a later slice once sandbox testing reveals the actual `vendor.updated` payload shape and we can spec a concrete correlator (`vendorId` → contact → honorarium). Deferring the PATCH is honest: writing it now would be guessing at the correlator. No portal extension in this slice either.

---

## Verified API facts (from BILL docs, 2026-05-25)

WebFetch of `developer.bill.com` (notably `developer.bill.com/llms.txt`) surfaced **several discrepancies vs. the original `BILL_integration_handoff.md`**:

| Topic | Handoff doc said | BILL docs say |
|---|---|---|
| Login field name | `userName` | `username` |
| Login field name | `orgId` | `organizationId` |
| devKey transport | header | **body** for `/v3/login`; header (`devKey`) for everything else |
| Network search key | email | **name** (`/v3/network?name=...&scope=BILL`); requires ≥3 char complete word |
| Network "EMAIL" invite type | a value of `networkType` | doesn't exist; `networkType` is `BILL` or `RPPS` only |
| Email-invitation to non-network-vendor | a documented path | **not visible in v3 reference** — open question Q1 (sandbox-time discovery, hard-gates the portal slice) |

**Auth model:**
- `POST /v3/login` — body: `{ devKey, username, password, organizationId }` → response includes `sessionId`
- Subsequent calls: headers `sessionId: <id>` AND `devKey: <key>`
- Session expires after 35 min of inactivity (BDC_1109)
- Login rate-limited at **200/hour per devKey** (much tighter than the 20K/hr general limit) — session caching is mandatory

**Vendor create — `POST /v3/vendors`:**
- Required: `name`, `address.{line1, city, zipOrPostalCode, country (ISO2)}`
- Optional: `email`, `phone`, payment info
- Success: 201, response `id` begins with `009` (the **BILL vendor ID** we write to `contact.wmkf_billcomid`)
- No documented idempotency / duplicate-detection

**Network search — `GET /v3/network`:**
- Query: `name` (req, ≥3 chars), `scope=BILL`, optional `zipOrPostalCode`
- Response: `{ results: [{ id, name, type, addresses, managedBy }] }`
- `results[].id` is the **Payment Network ID (PNI)**; verified vendors prefixed `0rv`. This is what we write to `wmkf_paymentnetworkidpni`
- Empty `results` array = no match (not 404)

**Connection invitation — `POST /v3/network/invitation/vendor/{vendorId}`:**
- Body: `{ networkId, networkType: "BILL" }`
- Sends a connection request to an **existing network member**
- 60-day expiry if no response

**Errors:**
- Non-2xx HTTP status; body is an array of `{ timestamp, code, severity, category, message, detail, help }`; codes prefixed `BDC_`
- **Rate-limit responses are 4xx with BDC codes in body, NOT HTTP 429** — `BDC_1144` (hourly quota, ~60-min reset) or `BDC_1322` (concurrent burst, ~seconds). Must parse body to detect.
- No standard `Retry-After` header

**Webhook:**
- Signature header: `x-bill-sha-signature`, HMAC-SHA256, base64-encoded
- Secret: per-subscription `securityKey`, rotatable via `POST /v3/subscriptions/{id}/security-key`
- `eventId` in payload metadata
- BILL retries failed deliveries with exponential backoff; subscription auto-disables after retry exhaustion
- No documented replay-protection; **we add our own**

---

## Interface

```js
// lib/bill.js exports:
//   createBillVendor(vendor)          → { vendorId, networkStatus? }
//   searchBillNetwork(q)              → { pni, networkId, type, exactMatchCount, allResults }
//   sendNetworkInvitation(vendorId, networkId) → void
//   verifyBillWebhook(rawBody, signatureHeader, secret) → boolean
//   BillError, BillAuthError, BillRateLimitError, BillValidationError, BillServerError  // exported classes
//
// Internal (not exported):
//   getOrCreateBillSession()          — session cache + refresh
//   BillSessionError                  — internal-only; caller never sees it (retried by the wrapper)
```

All functions that talk to BILL throw `BillError` subclasses on failure. None throw raw `Error`. None throw `BillSessionError` to callers — that class is internal-only (`@internal`) and is always caught by the in-wrapper retry path.

**Caller pattern at `/api/bill/onboard-reviewer` (later slice):**

```js
// 1. Read contact.wmkf_billcomid
//    • populated  → SOFT short-circuit: skip createBillVendor (reuse the id);
//                   STILL run search + invite + PNI write (state may have changed)
//    • empty      → createBillVendor → vendorId; PATCH contact.wmkf_billcomid
// 2. searchBillNetwork({ name: reviewer.fullName, zipOrPostalCode: reviewer.zip })
//    → { pni, networkId, exactMatchCount }
// 3. If exactMatchCount === 1 && zip disambiguator matched
//    → sendNetworkInvitation(vendorId, networkId); write wmkf_exisitngbillcomaccount=Yes; write PNI
//    Else → write wmkf_exisitngbillcomaccount=No; alert Steph (per Q1 sandbox finding)
```

The integration doc's failure-modes table is consistent with this: soft short-circuit — skip BILL vendor create only; still run network search + invite + PNI write because network state may have changed since last cycle. (Codex NEW-4 fix.)

---

## Session model

**Module-level cache** of one `{ sessionId, fetchedAt }`. Session is treated as valid for **30 minutes** from `fetchedAt` (5-minute safety margin under BILL's 35-min inactivity timeout).

**Cold-start serialization.** If two concurrent callers hit a cache miss, an in-flight `Promise` holds them — only one login round-trip is made. Same pattern as `dynamics-service.js:getAccessToken`.

**Failed-login-promise lifecycle (Codex Q1.1).** If the in-flight login promise rejects, the cache entry holding it MUST be cleared before the rejection propagates. Otherwise future callers await a forever-rejected promise until process recycle. Spec:

```
if cached.inFlightPromise exists: await it
else:
  cached.inFlightPromise = doLogin()
  try { result = await cached.inFlightPromise; cached.session = result; return result }
  catch (err) { throw err }
  finally { cached.inFlightPromise = null }   // clear regardless of outcome
```

**Mid-call session expiry.** On any 4xx with body code `BDC_1109`, the wrapper:
1. Invalidates session cache
2. Performs one fresh login
3. Retries the original request **once**
4. This reauth+retry is "free" — it doesn't consume from the general retry budget (Codex Q2.2). Hard-capped at 1 per call to prevent loops.

**Cross-instance trade-off (Codex Q1.2, P2).** Module-level cache coordinates within a single Vercel function instance. Concurrent cold-starts across multiple instances will each perform their own login. Cross-instance coordination would require Vercel KV or runtime-cache shared state — explicitly **not done** at our volume (~85 reviewers/cycle, each accept fires a single onboarding call; 200 logins/hr per devKey is comfortable headroom). Documented as a conscious trade-off, not an oversight.

---

## Retry policy

Errors are classified by parsing the response body (BILL puts BDC codes in the body, not in HTTP status):

| BDC code / shape | Category | Retryable? | Backoff |
|---|---|---|---|
| BDC_1109 | session_expired | yes (internal — 1 free reauth) | none — immediate retry after reauth |
| BDC_1101, BDC_1102 | auth | no | — (throw `BillAuthError`) |
| **BDC_1322** | rate_limited_concurrent | yes | exp backoff `2^attempt`s, max 3 attempts |
| **BDC_1144** | rate_limited_hourly | **no** | throw `BillRateLimitError` immediately (Codex Q2.1) — caller surfaces to alert; 14s exp backoff is useless against a 60-min reset window |
| HTTP 5xx (any) | server | yes | exp backoff, max 3 attempts |
| HTTP 4xx with parseable BdcError array (other) | client | no | throw `BillValidationError` |
| HTTP 4xx with **unparseable body** (Codex Q2.3) | unknown_client | no | log raw (truncated, redacted); throw `BillValidationError` |
| HTTP 5xx with **unparseable body** (Codex Q2.3) | unknown_server | yes | same exp-backoff budget as well-formed 5xx (max 3 attempts); throw `BillServerError` if still failing |
| HTTP 200 with **body matching error-array shape** (Codex NEW-7) | classify by code | follow the matching row above | rare; treat as the matching BDC category despite the 200 status |
| Network error / abort | transient | yes | exp backoff, max 2 attempts |

Max general-retry budget: **3** by default (configurable per-call). Worst-case latency at max retries ≈ 14s with `2^attempt` backoff. Acceptable since this runs in an accept-handler, not in UI hot-path.

**Login itself:** never retry on auth failure (no point). Retry on 5xx + `BDC_1322` (transient concurrent burst). **Never retry on `BDC_1144`** for login — that's the 200/hr login limit and we'd just burn requests. Login retries hard-capped at 1.

---

## Error model

```js
class BillError extends Error {
  constructor(message, { status, codes, response }) { ... }
  // status: HTTP status code (or null for network errors)
  // codes: array of BDC codes parsed from body (empty for non-API errors)
  // response: raw body excerpt (truncated to 500 chars, redacted)
}

class BillAuthError extends BillError {}        // BDC_1101/1102 — dev-key / creds wrong; alert humans
class BillRateLimitError extends BillError {}   // BDC_1144 hourly — caller decides defer/alert
class BillValidationError extends BillError {}  // 4xx-other — caller-fixable input issues
class BillServerError extends BillError {}      // 5xx — transient or BILL-side outage

/** @internal */
class BillSessionError extends BillError {}     // BDC_1109 — caught internally by wrapper, NEVER thrown to callers; not re-exported
```

`BillSessionError` is intentionally **not** re-exported; it's a private signal between the request shim and the retry loop. Callers handle only the four public subclasses (Codex Q3.2).

**Codex Q3.1 fix:** any prior interface comment referencing `BillApiError` is a typo for `BillError`. The implementation will not introduce a `BillApiError` class.

---

## Network safety (Codex Q6.3)

Mirrors the canonical wrapper pattern from `lib/services/llm-client.js`:

- **SSRF allowlist** via `lib/utils/safe-fetch.js`. The allowlist in that helper is **extended in this slice** to add two new hosts:
  - `gateway.bill.com` (prod)
  - `gateway.stage.bill.com` (sandbox)

  Any other host throws before the request. Defends against a misconfigured `BILL_BASE_URL` env var being pointed at an arbitrary URL. (Adding the hosts to the helper is in the slice file list below.)

- **AbortController-bound timeout.** Default **30 seconds per call** (configurable). The timeout cancels the underlying socket, not just the Promise — matching `llm-client.js`'s pattern (the `multi-llm-service.js` Promise.race anti-pattern is explicitly avoided).

- **Combined external + internal abort.** If the caller passes an `AbortSignal`, it composes with our internal timeout via `AbortSignal.any([external, internal])`. Either firing aborts the underlying fetch.

---

## Redaction

Every thrown error and every log line passes through a `redact()` helper that strips:
- `devKey` (header and body forms; JSON field value; URL query)
- `password` (JSON body field value)
- `sessionId` (header value; JSON body field value; URL query)
- Token-shape defensive sweep — any string ≥ 32 chars from the alphabet `[A-Za-z0-9_\-+/.=]` is replaced with `[redacted-token]`. Alphabet includes `.` (JWT segment separator) and `+`/`/`/`=` (standard base64). See Known limitations for the over-redaction tradeoff on long benign identifiers.

Pattern mirrors `lib/services/llm-client.js`'s `redactError` shape. Redaction also applies to the `response` field on thrown `BillError`s (the truncated body excerpt).

---

## Open questions (sandbox-time discovery)

**Q1 [HARD-GATES PORTAL SLICE, NOT THIS SLICE].** How are non-network reviewers onboarded?
The v3 API has no documented "email this person to join the network" endpoint; `networkType` is `BILL` or `RPPS` only; the `network/invitation/vendor/{vendorId}` endpoint requires the target to already be a network member. Two hypotheses for sandbox testing:

- (a) `POST /v3/vendors` with `email` populated triggers BILL to auto-email the vendor for onboarding (their side, our outreach is implicit)
- (b) Non-network onboarding requires a separate operator-side action in BILL's web UI — meaning our integration cannot deliver true "no separate trip"

**Why this hard-gates the portal slice but not this slice.** `lib/bill.js` is just an API wrapper — the same functions work whichever hypothesis is true. The portal slice's accept-handler logic (and the integration doc's promise of "no manual staff step") depends on the answer:

- If (a): portal flow is complete as designed
- If (b): portal flow must either route to an alternative onboarding path OR explicitly fall back to "alert Steph for manual outreach" — and the integration doc's UX promise needs revision

**Sandbox test, day 1:** create a fresh test vendor with `email` populated for an email address we control; observe whether BILL sends an onboarding email. Document the answer. Update integration doc accordingly.

**Q2. Name-based search false positives.**
Names like "John Smith" return many BILL network matches. The `searchBillNetwork` interface returns `exactMatchCount + allResults` so the caller's auto-connect policy can be conservative. **Default policy: auto-connect only when `exactMatchCount === 1` AND the zip disambiguator matched.** Multi-match or zip-mismatch ⇒ no auto-connect, defer to BILL's own outreach + alert Steph.

**Q3. Webhook subscription mechanism.**
`POST /v3/subscriptions` creates a subscription with a one-time `securityKey`. Operator-side provisioning step in sandbox + prod, parallel to env-var setup. The webhook handler we ship just verifies signatures using `process.env.BILL_WEBHOOK_SECRET`.

**Q4. Idempotency on vendor create.**
No documented idempotency key. Caller-side short-circuit (read `contact.wmkf_billcomid` first) prevents the common case. Sandbox-test reveals what duplicate POSTs actually do (return existing, 409, create duplicate?). If duplicates create duplicate rows, we add a small Postgres idempotency table later.

---

## Test surface (slice 2 — unit tests)

Mocked endpoints; no live BILL calls. Mock layer is a `mockFetch` injection per `llm-client.js` test pattern.

- `login` happy path → returns sessionId
- `login` BDC_1101 → BillAuthError, no retry
- `login` BDC_1322 → one retry, then success or BillRateLimitError
- `login` BDC_1144 → BillRateLimitError immediately, no retry (per revised policy)
- `login` 5xx → exp-backoff retry up to cap
- **`login` rejection clears in-flight promise** → second cold-start call after rejection performs a fresh login attempt, not awaits the stale rejection
- `createBillVendor` happy path → returns id starting `009`
- `createBillVendor` validation 4xx → BillValidationError
- `createBillVendor` after session expiry → auto-reauths + retries once (BDC_1109 → fresh login → original call succeeds)
- `createBillVendor` malformed 4xx body (HTML page) → BillValidationError, no retry
- `createBillVendor` malformed 5xx body → exp-backoff retried (max 3 attempts, same budget as well-formed 5xx) → BillServerError if still failing
- `createBillVendor` HTTP 200 with error-array-shaped body → classified per BDC code (e.g., body carries BDC_1101 → BillAuthError)
- `searchBillNetwork` zero results → `{ pni: null, exactMatchCount: 0 }`
- `searchBillNetwork` one result → returns PNI + networkId + type
- `searchBillNetwork` multi-result → `exactMatchCount > 1, allResults populated`
- `sendNetworkInvitation` happy path → resolves void
- `sendNetworkInvitation` 4xx → BillValidationError
- Session cache: two concurrent calls trigger only one login
- Session cache: third call > 30 min after first triggers fresh login
- SSRF guard: a `BILL_BASE_URL` outside the allowlist throws synchronously before fetch
- Abort: external AbortSignal aborts the underlying fetch (verified via mock that observes its `signal`)
- Abort: internal timeout fires when fetch hangs past 30s (test uses fake timers)
- `verifyBillWebhook` valid signature → true
- `verifyBillWebhook` wrong signature → false
- `verifyBillWebhook` signature comparison uses `crypto.timingSafeEqual` (not `===`)
- `verifyBillWebhook` malformed signature header → false (not throw)
- `redact()` strips devKey/password/sessionId from error messages
- `redact()` strips token-looking long strings

---

## Webhook handler (`pages/api/webhooks/bill.js`)

Allowlisted in `proxy.js` (signature-authenticated, not session-JWT).

**Flow:**
1. Read **raw body** (via `getRawBody` helper or `req.body` with bodyParser disabled — pre-parse bytes required for HMAC)
2. Read `x-bill-sha-signature` header
3. `verifyBillWebhook(rawBody, signature, process.env.BILL_WEBHOOK_SECRET)` → 401 if mismatch
4. Parse body as JSON
5. Read `eventId` from payload metadata
6. **Dedup gate (Codex Q4.1/4.2/4.3):** `INSERT INTO bill_webhook_events (subscription_id, event_id, received_at) VALUES (...) ON CONFLICT (subscription_id, event_id) DO NOTHING RETURNING id`. If no row returned ⇒ duplicate ⇒ 200 OK, no further processing. Compound key is `(subscription_id, event_id)` so we don't assume `event_id` is globally unique across subscriptions.
7. **Structured log** of every received event — by default logs only `subscriptionId`, `eventId`, `eventType`, and the top-level payload key list. To capture a redacted payload sample for sandbox-time payload-shape discovery, set env `BILL_WEBHOOK_DEBUG=true`; a 1000-char `redactString`-redacted sample is appended to the log line. The debug gate is intentionally not on by default in any environment, because (a) BILL webhooks carry vendor PII (names, emails, addresses) that `redactString` does NOT strip, and (b) BILL secrets like the security key only flow into the verify path, not the payload
8. Returns 200

**No event-type dispatch and no Dataverse writes in this slice.** The handler exists so that:
- BILL has a valid endpoint that returns 200, so the subscription doesn't auto-disable during sandbox setup
- We capture real `vendor.updated` payload shapes for correlator design
- Signature verification + dedup + auth gates are in place from day one

The follow-up slice (after sandbox payload observation) adds event-type dispatch and the `vendor.updated` → honorarium PATCH. By that point we'll know whether the payload carries `vendorId` (then reverse-lookup `contact.wmkf_billcomid` → most-recent honorarium for that contact) or some other correlator entirely.

**Signature verification (Codex Q6.2 + NEW-5).** Mirrors the IRS-verify `constantTimeEqual` pattern at `pages/api/irs/verify-ein.js:54-66` — pad both buffers to the max length before `timingSafeEqual` (which throws on length-mismatch), then check original lengths matched. Padding-then-length-check prevents both `timingSafeEqual`'s mismatch-throw AND a length-leak timing oracle:

```js
function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  const len = Math.max(aBuf.length, bBuf.length);
  const aPad = Buffer.alloc(len);
  const bPad = Buffer.alloc(len);
  aBuf.copy(aPad);
  bBuf.copy(bPad);
  return crypto.timingSafeEqual(aPad, bPad) && aBuf.length === bBuf.length;
}

function verifyBillWebhook(rawBody, signatureHeader, secret) {
  if (!secret || !signatureHeader) return false;
  const computed = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  return constantTimeEqual(computed, signatureHeader);
}
```

**Endpoint auth + method failure modes (Codex NEW-6).** Mirrors IRS endpoint:
- Non-POST → `405 { error: 'Method not allowed' }`
- Missing `BILL_WEBHOOK_SECRET` in production (`NODE_ENV !== 'development'`) → log + `500 { error: 'Webhook secret not configured' }`. Fails closed.
- Development bypass for the missing-secret path is acceptable for local testing (same convention as the cron auth helper)

**Dedup table schema (Codex Q4.1/4.2/4.3):**
```sql
CREATE TABLE bill_webhook_events (
  id SERIAL PRIMARY KEY,
  subscription_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (subscription_id, event_id)
);
CREATE INDEX bill_webhook_events_received_at_idx ON bill_webhook_events (received_at);
```

**TTL:** 7 days. A daily maintenance step (added to the existing maintenance cron) deletes rows where `received_at < NOW() - INTERVAL '7 days'`. 7 days comfortably exceeds any plausible BILL retry horizon (which the docs leave unspecified but is bounded by their auto-disable-on-exhaustion policy).

---

## Files in this slice

- `lib/bill/index.js` (~250 LOC) — public surface (`createBillVendor`, `searchBillNetwork`, `sendNetworkInvitation`, `verifyBillWebhook`)
- `lib/bill/session.js` (~80 LOC) — session cache + cold-start serialization
- `lib/bill/errors.js` (~60 LOC) — error class hierarchy
- `lib/bill/classify.js` (~60 LOC) — error body classification (BDC code → category)
- `lib/bill/redact.js` (~30 LOC) — borrowed pattern from llm-client
- `lib/utils/safe-fetch.js` — small edit to add `gateway.bill.com` + `gateway.stage.bill.com` to the SSRF allowlist
- `tests/unit/bill.test.js` (~350 LOC) — covers all cases listed above
- `tests/unit/safe-fetch.test.js` — extend if it exists, to verify the new BILL hosts pass and an arbitrary host fails
- `pages/api/webhooks/bill.js` (~120 LOC) — handler with timingSafeEqual + dedup gate
- `tests/unit/webhook-bill.test.js` (~150 LOC)
- `lib/db/migrations/0014_bill_webhook_events.sql` — dedup table
- This design doc

**In-scope Dataverse writes:** **none.** The webhook PATCH is deferred to the next slice once the `vendor.updated` payload shape is known from sandbox.

**Out of scope for this slice:** `/api/bill/onboard-reviewer`, portal extension, Stage 2a UI changes, Connor's Q5 schema add wait, webhook→Dataverse PATCH. Those land in subsequent slices when their dependencies clear.

---

## v2 changelog (folded Codex pre-impl review)

P1 catches folded:
- Q1.1 — failed-login-promise clearing spec added (Session model section)
- Q2.1 — BDC_1144 (hourly) now fails loud instead of futile-retry; BDC_1322 (concurrent) retains exp backoff
- Q4.1 — dedup key compounded to `(subscription_id, event_id)`
- Q4.2 — concrete 7-day TTL specified
- Q4.3 — `UNIQUE` constraint + `ON CONFLICT DO NOTHING RETURNING id` for atomic check-insert
- Q5.1 — sandbox-deferral language tightened; Q1 explicitly marked as HARD-GATE for portal slice (not this slice)
- Q6.1 — scope contradiction removed (v2 stated webhook DOES write to Dataverse; v3 subsequently deferred that write per NEW-3 — see v3 changelog below)
- Q6.2 — `crypto.timingSafeEqual` signature comparison spec added
- Q6.3 — SSRF allowlist + AbortController-bound timeout section added (Network safety)

P2 catches folded:
- Q1.2 — cross-instance Vercel trade-off now an explicit conscious choice
- Q2.2 — session-expiry reauth budget rule specified (1 free reauth per call, doesn't consume general retry budget)
- Q2.3 — malformed/non-array error body classification added
- Q3.1 — `BillApiError` typo → confirmed `BillError`
- Q3.2 — `BillSessionError` marked `@internal`, not re-exported
- Q5.2 — handoff doc EMAIL contradiction surfaced more loudly in Q1

The integration doc (`docs/BILL_HONORARIUM_INTEGRATION_DESIGN.md`) is being reconciled separately for Q6.4 (stale email-search references) in the same pass.

## Known limitations (post-impl, deliberate deferral)

- **Backoff sleeps are not abort-aware.** If a caller aborts during a retry backoff, the wrapper still waits out the sleep before honoring the abort. Worst-case wasted wall-clock: ~14 seconds (sum of `2 + 4 + 8`). Fix would require a custom abort-aware `sleep` + listener management; deferred because the volume + abort path is low-stakes (the webhook handler doesn't abort; the only abort path is a caller-passed `signal` on lib/bill functions, set later by the portal-extension slice). Documented per Codex post-impl review §2.

- **Defensive token-sweep redaction is noisy.** `lib/bill/redact.js` includes a length-32+ token-shape sweep (`/[A-Za-z0-9_\-+/.=]{32,}/g`) intended to defensively catch JWT/base64/long-token secrets even when their structural pattern doesn't match the named-field rules above it. Side-effect: long benign identifiers (dehyphenated Dataverse GUIDs, 32+ char request IDs, etc.) will also be redacted as `[redacted-token]` in log output. Accepted tradeoff — better noisy than leaky. If log readability becomes a real friction, tighten the regex to require token-shaped entropy markers (mixed-case + digits within the same span) rather than just length. Documented per Codex post-impl re-review.

## v3 changelog (folded second-round Codex review)

Verifying the v2 folds + addressing 3 P1 and 4 P2 net-new issues:

- Q2.3 (NEW-1) — malformed 5xx now explicitly gets the same 3-attempt exp-backoff budget as well-formed 5xx; malformed 4xx still no-retry; reconciled retry table and test surface
- Q6.3 (NEW-2) — `lib/utils/safe-fetch.js` allowlist update added to slice file list with the two BILL hosts spelled out; matching test
- NEW-3 — webhook PATCH **deferred to next slice**; this slice ships handler scaffold (verify + dedup + structured log + 200 OK) and zero Dataverse writes. Sandbox-observed payload shape then drives the correlator design
- NEW-4 — returning-reviewer policy pinned to **soft short-circuit** (skip vendor create, still run search + invite + PNI write). Integration doc failure-modes table + flow diagram updated to match
- NEW-5 — signature verification now mirrors `pages/api/irs/verify-ein.js:54-66` (pad both buffers to max length, `timingSafeEqual`, then check original lengths matched — prevents both the throw-on-mismatch and the length-leak)
- NEW-6 — webhook endpoint auth/method failure modes spec'd: 405 for non-POST, fail-closed 500 for missing secret in production, dev bypass acceptable
- NEW-7 — HTTP 200-with-error-array-shaped-body classified per BDC code (rare but defensive)
