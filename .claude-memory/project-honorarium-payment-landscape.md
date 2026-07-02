---
name: Reviewer honorarium onboarding/payment reality (current-state, reverse-engineered)
description: How reviewer honoraria get created and still do not get paid through AkoyaGO/BILL. Core finding for Steph/Ops "mimic Rosie's grant flow" ask: the AkoyaGO payment engine has NEVER paid an individual (0/9,151 disbursements) - it is rail-agnostic but payee-bound to institutions. As of the 2026-07-01 no-BILL-cycle decision, our portal is the planned sole creator of reviewer honorarium akoya_request rows, but the vendor+payment tail remains deferred/offline.
metadata:
  type: project
  status: active
  scope: bill
  last_verified: 2026-07-02 against `docs/HONORARIUM_PORTAL_CREATION_STRATEGY.md`; payment probes remain 2026-06-27/28 and were not re-run
---

## Recall Rule

Read this when: responding to Ops/Steph about paying reviewers, designing or
scoping any honorarium-payment path, or weighing "mimic Rosie's grant→BILL
workflow for honoraria." Pairs with `docs/HONORARIUM_PORTAL_CREATION_STRATEGY.md`
(current no-BILL creation plan), [[akoya-payment-field-semantics]] (field detail),
[[akoya-request-honorarium-nomenclature]] (person-vs-institution discriminators),
and [[project-bill-honorarium-integration]] (portal-integrated pipeline). Payment
numbers below are live-probed 2026-06-27/28; re-probe before treating them as
current next cycle.

## The ask (context)
Steph (Director of Ops) confirmed BILL is NOT integrating with the reviewer
module this cycle, but wanted Ops to "mimic the existing Akoya->BILL grant-payment
workflow Rosie runs" so reviewer honoraria can be pulled into BILL, vendor'd, and
paid - minus the BILL->Akoya payment-status feedback loop. Rosie = payments
operator. Connor/Sarah = AkoyaGO admins (Connor backend, Sarah frontend+staff;
Sarah Hibler is internal and does folio releases). "BCO"/Bromelkamp = the AkoyaGO
vendor.

**2026-07-01 update:** onboarding/request creation and payment are now separated.
For reviewers who come through our portal, the portal is the planned sole creator
of the honorarium `akoya_request` via `ensureHonorariumOnboarding()` with the
BILL tail deferred (`BILL_ONBOARDING_DEFERRED=true`). Reviewers no longer
self-register through GoApply for this path. This does not change the payment
finding below: individual honoraria still have no AkoyaGO/BILL payment substrate
and remain offline/check-paid until the person-payee tail is separately solved.
Go-live still needs the env flip plus deploy/restart; historical capture-only
backfill must first be hardened for required address completeness and proposal
title reload per `docs/HONORARIUM_PORTAL_CREATION_STRATEGY.md` §6.

## Historical GoApply-created cohort chain (all [VERIFIED via probe] unless noted)

This describes the pre-portal GoApply cohort that existed before the 2026-07-01
no-BILL creation decision. Keep it as payment-landscape evidence and comparison
data; do not treat it as the forward reviewer path for portal-created rows.

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
4. Connor MANUALLY classifies the honorarium the next day. **[VERIFIED via full-cohort
   change-history 2026-06-28, `scripts/probe-akoya-honorarium-classification-step.js`]**
   Across all 87 (Connor Noda 601 field-edits; Sarah Hibler a handful) the step is a
   **FIXED TEMPLATE** — every value deterministic or per-cycle-constant:
   - `akoya_programid` = Research Reviewer (87/87)
   - `wmkf_grantprogram` = Honorarium (87/87)
   - `wmkf_request_type` = Individual (87/87)
   - amount `akoya_request` / `wmkf_invitedamount` / `akoya_recommendedamount` = **$250**
     (86/86 — flat rate)
   - `wmkf_meetingdate` = the cycle's review-meeting date (3 distinct across the whole
     cohort = essentially one per cycle, e.g. 6/4/2026×85)
   Everything else on the record is SYNC-set (incl. `wmkf_authorizationtoremitpaymentflag`,
   sync-initialized on 87/87 and never flipped by staff — see the remit-flag candidate
   below). (e.g. #1002764 created 2-18 by the sync, classified 2-19 by Connor.) The one
   staff step visible in Dataverse.
   - **Automatable: YES.** No per-reviewer judgment — the only signal an automation
     needs is "this synced request is a reviewer honorarium" (the GoApply source
     program), then it stamps the fixed template above. Thread 1 resolved.
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
- **Thread 2 RESOLVED — the earlier "flag-fields are dead" read is REFUTED
  [VERIFIED via full-table scan 2026-06-28, `scripts/probe-akoya-approval-flags-deadness.js`].**
  S298 over-generalized from one record (#1002238 happened to have them unset).
  These are not uniform "flags" and 3 of 4 are populated org-wide on `akoya_request`
  (n=25,584) — matching the "Real gates" note in [[akoya-payment-field-semantics]]:
  - `wmkf_authorizationtoremitpaymentflag` (Boolean) — **303 Yes** / 5,748 No /
    19,533 null → LIVE; the staff remit gate the BILL design keeps
    ([[project-bill-honorarium-integration]]).
  - `wmkf_executivedirectorapproval` (**DateTime**, not a flag) — **323 dated** → LIVE ED sign-off.
  - `wmkf_directorofoperationsapproved` (**DateTime**) — **611 dated** → LIVE.
  - `wmkf_controllerapproved` (Picklist) — **0 / 25,584 set** → the only truly dead one.
  Used on a minority (~1–2%) of records, so a gate on *some* payments, not a universal one.
- **For honoraria specifically they stay unused:** all 303 `=Yes` are grant-type
  (Discretionary 154 / Program 138 / Special 9 / …); **0 on Individual/honorarium type.**
  So the honorarium-side conclusion still holds (honoraria paid offline by check, no
  Dataverse approval record) — but the blanket "approval is invisible to Dataverse"
  is wrong for **grants** (the flag + ED/DO dates *are* the Dataverse approval record);
  it's only true for honoraria.
- **`akoya_folio` lives on `akoya_requestpayment` (String), not `akoya_request`** —
  the folio state machine governs the payment child, not the request. The folio control
  stands: a human advances it (Ready To Send → Ready to Pay → … → PAID, e.g. Sarah
  Hibler), then BILL/Bromelkamp executes money-out.

## Portal connection
The front-of-funnel manual step (staff invites reviewers into GoApply and they
self-register) is replaced for portal reviewers by Review-Manager invite ->
magic-link -> Stage 2a accept. The 2026-07-01 strategy turns this from
"capture-only address collection" into app-created honorarium request creation
with the BILL tail deferred. So request creation is now the portal-side work; the
unsolved part remains the vendor+payment tail for an individual payee.

## Scoping: capturing PNIs without BILL API access (S298, Justin)
Goal: capture each reviewer's **PNI** (BILL Payment Network ID — the unique key) so
Rosie can find + vendor + pay them in BILL. Addresses are **obsolete going forward
per Steph** (they only existed to mail checks) — but KEEP collecting for now (still
serve checks for non-BILL reviewers + the zip disambiguator for BILL name search).

- **PNI is private to BILL; no public lookup.** Without API access the only ways to
  get one are: the reviewer **self-reports** it, or Rosie **manually** looks it
  up / invites them in BILL.
- **Q1 ≈ option (b): manual operator action in BILL's web UI** [Justin's operational
  understanding S298 — confirm w/ Steph/Rosie]. This resolves the design's
  hard-gating open question (`docs/BILL_LIB_DESIGN.md` Q1): no API exists to
  auto-invite a non-network reviewer, so Steph personally invites each one.
- **PNI format [VERIFIED, 301 live values 2026-06-27]:** canonical = **16 digits,
  leading zero** (270/301 = 90%). Variants: trailing whitespace (~9 — trim);
  international = optional single-letter prefix + 15 digits (e.g. `u164216946333850`);
  junk (`N/A`, `5`, short) ~7% → reject. NOTE: `BILL_LIB_DESIGN.md` assumes a
  `0rv` prefix — **NOT present in any live value**; reconcile when the BILL slice is
  revisited (likely the network *result-id* vs the stored PNI).

**Conservation-of-friction principle.** Without API access, friction can be
RELOCATED but not REMOVED. Every no-API option just shifts Rosie's manual work onto
someone: the **reviewer** (find/enter their PNI), **this app** (kludgy capture
infra), or back on **Rosie**. The only true removal is **BILL API access** → the
portal-integrated onboarding already built ([[project-bill-honorarium-integration]]),
gated and waiting on credentials.

**Scoping recommendation (S298):**
- **Build (small):** a "Do you have a Bill.com account? (Y/N) + PNI" self-report
  field on the reviewer portal; format-validate per the spec above; **persist on the
  `contact`** (today PNIs live only on the per-cycle request, 0 on contacts, so they
  don't carry forward). Value = **segmentation** (Rosie only manually invites the
  "No" reviewers), not capture volume (yield is low — only 8 reviewers ever had a
  PNI, 2 of those junk).
- **Don't build:** "walk the reviewer through BILL signup + PNI retrieval" infra —
  high effort, fragile, and it just dumps Ops's friction onto the app + reviewers.
- **Real lever:** BILL API access. Put it back to Ops/leadership as the
  authorization decision it is — "frictionless requires the API; the integration is
  built and gated; without it the friction stays manual, it doesn't vanish."

**Scope boundary + flag-setting candidate (Justin, 2026-06-28):**
- **All approval fields are OUT OF SCOPE for our apps — someone else's job.** The
  human sign-offs (`wmkf_executivedirectorapproval`, `wmkf_directorofoperationsapproved`,
  `wmkf_controllerapproved`) are approver concerns we neither own nor automate.
- **Candidate — TRACK, not committed:** `wmkf_authorizationtoremitpaymentflag` (303
  Yes org-wide, confirmed LIVE 2026-06-28) is the one field our app *might* set — when
  **the reviewer's completed review lands** (`wmkf_reviewreceivedat`, already the
  documented payment-eligibility signal per [[project-reviewer-apps-redesign-direction]]),
  as the eligible-to-pay marker. Confirmed trigger (Justin, 2026-06-28). Frame it as a
  **fulfillment/eligibility trigger, not a financial approval** (the field name reads
  like an approval, but the intent is "deliverable is in, payment may proceed").
  **Clean fit confirmed 2026-06-28:** the AkoyaGO sync already initializes this flag on
  87/87 honoraria and staff never flip it — the field is present and waiting on every
  reviewer honorarium, so our app setting it on review-completion writes to existing
  scaffolding, no schema change.
- **This REVISES, if pursued, the S188/S206 decision** that "the integration never
  touches this flag; staff retains it as the final pay-out gate"
  ([[project-bill-honorarium-integration]], `docs/BILL_HONORARIUM_INTEGRATION_DESIGN.md`,
  [[project-reviewer-apps-redesign-direction]]). Those restatements still describe
  **today's** behavior (we don't touch it yet); leave them until the candidate is
  committed, then reconcile all of them in one pass. Confirm scope before building.

## Verifiable provenance (probe scripts were one-off, in session scratchpad)
Key records: honorarium #1002764 (Amy Gladfelter, Duke, $250, Pending, 0 payments);
institutional grants #1002794 (Wayne State) and paid #1002238 (Utah State, $900K,
BILL) / #997034 (Tufts, $1.2M, ACH, pre-BILL). Cohort = 87 `akoya_program=Research
Reviewer` rows. Payment-child lookup = `_akoya_requestlookup_value` (validated
against #1002238's PAID child #0024011). Audit via RetrieveRecordChangeHistory
(bulk `audits` query is blocked — app user lacks ReadAuditSummary).

## Open threads (session tasks)
1. (done 2026-06-28; superseded as forward path 2026-07-01) Connor's classification
   of GoApply-created rows = a FIXED TEMPLATE, fully automatable - Individual /
   Honorarium / Research Reviewer / $250 flat / cycle meeting-date; no per-reviewer
   judgment. The forward portal path now writes the template directly at create
   time instead of detecting a GoApply-synced request. See
   `docs/HONORARIUM_PORTAL_CREATION_STRATEGY.md`.
2. (done 2026-06-28) Approval fields are NOT dead org-wide — 3 of 4 populated on
   grants (303/323/611), only `wmkf_controllerapproved` unused; 0 on honorarium-type.
   REFUTES the earlier "all dead" read. See the Approvals section.
3. (done) Pre-BILL ACH trace — #997034.
