---
name: Reviewer honorarium onboarding→payment reality (current-state, reverse-engineered)
description: How reviewer honoraria actually get onboarded and (don't) get paid today, reverse-engineered from live Dataverse probes 2026-06-27. Core finding for Steph/Ops "mimic Rosie's grant flow" ask: the AkoyaGO payment engine has NEVER paid an individual (0/9,151 disbursements) — it is rail-agnostic but payee-bound to institutions. The gap is the vendor+payment tail, not onboarding.
metadata:
  type: project
  status: active
  scope: bill
  last_verified: 2026-06-27 — live Dataverse probes this session
---

## Recall Rule

Read this when: responding to Ops/Steph about paying reviewers, designing or
scoping any honorarium-payment path, or weighing "mimic Rosie's grant→BILL
workflow for honoraria." Pairs with [[akoya-payment-field-semantics]] (field
detail), [[akoya-request-honorarium-nomenclature]] (person-vs-institution
discriminators), [[project-bill-honorarium-integration]] (the deferred portal
build). Numbers below are live-probed 2026-06-27; re-probe before treating as
current next cycle.

## The ask (context)
Steph (Director of Ops) confirmed BILL is NOT integrating with the reviewer
module this cycle, but wants Ops to "mimic the existing Akoya→BILL grant-payment
workflow Rosie runs" so reviewer honoraria can be pulled into BILL, vendor'd, and
paid — minus the BILL→Akoya payment-status feedback loop. Rosie = payments
operator. Connor/Sarah = AkoyaGO admins (Connor backend, Sarah frontend+staff;
Sarah Hibler is internal and does folio releases). "BCO"/Bromelkamp = the AkoyaGO
vendor.

## Reverse-engineered current-state chain (all [VERIFIED via probe] unless noted)
```
1. Staff (Rosie, [INFERRED — upstream in GoApply, not in Dataverse]) invites each
   reviewer into GoApply.            ← 87/87 honoraria have a per-reviewer
                                        akoya_goapplyinviteurl; invite precedes
                                        registration (median 3.6d, 82/87 before).
2. Reviewer SELF-registers in GoApply under their OWN email.
                                      ← 87/87 self-submitted (73 exact + 14 same
                                        person alt-email); 0 staff/@wmkeck.org.
3. AkoyaGO sync provisions the contact + honorarium akoya_request in Dataverse.
   createdby = "# BCO akoyaGO Integration"; portal acct adx_createdbyusername =
   bromelkampadmin@wmkeck.org (uniform across all 87 — a system/vendor account,
   NOT per-reviewer human entry); akoya_entitysource = GOapply. Contact created
   as a NON-vendor (akoya_isvendor=false, 0/87 ever true; 0/87 wmkf_billcomid).
4. Connor MANUALLY classifies the honorarium the next day — sets program=Research
   Reviewer, wmkf_grantprogram=Honorarium, wmkf_type/request_type=Individual,
   amount, meeting date (e.g. #1002764 created 2-18 by the sync, classified 2-19
   by Connor Noda). The one staff step visible in Dataverse.
5. …then nothing. No vendor record, no akoya_requestpayment row. Paid by physical
   check OFFLINE last cycle (no approval needed — see below). Rosie never touched
   Amy Gladfelter's honorarium #1002764 (0 audit entries by her).
```

## The wall (the actual gap for "mimic Rosie's flow")
- **The AkoyaGO payment engine has NEVER paid an individual.** Of **9,151**
  completed (akoya_folio="PAID") disbursements in the entire system, **100% went
  to an `account` (institution); 0 to a `contact` (person)**. The payee model is
  structurally account-bound (`akoya_payee` → account).
- **Honoraria have zero payment substrate:** 0/88 individual (Scholarship-type)
  requests have any `akoya_requestpayment` child. Grants get their folio=PAID
  Payment child from AkoyaGO's award process; honoraria have no equivalent.
- **The vendor record is account-bound too:** orgs carry `account.wmkf_billcomvendorid`
  + `akoya_isvendor=true` (e.g. Utah State #1002238 = "00901SAWVXCGEX3pth8g");
  individuals would need it on `contact.wmkf_billcomid`, which nothing populates.
  See [[akoya-payment-field-semantics]].
- So "mimic Rosie's grant flow for honoraria" asks the payment engine to do the
  one thing it has never done in 9,151 payments — **pay a person**. That is a
  payee-model capability question for **Connor/Sarah/Bromelkamp** (can AkoyaGO take
  a `contact` payee at all?), NOT a portal task, a missing row, or a rail choice.

## The machinery is rail-agnostic; BILL is just one rail
- Pre-BILL grant #997034 (Tufts, $1.2M) was paid by **ACH** through the SAME
  `akoya_requestpayment` + `akoya_folio` machinery — no BILL fields at all. The
  payment-reference field `wmkf_billcompaymentid` held `ACH7052935` (it's a
  generic reference field, not BILL-only; held a BILL id on the Utah State grant).
  `akoya_disbursementtype` is unreliable (said "Check" on the ACH payment).
- So the payment engine predates BILL and carries ACH/check/BILL interchangeably.
  **Honoraria may not need the BILL integration at all** — the blocker is the
  payee-is-a-person wall, upstream of the rail choice.

## Approvals are two-stage (board concurrence is NOT one of them)
- Honoraria skip **board concurrence** (that's why they pay before the board
  meeting), but money-out still needs the normal approvals.
- The Dataverse approval flag-fields are **dead** — `wmkf_authorizationtoremitpaymentflag`,
  `wmkf_executivedirectorapproval`, `wmkf_controllerapproved`, `wmkf_directorofoperationsapproved`
  are all null/false even on the paid $900K grant #1002238.
- The real control is the **`akoya_folio` state machine**: Ready To Send → (human
  release: Sarah Hibler) → Ready to Pay → (BILL/Bromelkamp execution) → Not Paid →
  PAID. So **Stage 1 = a human advancing folio in Dataverse; Stage 2 = the
  money-out approval(s) happen in BILL/offline**, invisible to Dataverse. (Thread 2,
  to fully confirm: are the flag fields dead org-wide?)

## Portal connection
The front-of-funnel manual step (staff invites reviewers into GoApply → they
self-register) is exactly what the reviewer portal's Review-Manager invite →
magic-link → Stage 2a accept flow already automates ([[project-bill-honorarium-integration]],
[[project-reviewer-hold-step-decouple]]). So onboarding is a solved problem on the
portal side; the unsolved part is the vendor+payment tail for an individual payee.

## Verifiable provenance (probe scripts were one-off, in session scratchpad)
Key records: honorarium #1002764 (Amy Gladfelter, Duke, $250, Pending, 0 payments);
institutional grants #1002794 (Wayne State) and paid #1002238 (Utah State, $900K,
BILL) / #997034 (Tufts, $1.2M, ACH, pre-BILL). Cohort = 87 `akoya_program=Research
Reviewer` rows. Payment-child lookup = `_akoya_requestlookup_value` (validated
against #1002238's PAID child #0024011). Audit via RetrieveRecordChangeHistory
(bulk `audits` query is blocked — app user lacks ReadAuditSummary).

## Open threads (session tasks)
1. Connor's manual 2/19 classification — what exactly, and is it automatable?
2. Confirm the approval flag-fields are dead org-wide (two-stage model).
3. (done) Pre-BILL ACH trace — #997034.
