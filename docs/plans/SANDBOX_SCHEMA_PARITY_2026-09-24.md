---
title: Sandbox schema parity with production (2026-09-24)
domain: dataverse
kind: plan
status: active
summary: "How the registered sandbox was brought to production wmkf_ schema parity by replaying every schema wave, what was generated from production metadata, the replay recipe, and the recorded deviations."
cataloged: 2026-09-24
last_verified: 2026-09-24
owner: product-engineering
related:
  - scripts/apply-dataverse-schema.js
  - lib/dataverse/schema-apply.js
  - lib/dataverse/schema/wave0-prod-parity-foundation/01_wmkf_grantcycle.json
  - lib/dataverse/schema/wave29-prod-parity-tail/zz_akoya_request.json
  - scripts/compare-sandbox-schema-parity.js
  - scripts/apply-sandbox-choice-parity.js
---

# Sandbox schema parity with production (2026-09-24)

## Why

The Test Request Factory's later-stage recipes (build-order item 6) need the
application schema in the registered sandbox (`orgd9e66399.crm.dynamics.com`).
A Session 537 probe found most application tables and request columns absent
there. The owner chose full `wmkf_` parity, built from the repository's schema
waves plus files generated from production metadata (Session 538).

## What was done

[VERIFIED via Session 538 runs; owner-authorized production definitions reads
(names, types, choice values, relationships; no records) and sandbox schema
writes]

1. A names-and-types inventory of production and the sandbox showed 15 `wmkf_`
   tables and about 190 `wmkf_` columns missing from the sandbox. Most were
   defined by existing waves that had only ever been applied to production.
2. Production items with no schema file were generated from production
   metadata into two waves:
   - `wave0-prod-parity-foundation`: tables `wmkf_grantcycle`,
     `wmkf_glaccount`, `wmkf_ai_prompt`, `wmkf_ai_run`, and 76 columns plus 12
     lookups on `account`, `akoya_akoyaapply`, `akoya_program`,
     `akoya_request`, `akoya_requestpayment`, `contact`, `systemuser`. It runs
     first because wave 16 binds to the two AI tables.
   - `wave29-prod-parity-tail`: `akoya_program.wmkf_code`,
     `akoya_request.wmkf_declinereason`, `contact.wmkf_orcid`, and
     `wmkf_appreviewersuggestion.wmkf_heldat` (the last previously created only
     by `scripts/add-reviewer-suggestion-heldat-column.mjs`). It runs last.
3. `lib/dataverse/schema-apply.js` gained global option sets (created or
   reused by name, with read-back and bind retries for metadata-cache lag),
   multiselect choice columns and file columns.
   `scripts/apply-dataverse-schema.js` gained `--new-first` (see recipe).
4. Every wave was applied to the sandbox, then 54 choice values production has
   and the sandbox lacked were inserted into the sandbox and published. The
   session used scratch versions of the two scripts in the recipe below;
   `scripts/compare-sandbox-schema-parity.js` and
   `scripts/apply-sandbox-choice-parity.js` are their committed form.

## Result

[VERIFIED via post-apply inventory, both environments, 2026-09-24]

- Every production `wmkf_` table exists in the sandbox.
- Every production `wmkf_` column on a shared table exists in the sandbox
  except the two deviations below; no column type differs.
- Every production choice value exists in the sandbox (110 production choice
  columns, 0 missing values).

## Deviations and residuals

- `akoya_request.wmkf_numberofpayments` is a rollup and
  `akoya_request.wmkf_calculatedtime` a formula column in production; the
  engine creates both as plain columns, so the sandbox holds no computed
  value. The rollup's helper columns `wmkf_numberofpayments_date` and
  `wmkf_numberofpayments_state` are not created.
- 22 `akoya_` vendor tables exist only in production; they come with a newer
  Akoya package version and were left out by owner decision.
- Three choice labels differ (production / sandbox): `akoya_program.wmkf_typeofdiscretionarygrant`
  707510001 "Staff Member" / "Employee"; `akoya_request.wmkf_lettertype` 100000000
  "Phase II Incomplete" / "Phase I Incomplete"; `akoya_request.wmkf_researchconceptstatus`
  100000002 "Completed" / "Done". Not changed.
- The sandbox holds 112 choice values production does not, and sandbox-only
  columns (the Factory's `wmkf_istestrequest` / `wmkf_testcreationrunid`, plus
  `akoya_request.wmkf_checkincomplete` and `wmkf_socalstaffrating`). Not
  removed.
- Forms, views, security roles, flows and data were not copied.

## Replay recipe (sandbox)

Run from the repository root, in this order, each with
`DYNAMICS_SANDBOX_URL=https://orgd9e66399.crm.dynamics.com node scripts/apply-dataverse-schema.js --wave=<w> --execute`:

`0-prod-parity-foundation`, `1`, `2` **with `--new-first`** (wave2-existing
extends `wmkf_appreviewersuggestion`, which wave2 creates), `2-fieldprimer`,
`2-grantee-deliverables`, `2-triagestatus`, `3`, `3-grantee-deliverable-table`,
`4`, `4-followup`, `5`, `6`, then every numbered wave from `7-reviewer-engagement`
through `28-meeting-tracker` in numeric order, then `29-prod-parity-tail`.
Do not pass `--wave` for a `-existing` directory; it loads with its parent.
The engine is creation-only, so rerunning after a failure is safe.

Then bring choice values across and check the result:

1. `DATAVERSE_ALLOW_PROD_READS=yes node scripts/compare-sandbox-schema-parity.js --out=<report.json>`
   (read-only, both environments; the production read needs owner authorization).
2. `node scripts/apply-sandbox-choice-parity.js --report=<report.json>` (dry run),
   then the same with `--execute` (sandbox only; inserts values and publishes).
3. Re-run step 1 and confirm 0 missing values and only the deviations above.

Do not run the `scripts/extend-*` / `scripts/add-*` one-off scripts against the
sandbox: they read `DYNAMICS_URL` (production) and several write without a dry
run. Choice values they added are covered by step 2; `wmkf_heldat` is in the
tail wave.
