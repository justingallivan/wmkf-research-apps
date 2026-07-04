---
title: "Reviewer Honorarium Onboarding — Design Doc for Connor"
domain: finance-honoraria
kind: spec
status: active
summary: "Target: Ready by 2026-06-10 for the cycle whose reviewer invitations go out ≥ 2026-06-17."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
related:
  - docs/HONORARIUM_PORTAL_CREATION_STRATEGY.md
  - docs/BILL_integration_handoff.md
  - "pages/external/review/[token].js"
  - "pages/api/external/review/[token]/respond.js"
---

# Reviewer Honorarium Onboarding — Design Doc for Connor

**Author:** Justin Gallivan
**Date:** 2026-05-25
**Status:** Connor sign-off received 2026-05-26 (Q1, Q2, Q4a, Q4b, Q5 with refinement, Q6, Q7). Confidentiality wording refinement deferred to UI session (no significant code impact expected). Build can proceed.
**Target:** Ready by 2026-06-10 for the cycle whose reviewer invitations go out ≥ 2026-06-17

**⚠️ CURRENT-CYCLE UPDATE (2026-07-01) — read before trusting the BILL/address sections below:**
- **Automated BILL onboarding is DEFERRED to next cycle** (leadership, 2026-06-09). `onboardReviewer()` short-circuits to `status: 'deferred'` (no BILL call, **no alert**) when `BILL_ONBOARDING_DEFERRED=true` — distinct from, and higher-precedence than, the `alert_only` (`BILL_ENABLED=false`) fallback described below. Payment is handled MANUALLY/offline this cycle.
- **Honorarium request creation is now the no-BILL target.** `docs/HONORARIUM_PORTAL_CREATION_STRATEGY.md` supersedes this older design's create-body details for the current go-live. The clean no-BILL posture is: set `HONORARIUM_PROGRAM_ID`, `HONORARIUM_GRANTPROGRAM_ID`, and `HONORARIUM_TYPE_ID`; unset `HONORARIUM_ONBOARDING_DEFERRED`; set `honorarium.default_amount`; keep `BILL_ONBOARDING_DEFERRED=true`. Then `ensureHonorariumOnboarding()` creates the honorarium `akoya_request` at Stage 2a accept and skips BILL/payment.
- **Capture-only remains the safety/off mode (2026-06-21; accept drain as of 2026-07-04).** When `HONORARIUM_ONBOARDING_DEFERRED=true` OR the discriminator GUIDs aren't configured, `ensureHonorariumOnboarding()` captures the contact + mailing address then returns `status: 'deferred'` **before** minting the `akoya_request` or calling BILL — and does NOT throw, so step (3) "create the honorarium `akoya_request`" below does NOT happen and **no per-reviewer warning email fires**. Instead the reviewer acceptance drain records ONE non-emailing `honorarium_capture_only` notice (`info`, `emailAdmins:false`) on a fresh accept.
- **Reviewer address + phone are REQUIRED and SERVER-ENFORCED** on a non-opted-out accept (`422 payment_contact_required`, via `missingRequiredAddressFields` in `respond.js`) — this **supersedes** the "server treats address as optional / client is the primary gate" framing in the failure-modes table and the "provisional" (S200) notes below. Ground truth in memory: `project-bill-honorarium-integration`, `project-reviewer-address-collection-provisional`.
**Context:** Ops team meeting 2026-05-23 approved the BILL integration concept. Background in `docs/BILL_integration_handoff.md`. Probe of live Dataverse + review of already-shipped Stage 2a reviewer-portal primitives (2026-05-25) reshaped the architecture from a PA-triggered backend-only flow into a portal-integrated flow.

---

## TL;DR

When a reviewer clicks **accept** on their invitation in our reviewer portal, that single action will (1) record their acceptance + policy acknowledgments [already shipped Stage 2a], (2) capture their payment address, and (3) create the honorarium `akoya_request` row in Dataverse. For the no-BILL cycle, step (4) BILL.com vendor onboarding is deliberately skipped by `BILL_ONBOARDING_DEFERRED=true`; payment remains manual/offline. **No GOapply form, no separate trip.** For the current create-body and open Connor questions, read `docs/HONORARIUM_PORTAL_CREATION_STRATEGY.md`.

---

## Nomenclature (please use these terms throughout)

Two distinct concepts both stored in the `akoya_request` table — easy to confuse:

| Term | What it is | Discriminator |
|---|---|---|
| **Grant request** | A proposal from a university asking for funding | `akoya_program ≠ "Research Reviewer"` |
| **Honorarium request** | A payment record for an individual who reviewed a grant request | `akoya_program = "Research Reviewer"` AND `wmkf_grantprogram = "Honorarium"` AND `wmkf_type = "Individual"` AND `wmkf_request_type = "Individual"` |

Example: Utah State submitted **grant request** #1002238. Amy Gladfelter agreed to review it and was issued **honorarium request** #1002764 for $250. The two are separate `akoya_request` rows. **Today they have no data link between them**; Q5 below proposes a small schema add that preserves the linkage going forward.

---

## Current state (from live Dataverse probe + already-shipped portal primitives)

### Already shipped on the reviewer portal (Stage 2a, 2026-05-09)

- Magic-link landing at `pages/external/review/[token].js`
- Accept/decline endpoint at `pages/api/external/review/[token]/respond.js` with state machine, optimistic locking, idempotency, audit, rate limit
- `contactEdits` capture (firstName, lastName, nickname, title, affiliation, email, orcid) → PATCHed to `contact`
- `honorariumOptOut` boolean captured at accept time
- Policy acknowledgments (COI + AI-use) gating accept

### What this honorarium integration adds

A small extension to the same Stage 2a accept handler:

- Three or four new address fields in `contactEdits` (line1, city, state, postal code, country) → PATCHed to `contact.address1_*`
- A new "create honorarium `akoya_request`" step in the accept path
- An inline call to a new `/api/bill/onboard-reviewer` endpoint that runs the BILL.com vendor create + network search + invitation

### Why no GOapply replacement is needed

Today's "Reviewer Information Form" in GOapply (record `001020`, phase "Reviewer Payment Info") collects reviewer payment info that AkoyaGO syncs into `akoya_request` + `contact`. Probe survey (85 honoraria for the 2026-06-04 meeting):

- **84/85 (98.8%) of reviewer contacts have full address** on `contact.address1_*` (line1 + postal code); 1 has city + country only; 0 are empty
- 0 paid honoraria ever (last cycle was first cycle; 77 paid via Excel, Steph back-filling Dataverse for bookkeeping; 8 partially populated)
- BILL fields on the honorarium request itself are 9% populated; the rest is Steph's manual backfill

Since the portal owns the reviewer journey end-to-end going forward, we skip the GOapply hop entirely. Reviewers from cycles starting ≥ 2026-06-17 onboard via our portal; the 8 already-touched 2026-06-04 honoraria remain on Steph's manual path.

### Existing Dataverse fields the integration writes

**On `akoya_request` (the honorarium request we create):**

| Field | Type | Today's use | Our use |
|---|---|---|---|
| `wmkf_paymentnetworkidpni` | String | BILL Payment Network ID; staff-entered, free-text | Validated PNI from BILL `GET /v3/network` response |
| `wmkf_emailaddressonbillcomaccount` | String | Reviewer email used for BILL account | The reviewer's email (from contact) |
| `wmkf_organizationnameonbillcomaccount` | String | For individuals, the person's own name | The reviewer's full name |
| `wmkf_billcomstreet1/2`, `wmkf_billcomcity`, `wmkf_billcomstate`, `wmkf_billcomzipcode`, `wmkf_billcomcountry` | String × 6 | Address block | Reviewer's address (from contact) |
| `wmkf_exisitngbillcomaccount` | Picklist (Yes/No/Recently Confirmed) | Used across grantee flow (385 non-null) | Yes if found in BILL network (exact-match + zip disambiguation), No if not found, Recently Confirmed after webhook (Q4a) |
| `wmkf_authorizationtoremitpaymentflag` | Boolean | Staff pay-authorization gate | **We never touch this** — staff retains final approval |
| `wmkf_vendorverified`, `wmkf_paymentcontactconfirmed` | Picklist | Grantee-org concerns (tax status; payment contact) | **We never touch these** — see Q4b + appendix |

**On `contact`:**

| Field | Type | Today's use | Our use |
|---|---|---|---|
| `wmkf_billcomid` | String | BILL vendor ID — **empty for every sampled reviewer** | We write the vendor ID returned from `POST /v3/vendors` (Q1) |
| `address1_line1`, `address1_city`, `address1_stateorprovince`, `address1_postalcode`, `address1_country` | String × 5 | Already 98.8% populated for current reviewers | We PATCH if the reviewer updates address on the accept form |
| `akoya_isvendor` | Boolean | "Send payments directly to this individual" | Deferred to staff (Q1) |

**⚠️ [PROBE 2026-06-27] Vendor-id field divergence from the live grant→BILL flow.** This design writes the BILL vendor id to **`contact.wmkf_billcomid`** (above). But the existing, working grant-payment flow that Ops/Rosie runs stores the BILL vendor id on the applicant **`account`** as **`wmkf_billcomvendorid`** (a *different field on a different entity*), with `account.akoya_isvendor=true` and an internal `account.wmkf_vendorid` code. Verified on paid grant Utah State #1002238 (`account.wmkf_billcomvendorid="00901SAWVXCGEX3pth8g"`); Amy #1002764's `contact.wmkf_billcomid` is null. Honoraria have no `account`, so an individual-payee path is genuinely needed — but any plan to "mimic Rosie's grant workflow" for honoraria must reconcile this account→contact / `wmkf_billcomvendorid`→`wmkf_billcomid` fork, because the grant flow's vendor logic reads the account field and has no individual code path. Ground truth: [[akoya-payment-field-semantics]], [[akoya-request-honorarium-nomenclature]].

---

## Proposed integration

### End-to-end flow

```
1. Staff invites reviewer (existing Review Manager flow → magic-link email)
2. Reviewer clicks link → /external/review/[token]   [shipped]
3. Reviewer reviews proposal context, sees policy cards, accepts   [shipped]
   • plus, NEW: enters/confirms payment address
   • plus, NEW: honorariumOptOut checkbox (already exists; default unchecked)
4. POST /api/external/review/[token]/respond { action: 'accept', ... }
   • Existing: state machine, lock, contactEdits PATCH, policy ack, audit
   • NEW: PATCH contact.address1_* if changed
   • NEW: createRecord('akoya_requests', { ...honorarium body with provenance })
   • NEW: fire-and-await /api/bill/onboard-reviewer with the new request id
5. /api/bill/onboard-reviewer:
   • Read contact.wmkf_billcomid
     → populated: SOFT short-circuit — skip vendor create, reuse the id; still run search + invite + PNI write below
     → empty: BILL POST /v3/vendors → write vendorId to contact.wmkf_billcomid
   • BILL GET /v3/network?name=<reviewer full name>&scope=BILL&zipOrPostalCode=<zip>
     → if exactly one high-confidence match: POST /v3/network/invitation/vendor/{vendorId}
       (direct-connect to existing BILL network member); write wmkf_exisitngbillcomaccount = Yes;
       write PNI to wmkf_paymentnetworkidpni
     → else: write wmkf_exisitngbillcomaccount = No; log "no auto-connect"
   • Whether BILL auto-emails non-network vendors is a sandbox-time open question
     (see `docs/BILL_LIB_DESIGN.md` Q1 — hard-gates the UX promise of "no separate trip
     to a staff-only flow")
6. (Async, hours/days later) Reviewer completes BILL setup
7. BILL webhook → /api/webhooks/bill → (slice 1: verify signature + dedup + log + 200, no Dataverse write yet) → (later slice, after sandbox reveals payload shape): update wmkf_exisitngbillcomaccount to "Recently Confirmed"
8. Reviewer does the actual review; staff later flips wmkf_authorizationtoremitpaymentflag = true; payment routes
```

If a reviewer opts out of the honorarium (`honorariumOptOut = true`), step 4's honorarium-create + step 5 are skipped entirely.

### Honorarium `akoya_request` create body

```js
{
  akoya_requestid: <new GUID we pre-generate>,
  'akoya_ProgramId@odata.bind': '/akoya_programs(<Research Reviewer GUID>)',
  'wmkf_GrantProgram@odata.bind': '/wmkf_grantprograms(<Honorarium GUID>)',
  'wmkf_Type@odata.bind': '/wmkf_types(<Individual GUID>)',
  'akoya_PrimaryContactId@odata.bind': `/contacts(${reviewerContactId})`,
  // Q5 (per Connor 2026-05-26): link lives on the engagement junction
  // (wmkf_appreviewersuggestion), not on this honorarium row.
  // After the honorarium request is created, we PATCH
  // wmkf_appreviewersuggestions(${suggestionId}) with
  // { 'wmkf_HonorariumRequest@odata.bind': '/akoya_requests(<new honorarium id>)' }.
  akoya_request: <honorarium amount, e.g. 250>,
  wmkf_meetingdate: <cycle meeting date from suggestion>,
}
```

The grant request id is on the suggestion row (`wmkf_appreviewersuggestion`) the token resolves to — so we capture provenance trivially at create time. Without Q5's new field, the linkage is thrown away even though we know it.

### Post-create PowerAutomate enrichment (Connor-owned, non-gating)

After our portal creates the honorarium `akoya_request`, Connor will build a PowerAutomate flow that fires on create and populates additional fields on the request that we don't have at portal-accept time (or that are easier to derive Dataverse-side). Trigger: create of an `akoya_request` matching the honorarium discriminator (`akoya_program = "Research Reviewer"` + `wmkf_grantprogram = "Honorarium"` + `wmkf_type = "Individual"` + `wmkf_request_type = "Individual"`).

- **Owner:** Connor
- **Field list:** TBD by Connor
- **Gating:** Does **not** gate our portal build. Our integration creates the row with the fields enumerated above; Connor's flow enriches the rest async.
- **Reminder:** Surface this in S189+ session prompts until the flow is built, so it doesn't get lost.

### Deliberately omitted

- **No queue / retry sophistication.** ~85 reviewers/cycle = small N; alert-and-manual-retry is fine. We've built the heavyweight intake-portal drain pattern (`submission_jobs`); we deliberately don't reuse it here.
- **No GOapply replacement work.** The 8 already-touched 2026-06-04 honoraria stay on Steph's manual backfill path; the 77 are bookkeeping-only.
- **No 1099 / threshold tracking.** Worth designing later as a `contact`-level rollup of YTD honoraria. IRS threshold recently raised to $2K (from $600); buys runway.
- **No `wmkf_vendorverified` / `wmkf_paymentcontactconfirmed` writes.** Empirically not payment gates (appendix) but defensively untouched.

### Failure modes + handling

| Failure | Handling |
|---|---|
| BILL API down / 5xx | Honorarium request still created; alert sent ("BILL onboarding pending for #X"); Steph retries manually OR we add a small retry job later |
| BILL hourly rate-limit hit (`BDC_1144`) | Honorarium request still created; alert sent immediately ("BILL onboarding throttled — retry after quota reset"); per `lib/bill.js` policy we do NOT retry futilely against a 60-min window |
| BILL network search returns ambiguous match (multiple John Smiths) | Skip auto-connect; `wmkf_exisitngbillcomaccount = "No"`; alert Steph for manual confirmation |
| Reviewer's address incomplete on form | Form-level validation prevents submit **when the reviewer is taking the honorarium** (required fields: line1, city, postalCode, country, **phone** — phone added 2026-06-09). If they opt out, the address card is hidden and no address is collected. **The server now ENFORCES the same required set** on a non-opted-out accept — a missing/incomplete set returns `422 payment_contact_required` (`missingRequiredAddressFields`); `validateAddress` still owns shape/length/country-code validity only. **The S200 "provisional / server-optional / client-is-the-primary-gate" framing is RESOLVED for this cycle** (2026-06-09 BILL deferral → manual payment → address+phone definitely needed, 2026-06-10 server-enforced). Next cycle may relax if BILL self-registration captures the remittance address — see `project-reviewer-address-collection-provisional`. |
| `wmkf_billcomid` already populated (returning reviewer) | Soft short-circuit — skip BILL vendor create (reuse stored id); still run network search + invite + PNI write (network state may have changed since last cycle) |
| Webhook signature invalid | 401, log, no state change |
| Webhook duplicate delivery (BILL retry-replay) | Postgres dedup gate on `(subscription_id, event_id)` → 200, no further processing |
| Duplicate honorarium create (retry race) | Pre-generated GUID + duplicate-PK recovery (pattern already in `pages/api/cron/drain-submissions.js`) |
| Reviewer opts out of honorarium | Skip honorarium create + BILL entirely; suggestion-row accept still goes through |

---

## Six questions for Connor

### Q1. OK if our portal writes to `contact.wmkf_billcomid` on first-time BILL onboarding?

Today this field is empty for every reviewer we sampled. Writing it lets future cycles skip the vendor-create round-trip (network search + invite still happen, so network state stays fresh — see failure-modes table for the exact soft-short-circuit semantics).

Sub-question: also flip `contact.akoya_isvendor = true` at the same time, or leave for staff?

**Our recommendation:** Yes to writing `wmkf_billcomid`. Defer `akoya_isvendor` to staff (we don't know downstream consumers of that boolean).

**Connor's answer (2026-05-26):** Yes — write `wmkf_billcomid` on first-time onboarding, AND also flip `contact.akoya_isvendor = true` at the same time.

---

### Q2. OK if our portal writes to `wmkf_paymentnetworkidpni` on the honorarium request?

Staff currently enters this by hand; the values are inconsistent (proper 16-digit PNIs, "N/A", "5", `u`-prefix international format). Our integration would only write validated BILL-API-returned values on net-new portal-created rows. Steph's existing entries on the 8 partially-touched 2026-06-04 honoraria stay untouched (different create path).

**Our recommendation:** Yes, write to the existing field.

**Connor's answer (2026-05-26):** Yes.

---

### Q4a. OK if our portal writes to `wmkf_exisitngbillcomaccount` on the honorarium request?

The Yes/No/Recently Confirmed semantics map onto BILL's `GET /v3/network` response (searched by name + zip, NOT email — API constraint):
- Reviewer found in BILL Network and auto-connect sent → **Yes**
- Not found (or ambiguous match) → **No**
- `vendor.updated` webhook fires with `networkStatus = "CONNECTED"` → **Recently Confirmed**

Gives Steph a real status picklist she can filter on, using a field she already understands from the grantee side.

**Our recommendation:** Yes.

**Connor's answer (2026-05-26):** Yes.

---

### Q4b. Leave `wmkf_vendorverified` and `wmkf_paymentcontactconfirmed` alone on honorarium rows?

- `wmkf_vendorverified` = tax-status verification for 501(c)(3); doesn't apply to individual reviewers; empirically NOT a payment gate (see appendix).
- `wmkf_paymentcontactconfirmed` = grantee-org concern (who at the institution handles payments); doesn't translate to individuals.

Defensive recommendation: leave both null so a future workflow change doesn't accidentally interpret an integration-set value.

**Our recommendation:** Yes, leave both untouched.

**Connor's answer (2026-05-26):** Yes — leave both `wmkf_vendorverified` and `wmkf_paymentcontactconfirmed` untouched on honorarium rows.

---

### Q5. Add `wmkf_honorariumforrequest` lookup on `akoya_request` to capture honorarium↔grant provenance?

Today Amy's honorarium #1002764 has zero data link back to grant #1002238 (the Utah State proposal she reviewed). Our portal **knows** which grant the reviewer is reviewing (it's on the suggestion row the token resolves to), so we can populate this at create time — but only if the field exists.

Proposed new optional Lookup field (per Connor 2026-05-26, refined):
- Name: `wmkf_HonorariumRequest`
- **Lives on:** `wmkf_appreviewersuggestion` (the per-(reviewer, request) engagement junction) — NOT on `akoya_request`, and NOT on `wmkf_potentialreviewer` (which is the per-person record, not the per-engagement junction; an earlier draft of this doc conflated the two)
- **Target entity:** `akoya_request` (the honorarium row)
- **Direction:** junction → honorarium (the junction row points at its honorarium)
- Required: no
- Populated by: our portal at honorarium-request creation time — PATCH the junction row with the new honorarium request id. Backfill: out of scope.

Downstream payoff:
- "How much did we spend on reviewers for the Medical Research cycle?" becomes a single query instead of a five-lookup join
- Catches the data-quality "ghost honorarium" case (honorarium with no corresponding grant assignment)
- Personalized BILL invitation emails can mention the proposal being reviewed

**This question is the only one that blocks the portal-extension slice (chunk 4)** — without the field, we lose provenance we know at create time. The earlier `lib/bill.js` + webhook-scaffold slice (chunks 2, 3, 7a) doesn't depend on Q5 and can ship while you're deciding.

**Our recommendation:** Yes. One small Dataverse change, ongoing value.

**Connor's answer (2026-05-26):** Yes, but with a refinement — the more important link is between the **reviewer/request junction record and the honorarium request**, not honorarium → grant request directly. The junction already carries the grant request, so we still get provenance to the grant via one hop, AND we preserve which specific reviewer-of-this-proposal assignment the honorarium pays out.

**Final shape (Connor 2026-05-26; host entity reconfirmed S196 2026-05-28):** new lookup `wmkf_HonorariumRequest` **on `wmkf_appreviewersuggestion`** (the per-(reviewer, request) engagement junction), target `akoya_request`. The junction row points at its honorarium. Our portal PATCHes the junction with the new honorarium id at create time (we already have the junction id — it's what the token resolves to). Connor owns creating the field.

---

### Q6. Adopt "grant request" vs "honorarium request" as canonical staff terminology?

Both are `akoya_request` rows but they describe very different things. Worth a small alignment exercise so you, Steph, and the staff use the two terms distinctly in tickets, emails, and conversation. No-op if you'd rather keep current phrasing — we just need to be precise in code/docs regardless.

**Our recommendation:** Yes.

**Connor's answer (2026-05-26):** Yes — adopt internally to avoid confusion.

---

### Q7 (informational, not blocking). What does the GOapply "Reviewer Information Form" you built capture?

We tried to enumerate the fields from Dataverse and couldn't (GOapply form responses aren't persisted as discrete rows; `akoya_akoyaapplyresponse` is empty across the org). Since the portal owns the reviewer journey going forward, replicating the GOapply form 1:1 isn't required — but knowing what reviewers were being asked helps us decide what to include in the portal form.

Four sub-questions:
- a. What fields does the form collect? (Identity / address / phone / banking / other?)
- b. Is there an "I accept the honorarium" gate, or is form submission alone the implicit acceptance?
- c. Any legal text? (W-9 collection, 1099 disclosure, terms of agreement.)
- d. How does the reviewer get the link? (Email triggered by what event?)

No recommendation — just inputs to our portal design.

**Connor's answer (2026-05-26):** Form definition JSON shared (`Phase_160354dd-3feb-f011-8543-6045bd02b4cc_FormDefinition_2026-02-26T18-24-28Z.json`). Concrete contents:

**a. Fields collected** (all map to existing Dataverse — already covered by our portal extension):
- **Contact panel** (dynamic, → `contact`): salutation, firstname, middlename, lastname, emailaddress1, adx_organizationname, jobtitle, telephone1, address1_line1, address1_line2, address1_city, address1_stateorprovince, address1_postalcode, address1_country
- **"Do you have a Bill.com account?"** radio (Yes / No, **required**)
- **BILL.com block** (all optional text — staff infers from radio above): organization_name_on_bill_com_account, email_address_on_bill_com_account, payment_network_id__pni_, bill_com_street_1/2/city/state/zip_code/country
- **No banking fields** (account/routing) — confirms BILL.com handles all banking detail; Dataverse stores only onboarding-status + PNI pointer (matches the [no-banking-PII-in-Dataverse](../.claude-memory/project-no-banking-pii-in-dataverse.md) constraint)
- **Hidden fields** auto-write to `akoya_request`:
  - `akoya_recommendedamount` defaulted to `$250`
  - `wmkf_request_type` defaulted to `Individual` (`682090001`) — confirms our discriminator update earlier in this doc

**b. Acceptance gate:** No separate "I accept the honorarium" gate. The form has a **required 4-checkbox confidentiality block** (`question4`) that gates submission — items cover confidentiality of proposal contents, AI/LLM training prohibition, no sharing with colleagues, destroy copies after review. Form submission with all four checked = implicit acceptance. Our portal already covers this with the policy-ack cards (Stage 2a).

**c. Legal text:** No W-9 / 1099 disclosure / banking ToS — just the four-item confidentiality + AI-use terms (full text preserved in `question4.choices` in the JSON if we ever need to mirror the exact wording).

**d. Link delivery:** Connor 2026-05-26 — "more or less" confirms the PowerAutomate-on-honorarium-create trigger model. Exact wiring isn't material to our build: our portal delivers the magic link itself via the existing Review Manager invite, so the GOapply trigger path is being retired alongside the form.

**Portal-coverage takeaway:** The GOapply form is fully subsumed by our portal-extension plan. Contact panel ≡ existing `contactEdits` + new address fields. BILL block ≡ our `/api/bill/onboard-reviewer` integration (we replace manual data entry with API-returned PNI). Confidentiality block ≡ existing Stage 2a policy-ack cards. Hidden field defaults ($250 + `wmkf_request_type=Individual`) ≡ our honorarium-create body. No new fields to add to the portal beyond what's already in the plan.

---

## What gets built

| # | Chunk | Owner | Depends on |
|---|---|---|---|
| 0 | This design doc → Connor sign-off | Connor | (none) |
| 1 | ✅ SHIPPED 2026-05-28 — Connor added `wmkf_HonorariumRequest` lookup on `wmkf_appreviewersuggestion` → `akoya_request`, RequiredLevel=None | Connor | Q5 answered yes |
| 1b | Connor builds post-create PowerAutomate enrichment flow on honorarium `akoya_request` (non-gating; field list TBD) | Connor | (none — parallel) |
| 2 | `lib/bill.js` — session, create vendor, search/invite network, against a mocked BILL response | Vercel | (none — parallel with Connor) |
| 3 | Unit tests for `lib/bill.js` | Vercel | Chunk 2 |
| 4 | Extend reviewer accept flow: `respond.js` validates/stages address fields and the reviewer-acceptance drain patches contact.address1_* + creates honorarium `akoya_request` with provenance | Vercel | Chunk 1 |
| 5 | ✅ SHIPPED 2026-05-29 (S200) — Stage 2a accept UI address card: country picker over the **complete** ISO 3166-1 alpha-2 set (`shared/config/countries.js`, 249 codes incl. territories — no curated subset that could hard-block a reviewer; `normalizeCountryToIso2` coerces stored full-name/alpha-3 prefill → alpha-2), required-when-honorarium / hidden-on-opt-out, prefill from promoted `contact.address1_*` via context endpoint, server 400-reason surfacing + `aria-describedby` field errors. Codex stop-time + full review folded (completeness over free-text fallback to keep data clean; ISO-3 prefill; territory/ISO-3 + opt-out/prefill component tests). Address collection was flagged **provisional** at S200, but is **RESOLVED for this cycle** (2026-06-09 BILL deferral → manual payment → address+phone definitely needed) and is now **server-enforced** (`422 payment_contact_required`); phone field added + required 2026-06-09. Next cycle may relax — see failure-modes note + `project-reviewer-address-collection-provisional`. | Vercel | Chunk 4 |
| 6 | New `/api/bill/onboard-reviewer` endpoint; wire into accept handler | Vercel | Chunks 2 + 4 |
| 7a | `/api/webhooks/bill` scaffold (verify + dedup + log + 200; no Dataverse writes) | Vercel | Chunk 2 |
| 7b | Wire `vendor.updated` → PATCH `wmkf_exisitngbillcomaccount` to "Recently Confirmed" (lands once sandbox reveals payload shape so correlator is concrete) | Vercel | Chunk 7a + sandbox observation |
| 8 | End-to-end test against BILL sandbox + synthetic reviewer | Vercel + Justin | Chunks 4, 5, 6, 7a, 7b; BILL sandbox |

**Dataverse schema changes:** one optional lookup (Q5). Everything else writes to existing fields.

**External provisioning (operator-side, parallel):**
- BILL.com sandbox access — Steph (Director of Operations) + BILL.com support
- Env vars in Vercel: `BILL_DEV_KEY`, `BILL_USERNAME`, `BILL_PASSWORD`, `BILL_ORG_ID`, `BILL_BASE_URL`, `BILL_WEBHOOK_SECRET`

---

## Timeline

- **2026-06-10** — ready
- **2026-06-17 (no earlier)** — first real reviewer invitation goes out

Sequencing between those two dates is flexible and depends on when Connor's Q5 schema add lands and when Steph's BILL sandbox is provisioned. Build chunks are listed in the prior section in dependency order; nothing about the order is calendar-pinned.

**Fallback if BILL sandbox isn't ready in time:** ship in "alert-only mode" — portal creates the honorarium request, emails Steph "manual BILL onboarding needed for #X"; flip on real BILL calls when sandbox lands. The reviewer-facing experience is identical either way. **[SUPERSEDED 2026-06-09 — leadership deferred automated BILL onboarding to next cycle; this cycle uses the silent `BILL_ONBOARDING_DEFERRED` gate (`status: 'deferred'`, no alert), NOT alert-only. See the current-cycle update at the top of this doc.]**

---

## Appendix — `wmkf_vendorverified` field-gating audit

Probe 2026-05-25 confirmed `wmkf_vendorverified=No` does NOT silently block payment.

**Evidence layer 1: paid grant requests with `vv=No` on the parent.** Five direct examples — all five have an `akoya_requestpayment` child with `akoya_folio = "PAID"`:

```
#1002814  paid=$2000  vv=No  →  payment #0024025  folio=PAID
#1002779  paid=$200   vv=No  →  payment #0023976  folio=PAID
#1002799  paid=$2500  vv=No  →  payment #0024022  folio=PAID
#1002060  paid=$2500  vv=No  →  payment #0023661  folio=PAID
#1002795  paid=$1000  vv=No  →  payment #0024020  folio=PAID
```

**Evidence layer 2: population scan.** Sampled 500 `akoya_requestpayment` rows where `akoya_paymentsent` is populated. Of 473 distinct parent grant requests: **473 null, 0 Yes, 0 No, 0 Recently Confirmed.**

**Evidence layer 3: reverse direction.** Across all `akoya_request` rows ever, only **4 total** are `vv=Yes` AND still unpaid. No "approved but not yet paid" queue exists.

**Real gates observed elsewhere (not our concern, documented):**
- `wmkf_executivedirectorapproval` (DateTime on `akoya_requestpayment`) — ED has to sign off per payment
- `wmkf_authorizationtoremitpaymentflag` (Boolean on `akoya_request`) — staff explicit pay authorization

**Naming gotcha:** `akoya_paymentsent` (DateTime, "Payment Sent") is null on all 5 sampled paid grants. The actual issued-marker is `akoya_folio = "PAID"`. If querying for actual payment events, use `akoya_folio` not `akoya_paymentsent`.

**Conclusion:** `wmkf_vendorverified` doesn't gate payment. Defensive recommendation in Q4b stands: integration leaves it null on honorarium rows.
