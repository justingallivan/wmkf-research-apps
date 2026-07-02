---
title: "DRAFT — UNAUTHORIZED / UNLANDED — Connor send-candidate v5 (S163, 2026-05-18)"
domain: intake-portal
kind: draft
status: draft
summary: "The CORE pre-deploy gate is now exactly: §5.4/§5.5 (flow saves) + §5.7 (gate-FALSE) + §5.8 (gate-TRUE) + §5.10 (active-subset input), on the real..."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
related:
  - scripts/probe-slice0-attr-collision.mjs
  - docs/INTAKE_PORTAL_ITEM_6_MAKER_PORTAL_TESTS.md
---

# DRAFT — UNAUTHORIZED / UNLANDED — Connor send-candidate v5 (S163, 2026-05-18)

> **Canonical status:** **`INTAKE_PORTAL_BUDGET_ROSTER_RECONCILE_STATUS.md`**. This file is retained for the full §5 procedures and the **waiver Artifact 1** (UNAUTHORIZED until Justin signs it). Current state — the P1-Update gate, waiver status, Connor status — is tracked in STATUS, not here. The condensed handout actually sent to Connor is `INTAKE_PORTAL_ITEM_6_CONNOR_CORE_GATE.md`.

## v3 -> v4 review deltas

1. §5.11 rapid multi-child deactivation is re-scoped as bounded stress evidence. A missing run, non-`Update` `SdkMessage`, or child-GUID attribution failure remains gate-relevant, but retry/duplicate ambiguity by itself is recorded and escalated as a separate Power Automate concurrency/run-history finding rather than forcing the P1-Update gate to FAIL.
2. §5.10 active-subset wording is tightened to say it proves only the queryable active-child input set used by the flow. It does not prove production aggregate arithmetic or parent PATCH behavior, which remain OUT/deferred per §5.0.
3. §5.16 verdict wording is aligned to those scope boundaries while preserving the hard rules: real path required for VERIFIED, deterministic Web API evidence required, and every required state-change `SdkMessage` must be exactly `Update`.

## v4 -> v5 Part-2 trim deltas (Codex Part-2 disposition applied)

The CORE pre-deploy gate is now exactly: §5.4/§5.5 (flow saves) + §5.7 (gate-FALSE) + §5.8 (gate-TRUE) + §5.10 (active-subset input), on the real path, with `SdkMessage` exactly `Update` and correct child/parent attribution.

4. §5.9 (reactivation symmetry) DOWNGRADED to EVIDENCE — direction-awareness, not in the deactivation-only P1-Update spec; no longer a VERIFIED/FAIL gate condition.
5. §5.12 (parent-status transition timing) DOWNGRADED to EVIDENCE — useful timing insight, not core to the deploy decision; the core pre-submit gate-FALSE remains §5.7. No longer a VERIFIED/FAIL gate condition.
6. §5.13 (Select-columns) made CONDITIONAL — run only if production will configure trigger Select columns; if production leaves Select columns blank (default/recommended), record the decision and SKIP §5.13; it gates nothing in that case.
7. §5.16 verdict + §5.0 scope table + §5.17 effort updated to match: §5.9/§5.11/§5.12 are evidence/record-and-escalate, §5.13 conditional; only the core set above plus the hard `SdkMessage`/attribution/real-path rules gate VERIFIED.

This file is a staging artifact for review. Nothing here is landed in the
authoritative docs (`INTAKE_PORTAL_BUDGET_AGGREGATE_RECOMPUTE_DECISION.md`,
`INTAKE_PORTAL_ITEM_6_MAKER_PORTAL_TESTS.md`, `INTAKE_PORTAL_DESIGN.md`) and
the waiver is **not** authorized.

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

## 5.0 Scope decision for the P1-Update pre-deploy gate

Use this table to keep the gate honest. Do not mark any scenario covered unless the executable section listed here was run and returned the required evidence.

| Scenario | Gate scope | Executable section | Justification |
|---|---:|---|---|
| Statecode-only deactivation path | IN | §5.7, §5.8 | This is the core P1-Update question. |
| Reactivation path (`statecode`->Active) | EVIDENCE — not gate | §5.9 | Direction-awareness evidence. Reactivation is not in the deactivation-only P1-Update spec; useful to inform production flow design but does not gate the pre-deploy decision. |
| Pre-submit / drain-window gate-false case | IN | §5.7 | The parent-status filter is only useful if it suppresses child updates before `Phase II Pending`. This static gate-FALSE is the core requirement; transition-timing is separate evidence (§5.12). |
| Multiple children under one parent, partial deactivation, active-only recompute input | IN | §5.10 | The flow must query active child rows only after one obsolete row is deactivated. This proves the input set, not the production aggregate arithmetic or parent PATCH. |
| Bulk / batch deactivation | IN as bounded evidence, not standalone gate-fail on ambiguity | §5.11 | The gate needs a multi-row stress check. This runbook uses rapid deterministic PATCHes, not a drain `$batch` implementation test. A missing expected run, non-`Update` `SdkMessage`, or wrong child attribution is gate-relevant; unresolved retry/duplicate ambiguity is recorded and escalated as a separate PA concurrency/run-history finding. |
| Concurrent / rapid edits | IN as bounded evidence, not standalone gate-fail on ambiguity | §5.11 | The gate needs child-GUID attribution and duplicate/retry disambiguation under rapid adjacent updates. Full concurrency correctness belongs to the production flow design, so ambiguous duplicate behavior here does not by itself prove the parent-status filter failed. |
| Parent status transitions into/out of `Phase II Pending` | EVIDENCE — not gate | §5.12 | Useful timing insight on when the filter evaluates parent status; not core to the pre-deploy decision (the core pre-submit gate-FALSE is §5.7). Run if time permits; does not gate VERIFIED/FAIL. |
| `SdkMessage` identity for the deactivation gate | IN | §5.8 | The production flow can only make deterministic decisions if the deactivation literal is exactly `Update`. (Reactivation `SdkMessage` in §5.9 is evidence only.) |
| Trigger `Filter rows` vs `Select columns` semantics for statecode-only change | CONDITIONAL — only if production uses Select columns | §5.13 | A statecode-only deactivation can be accidentally filtered out by Select columns. Run §5.13 ONLY if production will configure trigger Select columns; if production leaves them blank (default/recommended), record that decision and skip — it gates nothing in that case. |
| Retry / duplicate-fire disambiguation | IN | §5.6 and every observation section | A second visible run can be a retry or a distinct trigger fire; the gate must not count blindly. |
| Proxy entity vs real entity strength | IN | §5.2, §5.16 | Proxy proves only the platform pattern and is `[partially verified]`; real path is required for VERIFIED. |
| Candidate filter syntax ladder A-I | IN | §5.4 | The selected parent-status expression is part of the gate. |
| UI form Deactivate realism check | OUT of hard gate, optional evidence | §5.14 | Web API PATCH is the deterministic gate vehicle; UI deactivate can carry unrelated behavior. |
| Create binding | OUT for this gate | N/A | Connor's deactivate-not-delete ruling removed Create from the P1-Update pre-deploy blocker. |
| Delete binding / Delete payload introspection | OUT for this gate | N/A | Obsolete rows are deactivated, not deleted. Delete path remains outside the P1-Update decision. |
| True Dataverse `$batch` change-set drain implementation | OUT; deferred | N/A | Option B/drain atomicity is a separate implementation track, not the P1-Update filter-binding question. |
| Full production aggregate-field math and parent PATCH | OUT; deferred | N/A | This runbook proves the trigger path and active-child input set only; the production flow's final arithmetic/PATCH belongs to flow implementation testing. |

Platform claim tags in this runbook:

| Claim | Tag |
|---|---|
| Dataverse PA trigger supports row add/modify/delete change types and exposes `triggerOutputs()?['body/SdkMessage']`. | `[verified: docs/INTAKE_PORTAL_ITEM_6_MAKER_PORTAL_TESTS.md §1 Known verified primitives]` |
| Dataverse PA trigger supports OData-style `Filter rows`; do not include `$filter=` in the box. | `[verified: docs/INTAKE_PORTAL_ITEM_6_MAKER_PORTAL_TESTS.md §1 Known verified primitives and §3 Candidate filter expressions]` |
| Web API OData filters support comparison/logical operators and evaluate rows where the expression is true. | `[verified: docs/INTAKE_PORTAL_ITEM_6_MAKER_PORTAL_TESTS.md §1 Known verified primitives]` |
| Dataverse exposes lookup properties with the `_<name>_value` convention and case-sensitive single-valued navigation properties. | `[verified: docs/INTAKE_PORTAL_ITEM_6_MAKER_PORTAL_TESTS.md §1 Known verified primitives and §3 Candidate filter expressions]` |
| Lookup columns are not supported in the trigger's Select columns. | `[verified: docs/INTAKE_PORTAL_ITEM_6_MAKER_PORTAL_TESTS.md §3 Shared setup and Update binding steps]` |
| Power Automate trigger filter on a child table can traverse to parent status using the selected A-I expression during a statecode-only Update. | `[unverified -- needs PA-docs confirmation]` until Connor runs this runbook. |
| Statecode-only deactivate/reactivate PATCHes surface as `SdkMessage` exactly `Update`. | `[unverified -- needs PA-docs confirmation]` until Connor runs this runbook. |
| Flow run-history ordering, latency, and retry surfaces are deterministic enough to classify duplicate fires by run ID/status/start time. | `[unverified -- needs PA-docs confirmation]`; this runbook records enough evidence to avoid assuming it. |

---

## 5.1 Before you start

1. Confirm maker-portal access to the **sandbox** environment, not production.
2. Confirm you can create cloud flows with the Microsoft Dataverse trigger.
3. Confirm you can create, update, reactivate, and deactivate rows in the child table under test.
4. Confirm you can inspect flow run history and raw trigger/action outputs.
5. Pick exactly one entity path:

| Path | Use when | Result strength |
|---|---|---|
| Real path | `wmkf_proposalbudgetline` exists in the sandbox. Use `wmkf_proposalbudgetline` child, `akoya_request` parent, and the confirmed child lookup. | Can clear P1-Update. |
| Proxy path | Schema is not deployed yet. Use an existing child-parent pair where the parent has a controllable status/choice column and the child supports deactivate/reactivate. | Mark `[partially verified -- Connor tests this]`; repeat on the real schema before PA flow-live. |

Proxy requirements:

1. Child table has a many-to-one lookup to a parent table.
2. Parent table has a controllable status/choice column comparable to `akoya_request.akoya_requeststatus`.
3. Child rows support deactivate and reactivate through Web API PATCH.
4. Child rows have at least one numeric amount-like column if §5.10 active-subset evidence will calculate a sum. If not, §5.10 may use GUID membership/count evidence only and must record that limitation.
5. The relationship is normal Dataverse metadata, not a virtual table or unsupported connector surface.

---

## 5.2 Metadata values to collect before testing

Record every placeholder before running the gate. Every placeholder below is referenced by later steps.

| Placeholder | Value to record |
|---|---|
| `[TESTER_NAME]` | Connor or actual tester. |
| `[TEST_DATE]` | Test date. |
| `[ENVIRONMENT_URL]` | Sandbox environment URL/name. |
| `[ORG_HOST]` | Host portion used in Web API URLs, for example `[org].crm.dynamics.com`. |
| `[SOLUTION_NAME]` | Use `WMKF Intake Item 6 PA Trigger Test` unless the sandbox requires another solution. |
| `[ENTITY_PATH]` | `real` or `proxy`. |
| `[CHILD_TABLE]` | Child table logical name. Real schema: `wmkf_proposalbudgetline`. |
| `[CHILD_ENTITY_SET]` | Child entity-set URL segment for Web API PATCH. |
| `[PARENT_TABLE]` | Parent table logical name. Real schema: `akoya_request`. |
| `[PARENT_ENTITY_SET]` | Parent entity-set URL segment for Web API PATCH/status changes. |
| `[CHILD_PRIMARY_KEY]` | Child primary-key logical name. |
| `[PARENT_PRIMARY_KEY]` | Parent primary-key logical name. |
| `[CHILD_PARENT_LOOKUP_COLUMN]` | Child row's parent lookup column logical name. |
| `[CHILD_PARENT_LOOKUP_PROPERTY]` | Child row's parent foreign-key payload property. Real schema likely `_wmkf_request_value`; confirm from metadata or trigger output. |
| `[NAV_PROP_NAME]` | Single-valued navigation property name for the parent lookup; case-sensitive. |
| `[LOWERCASE_NAV_PROP_NAME]` | Lowercase probe value for Candidate F. |
| `[PARENT_STATUS_COLUMN]` | Parent-status column logical name. Real schema: `akoya_requeststatus`. |
| `[PHASE_II_PENDING_LABEL]` | `Phase II Pending`. |
| `[PHASE_II_PENDING_INT]` | Integer option-set value for `Phase II Pending`. |
| `[PRE_SUBMIT_STATUS_LABEL]` | Pre-submit/drain-time status label, for example `In Progress`. |
| `[PRE_SUBMIT_STATUS_INT]` | Integer option-set value for the pre-submit/drain-time status. |
| `[OTHER_POST_SUBMIT_STATUS_INT]` | Optional second post-submit status value for Candidate I; record `N/A` if unused. |
| `[ACTIVE_STATECODE_INT]` | Active statecode integer. Expected `0`; confirm in metadata. |
| `[ACTIVE_STATUSCODE_INT]` | Active statuscode integer. Expected `1`; confirm in metadata. |
| `[INACTIVE_STATECODE_INT]` | Inactive statecode integer. Expected `1`; confirm in metadata. |
| `[INACTIVE_STATUSCODE_INT]` | Inactive statuscode integer. Expected `2`; confirm in metadata. |
| `[AMOUNT_COLUMN]` | Numeric child column to use for §5.10 active-subset evidence; real schema likely `wmkf_amount`. |
| `[SELECT_COLUMNS_PRODUCTION_DECISION]` | `blank` (production leaves trigger Select columns empty — default/recommended; §5.13 is then SKIPPED and gates nothing) or `configured` (production will set Select columns; §5.13 then becomes a hard gate). Decide/record this before testing. |
| `[BUSINESS_SELECT_COLUMNS]` | Comma-separated business columns for §5.13, for example `wmkf_amount,wmkf_category,wmkf_year,wmkf_description`. Only needed if `[SELECT_COLUMNS_PRODUCTION_DECISION] = configured`. |
| `[FLOW_NAME]` | `TEST Item 6 BudgetLine Deactivation Filter Binding`. |
| `[SELECTED_CANDIDATE_LETTER]` | Candidate A-I that saves and passes runtime gate checks. |
| `[SELECTED_FILTER_EXPRESSION]` | Exact expression pasted into Filter rows after placeholder substitution. |
| `[PARENT_A_GUID]` | Non-Phase-II parent GUID. |
| `[CHILD_A_GUID]` | Active child under Parent A. |
| `[PARENT_B_GUID]` | Phase-II parent GUID for core deactivation/reactivation tests. |
| `[CHILD_B_GUID]` | Active child under Parent B. |
| `[PARENT_C_GUID]` | Phase-II parent GUID for active-subset test. |
| `[CHILD_C1_GUID]`, `[CHILD_C2_GUID]`, `[CHILD_C3_GUID]` | Three active child rows under Parent C. |
| `[CHILD_C1_AMOUNT]`, `[CHILD_C2_AMOUNT]`, `[CHILD_C3_AMOUNT]` | Amounts for Parent C children; recommended `100`, `200`, `300`. |
| `[PARENT_D_GUID]` | Phase-II parent GUID for rapid multi-child test. |
| `[CHILD_D1_GUID]`, `[CHILD_D2_GUID]` | Active child rows under Parent D. |

---

## 5.3 Web API state-change request shapes

Use deterministic Web API PATCH as the **primary gate vehicle** for every deactivate/reactivate operation in §5.7 through §5.13. Do not use the model-driven form Deactivate command as the primary gate vehicle because form autosave, companion field changes, or business rules can obscure the statecode-only question.

For deactivation, send this exact request shape:

```http
PATCH https://[ORG_HOST]/api/data/v9.2/[CHILD_ENTITY_SET]([CHILD_GUID])
Accept: application/json
Content-Type: application/json
OData-MaxVersion: 4.0
OData-Version: 4.0
If-Match: *

{"statecode":1,"statuscode":2}
```

For reactivation, send this exact request shape:

```http
PATCH https://[ORG_HOST]/api/data/v9.2/[CHILD_ENTITY_SET]([CHILD_GUID])
Accept: application/json
Content-Type: application/json
OData-MaxVersion: 4.0
OData-Version: 4.0
If-Match: *

{"statecode":0,"statuscode":1}
```

Replace the integer literals only if `[ACTIVE_STATECODE_INT]`, `[ACTIVE_STATUSCODE_INT]`, `[INACTIVE_STATECODE_INT]`, or `[INACTIVE_STATUSCODE_INT]` differ from the expected values recorded in §5.2. If any integer differs, record the adjusted request body verbatim.

For parent status changes in §5.12, use this request shape:

```http
PATCH https://[ORG_HOST]/api/data/v9.2/[PARENT_ENTITY_SET]([PARENT_GUID])
Accept: application/json
Content-Type: application/json
OData-MaxVersion: 4.0
OData-Version: 4.0
If-Match: *

{"[PARENT_STATUS_COLUMN]":[STATUS_INT]}
```

For each PATCH, record the target GUID, timestamp, HTTP status code, and response body. Pass only if the child PATCH body contains `statecode` and `statuscode` and no other child columns.

---

## 5.4 Candidate filter expression selection

Use only the A-I ladder from Maker Portal Tests §3. Do not invent new letters. Candidate A is a diagnostic probe only. Prefer Candidate E when `[NAV_PROP_NAME]` and `[PHASE_II_PENDING_INT]` are known.

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

Selection rules:

1. Put only the expression in "Filter rows"; do **not** include `$filter=`.
2. Replace every placeholder before saving the flow.
3. Try Candidate E first if `[NAV_PROP_NAME]` and `[PHASE_II_PENDING_INT]` are known.
4. If Candidate E does not save, try Candidate D.
5. If Candidate D does not save, continue through the A-I ladder and record every attempted candidate by letter.
6. If Candidate A saves and passes runtime observations, record it as diagnostic evidence only. It is not the preferred production expression because lookup GUID property traversal is not the documented navigation-property pattern in the source runbook.
7. Pass criterion for the selected expression: it saves, evaluates FALSE under `[PRE_SUBMIT_STATUS_INT]`, evaluates TRUE under `[PHASE_II_PENDING_INT]`, and supports the statecode-only Update tests below.
8. Fail criterion: no candidate saves, or the selected candidate cannot produce both the gate-FALSE and gate-TRUE runtime observations.

---

## 5.5 Build the test flow

1. Maker portal -> open or create the sandbox solution `[SOLUTION_NAME]`.
2. Select **+ New -> Automation -> Cloud flow -> Automated**.
3. Name the flow exactly `[FLOW_NAME]`.
4. Select the Microsoft Dataverse trigger **When a row is added, modified or deleted**.
5. Configure the trigger:

| Trigger parameter | Value |
|---|---|
| Change type | `Modified` |
| Table name | `[CHILD_TABLE]` |
| Scope | `Organization` |
| Select columns | blank for §5.7 through §5.12 |
| Filter rows | `[SELECTED_FILTER_EXPRESSION]` from §5.4 |

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

10. Add a **Compose** action named `Trigger child id`.
11. Set `Trigger child id` input to the raw trigger child primary key field. Use `[CHILD_PRIMARY_KEY]` from the trigger body or the dynamic child row identifier shown by the designer, then record the exact expression as `[TRIGGER_CHILD_ID_EXPRESSION]`.
12. Add a **Compose** action named `Trigger parent lookup`.
13. Set `Trigger parent lookup` input to:

```text
triggerOutputs()?['body/[CHILD_PARENT_LOOKUP_PROPERTY]']
```

14. Save the flow.
15. If save fails, record the exact validation error verbatim and test the next candidate from §5.4.
16. If no candidate saves, mark **FAIL -- Option B `$batch` fallback; no schema rework** and stop.
17. Turn the flow on.

For §5.10 only, temporarily add or enable a **List rows** action named `List active siblings` after `Dump trigger`:

| List rows field | Value |
|---|---|
| Table name | `[CHILD_TABLE]` |
| Filter rows | `[CHILD_PARENT_LOOKUP_PROPERTY] eq [PARENT_C_GUID] and statecode eq [ACTIVE_STATECODE_INT]` |
| Select columns | `[CHILD_PRIMARY_KEY],[CHILD_PARENT_LOOKUP_COLUMN],[AMOUNT_COLUMN],statecode,statuscode` if supported by the designer; otherwise record exact selected columns. |

If the List rows filter does not save, record the error and use an unfiltered List rows under `[PARENT_C_GUID]` plus manual inspection of `statecode`. That fallback proves the active subset only if the run output clearly shows active/inactive state for all Parent C children.

---

## 5.6 Observation protocol, baselines, and duplicate/retry handling

Use this protocol in every subtest.

1. Start each subtest by putting the named child row(s) into the required state. If a subtest says "start Active", send the §5.3 reactivation PATCH first when needed.
2. After any setup PATCH, wait for Dataverse/flow run-history propagation and log elapsed time as `[SETUP_PROPAGATION_ELAPSED]` for that subtest.
3. Record a fresh baseline timestamp to the minute immediately before the tested PATCH as `[SUBTEST]_BASELINE_TIMESTAMP`.
4. Record the latest visible run ID immediately before the tested PATCH as `[SUBTEST]_BASELINE_RUN_ID`.
5. Send the tested PATCH.
6. Wait 2 minutes.
7. If no expected run is visible, re-check at 3 minutes.
8. Count only runs whose start time is after `[SUBTEST]_BASELINE_TIMESTAMP`.
9. Count only runs whose raw trigger-output child row ID equals the expected child GUID for the subtest.
10. If a second run appears for the same child GUID, record it separately as `[SUBTEST]_RETRY_OR_DUPLICATE_OBSERVATION`.
11. To classify a second visible run, compare run IDs, retry/error status, trigger start times, and raw trigger body. Do not count it as a true duplicate fire unless it has a distinct run ID and a distinct trigger body/start time for the same tested PATCH.
12. Record every `SdkMessage` literal exactly as shown. Hard rule: for every child deactivate/reactivate state-change test, `SdkMessage` must be exactly `Update`. Any other literal -> record verbatim, **FAIL**, flag unresolved platform behavior. No human-judgment escape hatch.

---

## 5.7 Gate-FALSE deactivation under non-Phase-II parent

Purpose: prove the flow does not fire during the pre-submit/drain window.

State machine:

1. Set Parent A `[PARENT_STATUS_COLUMN]` to `[PRE_SUBMIT_STATUS_LABEL]` / `[PRE_SUBMIT_STATUS_INT]`.
2. Confirm `[CHILD_A_GUID]` is Active (`statecode` = `[ACTIVE_STATECODE_INT]`, `statuscode` = `[ACTIVE_STATUSCODE_INT]`).
3. If `[CHILD_A_GUID]` is Inactive, send the §5.3 reactivation PATCH for `[CHILD_A_GUID]`.
4. Follow §5.6 with `[SUBTEST] = FALSE`.
5. Send the §5.3 deactivation PATCH for `[CHILD_A_GUID]`.
6. Count only runs after `[FALSE_BASELINE_TIMESTAMP]` whose trigger-output child row ID equals `[CHILD_A_GUID]`.
7. Record `[FALSE_RUN_COUNT]`.
8. Record any `[FALSE_RETRY_OR_DUPLICATE_OBSERVATION]`.

Pass criterion: `[FALSE_RUN_COUNT]` = 0.

Fail criterion: `[FALSE_RUN_COUNT]` > 0.

---

## 5.8 Gate-TRUE deactivation under Phase-II parent

Purpose: prove statecode-only deactivation fires once with deterministic `Update` identity and parent attribution.

State machine:

1. Set Parent B `[PARENT_STATUS_COLUMN]` to `[PHASE_II_PENDING_LABEL]` / `[PHASE_II_PENDING_INT]`.
2. Confirm `[CHILD_B_GUID]` is Active (`statecode` = `[ACTIVE_STATECODE_INT]`, `statuscode` = `[ACTIVE_STATUSCODE_INT]`).
3. If `[CHILD_B_GUID]` is Inactive, send the §5.3 reactivation PATCH for `[CHILD_B_GUID]`.
4. Follow §5.6 with `[SUBTEST] = TRUE`.
5. Send the §5.3 deactivation PATCH for `[CHILD_B_GUID]`.
6. Count only runs after `[TRUE_BASELINE_TIMESTAMP]` whose trigger-output child row ID equals `[CHILD_B_GUID]`.
7. Record `[TRUE_RUN_COUNT]`.
8. Record any `[TRUE_RETRY_OR_DUPLICATE_OBSERVATION]`.
9. Open the single counted run if `[TRUE_RUN_COUNT]` = 1.
10. Record `SdkMessage` Compose output as `[SDK_MESSAGE_LITERAL]`.
11. Open `Dump trigger`.
12. Record whether `[CHILD_PARENT_LOOKUP_PROPERTY]` is present as `[TRUE_PARENT_LOOKUP_PRESENT]`.
13. Record whether `[CHILD_PARENT_LOOKUP_PROPERTY]` equals `[PARENT_B_GUID]` as `[TRUE_PARENT_LOOKUP_MATCH]`.
14. Record the run ID as `[TRUE_RUN_ID]`.

Pass criterion: `[TRUE_RUN_COUNT]` = 1, `[SDK_MESSAGE_LITERAL]` is exactly `Update`, `[TRUE_PARENT_LOOKUP_PRESENT]` = yes, and `[TRUE_PARENT_LOOKUP_MATCH]` = yes.

Fail criteria:

1. `[TRUE_RUN_COUNT]` != 1.
2. `[SDK_MESSAGE_LITERAL]` is any literal other than exactly `Update`; record it verbatim and flag unresolved platform behavior requiring PA-docs confirmation before P1-Update can clear.
3. `[CHILD_PARENT_LOOKUP_PROPERTY]` is missing or does not equal `[PARENT_B_GUID]`.

---

## 5.9 Reactivation symmetry under Phase-II parent — EVIDENCE ONLY (not a pre-deploy gate)

**Scope (Codex Part-2):** This section is direction-awareness EVIDENCE, not a hard gate condition. The P1-Update spec is deactivation-only; reactivation behavior informs production flow design but does not by itself clear or fail the pre-deploy gate. Record the results; do not let this section alone change the §5.16 verdict.

Purpose: observe whether the reverse state transition also binds as a child Update under the same parent-status filter.

State machine:

1. Set Select columns back to blank and save the flow.
2. Set Parent B `[PARENT_STATUS_COLUMN]` to `[PHASE_II_PENDING_LABEL]` / `[PHASE_II_PENDING_INT]`.
3. Confirm `[CHILD_B_GUID]` is Inactive (`statecode` = `[INACTIVE_STATECODE_INT]`, `statuscode` = `[INACTIVE_STATUSCODE_INT]`).
4. If `[CHILD_B_GUID]` is Active, send the §5.3 deactivation PATCH for `[CHILD_B_GUID]`, then wait for propagation and record elapsed time.
5. Follow §5.6 with `[SUBTEST] = REACTIVATE`.
6. Send the §5.3 reactivation PATCH for `[CHILD_B_GUID]`.
7. Count only runs after `[REACTIVATE_BASELINE_TIMESTAMP]` whose trigger-output child row ID equals `[CHILD_B_GUID]`.
8. Record `[REACTIVATE_RUN_COUNT]`.
9. Record any `[REACTIVATE_RETRY_OR_DUPLICATE_OBSERVATION]`.
10. Open the counted run if `[REACTIVATE_RUN_COUNT]` = 1.
11. Record the `SdkMessage` Compose output as `[REACTIVATE_SDK_MESSAGE_LITERAL]`.
12. Record whether `[CHILD_PARENT_LOOKUP_PROPERTY]` equals `[PARENT_B_GUID]` as `[REACTIVATE_PARENT_LOOKUP_MATCH]`.

Expected observation (evidence, not a gate): `[REACTIVATE_RUN_COUNT]` = 1, `[REACTIVATE_SDK_MESSAGE_LITERAL]` exactly `Update`, `[REACTIVATE_PARENT_LOOKUP_MATCH]` = yes. Record the actuals regardless. A deviation here is a production-flow-design input (the flow may need direction-aware logic) and a §5.16 "evidence note," NOT a pre-deploy FAIL on its own.

---

## 5.10 Active-subset recompute input after partial deactivation

Purpose: prove that after one obsolete child is deactivated, a List rows query in the triggered flow can read the active sibling set while excluding the just-deactivated row. This is active-subset input evidence only. It does **not** prove the production flow's aggregate arithmetic, category filters, currency handling, or parent aggregate PATCH; those remain OUT/deferred per §5.0.

State machine:

1. Set Select columns back to blank and save the flow.
2. Ensure `List active siblings` from §5.5 is present/enabled and filtered to `[PARENT_C_GUID]`.
3. Set Parent C `[PARENT_STATUS_COLUMN]` to `[PHASE_II_PENDING_LABEL]` / `[PHASE_II_PENDING_INT]`.
4. Create or select `[CHILD_C1_GUID]`, `[CHILD_C2_GUID]`, `[CHILD_C3_GUID]` under `[PARENT_C_GUID]`.
5. Set all three children Active using §5.3 reactivation PATCH if needed.
6. Set `[CHILD_C1_AMOUNT] = 100`, `[CHILD_C2_AMOUNT] = 200`, and `[CHILD_C3_AMOUNT] = 300`, or record the actual values if the proxy path uses different amounts.
7. Confirm expected active-before set is `[CHILD_C1_GUID]`, `[CHILD_C2_GUID]`, `[CHILD_C3_GUID]`.
8. Follow §5.6 with `[SUBTEST] = ACTIVE_SUBSET`.
9. Send the §5.3 deactivation PATCH for `[CHILD_C2_GUID]`.
10. Count only runs after `[ACTIVE_SUBSET_BASELINE_TIMESTAMP]` whose trigger-output child row ID equals `[CHILD_C2_GUID]`.
11. Record `[ACTIVE_SUBSET_RUN_COUNT]`.
12. Open the counted run if `[ACTIVE_SUBSET_RUN_COUNT]` = 1.
13. Record `[ACTIVE_SUBSET_SDK_MESSAGE_LITERAL]`.
14. Open `List active siblings` output.
15. Record returned child GUIDs as `[ACTIVE_SUBSET_RETURNED_CHILD_GUIDS]`.
16. Record returned state/status values as `[ACTIVE_SUBSET_RETURNED_STATES]`.
17. Record returned amount values as `[ACTIVE_SUBSET_RETURNED_AMOUNTS]`.
18. Calculate and record `[ACTIVE_SUBSET_EXPECTED_ACTIVE_GUIDS] = [CHILD_C1_GUID], [CHILD_C3_GUID]`.
19. Calculate and record `[ACTIVE_SUBSET_EXPECTED_AMOUNT_SUM] = [CHILD_C1_AMOUNT] + [CHILD_C3_AMOUNT]`.
20. If `[AMOUNT_COLUMN]` is available, calculate and record `[ACTIVE_SUBSET_OBSERVED_AMOUNT_SUM_FROM_RETURNED_ROWS]` as an operator-side check over the returned active rows only. If `[AMOUNT_COLUMN]` is not available, record `N/A -- amount column not available on proxy`.

Pass criterion: `[ACTIVE_SUBSET_RUN_COUNT]` = 1, `[ACTIVE_SUBSET_SDK_MESSAGE_LITERAL]` is exactly `Update`, returned active GUIDs are exactly `[CHILD_C1_GUID]` and `[CHILD_C3_GUID]`, and `[CHILD_C2_GUID]` is absent from the active set. When `[AMOUNT_COLUMN]` is available, `[ACTIVE_SUBSET_OBSERVED_AMOUNT_SUM_FROM_RETURNED_ROWS]` must equal `[ACTIVE_SUBSET_EXPECTED_AMOUNT_SUM]` as corroborating input-set evidence only.

Fail criterion: deactivated `[CHILD_C2_GUID]` appears in the active set, an active sibling is missing, the run count is not 1, `SdkMessage` is not exactly `Update`, or the operator-side sum over returned active rows is wrong when amount evidence is available. Do not report §5.10 as proof that the production recompute wrote correct aggregate values.

---

## 5.11 Rapid multi-child deactivation stress check

Purpose: collect bounded stress evidence for child-GUID attribution and duplicate/retry handling under rapid adjacent statecode-only Updates. This is a limited pre-deploy stress check, not a true `$batch` drain implementation test and not a full PA concurrency-correctness test.

State machine:

1. Set Select columns back to blank and save the flow.
2. Set Parent D `[PARENT_STATUS_COLUMN]` to `[PHASE_II_PENDING_LABEL]` / `[PHASE_II_PENDING_INT]`.
3. Create or select `[CHILD_D1_GUID]` and `[CHILD_D2_GUID]` under `[PARENT_D_GUID]`.
4. Confirm both children are Active. If either child is Inactive, send the §5.3 reactivation PATCH for that child and wait for propagation.
5. Follow §5.6 with `[SUBTEST] = RAPID`.
6. Send the §5.3 deactivation PATCH for `[CHILD_D1_GUID]`.
7. Immediately send the §5.3 deactivation PATCH for `[CHILD_D2_GUID]`.
8. Wait 2 minutes; re-check at 3 minutes if needed.
9. Count runs after `[RAPID_BASELINE_TIMESTAMP]` whose trigger-output child row ID equals `[CHILD_D1_GUID]`; record `[RAPID_D1_RUN_COUNT]`.
10. Count runs after `[RAPID_BASELINE_TIMESTAMP]` whose trigger-output child row ID equals `[CHILD_D2_GUID]`; record `[RAPID_D2_RUN_COUNT]`.
11. Record run IDs as `[RAPID_D1_RUN_ID]` and `[RAPID_D2_RUN_ID]`.
12. Record `SdkMessage` literals as `[RAPID_D1_SDK_MESSAGE_LITERAL]` and `[RAPID_D2_SDK_MESSAGE_LITERAL]`.
13. Record any `[RAPID_RETRY_OR_DUPLICATE_OBSERVATION]` using §5.6.

Clean evidence criterion: `[RAPID_D1_RUN_COUNT]` = 1, `[RAPID_D2_RUN_COUNT]` = 1, both `SdkMessage` literals are exactly `Update`, and each run's trigger child ID matches the expected child.

Gate-fail criterion: either child has 0 runs, any `SdkMessage` literal is not exactly `Update`, or child-GUID attribution is ambiguous.

Record-and-escalate criterion: if both expected child updates produce attributable `Update` runs, but one child also has an unresolved duplicate/ambiguous true fire that cannot be classified by §5.6, record the evidence and escalate as a separate PA retry/concurrency/run-history finding. Do **not** use that ambiguity alone to declare the parent-status filter-binding P1-Update gate failed; §5.7/§5.8/§5.9 remain the core single-update gate evidence.

---

## 5.12 Parent status transition timing checks — EVIDENCE ONLY (not a pre-deploy gate)

**Scope (Codex Part-2):** This section is timing EVIDENCE, not a hard gate condition. The core pre-submit gate-FALSE requirement is proven by §5.7 (static). §5.12 adds insight on *when* the filter re-evaluates parent status across a transition — useful for production flow design but not core to the deploy decision. Record results; do not let this section alone change the §5.16 verdict. Run only if time permits after the core gate (§5.7/§5.8/§5.10).

Purpose: observe whether the parent-status filter evaluates at child-update time for both transition directions around the drain boundary.

### 5.12.1 Transition into Phase II Pending

State machine:

1. Set Select columns back to blank and save the flow.
2. Set Parent A `[PARENT_STATUS_COLUMN]` to `[PRE_SUBMIT_STATUS_LABEL]` / `[PRE_SUBMIT_STATUS_INT]`.
3. Confirm `[CHILD_A_GUID]` is Active. If not, reactivate it using §5.3.
4. Follow §5.6 with `[SUBTEST] = TRANSITION_IN_FALSE`.
5. Send the §5.3 deactivation PATCH for `[CHILD_A_GUID]`.
6. Record `[TRANSITION_IN_FALSE_RUN_COUNT]`; expected 0.
7. Reactivate `[CHILD_A_GUID]` using §5.3 and wait for propagation.
8. PATCH Parent A to `[PHASE_II_PENDING_INT]` using §5.3 parent status shape.
9. Follow §5.6 with `[SUBTEST] = TRANSITION_IN_TRUE`.
10. Send the §5.3 deactivation PATCH for `[CHILD_A_GUID]`.
11. Record `[TRANSITION_IN_TRUE_RUN_COUNT]`.
12. If exactly one run appears, record `[TRANSITION_IN_TRUE_SDK_MESSAGE_LITERAL]`.

Expected observation (evidence, not a gate): `[TRANSITION_IN_FALSE_RUN_COUNT]` = 0, `[TRANSITION_IN_TRUE_RUN_COUNT]` = 1, `[TRANSITION_IN_TRUE_SDK_MESSAGE_LITERAL]` exactly `Update`. Record actuals. A deviation is a §5.16 evidence note + production-flow-design input, NOT a pre-deploy FAIL on its own (the core static gate-FALSE is §5.7).

### 5.12.2 Transition out of Phase II Pending

State machine:

1. Reactivate `[CHILD_A_GUID]` using §5.3 and wait for propagation.
2. PATCH Parent A back to `[PRE_SUBMIT_STATUS_INT]` using §5.3 parent status shape.
3. Follow §5.6 with `[SUBTEST] = TRANSITION_OUT_FALSE`.
4. Send the §5.3 deactivation PATCH for `[CHILD_A_GUID]`.
5. Record `[TRANSITION_OUT_FALSE_RUN_COUNT]`.

Expected observation (evidence, not a gate): `[TRANSITION_OUT_FALSE_RUN_COUNT]` = 0. Record actuals; deviation is an evidence note, not a standalone pre-deploy FAIL.

---

## 5.13 Select-columns interaction for statecode-only changes — CONDITIONAL

**Run condition (Codex Part-2):** Run §5.13 ONLY if production will configure trigger **Select columns**. If production will leave Select columns **blank** (the default and recommended configuration), record `[SELECT_COLUMNS_PRODUCTION_DECISION] = blank` in §5.15 and **SKIP §5.13 entirely** — in that case it gates nothing and does not affect the §5.16 verdict. Only if `[SELECT_COLUMNS_PRODUCTION_DECISION] = configured` does §5.13 become a hard gate condition.

Purpose (when applicable): prove the chosen production Select columns setting will not accidentally suppress statecode/statuscode-only Updates.

Treat every Select-columns subtest as a separate state-machine pass. Before every subtest, set Parent B to Phase II Pending, confirm `[CHILD_B_GUID]` is Active, and reactivate via §5.3 if needed.

### 5.13.1 Business-fields-only Select columns

1. Edit the trigger Select columns to `[BUSINESS_SELECT_COLUMNS]`.
2. Save the flow.
3. Follow §5.6 with `[SUBTEST] = SELECT_BUSINESS`.
4. Send the §5.3 deactivation PATCH for `[CHILD_B_GUID]`.
5. Count runs after `[SELECT_BUSINESS_BASELINE_TIMESTAMP]` whose trigger-output child row ID equals `[CHILD_B_GUID]`.
6. Record `[SELECT_BUSINESS_RUN_COUNT]`.

Expected observation: `[SELECT_BUSINESS_RUN_COUNT]` should be 0 if none of the selected business fields changed. If it is >0, record the run output and treat it as an unexpected platform observation requiring PA-docs confirmation.

### 5.13.2 `statecode` Select columns

1. Reactivate `[CHILD_B_GUID]` using §5.3 and wait for propagation.
2. Edit the trigger Select columns to:

```text
statecode
```

3. Save the flow.
4. Follow §5.6 with `[SUBTEST] = SELECT_STATE`.
5. Send the §5.3 deactivation PATCH for `[CHILD_B_GUID]`.
6. Count runs after `[SELECT_STATE_BASELINE_TIMESTAMP]` whose trigger-output child row ID equals `[CHILD_B_GUID]`.
7. Record `[SELECT_STATE_RUN_COUNT]`.
8. If exactly one run appears, record `[SELECT_STATE_SDK_MESSAGE_LITERAL]`.

Observation criterion: record whether `[SELECT_STATE_RUN_COUNT]` is 0 or 1. Do not rely on `statecode` alone in production unless Connor separately accepts the observed behavior.

### 5.13.3 `statecode,statuscode` Select columns

1. Reactivate `[CHILD_B_GUID]` using §5.3 and wait for propagation.
2. Edit the trigger Select columns to:

```text
statecode,statuscode
```

3. Save the flow.
4. Follow §5.6 with `[SUBTEST] = SELECT_STATE_STATUS`.
5. Send the §5.3 deactivation PATCH for `[CHILD_B_GUID]`.
6. Count runs after `[SELECT_STATE_STATUS_BASELINE_TIMESTAMP]` whose trigger-output child row ID equals `[CHILD_B_GUID]`.
7. Record `[SELECT_STATE_STATUS_RUN_COUNT]`.
8. If exactly one run appears, record `[SELECT_STATE_STATUS_SDK_MESSAGE_LITERAL]`.

Pass criterion for §5.13: `[SELECT_BUSINESS_RUN_COUNT]` = 0, `[SELECT_STATE_STATUS_RUN_COUNT]` = 1, and `[SELECT_STATE_STATUS_SDK_MESSAGE_LITERAL]` is exactly `Update`.

Fail criterion for §5.13: business-fields-only fires unexpectedly without an accepted explanation, `statecode,statuscode` does not fire, or `SdkMessage` is not exactly `Update`.

Production guidance: leave Select columns blank or include every state/status column the actual deactivate/reactivate request includes. Do not configure Select columns as lookup columns; the source runbook records lookup columns in Select columns as unsupported.

---

## 5.14 Optional secondary UI production-realism check

Run this section only after the core gate (§5.7, §5.8, §5.10) passes, and only if time permits. Treat this section as secondary evidence only; it cannot rescue a failed deterministic Web API gate and does not gate the §5.16 verdict.

State machine:

1. Confirm `[CHILD_B_GUID]` is Active.
2. If `[CHILD_B_GUID]` is Inactive, send the §5.3 reactivation PATCH for `[CHILD_B_GUID]`.
3. Wait for propagation.
4. Set Select columns back to blank and save the flow.
5. Follow §5.6 with `[SUBTEST] = UI`.
6. Open the model-driven form for `[CHILD_B_GUID]`.
7. Do not edit any field on the form.
8. Use the command bar **Deactivate** command and confirm the dialog.
9. Count only runs after `[UI_BASELINE_TIMESTAMP]` whose trigger-output child row ID equals `[CHILD_B_GUID]`.
10. Record `[UI_RUN_COUNT]`.
11. If exactly one run appears, record `[UI_SDK_MESSAGE_LITERAL]`.

Observation pass: `[UI_RUN_COUNT]` = 1 and `[UI_SDK_MESSAGE_LITERAL]` is exactly `Update`.

Observation fail: `[UI_RUN_COUNT]` != 1 or the UI `SdkMessage` literal is not exactly `Update`.

---

## 5.15 What to return

Return this checklist. Do not summarize away raw literals or errors.

1. `[TESTER_NAME]`, `[TEST_DATE]`, `[ENVIRONMENT_URL]`, `[ORG_HOST]`, `[SOLUTION_NAME]`, and `[ENTITY_PATH]`.
2. `[CHILD_TABLE]`, `[CHILD_ENTITY_SET]`, `[PARENT_TABLE]`, `[PARENT_ENTITY_SET]`, `[CHILD_PRIMARY_KEY]`, `[PARENT_PRIMARY_KEY]`.
3. `[CHILD_PARENT_LOOKUP_COLUMN]`, `[CHILD_PARENT_LOOKUP_PROPERTY]`, `[NAV_PROP_NAME]`, `[LOWERCASE_NAV_PROP_NAME]`, `[PARENT_STATUS_COLUMN]`.
4. `[PHASE_II_PENDING_INT]`, `[PRE_SUBMIT_STATUS_INT]`, `[OTHER_POST_SUBMIT_STATUS_INT]`, `[ACTIVE_STATECODE_INT]`, `[ACTIVE_STATUSCODE_INT]`, `[INACTIVE_STATECODE_INT]`, `[INACTIVE_STATUSCODE_INT]`.
5. `[AMOUNT_COLUMN]` and `[BUSINESS_SELECT_COLUMNS]`.
6. The exact candidate expression used, including `[SELECTED_CANDIDATE_LETTER]` and `[SELECTED_FILTER_EXPRESSION]`.
7. Screenshots or copied snippets proving the flow trigger configuration: Change type, Table name, Scope, Select columns, and Filter rows.
8. Every candidate validation error, run error, or HTTP error verbatim.
9. For every subtest: baseline timestamp, baseline run ID, tested child GUID(s), run count(s), run ID(s), retry/duplicate observations, and exact `SdkMessage` literal(s).
10. §5.7 evidence: `[FALSE_BASELINE_TIMESTAMP]`, `[FALSE_BASELINE_RUN_ID]`, `[FALSE_RUN_COUNT]`, `[FALSE_RETRY_OR_DUPLICATE_OBSERVATION]`.
11. §5.8 evidence: `[TRUE_BASELINE_TIMESTAMP]`, `[TRUE_BASELINE_RUN_ID]`, `[TRUE_RUN_COUNT]`, `[TRUE_RUN_ID]`, `[SDK_MESSAGE_LITERAL]`, `[TRUE_PARENT_LOOKUP_PRESENT]`, `[TRUE_PARENT_LOOKUP_MATCH]`, `[TRUE_RETRY_OR_DUPLICATE_OBSERVATION]`.
12. §5.9 evidence: `[REACTIVATE_BASELINE_TIMESTAMP]`, `[REACTIVATE_BASELINE_RUN_ID]`, `[REACTIVATE_RUN_COUNT]`, `[REACTIVATE_SDK_MESSAGE_LITERAL]`, `[REACTIVATE_PARENT_LOOKUP_MATCH]`, `[REACTIVATE_RETRY_OR_DUPLICATE_OBSERVATION]`.
13. §5.10 evidence: `[ACTIVE_SUBSET_RUN_COUNT]`, `[ACTIVE_SUBSET_SDK_MESSAGE_LITERAL]`, `[ACTIVE_SUBSET_RETURNED_CHILD_GUIDS]`, `[ACTIVE_SUBSET_RETURNED_STATES]`, `[ACTIVE_SUBSET_RETURNED_AMOUNTS]`, `[ACTIVE_SUBSET_EXPECTED_ACTIVE_GUIDS]`, `[ACTIVE_SUBSET_EXPECTED_AMOUNT_SUM]`, `[ACTIVE_SUBSET_OBSERVED_AMOUNT_SUM_FROM_RETURNED_ROWS]`.
14. §5.11 evidence: `[RAPID_D1_RUN_COUNT]`, `[RAPID_D2_RUN_COUNT]`, `[RAPID_D1_RUN_ID]`, `[RAPID_D2_RUN_ID]`, `[RAPID_D1_SDK_MESSAGE_LITERAL]`, `[RAPID_D2_SDK_MESSAGE_LITERAL]`, `[RAPID_RETRY_OR_DUPLICATE_OBSERVATION]`, and whether the §5.11 outcome is clean evidence, gate-fail, or record-and-escalate.
15. §5.12 evidence: `[TRANSITION_IN_FALSE_RUN_COUNT]`, `[TRANSITION_IN_TRUE_RUN_COUNT]`, `[TRANSITION_IN_TRUE_SDK_MESSAGE_LITERAL]`, `[TRANSITION_OUT_FALSE_RUN_COUNT]`.
16. `[SELECT_COLUMNS_PRODUCTION_DECISION]` (`blank` or `configured`). §5.13 evidence — only if `configured`: `[SELECT_BUSINESS_RUN_COUNT]`, `[SELECT_STATE_RUN_COUNT]`, `[SELECT_STATE_SDK_MESSAGE_LITERAL]` if present, `[SELECT_STATE_STATUS_RUN_COUNT]`, `[SELECT_STATE_STATUS_SDK_MESSAGE_LITERAL]`. If `blank`, state "§5.13 SKIPPED — production Select columns blank."
17. §5.14 evidence if run: `[UI_RUN_COUNT]`, `[UI_SDK_MESSAGE_LITERAL]`.
18. Screenshots or copied raw trigger-output snippets showing each counted run's child row ID equals the expected child GUID.
19. Screenshots or copied raw trigger-output snippets showing `[CHILD_PARENT_LOOKUP_PROPERTY]` equals the expected parent GUID.
20. Final verdict from §5.16.

---

## 5.16 Verdict rubric

Use exactly one verdict.

| Verdict | Deterministic conditions |
|---|---|
| VERIFIED | **Real path**; selected candidate saves (§5.4/§5.5); **§5.7 pass**; **§5.8 pass**; **§5.10 pass**; §5.13 pass **or** N/A (`[SELECT_COLUMNS_PRODUCTION_DECISION] = blank`); §5.11 is clean evidence or record-and-escalate with no §5.11 gate-fail condition; every required `SdkMessage` literal is exactly `Update`; every counted run's child ID and parent lookup attribution match the expected GUIDs. §5.9 and §5.12 are recorded as evidence and do NOT gate this verdict (note any deviation as a tracked production-flow-design item). Clears the S163 P1-Update pre-deploy gate, with any §5.11 record-and-escalate or §5.9/§5.12 evidence deviation tracked separately. |
| partial(proxy) | Proxy path; all VERIFIED gate conditions pass on the proxy pair; no real `wmkf_proposalbudgetline` run has been completed. Result is `[partially verified -- Connor tests this]`; real repeat = P4 post-deploy. |
| FAIL(->Option B, no schema rework) | No candidate saves; **§5.7, §5.8, or §5.10 fails**; §5.13 fails when `[SELECT_COLUMNS_PRODUCTION_DECISION] = configured`; §5.11 has a gate-fail condition (missing run / non-`Update` / attribution failure); any required `SdkMessage` literal is anything other than exactly `Update`; or trigger output child row ID or parent lookup attribution is missing/ambiguous. §5.9 or §5.12 evidence deviations do NOT by themselves produce FAIL. |

Hard rules:

1. Proxy-path evidence never becomes VERIFIED.
2. A UI-only pass never rescues a Web API failure.
3. Any non-`Update` `SdkMessage` literal in a **gate** state-change test (§5.7, §5.8, §5.10, §5.11, and §5.13 when configured) is FAIL, recorded verbatim. A non-`Update` literal in an EVIDENCE section (§5.9, §5.12) is recorded verbatim and escalated as a tracked production-flow-design finding, not a standalone FAIL.
4. Candidate A may diagnose the platform but should not be preferred for production if Candidate E or D passes.
5. Failure maps to Option B `$batch` fallback with no schema rework. Do not propose schema rollback from this test outcome.
6. §5.11 unresolved duplicate/ambiguous true-fire evidence is a separate PA concurrency/run-history finding when both expected child updates produced attributable `Update` runs. It does not, by itself, prove the parent-status filter-binding P1-Update gate failed.

---

## 5.17 Estimated effort

**Core gate (required — this is the minimal sound battery):**

1. Build one flow + collect metadata (§5.2, §5.4, §5.5).
2. §5.7 — one gate-FALSE Web API deactivation.
3. §5.8 — one gate-TRUE Web API deactivation.
4. §5.10 — one active-subset (3-child, deactivate-1) check.
5. §5.13 — three Select-columns subtests **only if** production will configure Select columns; otherwise record the decision and skip.

Core gate effort: **~35–55 minutes** including run-history latency (≈20–35 min if §5.13 is skipped).

**Evidence (run only if time permits — does NOT gate the verdict):**

6. §5.9 — reactivation symmetry (direction-awareness evidence).
7. §5.11 — rapid two-child stress (record-and-escalate, not gate-fail on ambiguity).
8. §5.12 — two parent-status transition-timing checks.
9. §5.14 — optional UI realism check, only after the core gate passes.

Full battery incl. all evidence: ~75–120 minutes. The deploy decision needs only the core gate; the evidence sections inform production flow design.
