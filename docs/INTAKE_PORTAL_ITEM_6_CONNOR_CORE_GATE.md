# Connor — P1-Update Core Gate Test

> **Canonical status:** **`INTAKE_PORTAL_BUDGET_ROSTER_RECONCILE_STATUS.md`** — current state: this handout was **sent to Connor (S165, 2026-05-19); AWAITING his Step 11 evidence + Step 12 verdict; the slice-0 gate is still OPEN.** This doc is authoritative only for the test mechanics and the Step 11/12 acceptance literals; do not read deploy-cleared state from it.

Condensed from `INTAKE_PORTAL_ITEM_6_P1UPDATE_TEST_DRAFT_v5.md` — the **core gate only** (the minimal set that decides the slice-0 schema deploy). The mechanical parts (PATCH bodies, filter expressions, trigger/flow config, observation rules, pass/fail criteria) are reproduced verbatim from v5; surrounding prose is condensed. Evidence-only sections (reactivation §5.9, rapid-stress §5.11, transition-timing §5.12, UI realism §5.14) are intentionally omitted; they do not gate the decision.

**Context (read once):** With the recompute flow triggering on a child Update whose only change is `statecode`→Inactive, we need to confirm a trigger-condition filter that traverses the child→parent lookup to filter on parent status (`akoya_requeststatus = 'Phase II Pending'`) (a) binds/saves, (b) does NOT fire when the parent is pre-submit, (c) fires exactly once when the parent is `Phase II Pending`, with `SdkMessage` exactly `Update` and correct parent attribution, and (d) the active-children query in that run excludes the just-deactivated row. Core effort ≈ **20–35 min** (Step 10 is locked-skipped per the production `blank` decision; it would add ~15–25 min only if that decision were ever reversed).

---

## STEP 1 — Before you start

1. Confirm maker-portal access to the **sandbox** environment, not production.
2. Confirm you can create cloud flows with the Microsoft Dataverse trigger.
3. Confirm you can create, update, reactivate, and deactivate rows in the child table under test.
4. Confirm you can inspect flow run history and raw trigger/action outputs.
5. Pick exactly one entity path:
   - **Real path** — `wmkf_proposalbudgetline` exists in the sandbox. Use `wmkf_proposalbudgetline` child, `akoya_request` parent, confirmed child lookup. **Can clear the gate.**
   - **Proxy path** — schema not deployed yet. Use an existing child→parent pair where: child has a many-to-one lookup to parent; parent has a controllable status/choice column; child supports deactivate/reactivate via Web API PATCH; child has a numeric amount-like column (for Step 9); relationship is normal Dataverse metadata. Result is `[partially verified]` — must repeat on real schema before PA flow-live (that repeat is precondition P4, expected regardless).

## STEP 2 — Collect metadata (fill before testing)

| Placeholder | Value to record |
|---|---|
| `[TESTER_NAME]` / `[TEST_DATE]` | You / date. |
| `[ENVIRONMENT_URL]` | Sandbox environment URL/name. |
| `[ORG_HOST]` | Host for Web API URLs, e.g. `[org].crm.dynamics.com`. |
| `[ENTITY_PATH]` | `real` or `proxy`. |
| `[CHILD_TABLE]` | Child logical name. Real: `wmkf_proposalbudgetline`. |
| `[CHILD_ENTITY_SET]` | Child entity-set URL segment for PATCH. |
| `[PARENT_TABLE]` | Parent table logical name. Real: `akoya_request`. |
| `[PARENT_ENTITY_SET]` | Parent entity-set URL segment (for setting parent status). |
| `[CHILD_PRIMARY_KEY]` | Child primary-key logical name. |
| `[CHILD_PARENT_LOOKUP_COLUMN]` | Child row's parent lookup column logical name. |
| `[CHILD_PARENT_LOOKUP_PROPERTY]` | Child→parent FK payload property. Real likely `_wmkf_request_value`; confirm from metadata/trigger output. |
| `[NAV_PROP_NAME]` | Single-valued navigation property name for the parent lookup; **case-sensitive**. |
| `[LOWERCASE_NAV_PROP_NAME]` | Lowercase variant (Candidate F only). |
| `[PARENT_STATUS_COLUMN]` | Parent status column. Real: `akoya_requeststatus`. |
| `[PHASE_II_PENDING_LABEL]` / `[PHASE_II_PENDING_INT]` | `Phase II Pending` and its option-set integer. |
| `[PRE_SUBMIT_STATUS_LABEL]` / `[PRE_SUBMIT_STATUS_INT]` | A pre-submit/drain status (e.g. `In Progress`) and its integer. |
| `[ACTIVE_STATECODE_INT]` / `[ACTIVE_STATUSCODE_INT]` | Active state/status ints. Expected `0` / `1`; confirm. |
| `[INACTIVE_STATECODE_INT]` / `[INACTIVE_STATUSCODE_INT]` | Inactive state/status ints. Expected `1` / `2`; confirm. |
| `[AMOUNT_COLUMN]` | Numeric child column for Step 9. Real likely `wmkf_amount`. |
| `[SELECT_COLUMNS_PRODUCTION_DECISION]` | **LOCKED = `blank`** (production decision S163, Codex-validated SAFE-WITH-CONDITIONS): the production recompute flow's trigger leaves Select columns empty. Record this value and **skip Step 10** (it stays in this doc only as a drift guardrail). The `configured` path applies only if that production decision is ever reversed. |
| `[BUSINESS_SELECT_COLUMNS]` | e.g. `wmkf_amount,wmkf_category,wmkf_year,wmkf_description`. Only if `configured`. |
| `[SOLUTION_NAME]` / `[FLOW_NAME]` | `WMKF Intake Item 6 PA Trigger Test` / `TEST Item 6 BudgetLine Deactivation Filter Binding`. |
| `[SELECTED_CANDIDATE_LETTER]` / `[SELECTED_FILTER_EXPRESSION]` | The candidate that saves (Step 4). |
| `[PARENT_A_GUID]` / `[CHILD_A_GUID]` | Non-Phase-II parent + its active child (Step 7). |
| `[PARENT_B_GUID]` / `[CHILD_B_GUID]` | Phase-II parent + its active child (Steps 8, 10). |
| `[PARENT_C_GUID]` / `[CHILD_C1_GUID]`,`[CHILD_C2_GUID]`,`[CHILD_C3_GUID]` | Phase-II parent + 3 active children (Step 9). |
| `[CHILD_C1_AMOUNT]`,`[CHILD_C2_AMOUNT]`,`[CHILD_C3_AMOUNT]` | Recommended `100`, `200`, `300`. |

## STEP 3 — Web API PATCH shapes (the gate vehicle — do NOT use the form Deactivate button)

Deactivation:
```http
PATCH https://[ORG_HOST]/api/data/v9.2/[CHILD_ENTITY_SET]([CHILD_GUID])
Accept: application/json
Content-Type: application/json
OData-MaxVersion: 4.0
OData-Version: 4.0
If-Match: *

{"statecode":1,"statuscode":2}
```
Reactivation:
```http
PATCH https://[ORG_HOST]/api/data/v9.2/[CHILD_ENTITY_SET]([CHILD_GUID])
Accept: application/json
Content-Type: application/json
OData-MaxVersion: 4.0
OData-Version: 4.0
If-Match: *

{"statecode":0,"statuscode":1}
```
Parent status change (used to set parent status in setup):
```http
PATCH https://[ORG_HOST]/api/data/v9.2/[PARENT_ENTITY_SET]([PARENT_GUID])
Accept: application/json
Content-Type: application/json
OData-MaxVersion: 4.0
OData-Version: 4.0
If-Match: *

{"[PARENT_STATUS_COLUMN]":[STATUS_INT]}
```
Replace state/status integers only if they differ from §STEP 2; if so, record the adjusted body verbatim. For each PATCH record target GUID, timestamp, HTTP status, response body. The child PATCH body must contain `statecode` and `statuscode` and **no other child columns**.

## STEP 4 — Pick the filter expression

Substitute placeholders; put ONLY the expression in "Filter rows" (no `$filter=`).

| Cand. | Expression | Use |
|---|---|---|
| A | `[CHILD_PARENT_LOOKUP_PROPERTY]/[PARENT_STATUS_COLUMN] eq 'Phase II Pending'` | Diagnostic probe only. |
| B | `[CHILD_PARENT_LOOKUP_PROPERTY]/[PARENT_STATUS_COLUMN] eq "Phase II Pending"` | Diagnostic quote probe. |
| C | `[CHILD_PARENT_LOOKUP_PROPERTY]/[PARENT_STATUS_COLUMN] eq [PHASE_II_PENDING_INT]` | Diagnostic int probe. |
| D | `[NAV_PROP_NAME]/[PARENT_STATUS_COLUMN] eq 'Phase II Pending'` | Nav-property label probe. |
| E | `[NAV_PROP_NAME]/[PARENT_STATUS_COLUMN] eq [PHASE_II_PENDING_INT]` | **Preferred when metadata known.** |
| F | `[LOWERCASE_NAV_PROP_NAME]/[PARENT_STATUS_COLUMN] eq [PHASE_II_PENDING_INT]` | Capitalization probe. |
| G | `[NAV_PROP_NAME]/Microsoft.Dynamics.CRM.[PARENT_TABLE]/[PARENT_STATUS_COLUMN] eq [PHASE_II_PENDING_INT]` | Type-cast probe. |
| H | `[NAV_PROP_NAME]/@odata.type eq 'Microsoft.Dynamics.CRM.[PARENT_TABLE]' and [NAV_PROP_NAME]/[PARENT_STATUS_COLUMN] eq [PHASE_II_PENDING_INT]` | `@odata.type` probe. |

Order: try **E** first (if `[NAV_PROP_NAME]` + `[PHASE_II_PENDING_INT]` known) → then **D** → then down the ladder, recording every attempted candidate by letter. Candidate A, if it works, is diagnostic evidence only (not preferred for production). **Selected expression must:** save, evaluate FALSE under `[PRE_SUBMIT_STATUS_INT]`, evaluate TRUE under `[PHASE_II_PENDING_INT]`. If no candidate saves → **FAIL** (→ Option B fallback, no schema rework) — stop and report.

## STEP 5 — Build the flow

1. Maker portal → open/create sandbox solution `[SOLUTION_NAME]`.
2. **+ New → Automation → Cloud flow → Automated.**
3. Name it exactly `[FLOW_NAME]`.
4. Trigger: Microsoft Dataverse **When a row is added, modified or deleted**.
5. Configure trigger: **Change type** `Modified` · **Table name** `[CHILD_TABLE]` · **Scope** `Organization` · **Select columns** blank · **Filter rows** `[SELECTED_FILTER_EXPRESSION]`.
6. Add **Compose** `Dump trigger` → input `triggerOutputs()`.
7. Add **Compose** `SdkMessage` → input `triggerOutputs()?['body/SdkMessage']`.
8. Add **Compose** `Trigger child id` → input the raw trigger child primary key (`[CHILD_PRIMARY_KEY]` from the trigger body / dynamic content); record the exact expression used.
9. Add **Compose** `Trigger parent lookup` → input `triggerOutputs()?['body/[CHILD_PARENT_LOOKUP_PROPERTY]']`.
10. **Save.** If save fails: record the exact validation error verbatim, try the next candidate (Step 4). If none save → FAIL, stop.
11. Turn the flow **On**.
12. **For Step 9 only**, add a **List rows** action `List active siblings` after `Dump trigger`: Table `[CHILD_TABLE]`; Filter rows `[CHILD_PARENT_LOOKUP_PROPERTY] eq [PARENT_C_GUID] and statecode eq [ACTIVE_STATECODE_INT]`; Select columns `[CHILD_PRIMARY_KEY],[CHILD_PARENT_LOOKUP_COLUMN],[AMOUNT_COLUMN],statecode,statuscode` (or record exact columns used). If the List rows filter does not save, record the error and use an unfiltered List rows under `[PARENT_C_GUID]` plus manual inspection of statecode. That fallback proves the active subset only if the run output clearly shows active/inactive state for all Parent C children.

## STEP 6 — Observation protocol (apply in every test below)

1. Put the named child row(s) into the required start state (reactivate via Step 3 if needed).
2. After any setup PATCH, wait for run-history propagation; log elapsed time.
3. Immediately before the tested PATCH, record a baseline timestamp (to the minute) and the latest visible run ID.
4. Send the tested PATCH.
5. Wait 2 minutes; if no expected run is visible, re-check at 3 minutes.
6. Count only runs whose start time is after the baseline AND whose raw trigger-output child row ID equals the expected child GUID.
7. If a second run appears for the same child GUID, record it separately; only treat it as a true duplicate fire if it has a distinct run ID AND distinct trigger body/start time for the same PATCH.
8. Record every `SdkMessage` literal exactly as shown. **Hard rule: for every state-change test, `SdkMessage` must be exactly `Update`. Any other literal → record verbatim, FAIL, stop. No judgment-call exceptions.**

## STEP 7 — TEST 1: Gate-FALSE (deactivate under non-Phase-II parent)

1. Set Parent A `[PARENT_STATUS_COLUMN]` = `[PRE_SUBMIT_STATUS_INT]`.
2. Confirm `[CHILD_A_GUID]` is Active; reactivate via Step 3 if not.
3. Apply Step 6, then send the Step 3 **deactivation** PATCH for `[CHILD_A_GUID]`.
4. Count runs after baseline whose child ID = `[CHILD_A_GUID]`; record the count.

**PASS:** run count = **0**.  **FAIL:** run count > 0.

## STEP 8 — TEST 2: Gate-TRUE (deactivate under Phase-II parent)

1. Set Parent B `[PARENT_STATUS_COLUMN]` = `[PHASE_II_PENDING_INT]`.
2. Confirm `[CHILD_B_GUID]` is Active; reactivate via Step 3 if not.
3. Apply Step 6, then send the Step 3 **deactivation** PATCH for `[CHILD_B_GUID]`.
4. Count runs after baseline whose child ID = `[CHILD_B_GUID]`; record the count.
5. If count = 1, open that run: record the `SdkMessage` literal; open `Dump trigger`; record whether `[CHILD_PARENT_LOOKUP_PROPERTY]` is present and whether it equals `[PARENT_B_GUID]`; record the run ID.

**PASS:** run count = **1** AND `SdkMessage` exactly `Update` AND parent lookup present AND equals `[PARENT_B_GUID]`.
**FAIL:** count ≠ 1, or `SdkMessage` ≠ `Update` (record verbatim), or parent lookup missing/wrong.

## STEP 9 — TEST 3: Active-subset after partial deactivation

Proves the flow can read the active sibling set excluding the just-deactivated row. (Input-set evidence only — it does NOT prove production aggregate math; that's out of scope.)

1. Ensure `List active siblings` (Step 5.12) is enabled, filtered to `[PARENT_C_GUID]`.
2. Set Parent C `[PARENT_STATUS_COLUMN]` = `[PHASE_II_PENDING_INT]`.
3. Create/select `[CHILD_C1_GUID]`,`[CHILD_C2_GUID]`,`[CHILD_C3_GUID]` under Parent C; set all Active; amounts `100`/`200`/`300` (or record actuals).
4. Apply Step 6, then send the Step 3 **deactivation** PATCH for `[CHILD_C2_GUID]`.
5. Count runs after baseline whose child ID = `[CHILD_C2_GUID]`; if = 1 open it, record `SdkMessage`.
6. Open `List active siblings` output; record returned child GUIDs, state/status, amounts.

**PASS:** run count = 1; `SdkMessage` exactly `Update`; returned active GUIDs are exactly `[CHILD_C1_GUID]` and `[CHILD_C3_GUID]`; `[CHILD_C2_GUID]` absent; if `[AMOUNT_COLUMN]` available, operator-side sum over returned active rows = `[CHILD_C1_AMOUNT] + [CHILD_C3_AMOUNT]` (corroborating input evidence only).
**FAIL:** deactivated `[CHILD_C2_GUID]` in active set, an active sibling missing, count ≠ 1, `SdkMessage` ≠ `Update`, or wrong sum when amounts available. (Do not report this as proof of production aggregate correctness.)

## STEP 10 — TEST 4: Select-columns — CONDITIONAL

**Production decision is LOCKED = `blank` (S163, Codex-validated):** record "Step 10 SKIPPED — production Select columns blank (locked design decision)" and go to Step 11. Step 10 gates nothing. (Accepted, validated tradeoff: with Select columns blank the recompute also fires on post-submit edits to non-aggregate child fields — operationally bounded at pilot scale; this was a deliberate choice, not an oversight. The parent-status Filter-rows condition still does the real scoping.)

**The `configured` branch below is retained only as a drift guardrail** — run it only if the locked `blank` decision is ever reversed: for each of the three sub-cases, first set Parent B = Phase II Pending and confirm `[CHILD_B_GUID]` Active (reactivate via Step 3 between sub-cases), edit the trigger Select columns, save, apply Step 6, send the Step 3 deactivation PATCH for `[CHILD_B_GUID]`, count attributable runs:
- **10a — `[BUSINESS_SELECT_COLUMNS]`** (business fields only): expect **0** runs. If >0, record the run output and treat it as an unexpected platform observation requiring PA-docs confirmation.
- **10b — `statecode`**: record whether 0 or 1 (observation).
- **10c — `statecode,statuscode`**: expect **1** run, `SdkMessage` exactly `Update`.

**PASS (configured only):** 10a = 0, 10c = 1 with `SdkMessage` exactly `Update`; or any 10a fire has an explicitly accepted explanation before the verdict is assigned. **FAIL:** business-fields-only fires unexpectedly without an accepted explanation, or 10c doesn't fire, or `SdkMessage` ≠ `Update`.

## STEP 11 — What to return (verbatim — do not summarize literals)

1. Metadata (full set): `[TESTER_NAME]`, `[TEST_DATE]`, `[ENVIRONMENT_URL]`, `[ORG_HOST]`, `[SOLUTION_NAME]`, `[FLOW_NAME]`, `[ENTITY_PATH]`, `[CHILD_TABLE]`, `[CHILD_ENTITY_SET]`, `[PARENT_TABLE]`, `[PARENT_ENTITY_SET]`, `[CHILD_PRIMARY_KEY]`, `[CHILD_PARENT_LOOKUP_COLUMN]`, `[CHILD_PARENT_LOOKUP_PROPERTY]`, `[NAV_PROP_NAME]`, `[LOWERCASE_NAV_PROP_NAME]`, `[PARENT_STATUS_COLUMN]`, `[PHASE_II_PENDING_INT]`, `[PRE_SUBMIT_STATUS_INT]`, the four state/status ints, `[AMOUNT_COLUMN]`, `[SELECT_COLUMNS_PRODUCTION_DECISION]`, `[BUSINESS_SELECT_COLUMNS]` (if configured).
2. `[SELECTED_CANDIDATE_LETTER]` + `[SELECTED_FILTER_EXPRESSION]`; every candidate attempted and any save error verbatim.
3. Screenshot/snippet of the trigger config (Change type, Table, Scope, Select columns, Filter rows).
4. Per test (7, 8, 9, and 10 if configured): baseline timestamp, baseline run ID, tested child GUID, run count, run ID(s), any retry/duplicate observation, exact `SdkMessage` literal(s), and raw trigger-output child row ID evidence.
5. For every counted run in Steps 8, 9, and 10 (if configured): parent-lookup field present? equals the expected parent GUID (`[PARENT_B_GUID]` or `[PARENT_C_GUID]` as applicable)? + raw trigger-output snippet showing it.
6. Step 9: returned active GUIDs, states, amounts; expected vs observed.
7. Final verdict (Step 12).

## STEP 12 — Verdict

- **VERIFIED** (clears the deploy gate): **real path**; a candidate saved; Step 7 PASS; Step 8 PASS; Step 9 PASS; Step 10 PASS or N/A (`blank`); every required `SdkMessage` exactly `Update`; every counted run's child ID + parent lookup attribution correct.
- **partial(proxy)**: same results but on a proxy pair → `[partially verified]`; real-schema repeat = P4 (post-deploy).
- **FAIL → Option B, no schema rework**: no candidate saves; Step 7, 8, or 9 fails; Step 10 fails when `configured`; any required `SdkMessage` ≠ `Update`; or child/parent attribution missing/ambiguous. A FAIL is a useful, expected outcome — it routes to a drain-side fallback with **zero schema rework**, not a schema rollback.

Optional evidence (only if time permits, do NOT gate the verdict): reactivation symmetry, rapid two-child stress, parent-status transition timing, UI-form realism — full procedures in `INTAKE_PORTAL_ITEM_6_P1UPDATE_TEST_DRAFT_v5.md` §5.9/§5.11/§5.12/§5.14.
