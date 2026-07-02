---
title: "Honorarium Portal-Creation Strategy (no-BILL cycle)"
domain: finance-honoraria
kind: plan
status: active
summary: "Config-gated draft implementation exists; go-live awaits env flip and Connor schema/open-item decisions."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
related:
  - lib/bill/honorarium-onboard-orchestrator.js
  - lib/services/honorarium-config.js
  - scripts/probe-honorarium-discriminators.js
  - scripts/backfill-honorarium-capture-only.mjs
---

# Honorarium Portal-Creation Strategy (no-BILL cycle)

**Status:** Go-live plan + config-gated draft implementation — verified against live
prod Dataverse; not live until the env/config flip.
**Date:** 2026-07-01 · **Context:** Justin + Connor decision; Claude session 314.
**Scope:** How reviewer honorarium `akoya_request` records get created when full
BILL.com integration is deferred and reviewers no longer self-register through
GoApply.

State labels: `[VERIFIED]` = confirmed against source or a live prod probe on the
date noted · `[DECISION]` = settled by Justin/Connor · `[OPEN]` = needs Connor.

---

## 1. Decision

- Full BILL.com integration is **not** happening this cycle. `[DECISION]`
- Our apps create the honorarium request **directly**; reviewers do **not** go
  through GoApply separately. The portal is the **sole** creator for reviewers who
  come through it, so there is no GoApply/AkoyaGO-sync duplication to reconcile.
  `[DECISION]`
- Mechanism = the post-accept pipeline `ensureHonorariumOnboarding()`
  (`lib/bill/honorarium-onboard-orchestrator.js`), run at Stage 2a accept, with
  the **BILL tail deferred**. As of commit `cd82c405`, the create-body draft is
  implemented and unit-tested behind config gates; it creates the `akoya_request`
  only after `HONORARIUM_ONBOARDING_DEFERRED` is unset and all discriminator GUIDs
  are configured. It does **not** attempt payment while `BILL_ONBOARDING_DEFERRED`
  remains `true`. `[VERIFIED via source]`
- **Payment is out of scope.** Individuals still cannot be paid through the
  AkoyaGO payment engine — per the 2026-06-27 landscape probe, 0 of 9,151 completed
  disbursements had ever gone to a person (**prior finding, not re-verified this
  session**; see `[[project-honorarium-payment-landscape]]`). Honoraria continue to
  be paid **offline by check**, and Dataverse holds no payment state for them —
  Amy Gladfelter's honorarium shows `akoya_paid = $0.00`,
  `akoya_requeststatus = Pending`. `[VERIFIED via prod read 2026-07-01]`

---

## 2. Config flip (turn creation on, keep BILL off)

The pipeline has two independent gates. The clean "create the request, skip BILL"
state is:

| Setting | Value | Effect |
|---|---|---|
| `HONORARIUM_PROGRAM_ID` | `7e744a42-37eb-f011-8543-6045bd02b4cc` (Research Reviewer) | discriminator |
| `HONORARIUM_GRANTPROGRAM_ID` | `60ef7626-38eb-f011-8543-6045bd02b4cc` (Honorarium) | discriminator |
| `HONORARIUM_TYPE_ID` | `4bab15c9-38eb-f011-8543-6045bd02b4cc` (Individual) | discriminator |
| `HONORARIUM_ONBOARDING_DEFERRED` | **unset** (prod was locked to `true` as of 2026-07-01; re-verify before flip) | allows the create to run |
| `BILL_ONBOARDING_DEFERRED` | **`true`** | skips the BILL call silently — no BILL, no per-reviewer alert (`onboard-reviewer-service.js:86`) |
| `wmkf_appsystemsettings` key `honorarium.default_amount` | e.g. `250` | stamped amount; confirmed-absent key falls back to `$250`, malformed/unavailable setting throws (`lib/services/honorarium-config.js`) |

- GUIDs above were read from the live prod record (Amy Gladfelter honorarium
  `#1002764`); confirm with `scripts/probe-honorarium-discriminators.js` before
  setting. `[VERIFIED via probe 2026-07-01]`
- Do **not** simply leave BILL disabled without `BILL_ONBOARDING_DEFERRED=true`:
  the `BILL_ENABLED !== 'true'` path fires an `alert_only` "onboard manually"
  notification per reviewer (`onboard-reviewer-service.js:90`). `[VERIFIED via source]`

---

## 3. Create-body spec (empirically verified)

Verification method: created a `$1` sentinel honorarium in prod via a **minimal**
body, read it back, diffed against Amy's GoApply-created row, then hard-deleted
both (verified 404, and confirmed absent in AkoyaGO by Connor/Justin).
`[VERIFIED via prod create/read/delete 2026-07-01]`

### 3a. Fields we MUST set (auto-default is absent or wrong)

Implementation status: the config-gated draft create body in
`lib/bill/honorarium-onboard-orchestrator.js` now sets these fields except the new
proposal self-lookup, which waits on Connor's schema change in §8/§9. `[VERIFIED
via source 2026-07-01]`

| Field | Value | Note |
|---|---|---|
| `akoya_programid@odata.bind` | Research Reviewer program | **see nav-casing fix §4** |
| `wmkf_GrantProgram@odata.bind` | Honorarium | |
| `wmkf_Type@odata.bind` | Individual | |
| `akoya_primarycontactid@odata.bind` | reviewer contact | **see nav-casing fix §4** |
| `transactioncurrencyid@odata.bind` | Optional explicit US Dollar bind (`0bc77bca-2c7b-ee11-8179-00224802aaea`) | drives the `*_base` amounts + `exchangerate`; draft code binds only when `HONORARIUM_CURRENCY_ID` is configured, otherwise Dataverse applies org default currency |
| `akoya_request` | admin amount | draft now sets; minimal create leaves absent |
| `wmkf_invitedamount` | admin amount | draft now sets; cohort carries same value |
| `akoya_recommendedamount` | admin amount | already set before S314; still set |
| `wmkf_request_type` | `682090001` (Individual) | already set before S314; does **not** auto-default |
| `akoya_requesttype` | `100000001` (Scholarship) | draft now sets; bare create auto-defaults to WRONG value `100000000` |
| `wmkf_meetingdate` | parent proposal's meeting date | draft sets when parent date exists; guard/alert when missing |
| `akoya_fiscalyear` | derived — see §5 | draft now derives; minimal create does **not** auto-derive |
| `wmkf_respondreminderenabled` | `false` | draft now forces off; bare create auto-defaults `true` (GoApply rows are off) |
| `wmkf_reviewduereminderenabled` | `false` | draft now forces off; bare create auto-defaults `true` |
| _proposal-linkage lookup_ (new — see §8) | parent proposal (`request.akoya_requestid`) | **needs schema change**; TODO remains in code until Connor adds the relationship and we verify nav-property casing |

Amounts: stamp all **three** amount fields from the single admin-panel amount
(`getHonorariumAmount()`); the cohort carries the same value on all three —
`$250` on 86 of 87 rows (1 legacy row null on all three). `[VERIFIED via cohort
probe 2026-07-01]`

### 3b. Fields we do NOT set (Dataverse/Akoya plugins fill them correctly)

- `akoya_requestsource` → auto-set to `100000000` (**CRM User**) — truthful for an
  app-created record; **no action, and no Connor question**. `[VERIFIED]`
- `akoya_requeststatus` → auto-set to `"Pending"`. `[VERIFIED]`
- `wmkf_authorizationtoremitpaymentflag` → auto-defaults `false` (matches the
  cohort; the reviewer stays not-yet-authorized). `[VERIFIED]`
- `statecode/statuscode` (Active), `akoya_paid` (0), `wmkf_typeforrollup`
  (Individual), `akoya_requestnum` (auto-number), all `*_base` amounts,
  `exchangerate` → auto. `[VERIFIED]`
- `akoya_title` → auto-generates as `"Grant to <contact>"`. The draft create body
  now **overrides** it with a proposal-referencing title at create (Option C, §8)
  — plain writable string, no schema change. `[VERIFIED via source]`

### 3c. Idempotency (already handled)

`ensureHonorariumOnboarding` mints with a **deterministic** GUID
(`uuidv5(suggestionId)`) and writes the `wmkf_HonorariumRequest` junction marker,
so retries / repeat accepts never double-mint. With GoApply out of the reviewer
path there is no cross-source duplication either. `[VERIFIED via source]`

### 3d. Contact linkage (the person is *linked*, not copied)

The request is bound to the **actual person `contact` record** via a lookup
relationship — it is **not** populated from a copy of the contact's data.
`[VERIFIED via source + test create 2026-07-01]`

- `ensureContact()` (orchestrator step 1) resolves the real person: existing
  contact by email → by ORCID → else create new (with duplicate-risk alerts). It
  returns that contact's GUID.
- The create body binds it as a lookup: `akoya_primarycontactid@odata.bind →
  /contacts(<contactId>)`, surfacing on the request as the
  `_akoya_primarycontactid_value` lookup (as on Amy's row and the test row).
- The request row itself carries only the honorarium template fields (program /
  type / amount / dates) **plus the pointer to the person**. Name / email / ORCID
  are **not** stamped onto the request — they stay on the contact and are reached
  through the lookup. Editing the person later updates the linked contact; the
  request keeps pointing at it (no stale copy on the request).
- **Address goes to the *contact*, not the request:** step 2 PATCHes
  `contact.address1_*`. Address data lands on the person record, referenced (not
  duplicated) by the request.
- **Title:** left to the plugin, `akoya_title` would denormalize the contact's name
  ("Grant to \<name>"). Under Option C (§8) we instead **override** it with a
  proposal-referencing string, so the title reflects the proposal rather than
  copying the person.

---

## 4. Nav-property casing bug fixed in the draft create body

The pre-S314 create body used `akoya_ProgramId` and `akoya_PrimaryContactId`.
Dataverse **rejects** that casing with a `400` ("undeclared property … only has
property annotations"). The real single-valued navigation properties are
lowercase, and the draft implementation now uses them:

- `akoya_ProgramId@odata.bind` → **`akoya_programid@odata.bind`**
- `akoya_PrimaryContactId@odata.bind` → **`akoya_primarycontactid@odata.bind`**
- (`wmkf_GrantProgram`, `wmkf_Type` are correct as-is.)

This was never caught earlier because the path has been deferred in prod and its
unit tests inject a fake `dynamics`. It would have failed the first real create;
commit `cd82c405` fixes the draft body and adds assertions for the lowercase bind
names. `[VERIFIED via prod 400 → corrected create succeeded 2026-07-01 + source]`

---

## 5. `akoya_fiscalyear` derivation

Plain sync-stamped string, **not** auto-derived by any plugin (confirmed: stayed
null on the test create despite `wmkf_meetingdate` being set). Derive it in our
code from the **parent proposal's meeting date**: `[DECISION]`

```
akoya_fiscalyear = "<MonthName> <FullYear>"   // of the parent request's wmkf_meetingdate
                                              // months observed: 6 → "June", 12 → "December"
```

Amy's `wmkf_meetingdate = 2026-06-04` → `"June 2026"`. `[VERIFIED]`

Edge case: if the parent request has **no** meeting date, we can derive neither
`wmkf_meetingdate` nor `akoya_fiscalyear` — the create should guard/alert rather
than write a malformed row (do not silently omit).

---

## 6. Rollout

- Reviewers who accepted while capture-only was on will **not** re-accept, so their
  honoraria were never minted. After the config flip, mint them with
  `scripts/backfill-honorarium-capture-only.mjs --cycle <CODE>`. The script is
  dry-run by default, cycle-scoped, idempotent, skips rows with no captured
  address, refuses to run while `HONORARIUM_ONBOARDING_DEFERRED=true` or the
  discriminator GUIDs are incomplete, and drives the same
  `ensureHonorariumOnboarding()` path rather than duplicating create logic.
  `[VERIFIED via source]`

---

## 7. Open items (Connor)

- **GoApply linkage lookups** — `_akoya_goapplyapplication_value`,
  `_akoya_goapplyphase_value`, `_akoya_goapplysubmitter_value` are present on every
  GoApply-created honorarium (n=87) and are **structurally absent** on
  app-created rows (there is no GoApply application). Note `_akoya_goapplysettings_value`
  *does* auto-populate on our create; the other three do not. **Does any payment,
  folio, or Ops dashboard/report require these three lookups?** If a view filters
  honoraria by GoApply application, app-created rows would be invisible to it.
  `[SENT to Connor 2026-07-01 — awaiting reply]`
- **New proposal-linkage relationship** — see §8. Connor is fine with the schema
  change in principle; tracked in §9 for the end-of-work update.

---

## 8. Proposal linkage (capability unique to the app path)

GoApply onboarding is **blind to the parent request**: reviewers just start a new
request with no notion of which proposal it responds to. Our create runs *with* the
proposal (`request.akoya_requestid`) in context, so we can make the honorarium
self-explanatory. `[VERIFIED: request = the proposal's akoya_request, respond.js:380,581]`

**Finding:** `akoya_request` has 65 lookup fields but **none is self-referential**
(no field targets `akoya_request`), so a direct honorarium→proposal link needs a new
relationship. `[VERIFIED via entity metadata 2026-07-01]`

**Build both:**

- **Option A — new self-lookup (structured, clickable, queryable).** Connor adds a
  custom lookup on `akoya_request` targeting `akoya_request` (proposed name
  `wmkf_relatedproposal` — Connor confirms the final schema name). Our create body
  binds it to the parent proposal via `<navprop>@odata.bind → /akoya_requests(<proposalId>)`.
  **Confirm the exact navigation-property name/casing from metadata after Connor
  creates it** — see the nav-casing hazard in §4.
- **Option C — proposal-referencing title (immediate, no schema change).** The draft
  create body now overrides `akoya_title` (a plain writable string, §3b) at create
  with `"Reviewer honorarium — <proposal title> (#num)"`, capped to the column
  length. Human-visible on the record now, even before A lands; not
  structured/queryable — A is the queryable link.

**Option B is obviated.** The proposal↔honorarium link is already *derivable* via the
`wmkf_HonorariumRequest` suggestion junction, but A supersedes it as the surfaced
link. (The junction stays for its existing idempotency/provenance role, §3c.)

---

## 9. Schema changes to track (for Connor end-of-work update)

| # | Change | Status | Consumer |
|---|---|---|---|
| 1 | New custom lookup on `akoya_request` → `akoya_request` (proposed `wmkf_relatedproposal`): honorarium → parent proposal | requested / Connor OK in principle | TODO is parked in the draft create body; bind after Connor creates it and nav-property casing is verified (§8 Option A) |

Add rows here as further Dataverse schema changes arise this cycle.

---

## 10. Provenance

- Source: `lib/bill/honorarium-onboard-orchestrator.js`,
  `lib/bill/onboard-reviewer-service.js`, `lib/bill/honorarium-discriminators.js`,
  `lib/services/honorarium-config.js`.
- Landscape / payment reality: `[[project-honorarium-payment-landscape]]`,
  `docs/agent-wiki/topics/finance-honoraria.md`.
- Live probes (read-only + one authorized sentinel create/delete), prod
  `wmkf.crm.dynamics.com`, 2026-07-01. Probe scripts were one-off (session
  scratchpad); re-derive from this doc's GUIDs if needed.
- Reference record: Amy Gladfelter honorarium `#1002764`
  (`akoya_requestid 357386c5-040d-f111-8406-000d3a352e68`), cohort = 87
  `akoya_program = Research Reviewer` rows.
