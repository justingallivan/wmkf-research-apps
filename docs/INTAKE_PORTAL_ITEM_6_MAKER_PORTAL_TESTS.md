---
title: Intake Portal Item 6 -- Maker Portal Tests
domain: intake-portal
kind: history
status: historical
summary: "Status: draft test runbook for Connor, 2026-05-14."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
related:
  - docs/INTAKE_PORTAL_BUDGET_AGGREGATE_RECOMPUTE_DECISION.md
  - docs/BUDGET_FORM_SPEC.md
---

# Intake Portal Item 6 -- Maker Portal Tests

> **⚠️ Pre-deactivate (2026-05-14) — history.** Predates Connor's deactivate-not-delete ruling; superseded for live test mechanics by `INTAKE_PORTAL_ITEM_6_CONNOR_CORE_GATE.md`. Retained because **§3 Candidates A–E** are still referenced by `INTAKE_PORTAL_BUDGET_AGGREGATE_RECOMPUTE_DECISION.md` §0. Canonical status (is slice-0 cleared? the P1-Update gate? waiver + Connor status?): **`INTAKE_PORTAL_BUDGET_ROSTER_RECONCILE_STATUS.md`**.

**Status:** draft test runbook for Connor, 2026-05-14.

**Related docs:**
- `docs/INTAKE_PORTAL_BUDGET_AGGREGATE_RECOMPUTE_DECISION.md` -- decision summary, Option A/B/C paths, verification-tag convention.
- `docs/BUDGET_FORM_SPEC.md` -- v3 budget schema, aggregate fields, drain ordering.

**Verification tags used here:**
- `[VERIFIED via URL]` -- Microsoft Learn documents the platform behavior directly.
- `[partially verified -- Connor tests this]` -- Microsoft Learn documents the primitive behavior, but not the exact combination Item 6 needs.
- `[unverified -- Connor explores]` -- no authoritative confirmation yet; this is a maker-portal discovery task.

Microsoft Learn references used in this runbook:
- Dataverse PA trigger setup, change types, `SdkMessage`, trigger filter expressions, lookup-column limitation for "Select columns": https://learn.microsoft.com/en-us/power-automate/dataverse/create-update-delete-trigger
- Dataverse Web API OData filter operators and filter evaluation: https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/query/filter-rows
- Dataverse lookup properties and single-valued navigation properties: https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/web-api-properties and https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/web-api-navigation-properties
- Dataverse connector overview, including create/update/delete triggers and changeset actions: https://learn.microsoft.com/en-us/power-automate/dataverse/overview
- Dataverse Web API batch/change set atomicity background for Option B: https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/execute-batch-operations-using-web-api

---

## 1. Purpose

We are testing whether Item 6 Option A is mechanically safe in the Power Automate maker portal.

Option A is the status-gated PA flow:

1. The intake drain cron writes `wmkf_proposalbudgetline` child rows during submit.
2. The drain PATCHes cached aggregate fields on the parent `akoya_request`.
3. Only after child writes and aggregate PATCH does the submission lifecycle flip the parent request status to `Phase II Pending`.
4. A PA flow on child Create/Update/Delete recomputes aggregates after post-submit staff edits.
5. The PA trigger must filter on parent status so the flow does **not** run for drain-time child writes.

The proposed trigger gate is conceptually:

```text
_wmkf_request_value/akoya_requeststatus eq 'Phase II Pending'
```

or the equivalent valid maker-portal expression.

This matters because the drain and PA flow both write the same parent aggregate fields over the proposal lifecycle:

| Field on `akoya_request` | Meaning |
|---|---|
| `akoya_request` | Total WMKF-requested amount, filtered to WMKF-spend categories |
| `wmkf_totalothersources` | Total cost-share amount, filtered to cost-share categories |
| `akoya_expenses` | Total project cost |

The dual-writer exception is acceptable only if the trigger-level status gate prevents drain-time PA runs and the Delete event can identify the deleted child row's parent. If either precondition fails, Option A is not deployable as drafted.

Two things must be verified in the maker portal:

1. **Trigger filter expression syntax binds for Create, Update, and Delete.** `[partially verified -- Connor tests this]`
2. **Delete trigger parent ID resolution works.** Specifically, the deleted row payload includes `_wmkf_request_value`, or an equivalent parent lookup value, so the flow knows which `akoya_request` to recompute. `[unverified -- Connor explores]`

Known verified primitives:

| Platform behavior | Status |
|---|---|
| The Dataverse trigger "When a row is added, modified or deleted" supports Create, Update, and Delete change types, and `triggerOutputs()['body/SdkMessage']` reports `Create`, `Update`, or `Delete`. | `[VERIFIED via URL]` |
| The trigger supports an OData-style "Filter rows" expression evaluated after the Dataverse save. | `[VERIFIED via URL]` |
| The PA trigger doc says the expression must **not** include the literal `$filter=` prefix. | `[VERIFIED via URL]` |
| Web API OData filters support comparison/logical operators and evaluate rows where the expression is true. | `[VERIFIED via URL]` |
| Dataverse exposes lookup properties with the `_<name>_value` convention and also has case-sensitive navigation property names in metadata. | `[VERIFIED via URL]` |
| Microsoft Learn does **not** document the exact combination "Power Automate trigger filter on child table using parent navigation property, including Delete." | `[partially verified -- Connor tests this]` |

---

## 2. Prerequisites

### Access

Connor needs:

1. Maker portal access to the correct sandbox environment.
2. Permission to create cloud flows using the Dataverse trigger. Microsoft Learn says the Dataverse trigger requires user-level permissions on the `Callback Registration` table, plus read permissions appropriate to the configured trigger scope. `[VERIFIED via URL]`
3. Permission to create, update, and delete test rows in the child table under test.
4. Permission to inspect flow run history and raw action outputs.
5. Permission to create or select a parent request row whose status can be controlled.

### Solution hygiene

Create all test flows inside a sandbox/dev solution, not as unmanaged loose flows. Suggested solution naming:

```text
WMKF Intake Item 6 PA Trigger Test
```

Suggested flow names:

```text
TEST Item 6 BudgetLine Create Filter Binding
TEST Item 6 BudgetLine Update Filter Binding
TEST Item 6 BudgetLine Delete Filter Binding
TEST Item 6 BudgetLine Delete Payload Introspection
```

Do not attach these tests to production tables in a production environment.

### Deploy-state caveat: `wmkf_proposalbudgetline` does not exist yet

Critical caveat: `wmkf_proposalbudgetline` is part of the pending schema slice. It may not exist in the org when Connor runs this test.

Pick exactly one path:

| Path | Use when | What changes in this runbook |
|---|---|---|
| Wait for schema deploy | `wmkf_proposalbudgetline` will be deployed before the test window. | Use the real table and real lookup names. This is the preferred final verification before slice 0 deploy. |
| Proxy entity test | The schema is not deployed, but we need a same-day answer on PA behavior. | Use an existing parent-child pair in the same org as a proxy. The test proves the platform pattern, but final verification must be repeated on `wmkf_proposalbudgetline` after schema deploy. |

Recommended proxy requirements:

1. Child table has a many-to-one lookup to a parent table.
2. Parent table has a choice/status field comparable to `akoya_request.akoya_requeststatus`.
3. Connor can create, update, and delete child rows safely.
4. The test parent has two statuses or two rows that let Connor test "gate false" and "gate true."
5. The relationship has normal Dataverse metadata, not a virtual table or unsupported connector surface.

Result interpretation:

| Test target | Result strength |
|---|---|
| Real `wmkf_proposalbudgetline` + real `akoya_request` | Can clear the Item 6 precondition. |
| Proxy parent-child pair only | Can reduce risk, but does **not** fully clear the Item 6 precondition. Mark the result `[partially verified -- Connor tests this]` until repeated on the real schema. |

### Metadata values to collect before testing

For the real schema path, collect:

| Item | Expected / placeholder |
|---|---|
| Child table logical name | `wmkf_proposalbudgetline` |
| Parent table logical name | `akoya_request` |
| Child lookup column logical name | likely `wmkf_request`, but confirm in metadata |
| Lookup property name in payload | likely `_wmkf_request_value`, but confirm from trigger output |
| Single-valued navigation property name | likely `wmkf_Request` or similar; confirm in relationship metadata because navigation property names are case-sensitive |
| Parent status column | `akoya_requeststatus` |
| `Phase II Pending` option-set integer | **unknown; must be read from Dataverse metadata** |
| Pre-submit/drain-time parent status option-set integer | **unknown; must be read from Dataverse metadata** |

For the proxy path, record the equivalent values in the result table.

---

## 3. Test 1 -- Trigger Filter Binding

Goal: confirm a trigger-level filter can reference the parent request status and bind for each event type: Create, Update, Delete.

Do this as three separate flows, one per change type. Separate flows make it obvious whether one event type binds while another fails.

### Shared setup

1. In the maker portal, open the sandbox solution.
2. Create a new automated cloud flow.
3. Choose the Microsoft Dataverse trigger: **When a row is added, modified or deleted**.
4. Configure:

| Trigger parameter | Real schema value | Proxy value |
|---|---|---|
| Change type | Create, Update, or Delete depending on the flow | Same |
| Table name | `wmkf_proposalbudgetline` | proxy child table |
| Scope | Organization, unless Connor intentionally needs narrower | same |
| Select columns | Leave blank for Create/Delete. For Update, optionally use scalar columns such as `wmkf_amount` after first testing with blank. Do **not** use lookup columns here; Microsoft Learn says lookup columns are not supported in Select columns. `[VERIFIED via URL]` |
| Filter rows | One OData candidate from the sections below | proxy equivalent |

5. Add a **Compose** action named `Dump trigger`.
6. Use this expression:

```text
triggerOutputs()
```

7. Add a second **Compose** action named `SdkMessage`.
8. Use this expression:

```text
triggerOutputs()?['body/SdkMessage']
```

9. Save the flow.
10. If save fails, record the exact maker-portal validation error and try the next filter candidate.
11. If save succeeds, perform the data operation and inspect run history.

### Parent status test rows

For every candidate expression that saves:

1. Prepare parent A with request status = pre-submit/drain-time status, for example `In Progress`.
2. Prepare parent B with request status = `Phase II Pending`.
3. Create or select child rows under both parents.
4. Perform the event:
   - Create: create one child under parent A and one child under parent B.
   - Update: update a scalar field such as `wmkf_amount` under parent A and parent B.
   - Delete: delete one child under parent A and one child under parent B.
5. Expected result:
   - Parent A operation does **not** create a flow run.
   - Parent B operation creates exactly one flow run.
   - `SdkMessage` equals `Create`, `Update`, or `Delete` for the flow being tested.

### Candidate filter expressions

Important:

1. Put only the expression in "Filter rows"; do **not** include `$filter=`.
2. Replace `100000123` with the real integer value for `Phase II Pending`.
3. Replace navigation property names after confirming metadata. Navigation property names are case-sensitive in Dataverse metadata. `[VERIFIED via URL]`
4. The variants below are probes. Some are intentionally likely to fail so we can capture exactly what the PA trigger accepts.

#### Candidate A -- lookup-property slash parent status, quoted label

```text
_wmkf_request_value/akoya_requeststatus eq 'Phase II Pending'
```

Status: `[partially verified -- Connor tests this]`

Why test it: This is the conceptual expression from the Item 6 decision notes.

Risk: In Dataverse Web API docs, `_<name>_value` is a lookup property containing a GUID, while parent-column traversal is normally expressed through a single-valued navigation property. This exact form may not bind.

#### Candidate B -- lookup-property slash parent status, double-quoted label

```text
_wmkf_request_value/akoya_requeststatus eq "Phase II Pending"
```

Status: `[unverified -- Connor explores]`

Why test it: Included only because the original question used double quotes around `Phase II Pending`.

Risk: OData string literals normally use single quotes. Expect this to fail or be normalized by the designer.

#### Candidate C -- lookup-property slash parent status, integer option-set

```text
_wmkf_request_value/akoya_requeststatus eq 100000123
```

Status: `[partially verified -- Connor tests this]`

Why test it: If the trigger accepts the `_wmkf_request_value/...` traversal at all, a Dataverse choice/status column is more likely to compare by integer value than display label.

Risk: Same lookup-property traversal concern as Candidate A.

#### Candidate D -- confirmed single-valued navigation property, quoted label

```text
wmkf_Request/akoya_requeststatus eq 'Phase II Pending'
```

Status: `[partially verified -- Connor tests this]`

Why test it: Dataverse docs distinguish lookup properties from single-valued navigation properties. If `wmkf_Request` is the actual navigation property name, this is closer to documented OData navigation syntax.

Risk: The navigation property name may be different. Confirm from metadata.

#### Candidate E -- confirmed single-valued navigation property, integer option-set

```text
wmkf_Request/akoya_requeststatus eq 100000123
```

Status: `[partially verified -- Connor tests this]`

Why test it: This is likely the cleanest candidate if PA trigger filters support parent navigation at all.

Risk: The trigger filter may not support parent navigation even though Web API filters do.

#### Candidate F -- lower-case navigation property, integer option-set

```text
wmkf_request/akoya_requeststatus eq 100000123
```

Status: `[unverified -- Connor explores]`

Why test it: Some generated logical names and navigation names differ by capitalization. Microsoft Learn says navigation property names are case-sensitive in metadata; this should be treated as a capitalization probe, not a preferred expression.

Risk: Expected to fail if actual metadata uses `wmkf_Request` or another casing.

#### Candidate G -- type-cast navigation path, integer option-set

```text
wmkf_Request/Microsoft.Dynamics.CRM.akoya_request/akoya_requeststatus eq 100000123
```

Status: `[unverified -- Connor explores]`

Why test it: OData supports type-cast path segments in some derived-type scenarios. This is a last-resort probe if the designer complains that the parent path is ambiguous.

Risk: Likely invalid for a normal single-valued navigation property. Do not prefer this unless simpler forms fail and this saves/runs.

#### Candidate H -- `@odata.type` discriminator plus parent status

```text
wmkf_Request/@odata.type eq 'Microsoft.Dynamics.CRM.akoya_request' and wmkf_Request/akoya_requeststatus eq 100000123
```

Status: `[unverified -- Connor explores]`

Why test it: Included because the requested test matrix calls out an `@odata.type` prefix/variant. It is a diagnostic probe, not an expected production expression.

Risk: `@odata.type` is usually payload metadata, not a normal column path for trigger filtering. Expect rejection unless the PA designer has special handling.

#### Candidate I -- parent status by integer with multiple post-submit statuses

Use this only if Option A expands beyond one post-submit status.

```text
wmkf_Request/akoya_requeststatus eq 100000123 or wmkf_Request/akoya_requeststatus eq 100000124
```

Status: `[partially verified -- Connor tests this]`

Why test it: Future-proofs the pattern if `Phase II Pending` is not the only status where staff edits should recompute totals.

Risk: Only use after a single-status expression binds. Parentheses may be needed in larger expressions.

### Create binding steps

1. Create flow `TEST Item 6 BudgetLine Create Filter Binding`.
2. Set Change type = `Added`.
3. Leave Select columns blank.
4. Paste Candidate E first if the single-valued navigation property name is known. If not, start with Candidate A because it matches the Item 6 note, then move to D/E after metadata is confirmed.
5. Save.
6. If save fails, record the error and test the next candidate.
7. If save succeeds, create a child row under a parent whose status is not `Phase II Pending`.
8. Confirm no flow run appears.
9. Create a child row under a parent whose status is `Phase II Pending`.
10. Confirm exactly one flow run appears and `SdkMessage` is `Create`.
11. Open `Dump trigger` and record whether the payload includes:
    - child row ID
    - `_wmkf_request_value`
    - formatted lookup annotations
    - any expanded parent object
12. Record the exact expression that saved and ran correctly.

Pass criteria:

| Requirement | Pass condition |
|---|---|
| Designer binding | The flow saves without expression validation errors. |
| Gate false | Child Create under non-Phase-II parent does not create a run. |
| Gate true | Child Create under Phase-II parent creates one run. |
| Event identity | `triggerOutputs()?['body/SdkMessage']` is `Create`. |

Fail criteria:

| Failure | Meaning |
|---|---|
| No candidate saves | Trigger-level parent-status gate does not bind for Create. Option A is dead unless Connor finds a new syntax. |
| Candidate saves but fires for both statuses | Filter is not evaluating parent status correctly. Do not use it. |
| Candidate saves but fires for neither status | Option-set value, label syntax, or navigation path is wrong. Continue probing. |

### Update binding steps

1. Create flow `TEST Item 6 BudgetLine Update Filter Binding`.
2. Set Change type = `Modified`.
3. First pass: leave Select columns blank.
4. Use the same best candidate expression from the Create test.
5. Save.
6. If save succeeds, update a scalar field such as `wmkf_amount` on a child under a non-Phase-II parent.
7. Confirm no flow run appears.
8. Update the same scalar field on a child under a Phase-II parent.
9. Confirm exactly one flow run appears and `SdkMessage` is `Update`.
10. Optional second pass: set Select columns to scalar fields that should cause recompute, for example:

```text
wmkf_amount,wmkf_category,wmkf_year,wmkf_description
```

11. Do **not** include `_wmkf_request_value` or the lookup column in Select columns. Microsoft Learn says lookup columns are not supported in Select columns. `[VERIFIED via URL]`
12. Repeat the update operations and record whether Select columns narrows runs as expected.

Pass criteria:

| Requirement | Pass condition |
|---|---|
| Designer binding | The flow saves without expression validation errors. |
| Gate false | Child Update under non-Phase-II parent does not create a run. |
| Gate true | Child Update under Phase-II parent creates one run. |
| Event identity | `triggerOutputs()?['body/SdkMessage']` is `Update`. |
| Optional Select columns | Scalar-column narrowing works, if Connor chooses to use it. |

Fail criteria:

| Failure | Meaning |
|---|---|
| Same expression that passed Create fails Update | Option A needs event-specific flow design or is not safe as drafted. |
| Update fires on lookup changes only when Select columns includes lookup | Invalid design; lookup columns are not supported in Select columns per Microsoft Learn. |
| Update fires for non-Phase-II parent | Trigger gate is not sufficient to prevent drain-time flow runs. |

### Delete binding steps

1. Create flow `TEST Item 6 BudgetLine Delete Filter Binding`.
2. Set Change type = `Deleted`.
3. Leave Select columns blank.
4. Use the same best candidate expression from the Create/Update tests.
5. Save.
6. If save fails, test the next candidate expression.
7. If save succeeds, delete a child row under a non-Phase-II parent.
8. Confirm no flow run appears.
9. Delete a child row under a Phase-II parent.
10. Confirm exactly one flow run appears and `SdkMessage` is `Delete`.
11. Open `Dump trigger` and record whether the payload includes `_wmkf_request_value`.

Pass criteria:

| Requirement | Pass condition |
|---|---|
| Designer binding | The flow saves without expression validation errors. |
| Gate false | Child Delete under non-Phase-II parent does not create a run. |
| Gate true | Child Delete under Phase-II parent creates one run. |
| Event identity | `triggerOutputs()?['body/SdkMessage']` is `Delete`. |

Fail criteria:

| Failure | Meaning |
|---|---|
| No candidate saves | Trigger-level parent-status gate does not bind for Delete. Option A is incomplete. |
| Delete fires for both statuses | Trigger gate cannot prevent drain-time delete flow runs. |
| Delete gate works but payload lacks parent ID | Test 1 passes for binding, but Test 2 still fails; Option A needs a Delete fallback. |

### What to record for each event

Record all of this, not just pass/fail:

1. Target environment.
2. Real table vs proxy table.
3. Child table logical name.
4. Parent table logical name.
5. Child lookup logical name.
6. Lookup property observed in payload.
7. Single-valued navigation property used in the expression.
8. Parent status column.
9. `Phase II Pending` integer value.
10. Exact filter expression.
11. Whether the flow saved.
12. Whether gate false suppressed the run.
13. Whether gate true produced a run.
14. `SdkMessage` value.
15. Raw validation error or run error, if any.
16. Screenshots or copied run-history snippets as needed.

---

## 4. Test 2 -- Delete Trigger Payload Introspection

Goal: determine whether a Delete-triggered flow can resolve the parent `akoya_request` for the deleted child row.

Option A's recompute flow cannot work on Delete unless it knows which parent request to recompute. After deletion, the child row no longer exists, so a later "Get row" on the deleted child ID is not enough.

### Delete introspection flow setup

1. Create flow `TEST Item 6 BudgetLine Delete Payload Introspection`.
2. Use Dataverse trigger **When a row is added, modified or deleted**.
3. Configure:

| Trigger parameter | Value |
|---|---|
| Change type | Deleted |
| Table name | `wmkf_proposalbudgetline` or proxy child table |
| Scope | Organization |
| Select columns | blank |
| Filter rows | Use the best passing Delete filter from Test 1. If no Delete filter passed, leave blank for payload discovery and clearly mark this as not proving Option A. |

4. Add Compose action `Dump triggerOutputs`.
5. Expression:

```text
triggerOutputs()
```

6. Add Compose action `Dump triggerBody`.
7. Expression:

```text
triggerBody()
```

8. Add Compose action `Parent lookup value`.
9. First try:

```text
triggerBody()?['_wmkf_request_value']
```

10. If the proxy lookup has another logical name, use the proxy equivalent.
11. Save the flow.
12. Delete one child row under a Phase-II parent.
13. Open run history and inspect all Compose outputs.

### Payload pass criteria

Pass if the Delete trigger payload contains one of these:

| Parent evidence | Acceptable? | Notes |
|---|---|---|
| `_wmkf_request_value` with the parent GUID | Yes | Clean path. Production flow can recompute parent directly. |
| Equivalent lookup property with parent GUID on proxy | Yes for proxy only | Must repeat on real `wmkf_proposalbudgetline` after schema deploy. |
| A named navigation/bind value that includes the parent GUID | Probably yes | Record exact key and test expression access. |
| Expanded parent object including parent ID | Yes | Heavier than needed, but sufficient if stable. |

Fail if:

| Payload shape | Consequence |
|---|---|
| Only deleted child row ID appears | Flow cannot resolve parent after row deletion without a fallback. |
| Payload has no lookup and no parent identity | Delete recompute cannot be implemented directly in PA. |
| Payload differs between direct delete and cascade delete in a way that hides parent ID | Need explicit cascade behavior decision. |

### If `_wmkf_request_value` appears

Record:

1. Exact JSON key.
2. Exact expression that returns the GUID.
3. Whether formatted-value annotations are also present.
4. Whether the key appears for direct manual delete.
5. Whether the key appears for cascade delete, if tested.

Production design path:

1. Delete trigger reads parent GUID from payload.
2. Flow lists remaining `wmkf_proposalbudgetline` rows for that parent.
3. Flow recomputes:
   - `akoya_request`: sum of WMKF-spend categories.
   - `wmkf_totalothersources`: sum of cost-share categories.
   - `akoya_expenses`: sum of all child lines, or `akoya_request + wmkf_totalothersources`.
4. Flow PATCHes parent aggregate fields.

### If `_wmkf_request_value` does not appear: pre-image registration path

Status: `[unverified -- Connor explores]`

Possible path:

1. Register a Dataverse plug-in step or webhook with a Delete pre-image for `wmkf_proposalbudgetline`.
2. Include the lookup column in the pre-image.
3. Use that pre-image to make the parent ID available to automation.
4. Recompute parent totals from remaining children.

Questions to answer before choosing this path:

| Question | Why it matters |
|---|---|
| Can Connor configure the required pre-image path inside the current solution process? | If it requires plug-in tooling outside Connor's normal PA surface, it may be too heavy for slice 0. |
| Can a cloud flow consume that pre-image cleanly, or does this become a custom plug-in/webhook design? | If not cleanly consumable by PA, Option A loses its main implementation advantage. |
| Does this introduce new solution packaging or ALM risk? | Slice 0 is blocked on Item 6; avoid adding an untested deploy mechanism. |

Interpretation:

If trigger-level Delete binding works but Delete payload lacks parent ID, do not declare Option A confirmed. Move to the Delete-fallback design huddle path in Section 6.

### If `_wmkf_request_value` does not appear: stored-mapping fallback

Status: `[unverified -- Connor explores]`

Possible path:

1. Add or reuse a small mapping/audit table keyed by child budget-line GUID.
2. On child Create, write `{ childBudgetLineId, parentRequestId }`.
3. On child Delete, use deleted child row ID to look up parent ID in the mapping table.
4. Recompute parent totals.
5. Mark the mapping deleted or keep it as audit history.

Trade-offs:

| Advantage | Cost |
|---|---|
| Keeps Delete recompute in PA if trigger payload only has child ID. | Adds schema or storage surface. |
| Does not require a C# plug-in if Create/Delete flows can maintain mapping. | Mapping drift becomes a new failure mode. |
| Can support forensic audit of deleted child rows. | Needs cleanup/reconcile policy. |

Stored mapping is a fallback, not the preferred Option A implementation.

### Cascade-delete probe

Status: `[unverified -- Connor explores]`

Run this only if Connor can safely create disposable parent/child test records.

Purpose: determine whether deleting the parent request produces child Delete trigger runs, and whether those runs include parent lookup values.

Steps:

1. Create a disposable parent row with status = `Phase II Pending`.
2. Create two disposable child rows under it.
3. Confirm the Delete introspection flow is on.
4. Delete the parent row, or perform the closest safe cascade-delete operation available in sandbox.
5. Inspect whether the flow ran for each child delete.
6. Inspect whether `_wmkf_request_value` appears in each Delete payload.

Interpretation:

| Result | Meaning |
|---|---|
| No child Delete flows run on cascade | Acceptable if parent deletion does not need aggregate recompute, but record it. |
| Child Delete flows run and include parent ID | Clean; flow can identify parent, though recompute may be unnecessary if parent is gone. |
| Child Delete flows run but parent ID is missing | Potential noise/failure path. Production flow must handle missing parent ID without throwing noisy failures. |
| Flow runs after parent is gone | Production flow should check parent existence before PATCHing aggregates. |

---

## 5. Result Reporting Template

Connor can copy/paste these tables into the discussion doc, a Teams thread, or the schema review notes.

### Environment and schema state

| Field | Value |
|---|---|
| Tester | Connor |
| Date | |
| Environment URL/name | |
| Solution name | |
| Real schema or proxy? | |
| If proxy, parent table | |
| If proxy, child table | |
| If proxy, why this pair is representative | |
| Child lookup logical name | |
| Lookup property observed in payload | |
| Single-valued navigation property name | |
| Parent status column | |
| `Phase II Pending` option-set integer | |
| Pre-submit status used for gate-false test | |
| Pre-submit status option-set integer | |

### Test 1 result table

| Event | Candidate | Exact filter expression | Saves? | Gate false suppressed? | Gate true ran? | `SdkMessage` | Payload includes parent lookup? | Result tag | Notes / error |
|---|---|---|---|---|---|---|---|---|---|
| Create | | | | | | | | `[partially verified -- Connor tests this]` | |
| Update | | | | | | | | `[partially verified -- Connor tests this]` | |
| Delete | | | | | | | | `[partially verified -- Connor tests this]` | |

### Candidate syntax log

| Candidate | Expression | Event tested | Save result | Runtime result | Error text or notes |
|---|---|---|---|---|---|
| A | `_wmkf_request_value/akoya_requeststatus eq 'Phase II Pending'` | | | | |
| B | `_wmkf_request_value/akoya_requeststatus eq "Phase II Pending"` | | | | |
| C | `_wmkf_request_value/akoya_requeststatus eq 100000123` | | | | |
| D | `wmkf_Request/akoya_requeststatus eq 'Phase II Pending'` | | | | |
| E | `wmkf_Request/akoya_requeststatus eq 100000123` | | | | |
| F | `wmkf_request/akoya_requeststatus eq 100000123` | | | | |
| G | `wmkf_Request/Microsoft.Dynamics.CRM.akoya_request/akoya_requeststatus eq 100000123` | | | | |
| H | `wmkf_Request/@odata.type eq 'Microsoft.Dynamics.CRM.akoya_request' and wmkf_Request/akoya_requeststatus eq 100000123` | | | | |

### Test 2 Delete payload table

| Question | Answer |
|---|---|
| Does direct Delete trigger run under Phase-II parent? | |
| Does direct Delete payload include `_wmkf_request_value` or equivalent? | |
| Exact key for parent lookup | |
| Exact PA expression that returns parent GUID | |
| Does the value match the parent row GUID? | |
| Does payload include only child ID? | |
| Was cascade delete tested? | |
| Does cascade delete trigger child Delete flow runs? | |
| Does cascade Delete payload include parent lookup? | |
| Recommended Delete path | Clean payload / pre-image / stored mapping / design huddle |
| Result tag | `[unverified -- Connor explores]` |
| Notes | |

### Final precondition call

| Precondition | Pass? | Evidence | Result tag |
|---|---|---|---|
| Create trigger filter binds and gates correctly | | | |
| Update trigger filter binds and gates correctly | | | |
| Delete trigger filter binds and gates correctly | | | |
| Delete trigger payload resolves parent ID | | | |
| Test used real `wmkf_proposalbudgetline`, not proxy | | | |

Decision:

```text
Option A preconditions are:
[ ] Confirmed on real schema
[ ] Partially confirmed on proxy only; repeat after schema deploy
[ ] Failed; do not deploy Option A as drafted
```

---

## 6. What Happens After The Tests

Map the results to the three paths from `docs/INTAKE_PORTAL_BUDGET_AGGREGATE_RECOMPUTE_DECISION.md`.

### Path 1 -- A+B hybrid confirmed

Use this path if all of the following are true:

1. Create trigger filter binds and gates correctly.
2. Update trigger filter binds and gates correctly.
3. Delete trigger filter binds and gates correctly.
4. Delete payload exposes `_wmkf_request_value` or an equivalent parent ID.
5. The successful test was run on real `wmkf_proposalbudgetline`, or a proxy test passed and the team explicitly accepts "repeat after schema deploy" as a temporary risk.

Outcome:

```text
A+B hybrid confirmed.
Option A can ship for slice 0 after real-schema verification.
Option B remains the near-term follow-up: add Dataverse $batch/change-set support to dynamics-service.js so the drain can delete children, insert children, and PATCH parent aggregates atomically.
```

Implementation notes:

1. Connor builds the production PA recompute flow using the exact passing trigger filter expression.
2. The flow recomputes all three aggregate fields from child rows, not from prior parent values.
3. The flow handles missing/deleted parent defensively.
4. Justin/Vercel side keeps the drain's submit-time aggregate PATCH.
5. The design doc gets the narrow boundary-rule exception language from the discussion doc.

Result tag:

```text
[partially verified -- Connor tests this]
```

Change to `[VERIFIED via URL]` is **not** appropriate because Microsoft Learn does not document this exact end-to-end combination. The correct local wording is "verified in maker portal on WMKF sandbox."

### Path 2 -- Delete-fallback design huddle

Use this path if:

1. Create and Update filter binding pass.
2. Delete filter binding passes or can be made to run.
3. Delete payload does **not** expose `_wmkf_request_value` or an equivalent parent ID.

Outcome:

```text
Option A is not confirmed.
Create/Update path is viable, but Delete needs a fallback design.
Hold a short design huddle before schema slice deploy.
```

Design huddle agenda:

1. Decide whether Delete edits are required for staff in AkoyaGO during pilot.
2. If yes, choose pre-image registration vs stored mapping.
3. Decide whether the fallback can be built by Connor inside PA/maker portal, or whether it requires developer-owned Dataverse plug-in work.
4. Decide whether to temporarily block or discourage post-submit budget-line deletes until fallback lands.
5. Decide whether a daily reconcile cron is required as a safety net.

Possible outcomes:

| Fallback | When acceptable |
|---|---|
| Pre-image registration | Connor can package and consume pre-image data cleanly in the solution. |
| Stored mapping | Team accepts a small mapping/audit table and reconciliation responsibility. |
| No Delete support for pilot | Staff process can prohibit post-submit budget-line deletes, and Update-to-zero is acceptable. |
| Option B alone | Delete correctness cannot be made safe in PA before deploy. |

Result tag:

```text
[unverified -- Connor explores]
```

### Path 3 -- Option B alone

Use this path if:

1. Trigger-level parent-status filter fails for any required event, especially Create during drain-time child writes.
2. The filter saves but fires during non-Phase-II/drain-time operations.
3. Delete cannot bind and no acceptable fallback exists.
4. Proxy test passes but real-schema test fails after `wmkf_proposalbudgetline` deploy.

Outcome:

```text
Option A is dead or too weak for slice 0.
Do not deploy a PA recompute flow that fires during the drain.
Move to Option B alone for correctness: build $batch/change-set support in dynamics-service.js and keep aggregate writes inside the portal-owned drain path until another post-submit edit strategy is designed.
```

Implications:

1. Submit-time drain correctness improves only after `$batch` support lands.
2. Post-submit AkoyaGO child edits do not self-heal aggregates unless another mechanism is added.
3. The team must choose one of:
   - temporarily disallow post-submit child budget edits,
   - route edits through the portal/drain-owned write path,
   - build a plug-in/reconcile mechanism,
   - revisit rollup fields if AkoyaGO writers can be removed.

Result tag:

```text
[partially verified -- Connor tests this]
```

### Outcome matrix

| Create gate | Update gate | Delete gate | Delete parent ID | Real schema? | Path |
|---|---|---|---|---|---|
| Pass | Pass | Pass | Present | Yes | A+B hybrid confirmed |
| Pass | Pass | Pass | Present | Proxy only | A+B hybrid provisionally confirmed; repeat on real schema before final deploy |
| Pass | Pass | Pass | Missing | Yes or proxy | Delete-fallback design huddle |
| Pass | Pass | Fail | N/A | Yes or proxy | Option B alone, unless a different Delete design is accepted |
| Pass | Fail | Any | Any | Yes or proxy | Option B alone |
| Fail | Any | Any | Any | Yes or proxy | Option B alone |
| Saves but fires for drain-time/non-Phase-II parent | Any | Any | Any | Yes or proxy | Option B alone |
| Proxy passes | Proxy passes | Proxy passes | Present | Real schema later fails | Option B alone or redesign; proxy result does not override real schema |

### Final note before slice 0 deploy

Do not mark Item 6 cleared solely because the PA designer accepts an expression. The precondition requires all of:

1. Save-time binding.
2. Runtime gate false under pre-submit parent status.
3. Runtime gate true under `Phase II Pending`.
4. Event coverage for Create, Update, and Delete.
5. Delete parent ID resolution.
6. Final verification against `wmkf_proposalbudgetline` after schema deploy, unless the team explicitly accepts a proxy-only interim risk.

