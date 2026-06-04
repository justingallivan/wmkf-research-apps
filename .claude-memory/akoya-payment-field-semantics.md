---
name: akoya_request / akoya_requestpayment field-gating semantics
description: wmkf_vendorverified is NOT a payment gate (empirically). akoya_paymentsent is misleading — akoya_folio="PAID" is the real "money went out" signal. Two real gates exist: ED approval + authToRemit flag.
metadata:
  type: project
  status: active
  scope: bill
  last_verified: S188 via memory-content (not re-probed 2026-06-04)
---

## Recall Rule

Read this when: reasoning about whether a Dataverse `akoya_request`/`akoya_requestpayment` field gates a payment workflow, or writing BILL/honorarium payment-related code.

Do:
- Use `akoya_folio="PAID"` as the issued-payment signal, not `akoya_paymentsent` (which is null on sampled paid grants).
- Look for paid-and-not-verified counter-examples before assuming any field is a gate.
- Leave `wmkf_vendorverified` / `wmkf_paymentcontactconfirmed` null defensively; it's fine to write `wmkf_exisitngbillcomaccount`.

Do not:
- Treat `wmkf_vendorverified=No` as "do not pay" — it's a tax-status tracker, sparsely populated, orthogonal to the payment flow.
- Assume `akoya_paymentsent` (DateTime) reliably means money went out.

Ground truth: `docs/BILL_HONORARIUM_INTEGRATION_DESIGN.md` (full appendix); S188 population scans on `akoya_request`/`akoya_requestpayment`. Real gates: `wmkf_executivedirectorapproval`, `wmkf_authorizationtoremitpaymentflag`.

S188 probe (2026-05-25) audited which `akoya_request` / `akoya_requestpayment` fields actually gate payment activity vs. which are sparsely-populated tracking conveniences. Findings worth preserving so the next investigator doesn't re-litigate.

**`wmkf_vendorverified` (Picklist Yes/No/Recently Confirmed) is NOT a payment gate.** It's a tax-status verification tracker (relevant for 501(c)(3) grantee due diligence) and is sparsely populated across the request table. Three layers of evidence:
1. Five paid grant requests with `vv=No` on the parent — all have `akoya_requestpayment` children with `akoya_folio="PAID"`: #1002814 ($2K), #1002779 ($200), #1002799 ($2.5K), #1002060 ($2.5K), #1002795 ($1K).
2. Population scan of 473 distinct parent grant requests of issued payments: 473 null, 0 Yes, 0 No, 0 "Recently Confirmed". Field is just orthogonal to the payment flow.
3. Reverse direction: only 4 rows total across all history are `vv=Yes` AND still unpaid. No "approved but not yet paid" queue would exist if this were a positive payment signal.

**`akoya_paymentsent` (DateTime, "Payment Sent") is misleading.** Null on all 5 sampled paid grants. The actual issued-marker is `akoya_folio = "PAID"` on `akoya_requestpayment`. The DateTime is from a newer/different flow path and isn't reliable as "money went out." **If querying for actual payment events, use `akoya_folio` not `akoya_paymentsent`.**

**Real gates that DO exist (documented for awareness, not necessarily our concern):**
- `wmkf_executivedirectorapproval` (DateTime on `akoya_requestpayment`) — ED has to sign off per payment
- `wmkf_authorizationtoremitpaymentflag` (Boolean on `akoya_request`) — staff explicit pay-authorization gate

**Other field semantics surveyed:**
- `wmkf_exisitngbillcomaccount` (Picklist Yes/No/Recently Confirmed) — actively used on grantee-org flow (385 non-null rows: 270 Yes / 115 No). Semantically maps to BILL's "is this entity in our network?" — appropriate for honorarium integration to write to.
- `wmkf_paymentcontactconfirmed` (Picklist) — 398 non-null (357 Yes / 32 Recently Confirmed / 9 No). Grantee-org concern (who at the institution handles payments); doesn't translate to individuals.

**Why:** During S188 design of [[project-bill-honorarium-integration]], Justin flagged the legitimate concern that `wmkf_vendorverified=No` might be silently interpreted as "do not pay" by some downstream flow — which would have blocked the entire honorarium-onboarding integration for individual reviewers (who never have nonprofit tax status). The empirical audit dismissed this.

**How to apply:**
- When reasoning about whether a Dataverse field gates a workflow, look for actual paid-and-not-verified counter-examples before assuming a gate exists.
- For BILL/payment-related code: use `akoya_folio="PAID"` as the issued-payment signal, not `akoya_paymentsent`.
- For honorarium-flow code: leave `wmkf_vendorverified` and `wmkf_paymentcontactconfirmed` null defensively (avoid setting them to "No" which a future flow could misread). It's fine to write to `wmkf_exisitngbillcomaccount` — semantics align.
- Full appendix in `docs/BILL_HONORARIUM_INTEGRATION_DESIGN.md`.
