---
name: Reviewer honorarium onboarding (portal-integrated)
description: Reviewer portal accept-action creates the honorarium akoya_request + triggers BILL.com onboarding inline. Extends already-shipped Stage 2a. Targets ready 2026-06-10; reviewers ≥ 2026-06-17. Approved by Ops 2026-05-23; design doc has 6 Connor questions + 1 informational.
metadata:
  type: project
---

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
5. Q5 — **REQUIRED** — add `wmkf_honorariumforrequest` self-referential lookup on `akoya_request`. Our portal knows the linkage at create time; without this field we throw it away.
6. Q6 — adopt "grant request" vs "honorarium request" as canonical staff terminology? (rec: yes)
7. Q7 — informational — what does the current GOapply "Reviewer Information Form" capture? (We're replacing it, not replicating 1:1; informs portal form design but doesn't block.)

**Build chunks:**
- 0: design doc → Connor sign-off
- 1: Connor schema add (Q5)
- 2-3: `lib/bill.js` + unit tests against mock (parallel with Connor, no dependency)
- 4: extend `respond.js` accept path
- 5: extend Stage 2a accept UI with address inputs
- 6: `/api/bill/onboard-reviewer` endpoint + wire into accept handler
- 7: `/api/webhooks/bill`
- 8: end-to-end test against BILL sandbox

**Q3 (PA + shared-secret) is dropped from the doc.** The portal calls our BILL endpoint directly; no PA trigger needed.

**External (operator-side, parallel):**
- BILL.com sandbox via Steph (Director of Operations) + BILL.com support
- Vercel env vars: `BILL_DEV_KEY`, `BILL_USERNAME`, `BILL_PASSWORD`, `BILL_ORG_ID`, `BILL_BASE_URL`, `BILL_WEBHOOK_SECRET`
- **Fallback if sandbox isn't ready by ~June 7:** ship in "alert-only mode" — portal creates honorarium, emails Steph "manual BILL onboarding needed"; flip on real BILL calls when sandbox lands.

**Why:** Ops team meeting 2026-05-23 approved BILL integration. Pre-existing BILL integration (AkoyaGO for institutional grantee payouts) means legal/policy posture is already established — no new financial connector, no new data category. Skipping GOapply entirely (not just for honoraria onboarding, but for the whole reviewer-payment-info flow) removes a UX hop AND a dependency we don't control.

**How to apply:**
- Don't reintroduce PA-trigger framing in design conversations — that path is closed.
- The `wmkf_appreviewersuggestion` row carries the grant linkage; use it as the provenance source when populating `wmkf_honorariumforrequest`.
- Existing Stage 2a primitives (token verify, state machine, optimistic locking, audit, rate limit, policy ack) handle all the auth/safety concerns — extension is purely additive.
- Related: [[akoya-request-honorarium-nomenclature]], [[akoya-payment-field-semantics]], [[project-external-reviewer-file-access]] (Stage 2a primitives), [[project-reviewer-lifecycle]].
