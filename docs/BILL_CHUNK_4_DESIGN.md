# BILL Chunk 4 Design — respond.js accept-path extension + amount-as-setting + Full-real-fix hardening

**Status:** draft for pre-impl Codex review (S199, 2026-05-29)
**⚠️ Current-cycle (2026-06-09):** automated BILL onboarding DEFERRED — `onboardReviewer()` short-circuits to `status: 'deferred'` (no BILL, NO alert) when `BILL_ONBOARDING_DEFERRED=true`. The `alert_only` references below are the BILL-disabled fallback, superseded by the deferral gate this cycle; address+phone are now server-enforced (`422 payment_contact_required`). Parent doc's current-cycle update is authoritative.
**⚠️ Current-cycle (2026-06-21): honorarium-create itself is also deferrable (capture-only).** `ensureHonorariumOnboarding()` now short-circuits to `status: 'deferred'` AFTER capturing contact + mailing address but BEFORE minting the `akoya_request` or calling BILL — when `HONORARIUM_ONBOARDING_DEFERRED=true` OR the discriminator GUIDs (`HONORARIUM_PROGRAM_ID` / `HONORARIUM_GRANTPROGRAM_ID` / `HONORARIUM_TYPE_ID`) are unset. It does NOT throw, so `respond.js` fires NO per-reviewer warning email — instead it records ONE non-emailing `honorarium_capture_only` notice (severity `info`, `emailAdmins:false`) on a fresh accept. Use this when the honorarium payment pipeline isn't built yet but you still want to capture reviewer address + choice. Reversible: configure the GUIDs / unset the flag and the full create+onboard tail runs unchanged on a later accept (or a backfill). When this gate is OFF, the chunk-4 accept path creates the honorarium + PATCHes address/phone as designed below.
**Parent:** `docs/BILL_HONORARIUM_INTEGRATION_DESIGN.md` (umbrella plan, Connor sign-off 2026-05-26)
**Hardening source:** `docs/REVIEWER_BILL_HARDENING_FINDINGS.md` (S198 deep-pass; 3 money-adjacent P1s)
**Sibling shipped chunks:** 1 (junction lookup `wmkf_HonorariumRequest`), 2-3 (`lib/bill/`), 6 (`/api/bill/onboard-reviewer` + service), 7a (webhook scaffold)
**Target ready:** 2026-06-10. First reviewer invitations ≥ 2026-06-17.

This chunk has three threads, decided with the user S199:

1. **Chunk 4 proper** — wire the honorarium row create + junction PATCH + onboard call into the Stage 2a accept path.
2. **Honorarium amount as Dataverse ground-truth** — replace the hardcoded `$250` / per-user preference with one admin-editable `wmkf_appsystemsettings` value, read live at create time (future-creates-only; existing rows untouched). Remove the per-user preference UI.
3. **Full-real-fix hardening** — `bill_onboarding_state` Postgres staging table closes all three S198 P1s (duplicate-vendor-on-retry, no idempotency guard, torn cross-system state) via a durable vendorId store + a resume sweep.

---

## Decisions locked (user, S199)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Hardening scope | **Full real fix** (staging table + reorder + sweep) |
| D2 | Amount storage | **Single global Dataverse setting** (`wmkf_appsystemsettings`, NOT Postgres) |
| D3 | Amount on change | **Future-creates-only** — stamp the live value at create; no backfill of existing rows |
| D4 | Per-user pref | **Remove now** — Review Manager email + portal both read the system setting |
| D5 | Contact-absent at accept | **Promote-on-accept** fallback (reuse existing primitives), not alert-and-skip |
| D6 | Discriminator GUIDs | **Resolve by name at runtime**, fail-loud + module cache (living-taxonomy) |

---

## Thread 1 — Chunk 4: respond.js accept-path extension

### Current state
`pages/api/external/review/[token]/respond.js` (227 lines) handles accept/decline. The accept path today: rate-limit → verify token → validate `contactEdits` → state-machine guard → idempotency short-circuit → policy-ack check → `applyStage2aResponse(...)` (one PATCH to the suggestion row). It only destructures `{ suggestion }` from the verifier; `verifySuggestionToken` also returns `request` and `reviewer` (expanded), which this chunk needs.

### What chunk 4 adds (accept path only, AFTER `applyStage2aResponse` succeeds, gated on NOT `honorariumOptOut`)
A new post-accept honorarium step. Encapsulated in a new testable helper `lib/bill/honorarium-onboard-orchestrator.js` (keeps respond.js lean; same separation as `onboard-reviewer-service.js`). respond.js calls it; failures are **non-fatal to the accept** (the accept already committed) — they surface as alerts + are recorded, never as a 500 to the reviewer.

Sequence inside the orchestrator:

1. **Resolve/ensure contact.** Read `reviewer._wmkf_contact_value`.
   - Present → use it.
   - Absent → **promote-on-accept**: `contactAdapter.findOrCreateByEmail({ firstName, lastName, email })` (resolved accept-time values; `contactEdits` override the reviewer snapshot), then `potentialReviewerAdapter.setContactLink(potentialReviewerId, contactId)`. This is the exact primitive `send-emails.js:254` uses (promotion there is non-fatal, so absence is expected-but-rare).
   - **Hard requirement:** an email. The magic link was emailed to the reviewer, so an email essentially always exists; if none can be resolved, skip honorarium-create, emit an alert, and return — accept still succeeds.
2. **PATCH `contact.address1_*`** from the accept-body address (see address contract below). Best-effort; a failure alerts but does not stop the create (the honorarium row's own BILL address block carries the address downstream).
3. **Idempotent honorarium create.**
   - Re-read the junction row's `_wmkf_honorariumrequest_value`. **If already set → honorarium already created on a prior attempt; reuse that id, skip create.** (The junction lookup IS the create-idempotency primitive — no extra store needed for this step.)
   - Else: pre-generate a GUID, `createRecord('akoya_requests', body)`. On a duplicate-PK error against the pre-generated GUID (retry race), treat as success and proceed.
   - Then PATCH the junction: `updateRecord('wmkf_appreviewersuggestions', suggestionId, { 'wmkf_HonorariumRequest@odata.bind': '/akoya_requests(<newId>)' })`. This is the durable marker; do it immediately after create.
4. **Call `/api/bill/onboard-reviewer`** (HMAC-signed via `signInternalCall`) with `{ honorariumRequestId, reviewerContactId, reviewerName, reviewerEmail, reviewerPhone, address }`. Fire-and-await; the endpoint always 200s with the outcome in `status`. Record the status; never fail the accept on it. When `BILL_ENABLED=false` (sandbox not provisioned) the endpoint returns `alert_only` and ops onboards manually — so this chunk is shippable before the BILL sandbox lands.

### Honorarium `akoya_request` create body
```js
{
  akoya_requestid: <pre-generated GUID>,
  'akoya_ProgramId@odata.bind':       `/akoya_programs(${researchReviewerProgramId})`,
  'wmkf_GrantProgram@odata.bind':     `/wmkf_grantprograms(${honorariumProgramId})`,
  'wmkf_Type@odata.bind':             `/wmkf_types(${individualTypeId})`,
  'akoya_PrimaryContactId@odata.bind': `/contacts(${reviewerContactId})`,
  wmkf_request_type: 682090001,        // Individual (picklist; per umbrella Q7a)
  akoya_recommendedamount: <amount from setting>,   // see Thread 2
  wmkf_meetingdate: <request.wmkf_meetingdate>,
}
```
Notes:
- **Amount field = `akoya_recommendedamount`**, NOT the `akoya_request` money field. The umbrella create-body sketch wrote `akoya_request: <amount>`, but the GOapply hidden field this integration replaces used `akoya_recommendedamount` (=$250), and `lib/services/dataverse-export/constants.js` maps "recommended amount" → `akoya_recommendedamount`. Using the GOapply field keeps continuity with Steph's existing bookkeeping. (Doc-drift in the umbrella doc to reconcile.)
- Provenance to the grant request is carried by the junction (`wmkf_HonorariumRequest` → honorarium; junction already carries `_wmkf_request_value` → grant), per Connor's Q5 refinement — we do NOT add a direct honorarium→grant lookup.
- Connor's post-create PowerAutomate enrichment (chunk 1b, his) fills additional fields async; not gating.

### Address contract (accept body + contactEdits)
The Stage 2a accept body gains an `address` block (chunk 5 builds the UI; chunk 4 accepts + validates it server-side):
```ts
address?: { line1, line2?, city, state?, postalCode, country }   // country ISO2
```
- Validated in respond.js with per-field caps (mirror the existing `validateContactEdits` shape) → clean 400 on violation.
- PATCHed to `contact.address1_line1 / address1_line2 / address1_city / address1_stateorprovince / address1_postalcode / address1_country`.
- Mapped into the onboard call's `address: { line1, city, state, zipOrPostalCode: postalCode, country }`.
- **Required for honorarium-create** (BILL vendor-create requires line1/city/zip/country). If `honorariumOptOut` is true, address is not required and the whole thread is skipped.

### Discriminator GUID resolution (D6)
New `lib/bill/honorarium-discriminators.js`: resolve and module-cache the three GUIDs by name at runtime, fail-loud if any is missing/ambiguous:
- `akoya_programs?$filter=akoya_program eq 'Research Reviewer'` → `akoya_programid`
- `wmkf_grantprograms?$filter=<name eq 'Honorarium'>` → id
- `wmkf_types?$filter=<name eq 'Individual'>` → id

⚠️ `akoya_program` has a **known duplicate-name hazard** (atlas: `Law and Legal Administration` exists twice; `Research Reviewer` created 2026-01-06). Resolution must assert **exactly one active match** and throw on 0 or ≥2 — never silently pick `[0]`. Cache is per-process; a throw is surfaced as an alert and skips honorarium-create (accept still succeeds).

---

## Thread 2 — Honorarium amount as Dataverse ground-truth

### Setting
- Key: `honorarium.default_amount` in `wmkf_appsystemsettings` (Dataverse; read/written by `lib/services/dataverse-settings-service.js` `getSetting`/`setSetting`). **Confirmed Dataverse, not Postgres** — the Postgres `system_settings` table was dropped 2026-05-12 (Wave 1).
- New reader helper (e.g. `lib/services/honorarium-config.js` `getHonorariumAmount()`): `getSetting('honorarium.default_amount')` → parse to a positive number. **Fallback** to a single documented constant `DEFAULT_HONORARIUM_AMOUNT = 250` when unset (so a fresh env works); **fail-loud** (throw) on a *malformed* stored value (non-numeric / ≤0) rather than silently falling back — a bad admin entry must not silently mint $250 honoraria.
- Read **live at create time** (D3). The created row stamps the value into `akoya_recommendedamount`; a later setting change does not touch existing rows.

### Admin surface
Surface the value in `/admin` for edit (mirror the `pages/api/admin/models.js` + `pages/admin.js` settings pattern; superuser-gated like the rest of admin). A thin GET/PATCH on the one key, or fold into an existing admin settings section — implementer's call, smallest coherent diff.

### Remove the per-user preference (D4)
- The per-user amount lives nested in the `GRANT_CYCLE_SETTINGS` profile preference as `grantCycle.customFields.honorarium` (default `'250'` at `SettingsModal.js:35`; input at `:894`; also `EmailTemplateEditor.js:66`).
- Remove the honorarium field from the SettingsModal UI + its default + the customFields shape.
- Rewire its consumers (Review Manager invitation email amount — `review-manager.js:527` display + the send-emails / email-template path) to read the system setting instead of the per-user value.
- **Verified consumer set (S199 disconfirming grep, `grep -rin honorarium pages/ shared/ lib/` minus optOut/tests):** the amount pref is bounded to exactly three files — `pages/review-manager.js` (UI input + `emailFields` state, lines 229/347/527/530/531), `shared/components/EmailTemplateEditor.js:66` (default), `shared/components/SettingsModal.js` (35/890/894). **No** consumers in `lib/services/**` or `pages/api/**` (the `dataverse-export/constants.js` hits are the *grant-program* category "Honorarium", not the amount). So the removal is clean/bounded; still re-grep at implementation time per Carryover Hygiene since this is a destructive UI/pref removal.

---

## Thread 3 — Full-real-fix hardening (D1)

Closes the three S198 P1s. The root cause of #1/#2: the contact PATCH (`wmkf_billcomid`) is the *sole* vendor-create idempotency primitive, and it is exactly the call that may fail-and-continue → a retry re-reads empty `wmkf_billcomid` and creates a **second** BILL vendor. Fix: a durable store keyed by `honorariumRequestId` that records the vendorId the moment create returns, checked first on retry.

### New table: `bill_onboarding_state` (migration `017_bill_onboarding_state.sql`)
```sql
CREATE TABLE IF NOT EXISTS bill_onboarding_state (
  honorarium_request_id  uuid PRIMARY KEY,        -- akoya_request GUID (1 onboarding per honorarium)
  reviewer_contact_id    uuid NOT NULL,
  vendor_id              text,                     -- BILL vendor id ('009...'); set the instant createBillVendor returns
  bill_status            text NOT NULL DEFAULT 'pending',  -- mirrors onboard service status (onboarded/reused_existing/no_match/ambiguous_match/partial/bill_unavailable/alert_only)
  dynamics_pending       boolean NOT NULL DEFAULT false,   -- BILL side done, akoya_request PATCH still owed (torn-state marker)
  pending_pni            text,                     -- PNI to write on resume (null + dynamics_pending ⇒ write "No")
  pending_match          boolean,                  -- true ⇒ matched (write Yes+PNI); false ⇒ no/ambiguous (write No)
  attempts               integer NOT NULL DEFAULT 0,
  last_error             text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bill_onboarding_pending
  ON bill_onboarding_state (dynamics_pending) WHERE dynamics_pending = true;
```
Add to `lib/db/migrations-manifest.json` (regenerated by `npm run prebuild`; gated by `check:migrations-manifest`).

### `onboard-reviewer-service.js` rewire
- **Idempotency pre-read** now checks `bill_onboarding_state[honorariumRequestId].vendor_id` **first**, then falls back to `contact.wmkf_billcomid` (backstop for rows created before this table existed / cross-env). Either present → reuse, skip create.
- **Reorder (Fix #1/#2):** `createBillVendor` → **immediately `UPSERT bill_onboarding_state {vendor_id}`** → *then* `patchContactBillcomId`. A failed contact PATCH no longer loses the vendorId.
- **Best-effort pre-create lookup (backstop for lost-response, Fix #2):** before create, query BILL vendors by name (+email if supported) so a vendor created on a prior call whose HTTP response never arrived isn't duplicated. ⚠️ BILL match is fuzzy — document this as a **low-probability residual gap**, not airtight idempotency (per findings doc).
- **Fix #3 (torn state):**
  - Retry `patchAkoyaRequestSuccess` / `patchAkoyaRequestNoMatch` with **backoff** (today: 0 retries) so a transient Dynamics blip doesn't tear.
  - On persistent failure after BILL-side success: set `dynamics_pending = true`, store `pending_pni` + `pending_match` on the staging row. Return `partial` as today (caller/alert unchanged) — but now there's a durable marker to resume from instead of relying on manual ops.
  - Always update `bill_status` on the staging row at terminal outcomes (observability).

### Resume sweep
- `MaintenanceService.sweepBillOnboarding()` (mirrors `sweepIntakePending` shape): select `dynamics_pending = true` rows, retry the appropriate `akoya_request` PATCH idempotently (`pending_match` → write PNI + "Yes"; else "No"); on success clear `dynamics_pending`; on failure bump `attempts` + `last_error`. Bounded retry (e.g. stop alerting-only after N attempts).
- Wire as a step in `pages/api/cron/maintenance.js` (alongside `cleanupBillWebhookEvents` / `sweepIntakePending`). Idle ticks (0 pending) skip the `maintenance_runs` write, matching the S198 telemetry convention.
- TTL: completed (non-pending) rows pruned by a `cleanupBillOnboardingState(retentionDays)` step (mirror `cleanupBillWebhookEvents`), since 1 row/honorarium accumulates ~85/cycle.

---

## Thread 4 — schema-as-code / Atlas / gates (eval #8)

- **`wmkf_HonorariumRequest` missing from code:** add `_wmkf_honorariumrequest_value` to `reviewer-suggestion.js` `FIELD_SELECT` and to the wave2 schema JSON (`lib/dataverse/schema/wave2/wmkf_app_reviewer_suggestion.json`). It's documented-deployed (chunk 1) but absent from schema-as-code + the adapter select.
- **Atlas:** new Postgres table `bill_onboarding_state` → add to a `docs/atlas/` page so `check:atlas` stays green (it gates `lib/db/**`, `lib/services/*`). Update `docs/atlas/dataverse-akoya-request.md` write-path section (new honorarium-create writer) and the `wmkf_appreviewersuggestion` page (junction PATCH writer).
- **CLAUDE.md** Database Schema table: add `bill_onboarding_state` row.
- **`check:api-routes`:** no new routes (reuses `/api/bill/onboard-reviewer`); matrix unchanged.
- **`check:fact-consistency`:** re-run after any guard/count touch (no `requireAppAccess` change expected, but the gate is cheap).

---

## Testing
- Orchestrator unit tests (injected fakes, like `onboard-reviewer-service` tests): contact-present vs promote-on-accept; honorarium-create idempotency (junction already set → skip; duplicate-PK → recover); junction PATCH; opt-out skip; address-missing 400; discriminator resolution throw → skip + alert; onboard-call failure non-fatal.
- Hardening tests: staging pre-read short-circuit; vendorId persisted before contact PATCH (assert ordering); torn-state marker written on request-PATCH failure; sweep resumes + clears `dynamics_pending`; sweep idempotency.
- Amount: setting read + fallback + malformed-throw; create body stamps the live value.
- Full suite + `check:atlas` (+ self-test sequentially) + `check:api-routes` + `check:fact-consistency` + `check:migrations-manifest` green.
- Codex post-impl review per the established multi-chunk loop.

## Build order (dependency-aware)
1. Migration `017` + manifest + Atlas page (so gates pass as soon as code references the table).
2. `honorarium-config.js` (amount setting reader) + admin surface + per-user pref removal.
3. `honorarium-discriminators.js`.
4. `honorarium-onboard-orchestrator.js` + respond.js wiring + reviewer-suggestion FIELD_SELECT/schema.
5. `onboard-reviewer-service.js` hardening rewire (staging store, reorder, retries, torn-state marker).
6. `sweepBillOnboarding` + cron step + TTL cleanup.
7. Tests throughout; gates; Codex post-impl.

## Codex pre-impl review — folded fixes (S199, verdict NEEDS-P1-FIXES-FIRST)

All findings accepted. Resolutions, now binding on the build:

- **P1 — create idempotency broken across HTTP retries.** Pre-generated GUID + duplicate-PK recovery only helps *within* one attempt; a stateless retry mints a new GUID and never trips the PK guard. **FIX:** the **pre-create existence query is the PRIMARY guard**, not the junction. Before create, query `akoya_requests` for an existing honorarium for this engagement: filter `_akoya_primarycontactid_value eq <contactId> and _akoya_programid_value eq <researchReviewerProgramId> and wmkf_request_type eq 682090001` (+ `wmkf_meetingdate eq <meeting>` to scope to this cycle, guarding the rare same-reviewer-multiple-cycles case). If exactly one match → reuse it (and backfill the junction if unset). The junction lookup remains a fast-path short-circuit + the durable provenance marker, but is no longer the sole idempotency primitive. Duplicate-PK recovery on the pre-generated GUID stays as a last-resort within-attempt guard.
- **P1 — partial accept permanently skips honorarium.** `respond.js:137` early-returns `idempotent:true` when already accepted, so a retry after a torn accept never re-enters the honorarium step → accepted reviewer with no honorarium. **FIX:** the honorarium step must run on a **re-accept of an already-accepted row too**. Restructure the accept path so the honorarium orchestrator runs after the accept state is confirmed (whether freshly set this request OR already set), gated on `!honorariumOptOut` and "honorarium not yet created" (the pre-create existence query above makes this safe + idempotent). The idempotent short-circuit may still skip the *suggestion-row PATCH*, but must NOT skip the honorarium step when the engagement is accepted-but-honorarium-missing.
- **P1 — settings read failure silently mints fallback $250.** `getSetting` swallows ALL errors → `null`, so "key absent" and "Dynamics outage/auth-fail" are indistinguishable; a transient failure would stamp $250 into money. **FIX:** `getHonorariumAmount()` must distinguish *confirmed-absent* from *fetch-failure*. Implement a dedicated read (own try/catch around `findRow`-equivalent) that: throws on fetch failure (caller treats as "cannot determine amount" → skip honorarium-create + alert, NOT fall back); returns the fallback `250` ONLY on a confirmed-present-client + absent-key; throws on a malformed stored value. Do **not** build the helper on the error-swallowing `getSetting` alone — either extend `dataverse-settings-service` with a throwing variant (`getSettingStrict`) or read via a path that surfaces the error.
- **P2 — concurrent duplicate vendor (staging UPSERT is after the BILL side effect).** Two concurrent calls both pre-read no `vendor_id`, both create a BILL vendor, then contend on the PK. **FIX:** **reserve before the side effect** — `INSERT bill_onboarding_state (honorarium_request_id) ... ON CONFLICT DO NOTHING RETURNING` *before* `createBillVendor`. The caller that loses the insert race re-reads the row and waits/short-circuits rather than calling BILL. (Realistic concurrency here is a single reviewer double-submitting accept, which the Thread-1 honorarium-create idempotency already gates upstream — but the reservation closes the window cleanly.)
- **P2 — contact promote-on-accept dup race.** `findOrCreateByEmail` is check-then-create with no alt-key. **FIX:** acceptable for the realistic double-click case (email-based find is idempotent enough); document that a true `emailaddress1` alternate key is the only airtight fix and is out of scope. Single-flight the promotion behind the staging reservation where practical.
- **P2 — null `pending_match` misclassified as "No".** **FIX:** the sweep **fails closed** when `dynamics_pending=true AND pending_match IS NULL` — leave the row pending, bump `attempts`, alert; never default a malformed row to a "No" PATCH.
- **P3 — `docs/APPLICATION_STATE_ATLAS.md` index.** **FIX:** add `bill_onboarding_state` to the top-level "Other Postgres" summary in `docs/APPLICATION_STATE_ATLAS.md` AND the per-table page (`docs/atlas/postgres-infra-tables.md`), not just a new page. Added to Thread 4.

### Remaining design note
- Sweep alerting: bump `attempts` + `last_error` each resume failure; emit an escalation alert after N (e.g. 5) attempts so a permanently-stuck torn row surfaces (the original `partial` alert fired once at onboarding time; a stuck resume needs its own escalation).

## Codex post-impl review — folded fixes (S199, commit after 7cb8bc4)

Pre-impl findings verified ADDRESSED: F1 (deterministic-GUID create idempotency), F3 (strict amount read), F5 (NULL pending_match fails closed), F6 (Atlas). New/partial findings folded:

- **F2 — re-accept ignored persisted opt-out (PARTIAL→fixed).** `respond.js` now gates the honorarium step on `body.honorariumOptOut === true OR suggestion.wmkf_honorariumoptout === true`, so a re-accept whose body omits the flag can't mint a honorarium for a reviewer who opted out originally.
- **Stranding class (F4 + "staging vendor write swallowed" + "mark-pending failure").** The reviewer's *reservation row* is a third idempotency primitive — a retry after a lost vendorId-write or failed contact-PATCH hits `reserved:false` → `in_progress`, so there is **no duplicate vendor** (the P1 "duplicate" framing is downgraded). The real defect is **stranding**: an orphaned BILL vendor + a honorarium stuck in `pending`/`partial` that the resume sweep (which only scans `dynamics_pending=true`) never touches. Fixed with a **stuck-row reconcile** in `sweepBillOnboarding` (`onboarding-state.listStuck`): rows non-terminal past `stuckThresholdHours` (default 24h) raise a `bill_onboarding_stuck` ops alert for manual reconcile (orphaned vendor link/void). Not auto-resolved — that needs BILL API surface out of pre-launch scope.
- **ADDRESS_PATCH_ABORTS_CREATE.** `patchContactAddress` in the orchestrator is now wrapped — a failed address write logs + continues instead of aborting honorarium-create/onboard (the address also rides the BILL vendor payload).
- **PARTIAL_ROWS_TTL_REOPEN_DUP_WINDOW.** `cleanupCompleted` now deletes only TERMINAL statuses (`onboarded`/`reused_existing`/`no_match`/`ambiguous_match`/`alert_only`), never `pending`/`partial` rows that still hold the only `vendor_id` record.
- **Stop-time #1: re-accept retries could be permanently stranded.** The `reserved:false → in_progress` short-circuit originally bailed for ALL lost-reservation cases, so a re-accept of a row whose first attempt created the vendor but didn't finish looped on `in_progress` forever (only the stuck-reconcile ops alert surfaced it). **Fix:** `in_progress` now applies ONLY when the reserved row has NO `vendor_id`; when a `vendor_id` is staged the call RESUMES.
- **Stop-time #2: the resume must not replay terminal BILL side effects.** The first resume cut fell through into the full BILL flow, which re-ran `searchBillNetwork` + `sendNetworkInvitation` — re-sending a network invitation a prior attempt may already have fired. **Fix:** a resume (`reserved:false` + `vendor_id` staged) now re-applies ONLY the **idempotent contact PATCH** (`wmkf_billcomid` + `akoya_isvendor`, the commonly-owed write after a torn first attempt) and returns `resume_reconciled` — it does **not** call any BILL endpoint. Division of labor: torn `akoya_request` writebacks are owned by the `dynamics_pending` resume sweep (which never re-invites); a `vendor_id`-null abandoned row OR an onboarding whose invite never completed (BILL outage mid-flight) is surfaced by the stuck reconcile for manual ops — auto-re-inviting is deliberately NOT done because we have no per-step record proving the invite didn't already fire (lost-response duplicate risk).
### In-process onboarding call — a CONSCIOUS design choice (supersedes the umbrella doc's "POST /api/bill/onboard-reviewer" step)

The orchestrator drives onboarding by calling **`onboardReviewer()` in-process**, NOT by HMAC-POSTing `/api/bill/onboard-reviewer`. This is a deliberate decision, not an accidental contract violation — recorded here so the spec and the code agree:

**Why in-process.**
1. **Self-HTTP is a Vercel anti-pattern.** A function `fetch()`ing its own app's API route spends a second function invocation (fresh cold start, its own Active-CPU billing) to run code already loaded in the same process.
2. **Base-URL resolution is fragile.** `respond.js` runs on a public, token-authenticated path with no session; resolving the correct self-origin across prod / preview / branch deploys / localhost (`NEXTAUTH_URL` vs `VERCEL_URL` vs …) is a real "works in prod, 500s in preview" hazard the in-process call avoids entirely.
3. **The HMAC adds nothing same-process.** `internal-call-auth.js` authenticates a *network* request; with no network hop there's nothing to forge, so signing+verifying is pure ceremony that can only fail (skew, a missing/rotated `BILL_INTEGRATION_SECRET`).
4. **Better error handling.** The direct call returns the real `{status, vendorId, warnings}` and throws the real typed error (`.code`), instead of an HTTP status + a body to re-parse plus a new network-fault failure class.
5. **The service module is the intended seam.** `onboard-reviewer-service.js` was split out from the route handler precisely so callers can share the logic without the HTTP layer; the route is just one adapter over it.

**What this is NOT giving up.** The endpoint (`pages/api/bill/onboard-reviewer.js` + `internal-call-auth.js`) stays intact as the boundary for any future **external** caller (PowerAutomate, a retry queue) — so the option is preserved, not a one-way door.

**Contract parity (closes Codex P3's substantive sub-point).** Codex flagged that the in-process path bypassed the route's `validateBody`. Resolved by extracting **one shared validator, `validateOnboardInput()`** in `onboard-reviewer-service.js`, used by BOTH entry points: the HTTP route (→ `400` + detail) and `onboardReviewer()` itself (→ `invalid_input` status + ops alert, after the `BILL_ENABLED` check so disabled-mode `alert_only` still degrades cleanly). There is now a single validation definition and no drift between the two paths — the in-process call is a contract-equivalent peer of the HTTP endpoint, not a shortcut around it.

**Trade-off accepted.** If onboarding later needs to be async/durable (e.g. BILL latency makes inline accept too slow → enqueue a job), the in-process call would be reworked into an enqueue, whereas the HTTP endpoint is already a step toward that. Given the pre-launch, low-volume (~85/cycle) flow where inline latency is tolerable (and `BILL_ENABLED=false` returns instantly today), "simpler + cheaper now, reversible later" is the chosen trade.
