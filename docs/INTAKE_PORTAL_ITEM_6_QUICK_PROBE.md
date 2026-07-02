# Intake Portal Item 6 -- Quick Power Automate Probe

> **⚠️ Superseded — history only.** This probe describes the dead delete-driven **Option A**. The live model is **deactivate-not-delete**; the single open pre-deploy gate is **P1-Update**. Canonical status (is slice-0 cleared? waiver + Connor status?): **`INTAKE_PORTAL_BUDGET_ROSTER_RECONCILE_STATUS.md`**. Do not run this probe as the current test — see `INTAKE_PORTAL_ITEM_6_CONNOR_CORE_GATE.md`.

**Purpose:** Fast-path test for Connor to prove or disprove the Option A mechanics with one diagnostic flow, then one filtered replay.

**Audience:** Connor. Assumes familiarity with Power Automate and Dataverse cloud-flow setup.

**Related full runbook:** `docs/INTAKE_PORTAL_ITEM_6_MAKER_PORTAL_TESTS.md`

---

## Goal

Determine quickly whether the status-gated Power Automate recompute flow is mechanically safe:

1. The trigger can suppress drain-time child writes by checking the parent request status.
2. The trigger still fires for post-submit child edits.
3. A Delete-triggered run can identify the deleted row's parent `akoya_request`.

Option A passes only if Create, Update, and Delete all gate correctly and Delete can resolve the parent request ID.

---

## Prereqs

Have two parent request rows ready:

| Parent | Status |
|---|---|
| Parent A | Pre-submit / drain-time status, for example `In Progress` |
| Parent B | `Phase II Pending` |

Have or create child budget-line rows under each parent.

If `wmkf_proposalbudgetline` is not deployed yet, use a safe proxy child table with:

- a parent lookup,
- a parent status field,
- safe disposable rows Connor can create, update, and delete.

Proxy results reduce risk but do not fully clear Item 6. Repeat on real `wmkf_proposalbudgetline` after schema deploy unless the team explicitly accepts proxy-only risk.

Collect before starting:

| Item | Value |
|---|---|
| Child table logical name | |
| Parent table logical name | |
| Parent lookup property, likely `_wmkf_request_value` | |
| Single-valued navigation property name, for example `wmkf_Request` | |
| Parent status column, likely `akoya_requeststatus` | |
| `Phase II Pending` option-set integer | |

---

## Pass 1: Payload Discovery

1. In the sandbox/dev solution, create one automated cloud flow.
2. Trigger: Dataverse -> **When a row is added, modified or deleted**.
3. Configure the trigger:

| Trigger setting | Value |
|---|---|
| Change type | `Added, Modified or Deleted` |
| Table name | `wmkf_proposalbudgetline` or proxy child table |
| Scope | `Organization` |
| Select columns | blank |
| Filter rows | blank |

4. Add Compose action: `SdkMessage`

```text
triggerOutputs()?['body/SdkMessage']
```

5. Add Compose action: `Dump triggerBody`

```text
triggerBody()
```

6. Add Compose action: `Dump triggerOutputs`

```text
triggerOutputs()
```

7. Save the flow.
8. Perform these operations under Parent B:
   - Create one child row.
   - Update a scalar field on that child row, for example amount.
   - Delete that child row.
9. Inspect run history for all three runs.
10. Record:

| Question | Answer |
|---|---|
| Does `SdkMessage` show `Create`, `Update`, and `Delete`? | |
| Does Create payload include `_wmkf_request_value` or equivalent? | |
| Does Update payload include `_wmkf_request_value` or equivalent? | |
| Does Delete payload include `_wmkf_request_value` or equivalent parent GUID? | |
| Exact key/expression that returns the parent GUID | |

**Stop condition:** If Delete payload does not expose the parent GUID or equivalent parent identity, Option A needs a Delete fallback design. Do not call Option A confirmed.

---

## Pass 2: Trigger Filter Replay

1. Edit the same flow trigger.
2. Add this candidate filter first, using real metadata names and the real integer status value:

```text
wmkf_Request/akoya_requeststatus eq 100000123
```

Replace:

| Placeholder | Replace with |
|---|---|
| `wmkf_Request` | Confirmed single-valued navigation property name |
| `akoya_requeststatus` | Real parent status column |
| `100000123` | Real `Phase II Pending` option-set integer |

3. Save the flow.
4. If save fails, try these in order:

```text
_wmkf_request_value/akoya_requeststatus eq 100000123
```

```text
wmkf_request/akoya_requeststatus eq 100000123
```

```text
wmkf_Request/akoya_requeststatus eq 'Phase II Pending'
```

5. Once one filter saves, replay six operations:

| Operation | Parent |
|---|---|
| Create child row | Parent A |
| Create child row | Parent B |
| Update scalar field on child row | Parent A |
| Update scalar field on child row | Parent B |
| Delete child row | Parent A |
| Delete child row | Parent B |

---

## Expected Result

| Operation parent | Expected behavior |
|---|---|
| Parent A, pre-submit status | No flow run |
| Parent B, `Phase II Pending` | Exactly one flow run |

For Parent B runs:

- `SdkMessage` must match the operation: `Create`, `Update`, or `Delete`.
- Delete run must include a parent GUID or equivalent resolvable parent identity.

---

## Decision Call

Option A passes only if all are true:

| Precondition | Pass? | Evidence |
|---|---|---|
| Create is suppressed for Parent A and fires for Parent B | | |
| Update is suppressed for Parent A and fires for Parent B | | |
| Delete is suppressed for Parent A and fires for Parent B | | |
| Delete payload resolves the parent request ID | | |
| Test was run on real `wmkf_proposalbudgetline`, or proxy-only risk is explicitly accepted | | |

Interpretation:

| Result | Meaning |
|---|---|
| Filter saves but fires for Parent A | Do not use it. It does not protect drain-time writes. |
| Create/Update pass but Delete fails | Hold the Delete fallback huddle. |
| Delete gates correctly but lacks parent ID | Hold the Delete fallback huddle. |
| No parent-status filter works | Option A is dead as drafted. |
| All rows above pass on real schema | Option A mechanics are confirmed in the WMKF maker portal. |

