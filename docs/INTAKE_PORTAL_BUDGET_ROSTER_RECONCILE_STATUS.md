---
title: "Intake Portal Budget/Roster Reconciliation — Canonical Status"
domain: intake-portal
kind: status
status: canonical
summary: "This is the single status entry point for intake portal budget/roster reconciliation, the slice-0 schema deploy, and the related PA recompute flow."
canonical: true
cataloged: 2026-07-02
owner: product-engineering
related:
  - scripts/probe-akoya-phaseii-status-field.js
  - lib/services/dynamics-service.js
  - scripts/probe-apprequestperson-role-data.js
  - scripts/probe-slice0-attr-collision.mjs
---

# Intake Portal Budget/Roster Reconciliation — Canonical Status

> **This is the single status entry point for intake portal budget/roster
> reconciliation, the slice-0 schema deploy, and the related PA recompute flow.**
> Historical `INTAKE_PORTAL_ITEM_6_*` docs are detail or history and should point
> here for current state. If this page disagrees with an Item 6 doc about
> **current state**, this page wins. For the **locked design decision** (why
> deactivate-not-delete, the A+B hybrid, the four preconditions),
> `INTAKE_PORTAL_BUDGET_AGGREGATE_RECOMPUTE_DECISION.md` §0 is authoritative and
> this page only summarizes it.

**Last updated:** S169, 2026-05-20.
**Maintenance rule:** when budget/roster reconciliation or PA recompute state
changes (Connor replies, a waiver is signed, the deploy runs), update *this
page first*, then the detail docs.

---

## 1. Is the slice-0 schema deploy cleared? — **YES (pending Justin's explicit go-ahead + deploy-time probes). PA flow also cleared at gate level for pilot scale.**

**P1-Update is closed. Verdict: FAIL on the as-written trigger-Filter-rows
mechanism (Connor maker-portal run, 2026-05-20).** Per `CONNOR_CORE_GATE.md` Step
12, a FAIL routes the **recompute mechanism** to a fallback with **zero schema
rework** — it does not rework, rollback, or re-gate the slice-0 schema. The
schema deploy is therefore unblocked at the gate level. **`--execute` is still
never run autonomously**: Justin's in-session go-ahead + deploy-time re-probes
are still required (§5).

**Option A′ (flow-body conditional) PASSED Steps 7′+9′ on proxy** (Connor
maker-portal run, same day, 2026-05-20). This clears the *PA-flow-live* gate
at pilot scale subject only to P4 (real-schema repeat post-deploy). Full
result in `INTAKE_PORTAL_ITEM_6_CONNOR_FLOW_BODY_RERUN.md`; condensed in §3.

Precondition state:

| Precondition | State |
|---|---|
| P1-Create (filter excludes pre-submit drain inserts) | ✅ Clean (moot — see §3 mechanism note) |
| **P1-Update** (trigger-Filter-rows binds on statecode-only deactivation Update) | ❌ **CLOSED — FAIL** (Connor 2026-05-20; routes to mechanism redesign, not schema rework) |
| **P1′-Update** (Option A′ flow-body conditional gates correctly on proxy) | ✅ **PASS — proxy** (Connor 2026-05-20; Step 7′ PASS, Step 9′ PASS, firing-rate envelope quantified) |
| P1-Delete (filter binds on Delete) | ✅ Dissolved S163 — no Delete trigger in deactivate model |
| P2 (Delete-trigger parent-ID resolution) | ✅ Dissolved S163 — deactivation Update carries parent lookup |
| P3 (rule-exception language in `INTAKE_PORTAL_DESIGN.md`) | ✅ Landed S150 |
| P4 (real-schema verification after deploy) | ⏳ Post-deploy — blocks PA-flow-live only, **never** the schema deploy; full Step 11 artifact set re-collected on real schema |

Slice-0 schema is verified additive / non-destructive / collision-clear (S163):
`apply-dataverse-schema.js --wave=4` is creation-only/idempotent, the picklist
extend is additive, `setup-database.js` V30 adds `submission_jobs` (no DROP). No
table drop anywhere in slice-0. The recompute-mechanism choice (see §3) is
**decoupled from the schema** — neither candidate mechanism requires schema
rework.

Trigger **Select columns = LOCKED `blank`** (S163, Codex-validated
SAFE-WITH-CONDITIONS). The S163 validation was conditioned on **trigger-level
Filter rows doing the real scoping**. With P1-Update FAILing, that scoping
basis is gone for any new mechanism — see §3 implications for Option A′.

---

## 2. The deploy posture (preserve verbatim)

> **P1-Update is closed (FAIL). Slice-0 schema deploy is unblocked at the gate
> level.** `apply-dataverse-schema.js --wave=4 --execute`, the picklist-extend
> script, and `setup-database.js` V30 are runnable on Justin's explicit
> in-session go-ahead, after BOTH point-in-time probes are re-run CLEAR at
> deploy time and live callers are grep-confirmed clean. **`--execute` is NEVER
> run autonomously.** Slice-0 remains destructive-carryover *by classification*
> regardless of gate state.

---

## 3. Connor's 2026-05-20 result + the mechanism redesign decision (post-deploy)

### What Connor ran (full record in his returned core-gate file)

- Entity path: **proxy** (`akoya_requestpayment` → `akoya_request`); production
  target (`wmkf_proposalbudgetline`) not yet deployed.
- Selected filter: **Candidate E**, `akoya_requestlookup/wmkf_phaseiistatus eq 100000002`.
- Step 7 (Gate-FALSE, null parent picklist): ✅ PASS — 0 runs.
- **Step 8 (Gate-TRUE, parent picklist = 100000002): ❌ FAIL — "filter saves but
  does not evaluate at runtime."** No fires when parent matches.
- Step 9 (active-subset, manually verified without the trigger filter): ✅
  PASS — `List active siblings` returned C1+C3, C2 absent.
- Step 10: SKIPPED per locked `blank` design.
- Diagnostic (no Filter rows, observing all child mods): trigger fires on
  statecode-only deactivation, `SdkMessage` = `Update`, parent lookup
  (`_akoya_requestlookup_value`) present and correct.
- Environment: **production** (`wmkf.crm.dynamics.com`), not sandbox — sandbox
  trigger registration failed for unrelated reasons (process deviation, noted).

### Verdict-check (strict, per §4 below)

By literal Step 12: Step 8 FAILED → **FAIL** verdict (`partial(proxy)` requires
*same-as-VERIFIED* results, which Step 8 fail precludes). Connor's self-label of
`partial(proxy)` is reclassified to **FAIL** for the audit trail. Both labels
unblock the schema (additive); the distinction routes the recompute mechanism
differently.

Connor's reported claim ("filter saves but does not evaluate at runtime") was
not accompanied by the Step 11 literal artifacts (run IDs, trigger output
snippets, `SdkMessage` literal observed when nothing fired). The behavioral
finding is plausible and matches known PA platform behavior for
lookup-traversal Picklist filters; the *literal* gate is not fully discharged,
but the gate routing (FAIL) is the same either way.

### Ground-truth correction landed (S169, Connor + live Dataverse probe)

- `akoya_requeststatus` (String, max 100) on `akoya_request` is a **derived**
  rollup of the two source-of-truth Picklists.
- `wmkf_phaseistatus` (Picklist, S/T = `wmkf_PhaseIStatus`) and
  `wmkf_phaseiistatus` (Picklist, S/T = `wmkf_PhaseIIStatus`) are the **sources**.
- Phase II Pending Committee Review = `wmkf_phaseiistatus = 100000002`.
- Phase I Pending Committee Review = `wmkf_phaseistatus = 100000000`.
- Live distribution (most-recent 200 `akoya_request`): `wmkf_phaseistatus` =
  Pending Committee Review (111), Not Scored (23), Invited (6), Not Invited
  (4), `<null>` (56); `wmkf_phaseiistatus` = `<null>` (194), Approved (5),
  Pending Committee Review (1); `akoya_requeststatus` string includes
  `'Phase I Pending'` (134), `'Phase II Pending'` (1), `'Concept Done'` (43),
  etc.
- Engineering preference: **filter on source Picklist**, not derived String.
  Pilot (Phase II Research) → `wmkf_phaseiistatus`. Broader rollout (Phase I)
  → `wmkf_phaseistatus`. Probe: `scripts/probe-akoya-phaseii-status-field.js`.

### The mechanism decision (mostly resolved; pilot path locked)

Three candidates against the documented
`INTAKE_PORTAL_BUDGET_AGGREGATE_RECOMPUTE_DECISION.md` §0 A+B hybrid:

- **Option A** (original — trigger-level `Filter rows` on lookup-traversal
  Picklist): **REJECTED** by P1-Update FAIL. Do not revive without a new test
  showing the platform behavior changed.
- **Option A′ — flow-body conditional (Connor's proposal, S169): ✅ PASS on
  proxy (2026-05-20).** Trigger has no Filter rows; fires on every
  `wmkf_proposalbudgetline` modification org-wide. Flow body reads parent
  `wmkf_phaseiistatus` (pilot) / `wmkf_phaseistatus` (broader) via an explicit
  `Get a row by ID` parent fetch, short-circuits the run unless it matches.
  Step 7′ PASS (`SdkMessage`=`Update`, No-branch taken under null parent
  picklist), Step 9′ PASS (Yes-branch taken under `100000002`, active-subset
  list returns C1+C3, C2 absent). Full result in
  `INTAKE_PORTAL_ITEM_6_CONNOR_FLOW_BODY_RERUN.md`. **Pilot path locked on A′.**
- **Option B** (`$batch` + change sets in `lib/services/dynamics-service.js`,
  per `INTAKE_PORTAL_BUDGET_AGGREGATE_RECOMPUTE_DECISION.md` §0): ships portal-wide as drain-side hardening
  regardless of A/A′. Connor's firing-rate quantification (below) confirms B
  is the right transition before full Phase I rollout, consistent with the
  documented A+B hybrid plan.

### Option A′ firing-rate envelope (Connor 2026-05-20)

| Scenario | Action requests / day | % of ~40K daily PA quota |
|---|---|---|
| Pilot drain (25 × 20 lines, spread over 2 weeks) | ~50 | <1% |
| Pilot worst case (all 25 submit same day) | ~500 | 1.25% |
| Pilot post-submit edits | ~100 | <1% |
| Full 300-scale drain (spread over 2 weeks) | ~2,400 | 6% |
| **Full 300-scale deadline-day worst case** | **~24,000** | **60%** |
| Full 300-scale Phase I post-submit edits | ~1,000–2,000 | 3–5% |

PA throttling = queueing (HTTP 429 / "Waiting" state), not silent drop. Early-
exit drain-time fires are the bulk of consumption and have no business
consequence if delayed. **Pilot scale: comfortably clear. Full scale: viable
under throttling, but argues for Option B transition before full Phase I
rollout** — matches the documented A+B hybrid plan.

🟡 **Watch-item:** the ~40K/day quota is **per-user** on Connor's PA connector.
If other automations run under the same account, the deadline-day 60% headroom
shrinks. Re-quantify before broader rollout.

### Carry-over guardrails (post-A′-PASS)

- ✅ **Hazard (d) discharged for A′ at pilot scale.** A′ cleared Steps 7′+9′
  against the documented behavioral criteria. P4 real-schema repeat on
  `wmkf_proposalbudgetline` (post-deploy) carries the full Step 11 artifact
  set; the audit-trail gap from A′'s proxy run is absorbed into P4.
- 🟢 The original "Plan A viable / Plan B = extra work" pressure is fully
  downgraded — Option B (`$batch`) ships portal-wide as infrastructure per
  the documented hybrid plan, and Connor's own firing-rate analysis recommends
  the A′→B transition before full Phase I rollout.
- 🟡 **The S163 Codex `SAFE-WITH-CONDITIONS` validation of `Select columns =
  blank`** was conditioned on **trigger-level Filter rows scoping**. Option A′
  moves scoping to the flow body; the validation does **not** transitively
  cover A′'s firing footprint. `blank` Select-columns remains fine
  *operationally* (statecode-suppression footgun argument still holds) and
  A′'s firing-rate is now quantified, but if the design ever materially shifts
  (e.g. dropping the parent fetch or changing trigger Select), the Codex
  validation needs a refresh.

---

## 4. Verdict-checker criteria (retained — these are the rubric, not history)

Quoted from `CONNOR_CORE_GATE.md` Step 12 (the bolded **Does NOT clear the gate
as full VERIFIED** clause is an added clarification, not in CORE_GATE source):

> - **VERIFIED** (clears the deploy gate): **real path**; a candidate saved;
>   Step 7 PASS; Step 8 PASS; Step 9 PASS; Step 10 PASS or N/A (`blank`); every
>   required `SdkMessage` exactly `Update`; every counted run's child ID + parent
>   lookup attribution correct.
> - **partial(proxy)**: same results but on a proxy pair → `[partially verified]`;
>   real-schema repeat = P4 (post-deploy). **Does NOT clear the gate as full VERIFIED.**
> - **FAIL → Option B, no schema rework**: no candidate saves; Step 7, 8, or 9
>   fails; Step 10 fails when `configured`; any required `SdkMessage` ≠ `Update`;
>   or child/parent attribution missing/ambiguous. A FAIL is a useful, expected
>   outcome — it routes to a drain-side fallback with **zero schema rework**, not
>   a schema rollback.

🔴 **Motivated-reasoning guards (retained, repurposed for future re-tests):**

- **(a)** prose "it fired" with no run IDs / `SdkMessage` literals / parent-GUID;
- **(b)** `partial(proxy)` banked as full VERIFIED — proxy still needs a
  real-schema repeat = precondition **P4 (post-deploy)**;
- **(c)** any `SdkMessage` ≠ `Update` waved through;
- **(d)** a *redesigned* trigger/flow conflated with a prior pass — a new
  mechanism must clear Steps 7–9 itself. **Discharged for Option A′ at pilot
  scale (Connor 2026-05-20).**

---

## 5. Deploy sequence (schema deploy now unblocked; `--execute` never autonomous)

Triggered by Justin's explicit in-session go-ahead. P1-Update gate is closed
(FAIL); no waiver needed. Still required at deploy time:

1. Re-run BOTH point-in-time probes (read-only; must be CLEAR at deploy time, not
   just historically): `node scripts/probe-apprequestperson-role-data.js` and
   `node scripts/probe-slice0-attr-collision.mjs`.
2. Grep live callers of any surface slice-0 touches; confirm none load-bearing.
3. `node scripts/apply-dataverse-schema.js --target=prod --wave=4 --execute`
4. `node scripts/extend-apprequestperson-role-picklist.mjs`
5. `node scripts/setup-database.js` (applies V30 `submission_jobs`)
6. Post-deploy: re-run `npm run check:atlas` + the 3 P0 gates. **P4 real-schema
   repeat is due before PA-flow-live regardless** (Connor used the proxy path).
7. Build the production A′ flow against real `wmkf_proposalbudgetline` schema
   (mirrors the proxy flow Connor built — trigger blank Filter rows, `Get a
   row by ID` parent fetch on `akoya_request.wmkf_phaseiistatus`, Condition
   `eq 100000002`, recompute work in the Yes branch). Connor builds.
8. **P4 — real-schema repeat of Steps 7′+9′** on the production flow against
   `wmkf_proposalbudgetline`, with the full Step 11 artifact set (run IDs,
   baseline timestamps, raw trigger-output snippets, parent-lookup field
   evidence — the audit-trail items absorbed into P4 from the proxy run).
9. Turn the production A′ flow on for pilot scale.
10. Plan Option B (`$batch` drain hardening) per
    `INTAKE_PORTAL_BUDGET_AGGREGATE_RECOMPUTE_DECISION.md` §0 and
    Connor's firing-rate recommendation: A′→B transition before full Phase I
    rollout. Schedule alongside broader-rollout decisions.

Specs are READY at `lib/dataverse/schema/wave4*/` — **do NOT re-author them.**

---

## 6. Budget/roster reconciliation document map

| Doc | Role | Authoritative for |
|---|---|---|
| **`INTAKE_PORTAL_BUDGET_ROSTER_RECONCILE_STATUS.md`** (this) | **Canonical status dashboard** | **Current state: is slice-0 cleared, gate, waiver/Connor status** |
| `INTAKE_PORTAL_BUDGET_AGGREGATE_RECOMPUTE_DECISION.md` §0 | Locked decision record | The *design decision* (deactivate-not-delete, A+B hybrid, the 4 preconditions) |
| `INTAKE_PORTAL_ITEM_6_CONNOR_CORE_GATE.md` | Original test handout (sent S165; result returned S169) | Step 1–12 test mechanics + Step 11/12 acceptance literals; historical for the *trigger-Filter-rows* mechanism (now FAILed) |
| `INTAKE_PORTAL_ITEM_6_CONNOR_FLOW_BODY_RERUN.md` | **S169** — Option A′ Steps 7′+9′ re-run (handout + Connor result; PASS 2026-05-20) | The flow-body-conditional mechanism gate (cleared at pilot scale on proxy; P4 real-schema repeat carries the full artifact set) |
| `INTAKE_PORTAL_ITEM_6_CONNOR_EMAIL.md` | Cover email (uncommitted, local) | — (regenerate from CORE_GATE if missing) |
| `INTAKE_PORTAL_ITEM_6_P1UPDATE_TEST_DRAFT_v5.md` | Full runbook + waiver Artifact 1 (no longer needed) | The waiver text (Artifact 1, UNAUTHORIZED — superseded by FAIL closing the gate) + full §5 procedures |
| `INTAKE_PORTAL_ITEM_6_P1UPDATE_TEST_DRAFT{,_v2,_v3,_v4}.md` | Superseded review drafts | History only — superseded by v5 / CORE_GATE |
| `INTAKE_PORTAL_ITEM_6_MAKER_PORTAL_TESTS.md` | Pre-deactivate (2026-05-14) test runbook | History; §3 Candidates A–E still referenced by `INTAKE_PORTAL_BUDGET_AGGREGATE_RECOMPUTE_DECISION.md` §0 |
| `INTAKE_PORTAL_ITEM_6_QUICK_PROBE.md` | Pre-deactivate fast probe (Option A) | History only — Option A (delete-driven) is dead |

Verdict-checker / acceptance detail also lives in memory
`slice0-deactivate-not-delete-recalc` and its `.claude-memory/` mirror (note:
the named memory entry was referenced through S168 but may need creating if
absent — check before relying on it).
