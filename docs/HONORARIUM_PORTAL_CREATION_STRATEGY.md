# Honorarium Portal-Creation Strategy (no-BILL cycle)

**Status:** Design — verified against live prod Dataverse, not yet built.
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
- Mechanism = the **already-built** post-accept pipeline
  `ensureHonorariumOnboarding()` (`lib/bill/honorarium-onboard-orchestrator.js`),
  run at Stage 2a accept, with the **BILL tail deferred**. It creates the
  `akoya_request`; it does **not** attempt payment. `[VERIFIED via source]`
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
| `HONORARIUM_ONBOARDING_DEFERRED` | **unset** (currently `true` in prod) | allows the create to run |
| `BILL_ONBOARDING_DEFERRED` | **`true`** | skips the BILL call silently — no BILL, no per-reviewer alert (`onboard-reviewer-service.js:86`) |
| `wmkf_appsystemsettings` key `honorarium.default_amount` | e.g. `250` | the stamped amount (falls back to `$250` if unset — `lib/services/honorarium-config.js`) |

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

| Field | Value | Note |
|---|---|---|
| `akoya_programid@odata.bind` | Research Reviewer program | **see nav-casing fix §4** |
| `wmkf_GrantProgram@odata.bind` | Honorarium | |
| `wmkf_Type@odata.bind` | Individual | |
| `akoya_primarycontactid@odata.bind` | reviewer contact | **see nav-casing fix §4** |
| `transactioncurrencyid@odata.bind` | US Dollar (`0bc77bca-2c7b-ee11-8179-00224802aaea`) | drives the `*_base` amounts + `exchangerate` |
| `akoya_request` | admin amount | **missing today** — currency field |
| `wmkf_invitedamount` | admin amount | **missing today** |
| `akoya_recommendedamount` | admin amount | already set |
| `wmkf_request_type` | `682090001` (Individual) | already set; does **not** auto-default |
| `akoya_requesttype` | `100000001` (Scholarship) | **missing today**; auto-defaults to the WRONG value `100000000` |
| `wmkf_meetingdate` | parent proposal's meeting date | already set (conditional) |
| `akoya_fiscalyear` | derived — see §5 | **missing today**; does **not** auto-derive |
| `wmkf_respondreminderenabled` | `false` | **missing today**; auto-defaults `true` (GoApply rows are off) |
| `wmkf_reviewduereminderenabled` | `false` | **missing today**; auto-defaults `true` |

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
- `akoya_title` → auto-generates as `"Grant to <contact>"`. Cosmetic; Amy's row had
  no title. Optionally stamp a honorarium-appropriate title later — low priority.

### 3c. Idempotency (already handled)

`ensureHonorariumOnboarding` mints with a **deterministic** GUID
(`uuidv5(suggestionId)`) and writes the `wmkf_HonorariumRequest` junction marker,
so retries / repeat accepts never double-mint. With GoApply out of the reviewer
path there is no cross-source duplication either. `[VERIFIED via source]`

---

## 4. 🔴 Latent bug to fix in the build (nav-property casing)

The current create body uses `akoya_ProgramId` and `akoya_PrimaryContactId`
(`honorarium-onboard-orchestrator.js:151,154`). Dataverse **rejects** that casing
with a `400` ("undeclared property … only has property annotations"). The real
single-valued navigation properties are lowercase:

- `akoya_ProgramId@odata.bind` → **`akoya_programid@odata.bind`**
- `akoya_PrimaryContactId@odata.bind` → **`akoya_primarycontactid@odata.bind`**
- (`wmkf_GrantProgram`, `wmkf_Type` are correct as-is.)

This was never caught because the path has been deferred in prod and its unit tests
inject a fake `dynamics`. **It would fail the first real create.** `[VERIFIED via
prod 400 → corrected create succeeded 2026-07-01]`

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
  `scripts/backfill-honorarium-capture-only.mjs --cycle <CODE>`. Per
  `docs/agent-wiki/topics/finance-honoraria.md` this is dry-run by default,
  cycle-scoped, idempotent, and skips rows with no captured address — **confirm the
  flags against the script source before running** (script not re-read this session).

---

## 7. Open item (Connor)

- **GoApply linkage lookups** — `_akoya_goapplyapplication_value`,
  `_akoya_goapplyphase_value`, `_akoya_goapplysubmitter_value` are present on every
  GoApply-created honorarium (n=87) and are **structurally absent** on
  app-created rows (there is no GoApply application). Note `_akoya_goapplysettings_value`
  *does* auto-populate on our create; the other three do not. **Does any payment,
  folio, or Ops dashboard/report require these three lookups?** If a view filters
  honoraria by GoApply application, app-created rows would be invisible to it.
  `[OPEN — Connor]`

---

## 8. Provenance

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
