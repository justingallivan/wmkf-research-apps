# DRAFT — UNAUTHORIZED / UNLANDED — for Codex review only (S163, 2026-05-18)

> **⚠️ Superseded — history only.** Canonical Item 6 / slice-0 status (is the deploy cleared? the P1-Update gate? waiver + Connor status?) lives in **`INTAKE_PORTAL_BUDGET_ROSTER_RECONCILE_STATUS.md`**. Superseded by v5 / `INTAKE_PORTAL_ITEM_6_CONNOR_CORE_GATE.md`; do not infer current state from this file.

This file is a staging artifact for review. Nothing here is landed in the
authoritative docs (`INTAKE_PORTAL_BUDGET_AGGREGATE_RECOMPUTE_DECISION.md`,
`INTAKE_PORTAL_ITEM_6_MAKER_PORTAL_TESTS.md`, `INTAKE_PORTAL_DESIGN.md`) and
the waiver is **not** authorized. Two artifacts to review:

1. The P1-Update pre-deploy waiver text (would land as a `DRAFT — UNAUTHORIZED`
   block in `INTAKE_PORTAL_BUDGET_AGGREGATE_RECOMPUTE_DECISION.md` §0).
2. The §5 Connor maker-portal test runbook (would land as a new §5 in
   `INTAKE_PORTAL_ITEM_6_MAKER_PORTAL_TESTS.md`).

Context: Connor's S162 deactivate-not-delete ruling collapsed the Item-6
Create/Update/Delete trigger sweep. The one open pre-deploy question is
**P1-Update**: does the parent-status trigger-condition filter bind and fire
on a child Update whose only change is `statecode`→Inactive (deactivation)?
The existing §3 Update test only edits a scalar field (`wmkf_amount`); it
never isolates a statecode-only Update.

---

## Artifact 1 — Waiver text (ready to authorize; NOT active)

> **P1-Update pre-deploy waiver — DRAFT, UNAUTHORIZED.** Status: drafted S163 (2026-05-18). Becomes active only when Justin signs the line at the bottom. Until then slice-0 deploy remains gated on P1-Update per the precondition list.
>
> **What this waives:** the requirement that P1-Update (does the parent-status trigger-condition filter bind and fire on a child Update whose only change is `statecode`→Inactive) be *verified in the maker portal before the slice-0 schema deploys*.
>
> **What this does NOT waive:** the P1-Update question itself. This waiver creates a documented exception to the S163 P1-Update pre-deploy gate. It does not redefine P4. P1-Update verification is added as an additional hard pre-flow-live condition, tracked separately. The PA recompute flow MUST NOT be switched on against the real `wmkf_proposalbudgetline` entity until P1-Update is verified or separately waived for flow-live by explicit owner acceptance.
>
> **Rationale (why decoupling is bounded-risk, not a correctness gamble):**
> 1. The slice-0 schema is inert and additive — verified non-destructive, collision-clear (`scripts/probe-slice0-attr-collision.mjs`, CLEAR 2026-05-18), and dry-run-clean. Creating the entities/attrs changes no behavior on its own; nothing reads or writes them until the drain + flow are built.
> 2. P1-Update failure has a **zero-schema-rework fallback**: Option B (`$batch` change sets in the drain, already the documented near-term infrastructure follow-up). The schema is correct under both Option A and Option B — a P1-Update failure changes a drain *implementation*, never a table.
> 3. The point where P1-Update failure actually bites — stale aggregate totals after a post-submit edit — is the *flow-live* window, not the *schema-deploy* window. This waiver adds no new exposure between deploy and flow-live because the PA recompute flow is off in that window by construction.
>
> **Scope boundary:** authorizes the slice-0 *schema* deploy (`apply-dataverse-schema.js --wave=4 --execute`, the picklist-extend script, `setup-database.js` V30) only. Does not authorize switching on any PA recompute flow. Does not waive any other precondition.
>
> **If P1-Update later fails maker-portal validation:** drain implements Option B `$batch`; PA recompute (Option A) is abandoned for the deactivation path; no schema migration or rollback occurs.
>
> **Authorized by:** ________________  (Justin)  **Date:** __________

---

## Artifact 2 — §5 Connor maker-portal test runbook

### 5.0 Why just this test

Connor's deactivate-not-delete ruling means the recompute flow fires on a child **Update whose only change is `statecode`→Inactive**. Existing §3 tests a scalar field edit (`wmkf_amount`); it never isolates a deterministic deactivation Update. This is the one open binding question. **Skip and mark `N/A — dissolved 2026-05-18`:** §3 Create binding, §3 Delete binding, all of §4 (Delete payload introspection).

### 5.1 Before you start

1. Confirm maker-portal access to the **sandbox** environment, not production.
2. Confirm you can create cloud flows with the Microsoft Dataverse trigger.
3. Confirm you can create, update, reactivate, and deactivate rows in the child table under test.
4. Confirm you can inspect flow run history and raw trigger/action outputs.
5. Pick exactly one entity path:

| Path | Use when | Result strength |
|---|---|---|
| Real path | `wmkf_proposalbudgetline` exists in the sandbox. Use `wmkf_proposalbudgetline` child, `akoya_request` parent, and the confirmed child lookup. | Can clear P1-Update. |
| Proxy path | Schema is not deployed yet. Use an existing child-parent pair where the parent has a controllable status/choice column and the child supports deactivate/reactivate. | Mark `[partially verified -- Connor tests this]`; repeat on the real schema before PA flow-live. |

### 5.2 Metadata values to collect before testing

1. Record the target environment URL/name as `[ENVIRONMENT_URL]`.
2. Record whether this is the real path or proxy path as `[ENTITY_PATH]`.
3. Record the child table logical name as `[CHILD_TABLE]`.
4. Record the parent table logical name as `[PARENT_TABLE]`.
5. Record the child primary key logical name as `[CHILD_PRIMARY_KEY]`.
6. Record the child row's parent lookup column logical name as `[CHILD_PARENT_LOOKUP_COLUMN]`.
7. Record the child row's parent foreign-key payload property as `[CHILD_PARENT_LOOKUP_PROPERTY]` (real schema likely `_wmkf_request_value`; confirm from metadata or trigger output).
8. Record the parent-status column logical name as `[PARENT_STATUS_COLUMN]` (real schema `akoya_requeststatus`).
9. Record the real integer value for `Phase II Pending` as `[PHASE_II_PENDING_INT]`.
10. Record a pre-submit/drain-time parent status label as `[PRE_SUBMIT_STATUS_LABEL]`.
11. Record the pre-submit/drain-time parent status integer as `[PRE_SUBMIT_STATUS_INT]`.
12. Record the single-valued navigation property name for the parent lookup as `[NAV_PROP_NAME]` (case-sensitive; real schema may be `wmkf_Request`, but confirm in relationship metadata).
13. Record the parent A GUID as `[PARENT_A_GUID]` after creating/selecting the non-Phase-II parent.
14. Record the parent B GUID as `[PARENT_B_GUID]` after creating/selecting the Phase-II parent.
15. Record the Parent A child GUID as `[CHILD_A_GUID]` after creating/selecting the non-Phase-II child.
16. Record the Parent B child GUID as `[CHILD_B_GUID]` after creating/selecting the Phase-II child.

### 5.3 Candidate filter expression selection

1. Use Candidate E first if `[NAV_PROP_NAME]` and `[PHASE_II_PENDING_INT]` are known:

```text
[NAV_PROP_NAME]/[PARENT_STATUS_COLUMN] eq [PHASE_II_PENDING_INT]
```

2. Use Candidate A only as a diagnostic probe if `[NAV_PROP_NAME]` or `[PHASE_II_PENDING_INT]` is not yet known:

```text
[CHILD_PARENT_LOOKUP_PROPERTY]/[PARENT_STATUS_COLUMN] eq 'Phase II Pending'
```

3. Treat Candidate A as `[partially verified -- Connor tests this]` and risky because lookup GUID property traversal is not the documented navigation-property pattern.
4. If Candidate E does not save, try Candidate D with the confirmed navigation property:

```text
[NAV_PROP_NAME]/[PARENT_STATUS_COLUMN] eq 'Phase II Pending'
```

5. If Candidate D does not save, continue through this self-contained candidate ladder and record every attempted candidate by letter:

| Candidate | Expression after placeholder substitution | Use |
|---|---|---|
| A | `[CHILD_PARENT_LOOKUP_PROPERTY]/[PARENT_STATUS_COLUMN] eq 'Phase II Pending'` | Diagnostic probe only. |
| B | `[CHILD_PARENT_LOOKUP_PROPERTY]/[PARENT_STATUS_COLUMN] eq "Phase II Pending"` | Diagnostic quote probe only. |
| C | `[CHILD_PARENT_LOOKUP_PROPERTY]/[PARENT_STATUS_COLUMN] eq [PHASE_II_PENDING_INT]` | Diagnostic lookup-property integer probe only. |
| D | `[NAV_PROP_NAME]/[PARENT_STATUS_COLUMN] eq 'Phase II Pending'` | Navigation-property label probe. |
| E | `[NAV_PROP_NAME]/[PARENT_STATUS_COLUMN] eq [PHASE_II_PENDING_INT]` | Preferred candidate when metadata is known. |
| F | `[LOWERCASE_NAV_PROP_NAME]/[PARENT_STATUS_COLUMN] eq [PHASE_II_PENDING_INT]` | Capitalization probe only. |
| G | `[NAV_PROP_NAME]/Microsoft.Dynamics.CRM.[PARENT_TABLE]/[PARENT_STATUS_COLUMN] eq [PHASE_II_PENDING_INT]` | Type-cast probe only. |
| H | `[NAV_PROP_NAME]/@odata.type eq 'Microsoft.Dynamics.CRM.[PARENT_TABLE]' and [NAV_PROP_NAME]/[PARENT_STATUS_COLUMN] eq [PHASE_II_PENDING_INT]` | `@odata.type` probe only. |
| I | `[NAV_PROP_NAME]/[PARENT_STATUS_COLUMN] eq [PHASE_II_PENDING_INT] or [NAV_PROP_NAME]/[PARENT_STATUS_COLUMN] eq [OTHER_POST_SUBMIT_STATUS_INT]` | Multi-status future probe only; do not prefer for this P1-Update gate. |

6. Do not include `$filter=` in the Filter rows box.
7. Replace every placeholder before saving the flow.
8. Pass criterion: the final selected expression saves and later evaluates FALSE before deactivation under `[PRE_SUBMIT_STATUS_INT]` and TRUE after deactivation under `[PHASE_II_PENDING_INT]`.
9. Fail criterion: no candidate saves, or the selected candidate cannot produce both the gate-FALSE and gate-TRUE runtime observations.

### 5.4 Build the test flow

1. Maker portal → open or create the sandbox solution `WMKF Intake Item 6 PA Trigger Test`.
2. Select **+ New → Automation → Cloud flow → Automated**.
3. Name the flow exactly `TEST Item 6 BudgetLine Deactivation Filter Binding`.
4. Select the Microsoft Dataverse trigger **When a row is added, modified or deleted**.
5. Configure the trigger:

| Trigger parameter | Value |
|---|---|
| Change type | `Modified` |
| Table name | `[CHILD_TABLE]` |
| Scope | `Organization` |
| Select columns | blank for the primary gate test |
| Filter rows | selected Candidate E, D, or diagnostic Candidate A expression from §5.3 |

6. Add a **Compose** action named `Dump trigger`.
7. Set `Dump trigger` input to:

```text
triggerOutputs()
```

8. Add a **Compose** action named `SdkMessage`.
9. Set `SdkMessage` input to:

```text
triggerOutputs()?['body/SdkMessage']
```

10. Save the flow.
11. If save fails, record the exact validation error verbatim and test the next candidate from §5.3.
12. If no candidate saves, mark **FAIL — Option B `$batch` fallback; no schema rework** and stop.
13. Turn the flow on.

### 5.5 Set up parent and child rows

1. Create or select Parent A in `[PARENT_TABLE]`.
2. Set Parent A `[PARENT_STATUS_COLUMN]` to `[PRE_SUBMIT_STATUS_LABEL]` / `[PRE_SUBMIT_STATUS_INT]`.
3. Record Parent A GUID as `[PARENT_A_GUID]`.
4. Create or select one active child row under Parent A in `[CHILD_TABLE]`.
5. Record the Parent A child GUID as `[CHILD_A_GUID]`.
6. Create or select Parent B in `[PARENT_TABLE]`.
7. Set Parent B `[PARENT_STATUS_COLUMN]` to `Phase II Pending` / `[PHASE_II_PENDING_INT]`.
8. Record Parent B GUID as `[PARENT_B_GUID]`.
9. Create or select one active child row under Parent B in `[CHILD_TABLE]`.
10. Record the Parent B child GUID as `[CHILD_B_GUID]`.
11. Record the current timestamp to the minute as `[CREATE_BASELINE_TIMESTAMP]`.
12. Record the latest visible run ID in the flow's run history as `[CREATE_BASELINE_RUN_ID]`.
13. Wait for run-history propagation.
14. If no create-related run is visible after 1 minute, re-check at 3 minutes.
15. Log the actual elapsed time as `[CREATE_HISTORY_ELAPSED]`.
16. Pass criterion: no run after `[CREATE_BASELINE_TIMESTAMP]` has trigger-output child row ID `[CHILD_A_GUID]` or `[CHILD_B_GUID]`.
17. Fail criterion: any run after `[CREATE_BASELINE_TIMESTAMP]` has trigger-output child row ID `[CHILD_A_GUID]` or `[CHILD_B_GUID]`.

### 5.6 Web API state-change request shapes

1. Use the deterministic Web API PATCH in this section as the **primary gate vehicle** for every deactivate/reactivate operation in §5.7 through §5.10.
2. Do not use a model-driven form Deactivate command as the primary gate vehicle because it can autosave dirty fields, carry companion field changes, or trigger business rules.
3. For deactivation, send this exact request shape:

```http
PATCH https://[org].crm.dynamics.com/api/data/v9.2/[CHILD_TABLE]([CHILD_GUID])
Accept: application/json
Content-Type: application/json
OData-MaxVersion: 4.0
OData-Version: 4.0
If-Match: *

{"statecode":1,"statuscode":2}
```

4. For reactivation, send this exact request shape:

```http
PATCH https://[org].crm.dynamics.com/api/data/v9.2/[CHILD_TABLE]([CHILD_GUID])
Accept: application/json
Content-Type: application/json
OData-MaxVersion: 4.0
OData-Version: 4.0
If-Match: *

{"statecode":0,"statuscode":1}
```

5. Replace `[org]` with the sandbox org host from `[ENVIRONMENT_URL]`.
6. Replace `[CHILD_TABLE]` with the entity-set URL segment for `[CHILD_TABLE]`; for the real parent request example the URL pattern is `https://[org].crm.dynamics.com/api/data/v9.2/akoya_requests([GUID])`, and for this child test use the equivalent child entity-set URL.
7. Replace `[CHILD_GUID]` with `[CHILD_A_GUID]` or `[CHILD_B_GUID]`.
8. Record the HTTP status code and response body for each PATCH attempt.
9. Pass criterion: deactivation PATCH sends only `statecode` and `statuscode` in the JSON body and receives a successful Dataverse response.
10. Fail criterion: deactivation is performed by form UI only, or the PATCH body contains any field other than `statecode` and `statuscode`.

### 5.7 Gate-FALSE test: deactivation under non-Phase-II parent

1. Confirm `[CHILD_A_GUID]` is Active (`statecode` = 0, `statuscode` = 1).
2. If `[CHILD_A_GUID]` is not Active, send the §5.6 reactivation PATCH for `[CHILD_A_GUID]`.
3. Wait for Dataverse/flow run-history propagation and log the elapsed time.
4. Record the current timestamp to the minute as `[FALSE_BASELINE_TIMESTAMP]`.
5. Record the latest visible run ID in run history as `[FALSE_BASELINE_RUN_ID]`.
6. Send the §5.6 deactivation PATCH for `[CHILD_A_GUID]`.
7. Wait 2 minutes.
8. Open the flow run history.
9. If no new run is visible yet, re-check at 3 minutes.
10. Count only runs whose start time is after `[FALSE_BASELINE_TIMESTAMP]`.
11. Count only runs whose raw trigger output child row ID equals `[CHILD_A_GUID]`.
12. Record the count as `[FALSE_RUN_COUNT]`.
13. If a second run appears for `[CHILD_A_GUID]`, record it separately as `[FALSE_RETRY_OBSERVATION]` and compare run IDs, retry/error status, and trigger start times before calling it a true second fire.
14. Pass criterion: `[FALSE_RUN_COUNT]` = 0.
15. Fail criterion: `[FALSE_RUN_COUNT]` > 0.

### 5.8 Gate-TRUE test: deactivation under Phase-II parent

1. Confirm `[CHILD_B_GUID]` is Active (`statecode` = 0, `statuscode` = 1).
2. If `[CHILD_B_GUID]` is not Active, send the §5.6 reactivation PATCH for `[CHILD_B_GUID]`.
3. Wait for Dataverse/flow run-history propagation and log the elapsed time.
4. Record the current timestamp to the minute as `[TRUE_BASELINE_TIMESTAMP]`.
5. Record the latest visible run ID in run history as `[TRUE_BASELINE_RUN_ID]`.
6. Send the §5.6 deactivation PATCH for `[CHILD_B_GUID]`.
7. Wait 2 minutes.
8. Open the flow run history.
9. If no new run is visible yet, re-check at 3 minutes.
10. Count only runs whose start time is after `[TRUE_BASELINE_TIMESTAMP]`.
11. Count only runs whose raw trigger output child row ID equals `[CHILD_B_GUID]`.
12. Record the count as `[TRUE_RUN_COUNT]`.
13. If a second run appears for `[CHILD_B_GUID]`, record it separately as `[TRUE_RETRY_OBSERVATION]` and compare run IDs, retry/error status, and trigger start times before calling it a true second fire.
14. Open the single counted run if `[TRUE_RUN_COUNT]` = 1.
15. Open the `SdkMessage` Compose output.
16. Record the literal output as `[SDK_MESSAGE_LITERAL]`.
17. Open the `Dump trigger` Compose output.
18. Record whether `[CHILD_PARENT_LOOKUP_PROPERTY]` is present.
19. Record whether `[CHILD_PARENT_LOOKUP_PROPERTY]` equals `[PARENT_B_GUID]`.
20. Pass criterion: `[TRUE_RUN_COUNT]` = 1, `[SDK_MESSAGE_LITERAL]` is exactly `Update`, and `[CHILD_PARENT_LOOKUP_PROPERTY]` equals `[PARENT_B_GUID]`.
21. Fail criterion: `[TRUE_RUN_COUNT]` != 1.
22. Fail criterion: `[SDK_MESSAGE_LITERAL]` is any literal other than exactly `Update`; record it verbatim and flag unresolved platform behavior requiring PA-docs confirmation before P1-Update can clear.
23. Fail criterion: `[CHILD_PARENT_LOOKUP_PROPERTY]` is missing or does not equal `[PARENT_B_GUID]`.

### 5.9 Select-columns interaction

1. Treat every Select-columns subtest as a separate state-machine pass.
2. Before every Select-columns subtest, confirm `[CHILD_B_GUID]` is Active.
3. If `[CHILD_B_GUID]` is Inactive, send the §5.6 reactivation PATCH for `[CHILD_B_GUID]`.
4. Wait for Dataverse/flow run-history propagation and log the elapsed time.
5. Edit the flow trigger Select columns to business fields only, for example:

```text
wmkf_amount,wmkf_category,wmkf_year,wmkf_description
```

6. Save the flow.
7. Record the current timestamp to the minute as `[SELECT_BUSINESS_BASELINE_TIMESTAMP]`.
8. Record the latest visible run ID in run history as `[SELECT_BUSINESS_BASELINE_RUN_ID]`.
9. Send the §5.6 deactivation PATCH for `[CHILD_B_GUID]`.
10. Wait 2 minutes.
11. If no new run is visible yet, re-check at 3 minutes.
12. Count only runs after `[SELECT_BUSINESS_BASELINE_TIMESTAMP]` whose trigger-output child row ID equals `[CHILD_B_GUID]`.
13. Record the count as `[SELECT_BUSINESS_RUN_COUNT]`.
14. Pass criterion: `[SELECT_BUSINESS_RUN_COUNT]` = 0.
15. Fail criterion: `[SELECT_BUSINESS_RUN_COUNT]` > 0.
16. Reactivate `[CHILD_B_GUID]` with the §5.6 reactivation PATCH.
17. Wait for Dataverse/flow run-history propagation and log the elapsed time.
18. Edit the flow trigger Select columns to:

```text
statecode
```

19. Save the flow.
20. Record the current timestamp to the minute as `[SELECT_STATE_BASELINE_TIMESTAMP]`.
21. Record the latest visible run ID in run history as `[SELECT_STATE_BASELINE_RUN_ID]`.
22. Send the §5.6 deactivation PATCH for `[CHILD_B_GUID]`.
23. Wait 2 minutes.
24. If no new run is visible yet, re-check at 3 minutes.
25. Count only runs after `[SELECT_STATE_BASELINE_TIMESTAMP]` whose trigger-output child row ID equals `[CHILD_B_GUID]`.
26. Record the count as `[SELECT_STATE_RUN_COUNT]`.
27. Observation criterion: record whether `[SELECT_STATE_RUN_COUNT]` is 0 or 1.
28. Reactivate `[CHILD_B_GUID]` with the §5.6 reactivation PATCH.
29. Wait for Dataverse/flow run-history propagation and log the elapsed time.
30. Edit the flow trigger Select columns to:

```text
statecode,statuscode
```

31. Save the flow.
32. Record the current timestamp to the minute as `[SELECT_STATE_STATUS_BASELINE_TIMESTAMP]`.
33. Record the latest visible run ID in run history as `[SELECT_STATE_STATUS_BASELINE_RUN_ID]`.
34. Send the §5.6 deactivation PATCH for `[CHILD_B_GUID]`.
35. Wait 2 minutes.
36. If no new run is visible yet, re-check at 3 minutes.
37. Count only runs after `[SELECT_STATE_STATUS_BASELINE_TIMESTAMP]` whose trigger-output child row ID equals `[CHILD_B_GUID]`.
38. Record the count as `[SELECT_STATE_STATUS_RUN_COUNT]`.
39. Pass criterion: `[SELECT_STATE_STATUS_RUN_COUNT]` = 1.
40. Fail criterion: `[SELECT_STATE_STATUS_RUN_COUNT]` != 1.
41. Production guidance: leave Select columns blank or include every state/status column the actual deactivate request includes.
42. Production guidance: if the production deactivate request sends `statecode` and `statuscode`, do not configure Select columns as `statecode` only unless Connor has separately accepted the observed behavior.

### 5.10 Optional secondary UI production-realism check

1. Run this section only after §5.7, §5.8, and §5.9 have completed.
2. Treat this section as secondary evidence only.
3. Confirm `[CHILD_B_GUID]` is Active.
4. If `[CHILD_B_GUID]` is Inactive, send the §5.6 reactivation PATCH for `[CHILD_B_GUID]`.
5. Wait for Dataverse/flow run-history propagation and log the elapsed time.
6. Set Select columns back to blank and save the flow.
7. Record the current timestamp to the minute as `[UI_BASELINE_TIMESTAMP]`.
8. Record the latest visible run ID in run history as `[UI_BASELINE_RUN_ID]`.
9. Open the model-driven form for `[CHILD_B_GUID]`.
10. Do not edit any field on the form.
11. Use the command bar **Deactivate** command and confirm the dialog.
12. Wait 2 minutes.
13. If no new run is visible yet, re-check at 3 minutes.
14. Count only runs after `[UI_BASELINE_TIMESTAMP]` whose trigger-output child row ID equals `[CHILD_B_GUID]`.
15. Record the count as `[UI_RUN_COUNT]`.
16. Record `SdkMessage` for the UI-originated run if exactly one run appears.
17. Pass criterion: `[UI_RUN_COUNT]` = 1 and the UI `SdkMessage` literal is exactly `Update`.
18. Fail criterion: `[UI_RUN_COUNT]` != 1 or the UI `SdkMessage` literal is not exactly `Update`.

### 5.11 Reactivation symmetry check

1. Set Select columns back to blank and save the flow.
2. Confirm `[CHILD_B_GUID]` is Inactive.
3. If `[CHILD_B_GUID]` is Active, do not run this section; record `N/A — row already Active` and leave the row unchanged.
4. Record the current timestamp to the minute as `[REACTIVATE_BASELINE_TIMESTAMP]`.
5. Record the latest visible run ID in run history as `[REACTIVATE_BASELINE_RUN_ID]`.
6. Send the §5.6 reactivation PATCH for `[CHILD_B_GUID]`.
7. Wait 2 minutes.
8. If no new run is visible yet, re-check at 3 minutes.
9. Count only runs after `[REACTIVATE_BASELINE_TIMESTAMP]` whose trigger-output child row ID equals `[CHILD_B_GUID]`.
10. Record the count as `[REACTIVATE_RUN_COUNT]`.
11. Open the `SdkMessage` Compose output if exactly one run appears.
12. Record the literal output as `[REACTIVATE_SDK_MESSAGE_LITERAL]`.
13. Pass criterion: `[REACTIVATE_RUN_COUNT]` = 1 and `[REACTIVATE_SDK_MESSAGE_LITERAL]` is exactly `Update`.
14. Fail criterion: `[REACTIVATE_RUN_COUNT]` != 1 or `[REACTIVATE_SDK_MESSAGE_LITERAL]` is not exactly `Update`.

### 5.12 What to return

1. Return `[ENVIRONMENT_URL]`, `[ENTITY_PATH]`, `[CHILD_TABLE]`, `[PARENT_TABLE]`, `[CHILD_PARENT_LOOKUP_COLUMN]`, `[CHILD_PARENT_LOOKUP_PROPERTY]`, `[NAV_PROP_NAME]`, `[PARENT_STATUS_COLUMN]`, `[PHASE_II_PENDING_INT]`, and `[PRE_SUBMIT_STATUS_INT]`.
2. Return the exact candidate expression used, including candidate letter.
3. Return screenshots or copied snippets proving the flow trigger configuration: Change type, Table name, Scope, Select columns, and Filter rows.
4. Return `[CREATE_BASELINE_TIMESTAMP]`, `[CREATE_BASELINE_RUN_ID]`, and `[CREATE_HISTORY_ELAPSED]`.
5. Return `[FALSE_BASELINE_TIMESTAMP]`, `[FALSE_BASELINE_RUN_ID]`, `[FALSE_RUN_COUNT]`, and any `[FALSE_RETRY_OBSERVATION]`.
6. Return `[TRUE_BASELINE_TIMESTAMP]`, `[TRUE_BASELINE_RUN_ID]`, `[TRUE_RUN_COUNT]`, `[SDK_MESSAGE_LITERAL]`, and any `[TRUE_RETRY_OBSERVATION]`.
7. Return the run ID for the counted gate-TRUE deactivation run.
8. Return screenshots or copied raw trigger-output snippets showing the counted run's child row ID equals `[CHILD_B_GUID]`.
9. Return screenshots or copied raw trigger-output snippets showing `[CHILD_PARENT_LOOKUP_PROPERTY]` equals `[PARENT_B_GUID]`.
10. Return pass/fail for §5.7, §5.8, §5.9 business-fields-only, §5.9 statecode-only, §5.9 statecode+statuscode, §5.10 if run, and §5.11.
11. Return every `SdkMessage` literal observed, exactly as shown by Power Automate.
12. Return every validation error, run error, or HTTP error verbatim.
13. Return the final verdict from §5.13.

### 5.13 Verdict rubric

| Verdict | Deterministic conditions |
|---|---|
| P1-Update VERIFIED — gate clears, no waiver needed | Real path; selected candidate saves; §5.7 pass; §5.8 pass; `SdkMessage` literal is exactly `Update`; trigger output child row ID equals `[CHILD_B_GUID]`; `[CHILD_PARENT_LOOKUP_PROPERTY]` equals `[PARENT_B_GUID]`; §5.9 `statecode,statuscode` pass. |
| Partially verified (proxy path only) — `[partially verified]` label applies; real-schema repeat is P4 post-deploy | Proxy path; all P1-Update VERIFIED runtime conditions pass on the proxy pair; no real `wmkf_proposalbudgetline` run has been completed. |
| FAIL — Option B `$batch` fallback; no schema rework | No candidate saves; §5.7 fails; §5.8 fails; `SdkMessage` literal is anything other than exactly `Update`; trigger output child row ID does not equal `[CHILD_B_GUID]`; `[CHILD_PARENT_LOOKUP_PROPERTY]` is missing or does not equal `[PARENT_B_GUID]`; or §5.9 `statecode,statuscode` fails. |

### 5.14 Estimated effort

1. Build one flow.
2. Collect four required metadata values before testing: `[PHASE_II_PENDING_INT]`, `[NAV_PROP_NAME]`, `[PRE_SUBMIT_STATUS_INT]`, and `[CHILD_PARENT_LOOKUP_PROPERTY]`.
3. Run one gate-FALSE Web API deactivation.
4. Run one gate-TRUE Web API deactivation.
5. Run three Select-columns deactivation subtests.
6. Run the optional UI realism check only after the deterministic Web API checks.
7. Expected effort: 45–75 minutes including run-history latency.
