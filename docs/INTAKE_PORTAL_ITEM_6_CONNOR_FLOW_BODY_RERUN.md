# Connor — Option A′ Flow-Body-Conditional Re-Run

> **Canonical status:** `INTAKE_PORTAL_BUDGET_ROSTER_RECONCILE_STATUS.md`. The original core-gate
> (`INTAKE_PORTAL_ITEM_6_CONNOR_CORE_GATE.md`) returned **FAIL** on Step 8
> (2026-05-20): trigger-level `Filter rows` with lookup-traversal Picklist
> equality "saves but does not evaluate at runtime." That closed the P1-Update
> gate and unblocked the slice-0 schema deploy.
>
> This handout is the **light re-run** for Option A′ — the flow-body-conditional
> mechanism you proposed in lieu of the trigger-level filter. It does NOT gate
> the schema deploy. It gates **PA-flow-live** for the recompute, alongside P4
> (real-schema repeat on `wmkf_proposalbudgetline` after deploy).

**Scope:** ~20–30 minutes. Two tests + one quantification.

---

## What changed from CORE_GATE.md

- **Trigger Filter rows:** **blank** (removes the lookup-traversal Picklist
  equality that failed Step 8).
- **Trigger Select columns:** still **blank** (locked design decision, S163).
- **New flow body:** explicit "Get a row by ID" on the parent + an `If`
  condition gating the downstream work. Trigger fires on every
  `wmkf_proposalbudgetline` modification org-wide; flow body short-circuits
  unless parent Picklist matches.
- **Picklist target:**
  - **Pilot (this re-run):** `wmkf_phaseiistatus eq 100000002` ("Phase II
    Pending Committee Review"). Same field you used in the original Step 8.
  - **Broader rollout (post-pilot):** `wmkf_phaseistatus eq <int>` — Phase I
    source-of-truth Picklist. Out of scope for this re-run.
- **Field framing (S169 ground-truth correction):** `akoya_requeststatus`
  (String) is a *derived* rollup. `wmkf_phaseistatus` and `wmkf_phaseiistatus`
  (both Picklists) are the canonical source-of-truth on `akoya_request`.
  Filtering on source Picklist is the engineering-preferred handle.

---

## STEP 1 — Build the Option A′ flow

Clone the existing flow (or create a sibling). Configure trigger and body as
follows; everything from CORE_GATE Step 5 still applies except for the changes
called out.

1. Trigger: Microsoft Dataverse **When a row is added, modified or deleted**.
2. Trigger config: Change type `Modified` · Table name `[CHILD_TABLE]` · Scope
   `Organization` · Select columns **blank** · **Filter rows blank**.
3. Compose `Dump trigger` → `triggerOutputs()` (as before).
4. Compose `SdkMessage` → `triggerOutputs()?['body/SdkMessage']` (as before).
5. Compose `Trigger child id` → raw child PK from trigger body (as before).
6. Compose `Trigger parent lookup` →
   `triggerOutputs()?['body/[CHILD_PARENT_LOOKUP_PROPERTY]']` (as before).
7. **NEW — "Get a row by ID"** action (Microsoft Dataverse) `Fetch parent`:
   - Table name: `[PARENT_TABLE]` (real: `akoya_request`; proxy:
     `akoya_request`).
   - Row ID: the value from compose `Trigger parent lookup`.
   - Select columns: `wmkf_phaseiistatus` (only — keep payload minimal).
8. **NEW — Compose** `Parent picklist value` → `outputs('Fetch_parent')?['body/wmkf_phaseiistatus']`.
9. **NEW — Condition** `Gate-Phase-II`:
   - Left: output of `Parent picklist value`.
   - Operator: **is equal to**.
   - Right: `100000002`.
10. **If yes** branch: the recompute work goes here.
    - For this re-run, drop in the same `List active siblings` action you used
      in CORE_GATE Step 5.12, with the same filter
      (`[CHILD_PARENT_LOOKUP_PROPERTY] eq [PARENT_C_GUID] and statecode eq
      [ACTIVE_STATECODE_INT]`), Select columns
      `[CHILD_PRIMARY_KEY],[CHILD_PARENT_LOOKUP_COLUMN],[AMOUNT_COLUMN],statecode,statuscode`.
    - Add a Compose `Yes-branch reached` → string `"yes-branch"`.
11. **If no** branch: Compose `No-branch reached` → string `"no-branch"`.
12. Save + turn on.

Record any save errors verbatim (none expected; this is standard PA shape).

---

## STEP 2 — TEST 7′ (Gate-FALSE via flow body)

Equivalent of CORE_GATE Step 7. The flow now **DOES** fire (no trigger filter)
but **MUST take the No branch**.

1. Set Parent A `wmkf_phaseiistatus` = `null` (or any value ≠ `100000002`).
2. Confirm `[CHILD_A_GUID]` is Active; reactivate via the CORE_GATE Step 3 PATCH
   if not.
3. Apply CORE_GATE Step 6 observation protocol.
4. Send the CORE_GATE Step 3 **deactivation** PATCH for `[CHILD_A_GUID]`.
5. Count runs after baseline whose child ID = `[CHILD_A_GUID]`. Expect **1**.
6. Open that run:
   - Record `SdkMessage` literal. **`Update`** ✅
   - Record `Parent picklist value` Compose output. **`null`** ✅
   - Record which branch's Compose ran. **`No-branch`** ✅ (Yes branch skipped — `List active siblings` did not execute)

**RESULT: ✅ PASS** — run count = 1, `SdkMessage` = `Update`, `Parent picklist value` = null, No branch taken.

---

## STEP 3 — TEST 9′ (Active-subset inside the Yes branch)

Equivalent of CORE_GATE Step 9, now executing inside the `If`-true branch.

1. Set Parent C `wmkf_phaseiistatus` = `100000002`.
2. Create/select `[CHILD_C1_GUID]`, `[CHILD_C2_GUID]`, `[CHILD_C3_GUID]` under
   Parent C; set all Active; amounts `100` / `200` / `300` (or record actuals).
3. Apply CORE_GATE Step 6.
4. Send the CORE_GATE Step 3 **deactivation** PATCH for `[CHILD_C2_GUID]`.
5. Count runs after baseline whose child ID = `[CHILD_C2_GUID]`. Expect **1**.
6. Open that run:
   - Record `SdkMessage` literal. **`Update`** ✅
   - Record `Parent picklist value` Compose output. **`100000002`** ✅
   - Confirm Yes branch taken. **`Yes-branch`** ✅
   - Open `List active siblings` output:

| GUID | statecode | statuscode | date |
|---|---|---|---|
| `ecce2235-8d54-f111-bec6-000d3a306da2` | 0 (Active) | 1 (Active) | 5/22/26 |
| `fb89252f-8d54-f111-bec6-000d3a306da2` | 0 (Active) | 1 (Active) | 5/21/26 |

Deactivated child (C2) absent from returned set. ✅

**RESULT: ✅ PASS** — run count = 1, `SdkMessage` = `Update`, `Parent picklist value` = `100000002`, Yes branch taken, 2 active siblings returned, deactivated child absent.

---

## STEP 4 — Quantify the firing-rate envelope

Option A′'s mechanism trades trigger-level scoping for a wider firing surface.
Estimates below based on Connor's tenant configuration (2026-05-20).

**Q1: Estimated `wmkf_proposalbudgetline` modifications per day org-wide**

300 applications × 20 budget lines = **6,000 child rows at scale.** Rate by phase: <!-- fact-consistency:ignore fact=app-definition-count as-of=2026-05-20 -->  <!-- "300 applications" = grant proposals per cycle, not the 17 web-app definitions tracked in appRegistry.js -->


- **Drain window (pre-submit):** creates spread over ~2-week submission window → ~30 apps/day × 20 lines = 600 drain-time creates/day. Each fires the flow and exits at the condition check. Worst case (all 300 submit on deadline day): 6,000 creates in one day.
- **Post-submit staff edits:** rare — ~10–20 budget line edits/day during review. Each triggers a full recompute.

**Q2: PA flow run quota**

Power Apps per user (Connor Noda's account — all custom flows run under this connector): **~40,000 action requests/day.**

**Q3: Headroom at pilot scale (~25 proposals, Phase II Research mid-June 2026)**

| Scenario | Action requests | % of 40K quota |
|---|---|---|
| Drain (25 × 20, spread over 2 weeks) | ~50/day | <1% |
| Worst case (all 25 submit same day) | ~500 | 1.25% |
| Post-submit edits | ~100/day | <1% |

No concern at pilot scale.

**Q4: Headroom at broader rollout (300 applications; Phase I — 134 of most-recent 200 `akoya_request` rows are Phase I Pending)** <!-- fact-consistency:ignore fact=app-definition-count as-of=2026-05-20 -->

| Scenario | Action requests | % of 40K quota |
|---|---|---|
| Drain (300 × 20, spread over 2 weeks) | ~2,400/day | 6% |
| **Worst case (all 300 submit on deadline day)** | **~24,000** | **60%** |
| Phase I post-submit edits (134 pending × light edit rate) | ~1,000–2,000/day | 3–5% |

The deadline-day scenario is the only envelope concern. On a typical day the quota is very comfortable.

**What happens if quota is hit: throttling, not failure**

PA does not terminate flows when the action request limit is reached. It **throttles** — queuing runs and delaying execution until quota resets on the rolling 24-hour window. Delayed runs eventually execute; they do not fail silently or drop. In flow run history, throttled runs appear in a "Waiting" state; individual actions may log HTTP 429 in run details.

For the recompute flow specifically: the 6,000 drain-time fires that exit at the condition check are the quota consumers, not the actual recomputes. Those early-exit runs have no business consequence — having them delayed or queued is harmless. Post-submit recomputes (the runs that actually matter) are low-volume and would clear well before any throttle engages.

**Implication for Option A′ vs Option B:**
- **Pilot scale:** Option A′ is clear — no quota concern.
- **Full 300-proposal scale:** Option A′ is viable (throttling behavior makes the 60% deadline-day figure less acute than it appears), but drain-time PA run consumption argues for Option B (`$batch` drain) before scaling to full volume — removing drain-time fires entirely. The A+B hybrid plan already anticipated this transition.

This isn't a pass/fail criterion — it's an artifact for the post-deploy
mechanism decision (Option A′ vs. Option B alone). Numbers in the right
order-of-magnitude are enough.

---

## STEP 5 — What to return

Per-test (7′, 9′): baseline timestamp, run ID, tested child GUID, run count,
`SdkMessage` literal, `Parent picklist value` Compose output, branch taken,
raw trigger-output child row ID, parent-lookup field present/value, raw
trigger-output snippet. Step 9′ also: returned active GUIDs / states /
amounts; expected vs observed.

Plus: the Step 4 firing-rate estimates and any save-time errors building the
flow.

| Test | Run count | SdkMessage | Parent picklist value | Branch |
|---|---|---|---|---|
| Step 7′ | 1 | `Update` | `null` | No-branch ✅ |
| Step 9′ | 1 | `Update` | `100000002` | Yes-branch ✅ |

Step 9′ List rows: `ecce2235-8d54-f111-bec6-000d3a306da2` (Active), `fb89252f-8d54-f111-bec6-000d3a306da2` (Active). Deactivated child absent. Both tests passed.

---

## STEP 6 — Verdict

✅ **PASS — Option A′ cleared for PA-flow-live** (still subject to P4 real-schema repeat on `wmkf_proposalbudgetline` post-deploy).

- Step 7′: PASS ✅
- Step 9′: PASS ✅
- Firing-rate envelope: acceptable at pilot scale; manageable at full 300-proposal scale with throttling behavior confirmed non-destructive. Option B (`$batch`) transition recommended before full rollout.

~~**FAIL — Option A′ not viable**~~

Optional, do NOT gate the verdict: reactivation symmetry, rapid two-child
stress, parent-status transition timing. If time permits, mirror
`INTAKE_PORTAL_ITEM_6_P1UPDATE_TEST_DRAFT_v5.md` §5.9 / §5.11 / §5.12.
