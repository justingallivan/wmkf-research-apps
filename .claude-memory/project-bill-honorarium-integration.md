---
name: Reviewer honorarium onboarding (portal-integrated)
description: Reviewer portal accept-action creates the honorarium akoya_request + (when enabled) triggers BILL.com onboarding inline. Extends already-shipped Stage 2a. AUTOMATED BILL ONBOARDING DEFERRED for the current cycle by leadership (2026-06-09) — re-enable NEXT cycle. Code intact behind reversible BILL_ONBOARDING_DEFERRED gate; honorarium row + mailing-address(+phone) capture still run.
metadata:
  type: project
  status: active
  scope: bill
  last_verified: 2026-06-09 — code re-grounded (chunk 5 shipped; deferral gate added)
---

## Recall Rule

Read this when: touching reviewer honorarium onboarding, the BILL.com integration, the Stage 2a accept path, or honorarium `akoya_request` creation.

Do:
- Treat the architecture as portal-integrated (Stage 2a accept extension), not PA-triggered.
- Read provenance from the `wmkf_appreviewersuggestion` junction; the honorarium→grant lookup nav-property is `wmkf_HonorariumRequest` (bind `wmkf_HonorariumRequest@odata.bind`, read `_wmkf_honorariumrequest_value`).
- Treat honorarium amount as the Dataverse setting `honorarium.default_amount`, not an env var.

Do not:
- Reintroduce PA-trigger / shared-secret (Q3) framing — that path is closed.
- Use `wmkf_honorariumforrequest` — it's a dead variant.
- Rebuild shipped chunks (lib/bill primitives, chunk-4 orchestrator, chunk-5 address UI, webhook dispatch). Chunk 5 (address UI) SHIPPED (commits `96baeb2` + `b4c91f0`); webhook event-dispatch built. Only remaining gap is e2e against the BILL sandbox (chunk 8, blocked on Steph) — and that is moot for THIS cycle (see deferral below).
- **DON'T re-enable BILL this cycle.** Leadership deferred automated bill.com onboarding to NEXT cycle (2026-06-09). The gate is on; flipping it back on is a next-cycle action, not a "finish the integration" task.

**⚠️ CURRENT-CYCLE STATUS (2026-06-09): automated BILL onboarding DEFERRED by leadership.** Re-enable NEXT cycle. Implemented as a reversible gate, NOT a teardown — no BILL code removed:
- `lib/bill/onboard-reviewer-service.js` short-circuits to `status: 'deferred'` (no BILL call, **no alert**) when `process.env.BILL_ONBOARDING_DEFERRED === 'true'`. Distinct from `alert_only` ("BILL not wired yet, onboard by hand"); deferred = no BILL onboarding at all this cycle, payment handled manually offline.
- The honorarium `akoya_request` create + mailing-address PATCH still run on accept (orchestrator steps 2–3), so the $250 payment record is intact — paid manually this cycle (Excel-style, per [[akoya-request-honorarium-nomenclature]]).
- **Phone now required + collected** in the Stage 2a payment-address card (`shared/components/external/Stage2aView.js`), validated server-side (`respond.js` `ADDRESS_MAX.phone`), persisted to `contact.address1_telephone1` (orchestrator `patchContactAddress`), and carried as `reviewerPhone` on the BILL payload next cycle (orchestrator reads `body.address.phone`).
- **Re-enable next cycle:** unset `BILL_ONBOARDING_DEFERRED`, set BILL creds + option-set values, flip `BILL_ENABLED=true`. Confirm `HONORARIUM_*_ID` discriminator GUIDs are set (honorarium-create needs them regardless of BILL).
- Shipped on branch `feat/reviewer-onboarding-no-bill-this-cycle`.

Ground truth: `docs/BILL_HONORARIUM_INTEGRATION_DESIGN.md`, `docs/BILL_CHUNK_4_DESIGN.md`, `docs/BILL_LIB_DESIGN.md`; `lib/bill/*`. Related: [[akoya-payment-field-semantics]], [[akoya-request-honorarium-nomenclature]], [[project-external-reviewer-file-access]].

**Status (S188, 2026-05-25):** Design doc at `docs/BILL_HONORARIUM_INTEGRATION_DESIGN.md`. **Architecture pivoted from PA-triggered backend-only to portal-integrated** after discovering Stage 2a accept endpoint is already shipped (since 2026-05-09) and only needs extension. No GOapply replacement work needed.

**The pivot.** Original BILL handoff doc + first design draft assumed AkoyaGO/GOapply would keep creating honorarium `akoya_request` rows and our integration would just be a PA-triggered BILL onboarding hook. After Justin pushed on the architecture question, we realized: the reviewer portal already owns the accept flow (`pages/external/review/[token]` + `/api/external/review/[token]/respond` shipped S144). Extending that handler to (a) capture address, (b) create the honorarium request with provenance, (c) trigger BILL inline is dramatically simpler than maintaining a GOapply dependency. Single architecture, single phase.

**The flow (one architecture, not phases):**
1. Staff invites reviewer → magic-link email (existing Review Manager)
2. Reviewer clicks link, lands on Stage 2a, sees policy cards, enters address, accepts (existing UI + new address fields)
3. `respond.js` accept path: existing state machine + contactEdits PATCH + policy ack + audit + **NEW** create honorarium `akoya_request` + **NEW** call `/api/bill/onboard-reviewer`
4. BILL endpoint: short-circuit if `contact.wmkf_billcomid` populated; else create vendor → search network → invite
5. Webhook handles `vendor.updated` → flips `wmkf_exisitngbillcomaccount` to "Recently Confirmed"
6. Staff retains `wmkf_authorizationtoremitpaymentflag` as final pay-out gate (integration never touches it)

**Honorarium opt-out (`honorariumOptOut` boolean on accept body) already exists** in the Stage 2a handler — when true, skip honorarium-create + BILL entirely; the suggestion-row accept still goes through.

**Timeline (only two real dates):**
- 2026-06-10 — ready
- 2026-06-17 (no earlier) — first real reviewer invitation
Sequencing between is flexible and depends on Connor's Q5 schema add + Steph's BILL sandbox availability.

**Six Connor questions + 1 informational (per design doc):**
1. Q1 — write `contact.wmkf_billcomid` going forward? (rec: yes; defer `akoya_isvendor` to staff)
2. Q2 — write `wmkf_paymentnetworkidpni` programmatically? (rec: yes; portal-create path doesn't collide with Steph's 8 backfilled rows)
3. Q4a — write `wmkf_exisitngbillcomaccount` (Yes/No/Recently Confirmed)? (rec: yes, maps to BILL `GET /v3/network`)
4. Q4b — leave `wmkf_vendorverified` and `wmkf_paymentcontactconfirmed` alone? (rec: yes — see [[akoya-payment-field-semantics]])
5. Q5 — **CLOSED (shipped 2026-05-28)** — Connor added the lookup as `wmkf_HonorariumRequest` **on `wmkf_appreviewersuggestion`** → `akoya_request` (NOT a self-referential lookup on `akoya_request` as the early draft proposed; the junction carries the grant linkage, so provenance to the grant is one hop). Set by chunk-4 at honorarium-create time.
6. Q6 — adopt "grant request" vs "honorarium request" as canonical staff terminology? (rec: yes)
7. Q7 — informational — what does the current GOapply "Reviewer Information Form" capture? (We're replacing it, not replicating 1:1; informs portal form design but doesn't block.)

**Build chunks:**
- 0: design doc → Connor sign-off
- ~~1: Connor schema add (Q5)~~ **SHIPPED 2026-05-28** — `wmkf_HonorariumRequest` lookup on `wmkf_appreviewersuggestion` → `akoya_request` (Connor moved it to the junction, not on `akoya_request`; provenance to the grant is one hop via `wmkf_Request`).
- ~~2-3: `lib/bill.js` + unit tests against mock~~ **SHIPPED S188** — primitives at `lib/bill/{index,session,classify,errors,redact}.js` (vendor / network / invitation / webhook-verify); see `docs/BILL_LIB_DESIGN.md` v3.
- ~~4: extend `respond.js` accept path~~ **SHIPPED S199 (2026-05-29, commits 7cb8bc4 + 290ba68)** — `lib/bill/honorarium-onboard-orchestrator.js` (promote-on-accept + address PATCH + idempotent honorarium create w/ DETERMINISTIC uuidv5 GUID per suggestion + junction PATCH + in-process `onboardReviewer()` call). Plus **amount-as-Dataverse-setting** (`honorarium.default_amount` in `wmkf_appsystemsettings`, `lib/services/honorarium-config.js`, admin UI, per-user pref removed) + **Full-real-fix hardening** (`bill_onboarding_state` table migration 017, reserve-before-create, vendorId-before-contact-PATCH, torn-state resume sweep + stuck reconcile). Design: `docs/BILL_CHUNK_4_DESIGN.md`. Codex pre+post-impl reviewed.
- ~~5: extend Stage 2a accept UI with address inputs~~ **SHIPPED** (`96baeb2` + `b4c91f0`) — `shared/components/external/Stage2aView.js` payment-address card (line1/line2/city/state/postalCode/country ISO-2). **Phone field added 2026-06-09** (required; persisted to `contact.address1_telephone1`). **Server-side presence now ENFORCED (2026-06-10, Codex post-impl catch):** a non-opted-out FRESH accept must carry the full required set (line1/city/postalCode/country/phone) or `respond.js` returns `422 payment_contact_required` (helper `missingRequiredAddressFields`). `validateAddress` still owns only shape/length/country-code (lenient on emptiness, 400 on malformed); the presence guard is separate. Rationale: this cycle pays manually, so the server — not just the client form — must guarantee a contact address + phone on a public token endpoint. Re-accept (idempotent honorarium retry) is NOT re-blocked. Opt-out reviewers skip the guard entirely.
- ~~6: `/api/bill/onboard-reviewer` endpoint~~ **SHIPPED S189** (chunk-4 calls `onboardReviewer()` in-process, not via HTTP — see design doc deviation note).
- ~~7a: `/api/webhooks/bill` scaffold~~ **SHIPPED S188** at `pages/api/webhooks/bill.js`; event-dispatch + Dataverse PATCH (7b) still pending.
- 8: end-to-end test against BILL sandbox — blocked on Steph's sandbox provisioning.

**Operational setup before BILL_ENABLED=true (chunk-4 reads these, fail-loud):** env GUIDs `HONORARIUM_PROGRAM_ID` / `HONORARIUM_GRANTPROGRAM_ID` / `HONORARIUM_TYPE_ID` (resolve via `scripts/probe-honorarium-discriminators.js`) + `BILLCOM_ACCOUNT_{YES,NO,RECENTLY_CONFIRMED}_VALUE` (probe-bill-option-set-values.js) + the migration 017 applied. The honorarium amount is a Dataverse setting, not an env var.

**Q3 (PA + shared-secret) is dropped from the doc.** The portal calls our BILL endpoint directly; no PA trigger needed.

**External (operator-side, parallel):**
- BILL.com sandbox via Steph (Director of Operations) + BILL.com support
- Vercel env vars: `BILL_DEV_KEY`, `BILL_USERNAME`, `BILL_PASSWORD`, `BILL_ORG_ID`, `BILL_BASE_URL`, `BILL_WEBHOOK_SECRET`
- **Fallback if sandbox isn't ready by ~June 7:** ship in "alert-only mode" — portal creates honorarium, emails Steph "manual BILL onboarding needed"; flip on real BILL calls when sandbox lands. **[SUPERSEDED 2026-06-09 — leadership deferred automated BILL onboarding to next cycle; this cycle uses the silent `BILL_ONBOARDING_DEFERRED` gate (no alert), not alert-only. See current-cycle status block above.]**

**Why:** Ops team meeting 2026-05-23 approved BILL integration. Pre-existing BILL integration (AkoyaGO for institutional grantee payouts) means legal/policy posture is already established — no new financial connector, no new data category. Skipping GOapply entirely (not just for honoraria onboarding, but for the whole reviewer-payment-info flow) removes a UX hop AND a dependency we don't control.

**How to apply:**
- Don't reintroduce PA-trigger framing in design conversations — that path is closed.
- The `wmkf_appreviewersuggestion` row carries the grant linkage; use it as the provenance source when populating the honorarium→grant lookup, whose real nav-property is `wmkf_HonorariumRequest` (set via `wmkf_HonorariumRequest@odata.bind`, read as `_wmkf_honorariumrequest_value`) — NOT `wmkf_honorariumforrequest` (a dead variant; see lines 32/38). [verified S209]
- Existing Stage 2a primitives (token verify, state machine, optimistic locking, audit, rate limit, policy ack) handle all the auth/safety concerns — extension is purely additive.
- Related: [[akoya-request-honorarium-nomenclature]], [[akoya-payment-field-semantics]], [[project-external-reviewer-file-access]] (Stage 2a primitives), [[project-reviewer-lifecycle]].
