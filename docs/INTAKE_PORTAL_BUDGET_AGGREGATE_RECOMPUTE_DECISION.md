# Intake Portal Budget Aggregate Recompute — Decision Record

> **Status entry point:** for *current* budget/roster reconciliation, slice-0
> deploy, P1-Update gate, waiver, and Connor status, read
> **`INTAKE_PORTAL_BUDGET_ROSTER_RECONCILE_STATUS.md`** — it is the single
> canonical dashboard. *This doc remains authoritative for the locked design
> decision* (§0: deactivate-not-delete, the A+B hybrid, the four preconditions);
> STATUS only summarizes §0 and never overrides it on the decision. The Status
> line directly below predates §0's S163 correction and is kept for history —
> trust §0 and STATUS over it.

**Status (updated 2026-05-14, Connor sync):** Q1 + Q2 answered; active path locked as A+B hybrid pending three pre-deploy preconditions (maker-portal Tests 1 + 2 + design-doc rule-exception edit) plus one post-deploy PA-flow-live gate (real-schema verification). See § 0.

## 0. Decisions locked 2026-05-14 (Connor sync — post-doc-draft)

**Q1 answer:** "GoApply updates write to `akoya_request` and `akoya_expenses`." → **Option C (rollup fields) is dead.** Converting either field to a rollup would make it read-only and break GoApply's continued writes during the pilot transition.

**Q2 answer:** "Yes, with the narrow exception language." → Boundary-rule exception accepted with the three non-negotiable preconditions documented in § 6 Q2.

**Active path: A+B hybrid.**
- **Option A** (status-gated PA flow filtering on `_wmkf_request_value/akoya_requeststatus`) ships for slice 0 to handle post-submit edit recompute. Connor builds.
- **Option B** (`$batch` + change sets in `lib/services/dynamics-service.js`) ships as near-term portal-wide infrastructure investment after pilot opens. Removes drain partial-state windows and benefits future drain consumers (roster, attachments). Justin/Vercel side builds.

**Preconditions** — ALL FOUR must clear before the PA recompute flow goes live (preconditions 1–3 also block slice 0 schema deploy; precondition 4 is a post-deploy gate that blocks flow-live, not the deploy itself):

1. **PA trigger filter expression validates on all three events.** "Validates" means more than the flow checker accepting the syntax at save time — it must demonstrate at runtime that (a) the flow does NOT fire when the parent's status is a pre-submit value (so drain's child writes don't trip it), (b) the flow DOES fire when status is `'Phase II Pending'` (so post-submit edits recompute), and (c) all three trigger events (Create, Update, Delete) bind under the chosen syntax. The exact OData expression form is open — multiple candidate syntaxes need probing in the maker portal (lookup-property traversal `_wmkf_request_value/akoya_requeststatus eq 'Phase II Pending'`, single-valued navigation-property with option-set integer, and others). See `docs/INTAKE_PORTAL_ITEM_6_MAKER_PORTAL_TESTS.md` § 3 Candidates A–E for the variations Connor probes.

2. **Delete trigger parent-ID resolution.** Delete event payload exposes the deleted row's `_wmkf_request_value` (or equivalent pre-image / stored-mapping fallback) so the flow knows which `akoya_request` to recompute. See `MAKER_PORTAL_TESTS.md` § 4.

3. **Rule-exception language landed in design doc.** The narrow exception accepted in § 6 Q2 must be drafted into `docs/INTAKE_PORTAL_DESIGN.md` at the "Power Automate boundary" rule site, naming `akoya_request` / `wmkf_totalothersources` / `akoya_expenses` and the lifecycle gate. Not a "later" item — landing this is one of the three non-negotiable preconditions for the exception itself per § 6 Q2.

4. **Real-schema verification after slice 0 deploys** (post-deploy gate — blocks PA flow go-live, NOT slice 0 deploy itself). Tests 1 and 2 may run against an existing parent-child proxy entity if Connor uses the proxy path in `MAKER_PORTAL_TESTS.md` § 2. If so, after the slice 0 schema deploys and `wmkf_proposalbudgetline` exists, a final verification pass against the real entity is required before the PA flow goes live. The team can explicitly waive this only with documented acceptance of proxy-only interim risk (per `MAKER_PORTAL_TESTS.md` § 6).

If precondition 1 fails completely → Option A dead, fall back to Option B alone (more work, slower delivery).
If precondition 1 fails on Delete only → A handles Create/Update; design huddle for Delete fallback.
If precondition 2 fails → Delete event needs a fallback (stored mapping + reconcile cron); design huddle.
Precondition 3 is a doc edit (us); precondition 4 is a post-deploy smoke (Connor) — neither blocks the maker-portal test pass.

Step-by-step maker-portal test instructions: **`docs/INTAKE_PORTAL_ITEM_6_MAKER_PORTAL_TESTS.md`** (drafted 2026-05-14 by parallel Codex pass; ready for Connor).

### Update 2026-05-18 (S163) — Connor's deactivate ruling dissolves P1(Delete)+P2; **P1-Update remains an open pre-deploy gate**

> **Correction (S163, post-Codex review).** An earlier draft of this subsection claimed "Item 6 no longer gates the slice-0 schema deploy" and that P1's Update residual was "the docs' acknowledged clean case, exercised post-deploy." That was an overstatement (Codex BLOCKER). Connor's email resolves the *design* (deactivate not delete) and dissolves the Delete-specific preconditions — it does **not** runtime-validate that the parent-status trigger filter binds on a `statecode`-only deactivation Update, which the original §0 precondition 1 demands as a **pre-deploy** gate. The accurate status is below.

Connor's email (received S162, 2026-05-18; verbatim in memory `slice0-deactivate-not-delete-recalc`):

> "Option A [as delete-driven] is a no-go. Dynamics doesn't provide the parent record ID when the child record is deleted. But … defunct records shouldn't be deleted, they should be deactivated. The flow would run on the child record **update** deactivating it, and recalculate based only on **active** records."

**Effect on the four preconditions:**

- **P2 (Delete-trigger parent-ID resolution) — DISSOLVED, not pending.** There is no longer a Delete trigger. Deactivation is a `statecode`→Inactive **Update**, which carries the parent lookup. P2 guarded a code path Connor's ruling structurally removes; it is moot.
- **P1 (filter binds on Create/Update/Delete) — split by event:**
  - *P1-Delete* — **DISSOLVED.** No Delete trigger exists in the deactivate model.
  - *P1-Create* (drain insert while parent pre-`'Phase II Pending'`) — the originally-clean case; the filter is designed to *exclude* these, unchanged by Connor's ruling.
  - *P1-Update* — 🔴 **UNVERIFIED — REMAINS A PRE-DEPLOY GATE.** The deactivate model makes the recompute fire on a child **Update whose only change is `statecode`→Inactive**. Whether the trigger-condition filter `_wmkf_request_value/akoya_requeststatus eq 'Phase II Pending'` actually *binds and fires* on a statecode-only Update is **not** something Connor's email establishes — he asserted the design, not maker-portal runtime validation. This is arguably a *new* sub-case the original Create/Update/Delete tests never isolated (ordinary field-edit Update ≠ statecode-only Update for PA trigger semantics). Per original §0 precondition 1, runtime validation of this is a **pre-deploy** requirement. It can be cleared two ways only: (i) Connor runs the maker-portal test on the deactivation-Update path and it binds; or (ii) the team records an **explicit, owned risk waiver** decoupling schema deploy from this check (rationale available: schema is inert/additive, flow is built+validated post-deploy under P4's proxy provision, fallback on failure is Option B `$batch` drain with zero schema rework). **Neither (i) nor (ii) has occurred as of S163** — so this remains an open pre-deploy gate.
- **P3 — landed S150** (doc edit, ours).
- **P4 — unchanged** (post-deploy, gates PA-flow-live only, never the schema deploy).

**Net (corrected):** Connor's ruling shrank the Item-6 gate from "Create/Update/Delete all unverified" to **exactly one open pre-deploy item: P1-Update (statecode-deactivation trigger-filter binding)**. P1-Delete, P2 are dissolved; P1-Create is clean; P3 landed; P4 is post-deploy. The slice-0 schema itself is verified additive/non-destructive/collision-clear (S163), so the *only* thing standing between here and `--execute` is the P1-Update decision: **Connor validates it, or the team records an explicit risk waiver.** Until one of those, slice-0 deploy is gated — narrowly, on P1-Update alone. (This corrects the earlier "no open Item-6 precondition" overstatement.)

**Drain reconciliation lifecycle (corrects Option B mechanics, § 5 line ~142):** the post-submit-edit reconciliation is **deactivate-then-recompute-over-active**, NOT "delete old children, insert new." Obsolete child rows get `statecode`→Inactive; the recompute sums active children only. (`wmkf_proposalbudgetline`'s parental `cascade.Delete: Cascade` is orthogonal — it governs whole-`akoya_request` deletion / orphan cleanup, a different event, and stays as specced. No schema change: Dataverse custom entities carry `statecode`/`statuscode` by default.)

**Trigger Select-columns decision — LOCKED `blank` (S163, 2026-05-18, Codex-validated SAFE-WITH-CONDITIONS).** The production recompute flow's Dataverse trigger leaves the **Select columns** parameter **blank** (no column-level filter). Rationale: the parent-status `Filter rows` condition already scopes the flow to post-submit parents, so a Select-columns filter adds no needed scoping and only introduces a statecode-suppression footgun — a configured set that omitted `statecode`/`statuscode` would *silently drop every deactivation fire* (the exact P1-Update event). **Accepted, bounded tradeoff:** with Select columns blank the recompute also fires on post-submit edits to non-aggregate child fields (e.g. `wmkf_year`, `wmkf_description`); operationally bounded at the ~25-proposal pilot scale (Codex Probe 1) and a deliberate choice, not an oversight. **Scope caveat:** this is only the safer trigger-config *default* — it does **NOT** close the P1-Update pre-deploy gate (the statecode-only-deactivation trigger-filter binding still must pass Connor's maker-portal test). **Guardrail:** the runbook's Select-columns test (`INTAKE_PORTAL_ITEM_6_P1UPDATE_TEST_DRAFT_v5.md` §5.13 / core-gate Step 10) is retained in conditional form against future config drift — if `blank` is ever reversed to `configured`, that set must include `statecode,statuscode` and pass the §5.13 battery before deploy.

**Sections 1–10 below** are the pre-decision walkthrough that produced this outcome; kept for context and for the option analysis under the boundary-rule exception. Sections 6 (questions) and 7 (recommendation matrix) are now historical — the answers locked above are authoritative.

---

**Note:** This document is v3. v1 stated several platform claims from memory that were wrong (rollup latency, plug-in cost). v2 verified those against Microsoft Learn but then over-applied the verification — claiming "VERIFIED" for combinations of features that Microsoft Learn documents only as separate primitives. v3 narrows the verification claims to what Microsoft Learn actually documents, surfaces the combinations that need Connor to test in the maker portal, and corrects a rollup-over-rollup design error in Option C. Every platform claim is now tagged: `[VERIFIED via URL]`, `[partially verified — Connor must test in maker portal]`, or `[unverified — needs Connor confirmation]`.

**Purpose:** Lay out resolution options conditioned on (a) verified Dataverse / PA behavior and (b) information only Connor has about existing AkoyaGO write paths. Converge on a path that doesn't break `INTAKE_PORTAL_DESIGN.md` § "Power Automate boundary."

**Time budget:** 20–30 minutes. Most time goes to two questions Connor needs to answer (§ 6).

**Background docs:**
- `docs/BUDGET_FORM_SPEC.md` v3 — § "Aggregate fields on `akoya_request`" + § "Idempotency + drain step ordering" (steps 1–6) + § "Portal-wide infrastructure gaps"
- `docs/INTAKE_PORTAL_DESIGN.md` § "Power Automate boundary" (lines 408–419) — the rule under examination
- `docs/INTAKE_PORTAL_SCHEMA_CHANGES.md` § "2026-05-14" — what's locked vs. blocked

---

## 1. The conflict

Three aggregate fields on `akoya_request` need to stay accurate over a proposal's lifetime:

| Field | Type | Definition |
|---|---|---|
| `akoya_request` | Money | sum of `wmkf_proposalbudgetline.wmkf_amount` where `wmkf_category` IN (WMKF-spend categories) |
| `wmkf_totalothersources` | Money | sum where category IN (`WaivedIndirect`, `WaivedTuition`, `OtherCostShare`) |
| `akoya_expenses` | Money | total project cost — semantically `akoya_request + wmkf_totalothersources`; mechanically a sum of `wmkf_proposalbudgetline.wmkf_amount` across all categories (the two filtered sums above are exhaustive, so the unfiltered sum equals their sum). The mechanical form matters in Option C (§ 5) where rollups cannot reference other rollups. |

Two surfaces will write `wmkf_proposalbudgetline` rows over the proposal's lifetime:

- **The intake drain** at submit time — creates 5–30 child rows in one drain pass, currently also PATCHes parent aggregates at the end.
- **Staff editing in AkoyaGO** post-submit — Connor said 2026-05-14 that AkoyaGO opens a record form for child edits, but added "since you surfaced the option of inline editing we might want to start using it. Let's make the process tolerant of that." Design for inline edits being possible.

For aggregates to stay correct under both write paths, something has to recompute the parent totals on every child write. The 2026-05-14 in-meeting decision was: a Power Automate flow on `wmkf_proposalbudgetline` Create / Update / Delete recomputes and PATCHes the parent.

## 2. The rule it breaks

`docs/INTAKE_PORTAL_DESIGN.md:408–419` states:

> ## Power Automate boundary
>
> Portal owns **every write that originates from an applicant action.** PA owns **every write that fans out from a state change.** They never write the same field.

Under the in-meeting plan, the drain writes the three aggregates AND Connor's PA flow writes the same three aggregates on every child write. Both touch the same field. Direct violation, in letter and intent.

Race condition Codex flagged separately: the drain writes 5–30 children sequentially (no `$batch` support today in `dynamics-service.js`), then PATCHes parent aggregates. If the PA flow fires on every child Create during drain, you get 5–30 PA-driven recompute PATCHes interleaved with the drain's final aggregate PATCH. Last-writer-wins; outcomes are non-deterministic.

## 3. Verified platform facts (Microsoft Learn, 2026-05-14)

These are the facts that determine which options are viable. Each has a source URL.

- **Dataverse rollup recompute is async.** The Mass Calculate Rollup Field job runs **12 hours** after the rollup is created/updated; after one run, reschedules ~10 years out. The recurring Calculate Rollup Field job runs **incrementally, minimum 1 hour** recurrence per table. `[VERIFIED via https://learn.microsoft.com/en-us/power-apps/maker/data-platform/define-rollup-fields]`

- **Rollups can be force-recomputed on demand via the `CalculateRollupField` message.** `[VERIFIED via https://learn.microsoft.com/en-us/power-apps/developer/data-platform/specialized-columns]` The Power Automate connector action name that maps to this message ("Recalculate Dataverse rollup columns" or similar) is community-documented but not in Microsoft Learn directly. `[partially verified — Connor confirms the exact connector action exists in the PA UI]`

- **Converting an existing field to a rollup makes it read-only.** Any current writer to that field breaks. `[VERIFIED via Microsoft Learn rollup column docs — same URL as above]` This is why Item 5's reuse of `akoya_request` / `akoya_expenses` interacts with Item 6: the rollup path is gated on whether AkoyaGO currently writes those fields.

- **PA Dataverse triggers support filter expressions; Web API filters support navigation-property syntax.** These two primitives exist separately in Microsoft Learn:
  - PA Dataverse "Row added/modified/deleted" triggers support an OData "Filter rows" expression that evaluates after save. `[VERIFIED via https://learn.microsoft.com/en-us/power-automate/dataverse/create-update-delete-trigger]`
  - Web API filter syntax supports parent-field references via single-valued navigation properties (`<lookup_nav>/<column>`). `[VERIFIED via https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/query/filter-rows]`
  - **The combination** — using parent-field navigation-property syntax inside the PA trigger's filter expression on a child entity, including the Delete event — is NOT documented as a single end-to-end pattern in Microsoft Learn. `[partially verified — Connor must test in maker portal for Create, Update, and Delete separately]`

- **Trigger filter on lookup columns has a known limitation.** The "Select columns" filter (which columns triggering a change) does NOT support lookup columns. The "Filter rows" / filter-expression form is what we'd use; lookup support there exists per the OData filter docs, but again the parent-navigation pattern is not Microsoft-Learn-documented for the trigger context specifically. `[VERIFIED for select-columns limitation via PA trigger doc; partially verified for filter-expression parent navigation]`

- **Dataverse `$batch` change sets are atomic.** A change set bundles multiple operations across multiple entity types; any failure rolls back all completed operations in the change set. Per-batch cap is **1,000 individual requests**. A 30-child drain encoded as delete-N + insert-N + 1 parent PATCH is ~61 operations — well within the cap. `$batch` is not implemented in our `dynamics-service.js` today but is tracked as a known infrastructure gap. `[VERIFIED via https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/execute-batch-operations-using-web-api]`

- **Synchronous plug-in timing.** Microsoft's hard limit for a synchronous transaction is 2 minutes total; their recommendation is to keep each plug-in execution to **2 seconds** for system responsiveness. Each child write triggers its own plug-in run; a 30-child drain pays the per-write latency individually (not cumulatively in one transaction). `[VERIFIED via https://learn.microsoft.com/en-us/power-apps/developer/data-platform/analyze-performance]`

## 4. The lifecycle ordering (verified locally)

Critical for several options below. From `docs/BUDGET_FORM_SPEC.md` § "Idempotency + drain step ordering":

1. Recompute aggregates from payload
2. Query existing children
3. Delete existing children one-by-one
4. **Insert new children one-by-one**
5. PATCH parent aggregates on `akoya_request`
6. **Advance `submission_jobs.status` → `status_flipped` step**

The status flip to `'Phase II Pending'` happens in step 6, AFTER child writes (step 4) and after the parent aggregate PATCH (step 5). At the moment of any child write during drain, the parent's `akoya_requeststatus` is still pre-submit (e.g., `'In Progress'`). Codex verified this against both `BUDGET_FORM_SPEC.md` and `INTAKE_PORTAL_DESIGN.md` § "Submission lifecycle" in the v2 review.

---

## 5. The options

### Option A — Status-gated PA flow at trigger level

**Mechanics:** PA flow triggers on `wmkf_proposalbudgetline` Create / Update / Delete. The trigger filter expression checks the parent's `akoya_requeststatus` via the navigation property and only fires when status IN (post-submit values). Drain's child writes happen pre-status-flip, so the filter evaluates false during drain → PA doesn't fire. Post-submit edits trigger PA normally.

**Drain side:** Drain still writes parent aggregates at step 5 (own them). PA fires only on post-submit edits.

**Pro:**
- Race goes away cleanly using an existing lifecycle field (no new flag, no schema noise) — IF trigger-level parent-field filtering works.
- PA filter at trigger level (not flow body) would mean no billable PA runs during drain — IF the same.
- Connor's wheelhouse (PA), not C# / plug-in work.

**Con:**
- Letter-of-the-rule violated — both drain and PA write the field over the proposal's lifetime, at different lifecycle stages. The "they never write the same field" invariant in `INTAKE_PORTAL_DESIGN.md` needs an explicit narrow exception (see § 6, question 2).
- Cover-doc PA on `'Phase II Pending'` reads cached totals immediately after drain's step 5 PATCH — fine on first submission; on later edits, depends on PA recompute latency (typically seconds).
- **Parent-field filter in PA trigger expression is `[partially verified]` per § 3.** Connor must test the syntax `_wmkf_request_value/akoya_requeststatus eq 'Phase II Pending'` (or equivalent) on Create, Update, AND Delete events in the maker portal. If the syntax doesn't bind on any of the three, Option A is dead for that event and we either degrade to flow-body filter (PA fires-then-exits, wastes PA runs during drain; data integrity holds only if the flow can still resolve the parent ID — see Delete-trigger open question below; on Delete events specifically, flow-body fallback may corrupt data if parent resolution fails) or fall back to Option B.

**Open mechanical question — Delete event parent ID resolution.** When a `wmkf_proposalbudgetline` row is deleted, can the PA Delete trigger still resolve the deleted row's parent `_wmkf_request_value` so the flow knows which `akoya_request` to recompute? Three possibilities, all `[needs Connor maker-portal test]`:

1. **Trigger payload exposes deleted row's pre-image including the parent lookup** — clean path; flow reads `triggerBody()['_wmkf_request_value']` and recomputes.
2. **Trigger payload exposes only the deleted row's GUID** — flow can't resolve parent; needs a pre-image registration OR a stored mapping (e.g., write parent ID to a custom audit table on insert, look up on delete).
3. **Delete trigger doesn't fire reliably for cascade-deletes** (e.g., when a parent `akoya_request` cascade-deletes children) — would mean parent deletion bypasses the recompute flow entirely; acceptable since parent's children are gone too, but worth confirming.

Until this is resolved, Option A handles Create and Update cleanly but Delete is undefined. The rule-exception language in § 6 Q2 should require trigger-level status gating **and** a tested Delete path before declaring Option A correct.

### Option B — Build `$batch` into `dynamics-service.js`; drain becomes one atomic operation

**Mechanics:** Implement `$batch` + change-set support in `lib/services/dynamics-service.js` (currently tracked as missing infrastructure). Drain rewrites step 3–5 as one atomic change set: delete old children, insert new children, PATCH parent aggregates — all roll back together on any failure. Pair with Option A for post-submit edits.

**Pro:**
- Submit-time correctness story is genuinely atomic — no intermediate-value window between children written and parent updated. `[VERIFIED via Microsoft Learn — change sets are atomic across multiple entity types]`
- Removes the entire class of "drain partial state" failures from `BUDGET_FORM_SPEC.md` § "Failure semantics."
- `$batch` is an infrastructure investment that benefits future drain consumers too (roster, attachments).

**Con:**
- Net-new code in `dynamics-service.js`. Likely a week of work plus rollout. Slips slice 0 deploy past 2026-05-19.
- Per-batch cap is 1,000 individual requests; our 30-child drain at ~61 operations is well under. Larger drains in future surfaces (e.g., 100+ roster rows) would need batching across multiple `$batch` calls; trade-off is acceptable. `[VERIFIED via Microsoft Learn]`
- Doesn't solve post-submit edits — still need Option A (or similar) for that surface.

### Option C — Rollup fields with PA force-recompute on critical events

**Mechanics:** Convert the three parent fields to Dataverse rollup fields. **Rollup definitions must not reference other rollups** (Microsoft Learn: rollup columns cannot reference rollup columns). So:

| Field | Rollup definition |
|---|---|
| `akoya_request` | Sum of `wmkf_proposalbudgetline.wmkf_amount` WHERE `wmkf_category IN (Personnel, Equipment, Supplies, Travel, Other Direct, Tuition, Indirect)` |
| `wmkf_totalothersources` | Sum of `wmkf_proposalbudgetline.wmkf_amount` WHERE `wmkf_category IN (WaivedIndirect, WaivedTuition, OtherCostShare)` |
| `akoya_expenses` | Sum of `wmkf_proposalbudgetline.wmkf_amount` (no category filter — math collapses: `sum(WMKF-spend) + sum(cost-share) = sum(all)`) |

All three are direct rollups over child rows — no rollup-over-rollup. Dataverse handles recompute scheduling (12hr mass / 1hr incremental). For critical reads (cover-doc PA reading totals immediately after status flip), Connor's PA on the status flip first invokes `CalculateRollupField` before reading.

**Pro:**
- Letter and spirit of the boundary rule preserved: no one writes the fields directly; Dataverse owns them.
- Declarative, minimal new code.
- Naturally tolerant of every write path including inline edits.

**Con:**
- **Existing fields become read-only after conversion.** Gated on Connor's audit (§ 6, question 1) — if any AkoyaGO flow, plug-in, or business rule writes `akoya_request` or `akoya_expenses` today, this option breaks them. `[VERIFIED via Microsoft Learn — rollup conversion]`
- Default recompute latency is **12 hours mass / 1 hour incremental**. `[VERIFIED via Microsoft Learn]` Without force-recompute, cover-doc PA reading totals shortly after submit would see stale or null values.
- Force-recompute via `CalculateRollupField` adds a step to Connor's plate for every read consumer that needs freshness — cover-doc PA, packet-builder PA, any business rule gating on totals. The PA connector action name for this message is community-documented but not in Microsoft Learn directly; Connor confirms in maker portal. `[partially verified]`

### Option D — Synchronous Dataverse plug-in (C#)

**Mechanics:** Plug-in registered on `wmkf_proposalbudgetline` Create / Update / Delete. Synchronous, in-transaction. Reads siblings, recomputes, PATCHes parent.

**Pro:**
- Strongest in-transaction correctness — no race possible across any write path.

**Con:**
- C# / Visual Studio / plug-in registration / solution lifecycle. New skill surface for Connor.
- Microsoft recommends each plug-in run complete in ≤2 seconds. `[VERIFIED via Microsoft Learn]` A 30-child drain pays the per-write latency 30 times individually (not cumulatively in one transaction since each child write is its own pipeline), but it slows every individual child write under the plug-in.
- Failure modes complex — plug-in exceptions roll back the originating operation, potentially leaving the drain stuck.

### Option E — Separate portal-owned aggregate fields

**Mechanics:** Don't touch `akoya_request` / `akoya_expenses`. Add three NEW fields: `wmkf_portaltotalrequested` / `wmkf_portaltotalothersources` / `wmkf_portaltotalprojectcost`. Drain writes only those; AkoyaGO continues to own the existing fields.

**Pro:**
- No conflict with existing AkoyaGO write paths (doesn't need Connor's audit).
- Cleanest write-ownership boundary.

**Con:**
- Defeats the human-legibility principle from Item 1. Two parallel fields per concept; staff must learn which is authoritative.
- AkoyaGO grid views still show the old fields, which now represent "whatever AkoyaGO sets" rather than the live applicant budget.
- Cover-doc PA reads the new fields; doubles Connor's mental model of where totals live.

### Option F — Remove the cache; compute on read

**Mechanics:** Don't cache aggregates. Every consumer (AkoyaGO views, PA flows, cover-doc PA) reads `wmkf_proposalbudgetline` and sums on demand.

**Pro:**
- No drift possible.
- No write conflict — only one writer per field (`wmkf_amount` on child rows).

**Con:**
- AkoyaGO grid view performance regresses (sub-query per row); unmeasured.
- $100K-multiple business rule has to be sum-and-check rather than reading a cached field — adds Connor's PA complexity.
- The forever cost-share filter (`wmkf_category NOT IN (...)`) lives in every read consumer, not in one cached value. `[unverified — depends on how many consumers exist]`

---

## 6. Two questions Connor needs to answer (HISTORICAL — answered 2026-05-14, see § 0)

These determine which option ships. Both can be answered in the meeting if Connor has 5–10 minutes of maker-portal time.

### Q1. Does anything in AkoyaGO today write to `akoya_request` (the Money field) or `akoya_expenses`?

**Why it matters:** If both fields are dormant or write-paths can be redirected, **Option C (rollup fields)** becomes viable. If either field has live AkoyaGO writers we can't easily redirect, Option C is dead and we fall through to Options A / B.

**How to check (concrete):** In the maker portal under Solutions, examine the AkoyaGO solution's flows, plug-ins, and business rules for write operations targeting these fields. Or query the Dataverse audit log for recent modifiedby on these fields if auditing is enabled. 5–10 minute task.

**Possible answers:**
- "Confirmed dormant" → Option C is the answer; lowest-complexity path.
- "Yes, X writes to them" → Option C is dead; pick between A and B.
- "I'd need a day to fully audit" → Default to A + B (status-gated PA + plan to build `$batch`); revisit C after audit lands.

### Q2. Are you OK with an explicit narrow exception to the "they never write the same field" rule?

**Why it matters:** Options A and B both have the drain write parent aggregates at submit time AND PA write them on post-submit edits. Letter-of-the-rule is broken. We're proposing to update `INTAKE_PORTAL_DESIGN.md` § "Power Automate boundary" with explicit language:

> Exception (intake portal aggregate fields): For cached aggregates that must self-heal under post-submit edits, the drain writes at submit time and a status-gated PA flow writes on post-submit edits. The exception applies only when ALL of the following are met:
>
> 1. The PA flow filters at the **trigger condition** on the parent's lifecycle field (verified against the maker portal for each trigger event — Create, Update, AND Delete) such that drain-time child writes do not fire the flow.
> 2. The Delete event has a tested mechanism to resolve the deleted row's parent ID (trigger pre-image, stored mapping, or equivalent).
> 3. The exception is documented in `INTAKE_PORTAL_DESIGN.md` at the site of the rule, naming the specific aggregate fields and the lifecycle gate.
>
> Future designs cannot rationalize dual writers by inventing lifecycle stages on their own — this is the ONE narrow case, documented explicitly.

This is a real exception, not a refinement. The three preconditions are non-negotiable — without all three, the exception is aspirational, not operational.

**Possible answers:**
- "Yes, with the narrow exception language" → Options A and B are on the table; pick between them based on Q1 and timing.
- "No, the rule is absolute" → Only Options C, D, E, F are viable. Of those, C (if Q1 clears) and D are the only ones with correctness stories; E and F have the trade-offs noted above.

## 7. Recommendation (HISTORICAL — Q1+Q2 answers landed on the A+B hybrid cell, see § 0)

**If Q1 clears (no AkoyaGO writers) AND Q2 declines the exception:**
→ **Option C (rollup fields with PA force-recompute on critical events).** No code, no flow conflict, rule preserved absolutely. Tolerates inline edits by design. Connor builds force-recompute action into the cover-doc PA so it reads fresh totals after status flip.

**If Q1 clears AND Q2 accepts the exception:**
→ Still **Option C** is simplest. Same reasoning as above; force-recompute is the only added Connor work.

**If Q1 doesn't clear AND Q2 accepts the exception:**
→ **A+B hybrid: Option A for slice 0, Option B as near-term follow-up.** Option A (status-gated PA flow) ships first to handle post-submit edits — the realistic path given the 2026-05-19 schema-slice target and 2026-06-01 pilot-open date. Option B (build `$batch` into `dynamics-service.js`) ships as a portal-wide infrastructure investment in the weeks following pilot open, removing drain partial-state windows and benefiting future drain consumers (roster, attachments). The hybrid is recommended explicitly: A alone handles correctness for the pilot; A+B is the long-term shape. **Cell is valid only after Connor confirms Option A's Delete-trigger mechanics per § 5 Option A's open mechanical question.**

**If Q1 doesn't clear AND Q2 declines the exception:**
→ Hard situation. Option D (plug-in) is the only correctness story left, and Connor's skill mismatch makes it expensive. Option E (separate fields) defeats human-legibility. Option F (no cache) reworks three consumers. Honest call: if we end up here, the right move is to **negotiate Q2** — the exception is narrow, documented, and the alternative is materially worse. The exception is a real rule change, but the alternative is "ship something with known correctness gaps because the rule is absolute." Note: even if Q2 is renegotiated to accept the exception, the recommendation still requires Option A's Delete-trigger test to land cleanly. If the Delete path doesn't bind in the maker portal, A is incomplete and we fall further to D or accept correctness gaps on the Delete surface only.

## 8. Next steps (active — supersedes the brief original below)


With Q1+Q2 locked, the schema slice can move toward deploy provided the three pre-deploy preconditions in § 0 clear (maker-portal Test 1, maker-portal Test 2, and the design-doc rule-exception edit). The fourth precondition is a post-deploy gate before the PA flow goes live. Concrete next steps:

1. **Connor:** runs the maker-portal tests per `docs/INTAKE_PORTAL_ITEM_6_MAKER_PORTAL_TESTS.md` (ready now). Target: complete before 2026-05-19 schema-slice deploy. Tests cover candidates A–E for the filter-expression syntax + Delete-trigger payload introspection.
2. **Justin/Claude:** drafts the rule-exception language into `docs/INTAKE_PORTAL_DESIGN.md` § "Power Automate boundary" naming the three specific aggregate fields and the lifecycle gate. **Pre-deploy precondition #3 from § 0** — landing the doc edit is part of the exception itself, not a follow-up.
3. **Justin/Claude:** writes the schema slice JSON specs for the locked changes — `wmkf_proposalbudgetline` new entity, `wmkf_apprequestperson` extension (3 fields + role enum expansion), `wmkf_totalothersources` field + `wmkf_priordecisionstatus` field. Reserves enum integer values pre-deploy and records them in the slice 0 Atlas page additions.
4. **Justin/Claude:** writes Postgres migration `009_submission_jobs.sql` (currently missing; prerequisite to drain regardless of Item 6 outcome).
5. **Connor (post-test):** builds the status-gated PA recompute flow per Option A. Effort estimate TBD pending test outcomes.
6. **Connor (post-schema-deploy):** final real-schema verification of the maker-portal tests against the actual `wmkf_proposalbudgetline` (precondition #4) before the PA flow goes live; team may waive with documented proxy-only risk acceptance.
7. **Justin/Claude (post-pilot-open):** builds `$batch` support into `lib/services/dynamics-service.js` per Option B; rolls out drain to use atomic change sets.
8. **Justin/Claude (slice 0):** creates new Atlas page `docs/atlas/dataverse-wmkf-proposalbudgetline.md` and amends `docs/atlas/dataverse-wmkf-apprequestperson.md` with the new fields + 5-value role enum.

### Original brief (pre-Connor-sync — kept for context; superseded by the detailed list above)

Pre-sync, the brief framing of next steps was: "Slice 0 schema deploy is waiting on Item 6 — locking unblocks:

- `wmkf_proposalbudgetline` entity creation (10-value `wmkf_category` enum)
- `wmkf_apprequestperson` extension (3 nullable fields, 5-value role enum)
- `wmkf_totalothersources` field on `akoya_request` (only net-new aggregate field)
- `wmkf_priordecisionstatus` field on `wmkf_portalmembership`

Two other prerequisites remain regardless of Item 6:
- `submission_jobs` Postgres migration (missing from `005_intake_portal.sql`)
- Reserve and document numeric integer values for all new enum entries

## 9. If we couldn't decide today (HISTORICAL — Q1+Q2 locked 2026-05-14, see § 0)

Kept for context — this was the contingency framing before Connor's sync answered both questions. The "safe default = Option A" landing line is now the actual locked outcome (per § 0 A+B hybrid), so the substance below is no longer a contingency, just a description of the path the meeting did select.

The next checkpoint is 2026-05-19. Option A (status-gated PA flow) ships for slice 0 with the boundary-rule exception clause drafted in this doc. Migrating from A to C later (i.e., converting to rollup fields) would require resolving Q1 in the other direction, which the Connor sync foreclosed for the lifetime of GoApply coexistence.

Option A's preconditions are now the four in § 0; the two listed previously in this section are subsumed into precondition #1 and precondition #2 there.

## 10. Honest note on this document's history

**v1** (2026-05-14) stated several platform claims from memory rather than verifying against Microsoft Learn. Codex caught wrong rollup latency, unverified PA trigger filtering, vague plug-in cost. The recommendation anchored on the wrong numbers.

**v2** (2026-05-14) verified each platform claim against Microsoft Learn but over-applied the verification. Codex caught the meta-failure: "feature X exists" doesn't equal "feature X works for the specific combination needed." In particular:

- PA trigger filter expressions exist (verified) AND Web API navigation-property filters exist (verified), but their **combination** — using parent-navigation syntax inside a PA trigger filter, especially for the Delete event — is not Microsoft-Learn-documented end-to-end.
- The PA connector action name for `CalculateRollupField` is community-documented, not Microsoft Learn directly.
- Option C's original rollup definitions had `akoya_expenses` as a rollup-over-rollup, which Microsoft Learn explicitly disallows.
- `$batch` cap was vague ("payload size limits") rather than concrete (1,000 requests per batch).
- Option A had no provision for the Delete-trigger parent-ID resolution problem.

**v3** (this version) tightens verification claims to what Microsoft Learn actually documents, narrows the "VERIFIED" tag to feature-existence claims, downgrades combination claims to "partially verified — Connor tests in maker portal," and fixes the rollup-over-rollup error in Option C. The recommendation matrix in § 7 now carries Delete-trigger as an explicit precondition for cells that depend on Option A.

Saved as feedback memory `feedback_verify_external_platform_claims`: external-platform claims require WebFetch on authoritative docs. **Updated 2026-05-14 with the v2 lesson:** verification must be use-case-specific, not feature-existence-specific. "X exists in Microsoft Learn" ≠ "X works for the specific Create/Update/Delete + filter + parent-navigation combination I need." When verification can't reach the specific combination, the claim is `[partially verified]` and must list what Connor (or smoke testing) needs to prove.
