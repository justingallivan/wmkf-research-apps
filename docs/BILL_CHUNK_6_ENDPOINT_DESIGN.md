# BILL Chunk 6 Design — `/api/bill/onboard-reviewer` Endpoint

**Status:** draft for pre-impl Codex review
**Parent:** `docs/BILL_HONORARIUM_INTEGRATION_DESIGN.md` (the umbrella plan)
**Sibling shipped chunks:** 2-3 (`lib/bill/`), 7a (`pages/api/webhooks/bill.js` scaffold)
**Sibling pending chunks:** 4 (extend `respond.js` accept path — blocked on Connor's `wmkf_HonorariumRequest` junction lookup), 5 (Stage 2a UI address inputs)
**Target ready:** 2026-06-10. First reviewer invitations ≥ 2026-06-17.

## Scope

Build the standalone HTTP endpoint that turns "we just created an honorarium `akoya_request`" into "BILL vendor exists, network search ran, invitation sent if matched, Dataverse fields written back." Chunk 6 ships the **endpoint + a service module** that wraps the `lib/bill/` primitives + Dataverse writes. Chunk 4 wires it up at the respond.js call site once the junction lookup field exists.

Explicit non-goals:
- Not creating the honorarium row (chunk 4)
- Not PATCHing `wmkf_potentialreviewer.wmkf_HonorariumRequest` (chunk 4)
- Not changing the Stage 2a UI (chunk 5)
- Not implementing the webhook event-dispatch / Dataverse PATCH for `vendor.updated` → "Recently Confirmed" (chunk 7b)
- Not building a queue / retry job (parent doc deliberately omits this)

## Endpoint contract

`POST /api/bill/onboard-reviewer`

### Request body
```ts
{
  // Provenance (must be present, validated as GUIDs)
  honorariumRequestId: string,    // akoya_request just created by respond.js
  reviewerContactId: string,      // contact whose wmkf_billcomid we may write

  // Vendor inputs (already on the contact in Dataverse, but caller passes them
  // explicitly so this endpoint doesn't have to re-read contact)
  reviewerName: string,           // full name, 1-100 chars
  reviewerEmail?: string,
  reviewerPhone?: string,
  address: {
    line1: string,
    city: string,
    state?: string,
    zipOrPostalCode: string,
    country: string,              // ISO2
  },

  // (Removed per Codex P2 #5 — endpoint reads contact.wmkf_billcomid live.
  // A caller hint that wasn't reused for idempotency was ceremony with no
  // defined effect.)
}
```

### Response
Always 200 on auth+validation success. Outcome lives in the body.
```ts
{
  ok: boolean,
  status: 'onboarded' | 'reused_existing' | 'no_match' | 'alert_only'
        | 'bill_unavailable' | 'partial',
  vendorId?: string,
  pni?: string,                   // BILL network payment id, if matched
  exactMatchCount?: number,       // 0, 1, or N — N implies we did NOT invite
  warnings?: string[],            // non-fatal Dataverse PATCH failures, etc.
  error?: { code: string, message: string },  // present iff !ok
}
```

Status codes:
- `onboarded` — net-new vendor created, network match found, invitation sent, all Dataverse fields written
- `reused_existing` — contact.wmkf_billcomid already populated; skipped vendor-create; ran search+invite+writeback
- `no_match` — vendor created (or reused), network search returned **0** results; `wmkf_exisitngbillcomaccount = "No"` written; no invitation sent
- `ambiguous_match` — vendor created (or reused), network search returned **≥2** results; `wmkf_exisitngbillcomaccount = "No"` written; no invitation sent; **warning alert emitted with redacted summary of all results so Steph can confirm by hand** (per umbrella plan failure-modes table)
- `alert_only` — `BILL_ENABLED=false` fallback mode: skipped all BILL calls, emailed ops with manual-onboarding payload
- `bill_unavailable` — BILL returned auth / rate-limit / 5xx; honorarium row stands, alert was emitted. Body's `error.phase` indicates **which** phase failed (`vendor_create` / `network_search` / `network_invite`) so the alert and caller can reason about whether contact.wmkf_billcomid was already written.
- `partial` — BILL side completed but at least one Dataverse PATCH failed; alert was emitted with which writes succeeded

Non-200 responses are limited to:
- 401 — internal-call auth failed
- 400 — body validation failed
- 500 — unhandled exception (alert emitted)

### Auth

Internal-call HMAC over a canonical signing string with timestamp-skew check (no nonce store — module memory is per-Vercel-instance and can't guarantee cross-instance replay prevention; per Codex Q3, timestamp ±5min is the right tradeoff for inline same-origin).

**Env var:** `BILL_INTEGRATION_SECRET` (matches the already-tracked `bill_integration_secret` forward declaration in `lib/utils/tracked-secrets.js:54-55`). ≥32 chars, distinct from `BILL_WEBHOOK_SECRET` and `CRON_SECRET`.

**Signing string** (Codex P1 #1 — explicit canonical form):
```
v1:${timestamp}:${nonce}:${rawBodyBytes}
```

- `timestamp` — Unix seconds, sent in `x-bill-timestamp` header. Endpoint rejects if `|now - timestamp| > 300` (5 min).
- `nonce` — random UUID per call, sent in `x-bill-nonce`. Included in the signature payload to make replay within the skew window cost an attacker observable headers (we don't store nonces server-side; the timestamp window is the actual replay defense).
- `rawBodyBytes` — exactly the bytes the endpoint hashes before JSON parsing.
- Signature header: `x-bill-internal-sig`, base64 HMAC-SHA256.

**Raw-body handling** (Codex P1 #1):
- `export const config = { api: { bodyParser: false } }` on the route, same pattern as `pages/api/webhooks/bill.js`.
- Read the raw body via the standard Next/stream helper, verify the HMAC against `rawBodyBytes`, **then** `JSON.parse` for business logic.

**Constant-time compare:** reuse the `constantTimeEqual` shape from `lib/bill/index.js:285-297` (pad-to-longest, then check original lengths). Don't reuse `verifyBillWebhook` directly — that's for BILL→us; this is us→us with a different signing-string format.

**Why not session-auth or NextAuth?** The caller is respond.js, which is itself token-auth (HMAC reviewer JWT), not session-auth. No staff session exists. Internal HMAC is the right primitive.

**Why not CRON_SECRET-style bearer?** `cron-auth.js:35-39` uses plain bearer equality, which leaks the secret over any logging/tracing layer that captures headers. HMAC-of-body has no secret in transit.

**Why not skip the HTTP hop entirely and call a service function?** Considered. Reasons to keep the HTTP boundary:
1. Independent fn timeout (BILL can be slow; respond.js shouldn't inherit that)
2. Independent error surface — if BILL fails, the respond.js accept already succeeded; the BILL endpoint can alert and return without poisoning the upstream
3. Operator can `curl` to re-run for a single honorarium after a sandbox outage
4. Parent design doc commits to this shape

## Behavior — per status path

### 1. Net-new vendor (most common)

```
1. Validate body + internal-sig
2. Re-read contact(reviewerContactId) — fetch wmkf_billcomid, akoya_isvendor
3. wmkf_billcomid is empty → call createBillVendor(...)
4. PATCH contact:
   - wmkf_billcomid = vendorId
   - akoya_isvendor = true   (per Connor 2026-05-26 Q1)
5. Call searchBillNetwork({ name, zipOrPostalCode })
6. exactMatchCount === 1 →
   - call sendNetworkInvitation(vendorId, networkId)
   - PATCH akoya_request(honorariumRequestId):
     - wmkf_paymentnetworkidpni = pni
     - wmkf_exisitngbillcomaccount = "Yes"  (option-set value resolved at startup)
   - return status: 'onboarded'
7. else → PATCH akoya_request(honorariumRequestId):
   - wmkf_exisitngbillcomaccount = "No"
   - return status: 'no_match'
```

### 2. Returning reviewer (wmkf_billcomid already populated)

Re-read contact, see wmkf_billcomid is populated. Skip step 3+4. Otherwise identical (search + invite + writeback). Return `status: 'reused_existing'`.

### 3. Alert-only fallback (`BILL_ENABLED=false`)

```
1. Validate body + internal-sig
2. NotificationService.notify({
     type: 'bill_manual_onboarding',
     severity: 'warning',
     emailAdmins: true,
     category: 'spend',  // routes to ops; falls back to superusers
     title: `Manual BILL onboarding needed: ${reviewerName}`,
     message: 'BILL integration is disabled; ops must onboard this reviewer manually.',
     metadata: { honorariumRequestId, reviewerContactId, reviewerName, address, email, phone },
   })
3. return status: 'alert_only'
```

This is the documented fallback for "sandbox not ready by ~June 7." Lets us ship chunk 6 + 4 + 5 without waiting on Steph's sandbox.

### 4. BILL unavailable — phase-specific (Codex P1 #3)

The happy path writes `contact.wmkf_billcomid` between `createBillVendor` and `searchBillNetwork`, so failure handling must track which phase blew up. Three phase tags:

| Phase tag                    | When                                  | Dataverse state at this point                                       |
|------------------------------|---------------------------------------|---------------------------------------------------------------------|
| `vendor_create`              | `createBillVendor` throws             | No writes yet                                                       |
| `network_search`             | `searchBillNetwork` throws            | `contact.wmkf_billcomid` + `akoya_isvendor` already PATCHed         |
| `network_invite`             | `sendNetworkInvitation` throws        | contact PATCHed, search returned a match (we know `vendorId` + `pni`) |

In all three cases:
- Return `status: 'bill_unavailable'`
- Body includes `error: { code, message, phase, vendorId?, pni? }` so the caller and the alert can see what advanced before the failure
- Emit an alert with severity:
  - `BillAuthError` → **critical**
  - `BillRateLimitError` → **error**
  - `BillServerError` / `BillError` → **error**
  - Alert metadata includes phase, vendorId (if past `vendor_create`), and the redacted error message — ops can finish the writeback by hand from that payload

A `network_invite` failure does NOT also clobber the akoya_request — we leave `wmkf_exisitngbillcomaccount` unwritten so the next call can retry cleanly.

**Duplicate-vendor on retry (Codex P1 #2):** Until sandbox reveals BILL's exact duplicate-vendor error shape, treat any post-create BILL failure as `bill_unavailable` with the appropriate phase tag. No optimistic "this is just a duplicate, treat as reused" handling — that primitive doesn't exist in `classify.js` yet and inventing it pre-sandbox is guesswork.

### 5. Partial — Dataverse PATCH failed after BILL succeeded

Catch the Dataverse error per-PATCH. Severity is split (Codex Q5):

- **`contact.wmkf_billcomid` PATCH failure → severity `error`**, retry once before alerting. This field IS the idempotency primitive — losing it means the next call's pre-read will think it's a returning reviewer with no vendor and try to create again. Alert payload includes `vendorId` so ops can write it manually.
- **`akoya_request` PATCH failure (`wmkf_paymentnetworkidpni`, `wmkf_exisitngbillcomaccount`) → severity `warning`**. Alert payload includes vendorId + pni + honorariumRequestId. No retry — these aren't idempotency-load-bearing.

Return `status: 'partial'` with `warnings: [...]` listing the failed paths.

## Idempotency

Per-call idempotency comes from two places:

1. **Pre-read contact.wmkf_billcomid before createBillVendor** — if a previous call already created the vendor, we skip the create. This is the only retry-safe path until sandbox reveals BILL's duplicate-vendor error shape (per Codex P1 #2).
2. **Dataverse PATCHes are last-writer-wins** — re-running just rewrites the same values.

We deliberately do NOT track idempotency keys server-side. The honorariumRequestId itself is unique per call; a retry against the same id either:
- runs cleanly and writes the same values → no harm
- finds contact already has vendorId → skips vendor-create
- gets a BILL duplicate-vendor error on retry (sandbox-time discovery) → currently surfaces as `bill_unavailable / phase: vendor_create` with an alert. Post-sandbox we may add a classify.js mapping to handle this gracefully, but **that's a chunk-8 follow-up, not chunk 6**.

## Failure modes summary table

| Failure                                  | Endpoint behavior                                  | Caller (respond.js) sees | Alert?               |
|------------------------------------------|----------------------------------------------------|--------------------------|----------------------|
| Internal-sig invalid / timestamp skew    | 401                                                | Programmer error         | severity=error       |
| Body validation fails                    | 400                                                | Programmer error         | None (caller's bug)  |
| `BILL_ENABLED=false`                     | 200, `status: 'alert_only'`                        | success                  | warning (manual TODO)|
| BILL auth (`BDC_1109` exhausted)         | 200, `status: 'bill_unavailable'`, phase tag       | logs + continues         | **critical**         |
| BILL rate-limited (`BDC_1144`)           | 200, `status: 'bill_unavailable'`, phase tag       | logs + continues         | error                |
| BILL 5xx                                 | 200, `status: 'bill_unavailable'`, phase tag       | logs + continues         | error                |
| Network search ambiguous (N≥2)           | 200, `status: 'ambiguous_match'`                   | success                  | warning              |
| Network search empty (N=0)               | 200, `status: 'no_match'`                          | success                  | None                 |
| Vendor create OK, contact PATCH fails    | 200, `status: 'partial'` (after 1 retry)           | logs the warning         | **error**            |
| All BILL OK, akoya_request PATCH fails   | 200, `status: 'partial'`                           | logs the warning         | warning              |
| Unhandled exception                      | 500                                                | logs + continues         | error                |

The endpoint never returns a non-200 due to BILL or Dataverse problems — those go through the body. Non-200 is reserved for "the caller broke the contract."

## Files

- **New** `pages/api/bill/onboard-reviewer.js` — route handler, ~150 LOC
- **New** `lib/bill/onboard-reviewer-service.js` — pure logic (no req/res), ~250 LOC. Easier to unit-test.
- **New** `lib/bill/internal-call-auth.js` — HMAC verify helper + LRU nonce gate, ~50 LOC. Could live in `lib/utils/`; lives in `lib/bill/` because it's BILL-specific and not reused elsewhere.
- **New** `tests/unit/bill-onboard-reviewer.test.js` — coverage:
  - Each `status` value's happy path
  - HMAC failure
  - Body validation failures
  - BILL error class → alert + status mapping
  - Idempotency (re-call with same honorariumRequestId)
  - `BILL_ENABLED=false` fallback

## Env vars

New:
- `BILL_INTEGRATION_SECRET` — ≥32 chars, distinct from `BILL_WEBHOOK_SECRET` and `CRON_SECRET`. Already forward-declared as `bill_integration_secret` in `lib/utils/tracked-secrets.js:54-55`; this chunk flips the entry from `tier: 'forward'` to `tier: 'integration'` (or whatever matches the existing convention) and documents the env-var name in `docs/CREDENTIALS_RUNBOOK.md`.
- `BILL_ENABLED` — default `false` until 2026-06-10. Flip via Vercel env settings after sandbox is up.

Existing (used by lib/bill, already documented):
- `BILL_BASE_URL`, `BILL_DEV_KEY`, `BILL_USERNAME`, `BILL_PASSWORD`, `BILL_ORG_ID`

## Option-set value resolution

`wmkf_exisitngbillcomaccount` is a Dataverse option-set. We need the int values for "Yes" and "No". Two options:
- A) Hard-code them via probe + comment (what most of the codebase does today)
- B) Resolve at endpoint startup via a one-time `RetrieveAttributeRequest` and cache

Recommendation: **A**. Probe the values once, write them to a `const` in the service module, comment the probe command. Matches existing pattern; option-set values don't change.

Probe script: `scripts/probe-bill-option-set-values.js` (new, throwaway). Output goes into the service module as `const BILLCOM_ACCOUNT_YES = <int>;` etc.

## Open questions for Codex

1. **Is the internal-HMAC the right auth primitive**, or is there an existing pattern in this codebase I should reuse (e.g., the CRON_SECRET shape, or the external-reviewer JWT primitive)?
2. **Should `status: 'bill_unavailable'` block respond.js from returning success to the reviewer?** Current design says no — accept always succeeds; BILL is best-effort downstream. The reviewer doesn't know BILL exists.
3. **Is per-request nonce tracking overkill for inline same-origin?** Could simplify to "HMAC over (timestamp + body)" with ±5min window check, no nonce store.
4. **Should I split the service module further** — one file for "BILL side" (create vendor + search + invite) and one for "Dataverse side" (PATCH contact + PATCH akoya_request)? Or is 250 LOC in one file fine?
5. **What's the right severity for "Dataverse PATCH failed after BILL succeeded"?** Argued for `warning` because honorarium row exists and ops has the payload, but could be `error` since BILL state is now ahead of Dataverse state.
6. **`BILL_ENABLED=false` payload to the alert** — is `metadata: { ...address, email, phone }` PII-safe? Goes to the ops inbox which is internal, but tracked-secrets / redaction posture should be confirmed against the [[project-virus-scanning-it-context]] approach (internal alerts for ops; no per-detection escalation needed).
7. **Is "alert + continue" the right pattern when the contact PATCH fails but vendor-create succeeded?** The contact.wmkf_billcomid we just got from BILL is now orphaned client-side until the next call. We could retry the PATCH once before alerting.

## Out of scope (will land in later chunks)

- Chunk 4 wire-up of this endpoint inside respond.js (waits on Connor's Q5 lookup)
- Chunk 7b webhook event-dispatch (vendor.updated → "Recently Confirmed")
- Chunk 8 end-to-end test against BILL sandbox (waits on Steph)
- Address-input UI (chunk 5, separate ship)
- Connor's post-create PA enrichment flow (Connor-owned)

---

## Codex pre-impl review folded (2026-05-27)

Six P1/P2 findings + answers to all 7 open questions. Material design changes:

- **P1 #1** — HMAC contract now explicit: canonical signing string `v1:${timestamp}:${nonce}:${rawBody}`, `bodyParser: false`, ±5min skew window
- **P1 #2** — Dropped the "lib/bill maps duplicate-vendor" claim from idempotency (the primitive doesn't exist yet); chunk 8 follow-up post-sandbox
- **P1 #3** — Failure path now phase-tagged (`vendor_create` / `network_search` / `network_invite`); response body carries the phase + vendorId so alerts can describe what advanced
- **P2 #4** — `ambiguous_match` is now a distinct status with a warning alert (umbrella plan's Steph-confirmation expectation); empty result stays `no_match` silent
- **P2 #5** — Removed `existingBillcomVendorId` from public contract; idempotency reads live
- **P2 #6** — Env var aligned to `BILL_INTEGRATION_SECRET` matching the tracked-secrets forward declaration
- **Q3** — Dropped the nonce store; ±5min timestamp window is the actual replay defense
- **Q5** — Split contact-PATCH-failure (`error` + 1 retry) from request-PATCH-failure (`warning`, no retry) by load-bearing-ness
- **Q7** — One retry on contact.wmkf_billcomid PATCH before alerting

Codex verdict: "ship-with-P1-fixes." All P1s folded above.
