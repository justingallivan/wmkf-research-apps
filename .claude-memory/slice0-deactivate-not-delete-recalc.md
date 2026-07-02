---
name: slice0-deactivate-not-delete-recalc
description: "HISTORICAL Item-6/slice-0 rationale. Durable current invariant now lives in the intake wiki and schema comments: drain reconciliation deactivates obsolete children and recomputes over active rows; it does not hard-delete removed lines."
metadata: 
  node_type: memory
  type: project
  originSessionId: 8050fbb7-13c6-444b-b802-c9bc7a61a3ce
  status: closed
  scope: intake
  last_verified: 2026-07-02 via hierarchy triage; current invariant moved to docs/agent-wiki/topics/intake-portal.md
---

## Recall Rule

Read this when: you need the historical rationale for the Item-6 deactivate-not-delete decision or the S162-S178 slice-0 deploy sequence.

Do:
- For current intake work, start with `docs/agent-wiki/topics/intake-portal.md`, `docs/INTAKE_PORTAL_BUDGET_ROSTER_RECONCILE_STATUS.md`, and `lib/dataverse/schema/wave4/wmkf_proposalbudgetline.json`.
- Preserve the invariant: drain/post-submit reconciliation deactivates obsolete child rows and recomputes over ACTIVE children only.

Do not:
- Treat this memory as the live status entry point; it is historical.
- Re-propagate pre-deploy phrasing such as "slice-0 deploy is gated" without reading the current status doc first.

Ground truth for current intake work: `docs/agent-wiki/topics/intake-portal.md`, `docs/INTAKE_PORTAL_BUDGET_ROSTER_RECONCILE_STATUS.md`, `lib/dataverse/schema/wave4/wmkf_proposalbudgetline.json`. Historical detail: `INTAKE_PORTAL_DESIGN.md`, `INTAKE_PORTAL_SCHEMA_CHANGES.md`. Related: [[dataverse-export-floor-scoping]].

Connor's email (received S162, 2026-05-18) resolving the slice-0 Item-6 block — verbatim gist: *"Option A is a no-go. Dynamics doesn't provide the parent record ID when the child record is deleted. But … defunct records shouldn't be deleted, they should be deactivated. The flow would run on the child record update deactivating it, and recalculate based only on active records."*

**Decision:** the slice-0 parent↔child rollup (the `wmkf_apprequestperson` roster recalculation) must use **soft-delete via `statecode` deactivation, never hard delete**. The recalc flow triggers on child **update** (the deactivation event), and recomputes the parent over **active children only**. Option A (delete-triggered parent recalculation) is permanently dead.

**Why:** Dynamics does not surface the parent record ID in a child-delete event, so a delete-driven flow physically cannot locate the parent to recalculate. Deactivation is an update (parent ID still available) and leaves an auditable trail.

**Historical S163 pre-deploy notes (superseded where the S178 status below says the deploy ran):**
- **No slice-0 *spec* assumed hard-delete of roster children** (checked S163). The roster spec (`wmkf_apprequestperson-roster-fields.json`) adds 3 nullable attrs only. `wmkf_proposalbudgetline.json`'s `cascade.Delete:Cascade` governs *whole-`akoya_request` deletion* (orphan cleanup) — orthogonal to the drain lifecycle, stays as specced. Deactivation needs **no schema** (Dataverse custom entities carry `statecode`/`statuscode` by default). The hard-delete assumption lived **only in the doc narrative** (Item-6 §0 Option B "delete old children, insert new") + future drain code that doesn't exist yet. **Fixed S163**: `INTAKE_PORTAL_BUDGET_AGGREGATE_RECOMPUTE_DECISION.md` §0 "Update 2026-05-18 (S163)", `INTAKE_PORTAL_DESIGN.md` PA-boundary + Item-6 summary, `INTAKE_PORTAL_SCHEMA_CHANGES.md` Item-6 bullet, the budgetline spec `_comment`/lookupDescription.
- **Historical S163 state:** slice-0 deploy was gated, narrowly, on P1-Update. That gate later closed as FAIL and routed the recompute mechanism to Option A′; see S178 status below and `docs/INTAKE_PORTAL_BUDGET_ROSTER_RECONCILE_STATUS.md`.
- **Deploy mechanics verified non-destructive (S163):** `apply-dataverse-schema.js --wave=4` is creation-only/idempotent (2 new entities + 4 new nullable attrs), picklist extend is additive, `setup-database.js` V30 = new `submission_jobs` table (no DROP). No table drop anywhere in slice-0 — the carryover's "gated table work / destructive" label overstated it.
- **Point-in-time probes (re-run at deploy):** BLOCKING `scripts/probe-apprequestperson-role-data.js` → CLEAR 2026-05-18 (5,561 rows, 0 in 100000002-4). New `scripts/probe-slice0-attr-collision.mjs` → CLEAR 2026-05-18 (`wmkf_totalothersources` vs 577 live `akoya_request` attrs; 3 roster fields vs 35 `wmkf_apprequestperson` attrs). Both read-only; re-run at deploy (point-in-time, not durable).
- **Genuinely Connor-owned (NOT a schema-deploy blocker):** he builds the PA recompute flow + the residual Update-filter-binding maker-portal check — both *post-deploy* by the decision record's own P4 + proxy provision. Naming (`wmkf_proposalbudgetline` vs `wmkf_budgetline`) + cost-share label-form = Justin's call, shape locked `INTAKE_PORTAL_DESIGN.md:98-117`.
- This is no longer a current deploy instruction for slice-0 itself; the deploy ran S178. Keep the "explicit go-ahead + point-in-time probes before execute" pattern for future destructive carryover work.

**Status update — S178 (2026-05-22): gate CLOSED, schema DEPLOYED.**
- **P1-Update verdict = FAIL** (Connor maker-portal run 2026-05-20). The as-written trigger-level Filter-rows mechanism "saves but does not evaluate at runtime" (Step 8 fail). Per the gate design a FAIL routes the *recompute mechanism* — not the schema — to a fallback with **zero schema rework**.
- **Recompute mechanism is now Option A′** (flow-body conditional: trigger has no Filter rows; the flow body fetches the parent `wmkf_phaseiistatus` and short-circuits unless it matches). A′ PASSED Steps 7′+9′ on a proxy entity (Connor 2026-05-20). P4 = real-schema re-verify of A′ on `wmkf_proposalbudgetline` post-deploy; gates PA-flow-live only.
- **Slice-0 schema DEPLOYED to prod Dataverse S178 (2026-05-22)** via `apply-dataverse-schema.js --target=prod --wave=4 --execute` + `extend-apprequestperson-role-picklist.mjs` + `setup-database.js` (V30). Both point-in-time probes re-run CLEAR at deploy time. Created: `wmkf_proposalbudgetline`, `wmkf_portalmembership` (entity sets confirmed live HTTP 200), `akoya_request.wmkf_TotalOtherSources`, 3 `wmkf_apprequestperson` fields, `wmkf_role` enum 2→5, Postgres `submission_jobs`. Two S178 pre-deploy edits also landed: `wmkf_category` gained `Tuition` at 100000005 (10-value enum); the membership entity was renamed `wmkf_portal_membership`→`wmkf_portalmembership`.
- **Remaining open work** (none blocks the deployed schema): Connor builds the prod Option A′ flow against real `wmkf_proposalbudgetline`; P4 real-schema re-verify; the drain + portal code; the Tuition cap rule (fixed-$ vs %-of-budget decision still TBD, recorded in `BUDGET_FORM_SPEC.md`). Live status authoritative in `docs/INTAKE_PORTAL_BUDGET_ROSTER_RECONCILE_STATUS.md`.

Related: [[dataverse-export-floor-scoping]] (separate Track B thread, parked this session pending SoCal-contact-role SME reply).
