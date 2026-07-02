---
title: "DRAFT — UNAUTHORIZED / UNLANDED — for Codex review only (S163, 2026-05-18)"
domain: intake-portal
kind: draft
status: draft
summary: "1. The P1-Update pre-deploy waiver text (would land as a DRAFT — UNAUTHORIZED block in INTAKE_PORTAL_BUDGET_AGGREGATE_RECOMPUTE_DECISION.md §0)."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
related:
  - scripts/probe-slice0-attr-collision.mjs
---

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
> **What this does NOT waive:** the P1-Update question itself. It is **relocated**, not removed — from a pre-deploy gate to a **hard pre-flow-live gate**. The PA recompute flow MUST NOT be switched on against the real `wmkf_proposalbudgetline` entity until P1-Update is verified (this is enforced by, and merges into, existing precondition P4).
>
> **Rationale (why decoupling is bounded-risk, not a correctness gamble):**
> 1. The slice-0 schema is inert and additive — verified non-destructive, collision-clear (`scripts/probe-slice0-attr-collision.mjs`, CLEAR 2026-05-18), and dry-run-clean. Creating the entities/attrs changes no behavior on its own; nothing reads or writes them until the drain + flow are built.
> 2. P1-Update failure has a **zero-schema-rework fallback**: Option B (`$batch` change sets in the drain, already the documented near-term infrastructure follow-up). The schema is correct under both Option A and Option B — a P1-Update failure changes a drain *implementation*, never a table.
> 3. The point where P1-Update failure actually bites — stale aggregate totals after a post-submit edit — is the *flow-live* window, not the *schema-deploy* window. P4 already mandates real-schema re-verification before the flow goes live. The waiver relies on a gate that already exists; it adds no new exposure between deploy and flow-live (the flow is off in that window by construction).
>
> **Scope boundary:** authorizes the slice-0 *schema* deploy (`apply-dataverse-schema.js --wave=4 --execute`, the picklist-extend script, `setup-database.js` V30) only. Does not authorize switching on any PA recompute flow. Does not waive any other precondition.
>
> **If P1-Update later fails maker-portal validation:** drain implements Option B `$batch`; PA recompute (Option A) is abandoned for the deactivation path; no schema migration or rollback occurs.
>
> **Authorized by:** ________________  (Justin)  **Date:** __________

---

## Artifact 2 — §5 Connor maker-portal test runbook

### 5.0 Why just this test

Connor's deactivate-not-delete ruling means the recompute flow fires on a child **Update whose only change is `statecode`→Inactive**. Existing §3 tests a scalar field edit (`wmkf_amount`); it never isolates a statecode-only Update. This is the one open binding question. **Skip and mark `N/A — dissolved 2026-05-18`:** §3 Create binding, §3 Delete binding, all of §4 (Delete payload introspection).

### 5.1 Before you start (≈10 min)

1. Confirm maker-portal access to the **sandbox** environment (not production).
2. Confirm you can: create cloud flows with the Dataverse trigger; create/update/deactivate rows in the child table; read flow run history + raw trigger outputs.
3. **Pick the entity path:**
   - **Real path** — `wmkf_proposalbudgetline` exists in the sandbox → use it (`wmkf_proposalbudgetline` child, `akoya_request` parent, lookup `wmkf_request` / `_wmkf_request_value`). This result can clear the gate.
   - **Proxy path** — schema not deployed yet → pick any existing child→parent pair where the parent has a controllable status/choice column and you can deactivate child rows. Result is `[partially verified — repeat on real wmkf_proposalbudgetline post-deploy]` (that repeat is precondition P4, expected regardless).
4. **Collect and write down these values** (you'll substitute them below):
   | Item | Your value |
   |---|---|
   | Child table logical name | __________ |
   | Parent status column logical name | __________ |
   | `Phase II Pending` option-set **integer** | __________ |
   | A pre-submit/drain-time parent status integer (e.g. "In Progress") | __________ |
   | Single-valued navigation property name (from relationship metadata, case-sensitive) | __________ |

### 5.2 Step A — build the test flow (≈10 min)

1. Maker portal → open (or create) the sandbox solution `WMKF Intake Item 6 PA Trigger Test`.
2. **+ New → Automation → Cloud flow → Automated.**
3. Name it exactly: `TEST Item 6 BudgetLine Deactivation Filter Binding`.
4. Trigger: search **"When a row is added, modified or deleted"** (Microsoft Dataverse). Select it. **Create.**
5. Configure the trigger:
   - **Change type:** `Modified`
   - **Table name:** your child table (5.1)
   - **Scope:** `Organization`
   - **Select columns:** **leave blank** for the primary run (critical — see 5.6).
   - **Filter rows:** paste **Candidate A** (uses the label, so no integer substitution needed):
     ```
     _wmkf_request_value/akoya_requeststatus eq 'Phase II Pending'
     ```
     If the flow won't **save** with Candidate A, that's a §3-level binding finding, not deactivation-specific — fall down the existing candidate ladder (D, then E with the integer) and record which one saves. Use the first that saves for the rest of this test.
6. **+ New step → Compose.** Rename it `Dump trigger`. Input expression:
   ```
   triggerOutputs()
   ```
7. **+ New step → Compose.** Rename it `SdkMessage`. Input expression:
   ```
   triggerOutputs()?['body/SdkMessage']
   ```
8. **Save.** If save fails: record the exact validation error verbatim, try the next candidate (step 5), repeat. If no candidate saves → **FAIL** (record and stop; this is a binding failure, → Option B fallback).
9. Ensure the flow is **On** (Solution → flow → Turn on).

### 5.3 Step B — set up parent + child rows (≈10 min)

1. Create/select **Parent A** with status = your pre-submit/drain-time status (e.g. "In Progress").
2. Create/select **Parent B** with status = `Phase II Pending`.
3. Under Parent A: create one **active** child row (fill required fields; note its name/GUID).
4. Under Parent B: create one **active** child row (note its name/GUID).
5. Wait ~1 min and confirm in the flow's **Run history** that *creating* these rows produced **no runs** (Change type is `Modified`, so Create shouldn't trigger — if it does, record it).

### 5.4 Step C — gate-FALSE test (deactivate under non-Phase-II parent)

1. Open the **Parent A** child row.
2. Use the **Deactivate** command (command bar → Deactivate; or set Status = Inactive on the form). Confirm the dialog. This sets `statecode`→Inactive.
3. Wait ~2 min. Open the flow **Run history**.
4. **Expected:** **zero** runs. Record actual run count.

### 5.5 Step D — gate-TRUE test (deactivate under Phase-II parent)

1. Open the **Parent B** child row.
2. **Deactivate** it (same as 5.4.2).
3. Wait ~2 min. Open **Run history**.
4. **Expected:** **exactly one** run. Open that run:
   - Open the `SdkMessage` Compose → record its **literal output** (`Update`? `SetState`? `SetStateDynamicEntity`?).
   - Open the `Dump trigger` Compose → confirm the parent lookup (`_wmkf_request_value` or proxy equivalent) is present and holds Parent B's GUID. Record yes/no + the value.

### 5.6 Step E — Select-columns interaction (critical design finding, ≈10 min)

This determines whether the *production* flow can use Select columns to limit runs.

1. Edit the flow trigger → set **Select columns** to scalar business columns only, e.g.:
   ```
   wmkf_amount,wmkf_category,wmkf_year
   ```
   (do **not** add `statecode` or any lookup column). Save.
2. Reactivate then re-deactivate the Parent B child row.
3. Run history. **Record:** did the statecode-only deactivation **still fire** with Select columns set to business fields only?
   - **If it did NOT fire:** key finding — the production flow must include `statecode` in Select columns (or leave it blank) or deactivations are silently missed. Note this for the flow design.
4. Add `statecode` to the Select columns list, save, re-test the deactivation, record whether it now fires.

### 5.7 Step F — reactivation symmetry (≈5 min)

1. Set Select columns back to **blank**, save.
2. **Reactivate** the Parent B child row (Activate command; `statecode`→Active).
3. Run history. **Expected:** exactly one run (reactivation changes the active-set the parent aggregate sums). Record run count + `SdkMessage`.

### 5.8 What to record (fill and return this)

| # | Observation | Result |
|---|---|---|
| 1 | Entity path (real / proxy) + table names | |
| 2 | Candidate expression that saved (A/D/E/…) | |
| 3 | Create produced no runs (5.3.5) | yes / no |
| 4 | Gate-FALSE: deactivate under non-Phase-II → run count (5.4) | ___ (expect 0) |
| 5 | Gate-TRUE: deactivate under Phase-II → run count (5.5) | ___ (expect 1) |
| 6 | `SdkMessage` literal on the deactivation run (5.5.4) | |
| 7 | Parent lookup present + correct GUID in trigger output (5.5.4) | yes / no |
| 8 | Deactivation fires with Select columns = business fields only (5.6.3) | yes / no |
| 9 | Deactivation fires with `statecode` added to Select columns (5.6.4) | yes / no |
| 10 | Reactivation fires exactly one run (5.7) | yes / no |

### 5.9 Verdict rubric

- **P1-Update VERIFIED** (real path) → slice-0 deploy gate clears, no waiver needed: rows 4 = 0, 5 = 1, 7 = yes, **and** row 6 is `Update` *or* a message identity Connor confirms the same filter gates correctly. (Row 8/9 don't gate verification — they're a design input for the production flow's Select columns.)
- **Partial** (proxy path, same results) → `[partially verified]`; real-schema repeat = P4, post-deploy.
- **P1-Update FAILS** → Option B `$batch` fallback, **no schema rework**: any of — no candidate saves; row 5 ≠ 1; row 4 > 0 (gate leaks drain-time deactivations); or row 6 is a message the parent-status filter cannot gate.

### 5.10 Estimated effort

One flow, one expression (Candidate A first), ~6 data operations against a proxy or real pair: **≈45–60 min** including setup. Versus the original full Test 1 (Create+Update+Delete ×9 candidates) + Test 2 — a small fraction.
