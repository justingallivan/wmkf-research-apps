# Atlas: `wmkf_proposalbudgetline` (Dataverse, WMKF child entity)

**Last verified:** 2026-05-22 (S178) — **DEPLOYED to prod Dataverse.** Slice-0 entity, created via `apply-dataverse-schema.js --wave=4 --execute`.
**Live row count:** 0 (entity created, no rows yet — drain/portal code not built)
**Entity set:** `wmkf_proposalbudgetlines` (confirmed live, HTTP 200, 2026-05-22)
**Schema spec:** `lib/dataverse/schema/wave4/wmkf_proposalbudgetline.json`
**Naming:** LOCKED as `wmkf_proposalbudgetline` (Justin decision 2026-05-18, S163 — `wmkf_budgetline` alternative dropped; was flagged for Connor naming review, now closed).
**Lookup `@odata.bind` key** (confirmed from live metadata 2026-05-22): `wmkf_Request` (→ `akoya_request`) — PascalCase; bind as `wmkf_Request@odata.bind`.

## Source of truth

**Per-year, per-category budget rows for an intake-portal proposal.** Child of `akoya_request` (parental, cascade delete). Drained from the applicant intake portal at submit; the status-gated PA recompute (Item 6 A+B hybrid) keeps the `akoya_request` aggregates in sync on post-submit edits. Authoritative spec: `docs/BUDGET_FORM_SPEC.md` v3 + `docs/INTAKE_PORTAL_SCHEMA_CHANGES.md` 2026-05-14 entry.

**Cost-share lives here too** (no separate `wmkf_proposalcostshare` entity — withdrawn). The forever-filter cost: WMKF-spend aggregate queries MUST filter `wmkf_category NOT IN (100000007, 100000008, 100000009)`; the cost-share aggregate (`akoya_request.wmkf_totalothersources`) uses the inverse `IN` set.

## Fields

Identity:
- `wmkf_proposalbudgetlineid` (PK)
- `wmkf_name` (String 160, ApplicationRequired) — primary name; synthesized `Y{year} — {category}: {description}` for picker/grid display only.

Lookup (PascalCase nav-property for `@odata.bind`; lowercase logical for plain reads):
- `wmkf_Request` / `_wmkf_request_value` → `akoya_request` (ApplicationRequired). **Parental — `CascadeConfiguration.Delete = Cascade`**: deleting the request deletes its budget lines.

Data:
- `wmkf_year` (Integer 1..10, ApplicationRequired) — program year; Integer not Choice (forward-compatible across program lengths).
- `wmkf_category` (Picklist, ApplicationRequired) — 10 values, integers **reserved S150 (Tuition added at 100000005 pre-deploy S178, cost-share block shifted up by 1); do not renumber after deploy**:
  - `100000000=Personnel`, `100000001=Equipment`, `100000002=Supplies`, `100000003=Travel`, `100000004=Other Direct`, `100000005=Tuition`, `100000006=Indirect` (WMKF-spend; Indirect reserved, always $0)
  - `100000007=Waived Indirect`, `100000008=Waived Tuition`, `100000009=Other Cost Share` (cost-share). Labels verbatim from `INTAKE_PORTAL_SCHEMA_CHANGES.md:80-82`; normalized to spaced form 2026-05-18 (S163, Justin decision — prior camelCase inconsistency resolved/closed). Filter-predicate shorthand in BUDGET_FORM_SPEC / ITEM_6 still writes the old camelCase tokens — integer-backed category references, not the label; integers authoritative for every guard.
- `wmkf_description` (String 500) — free-text line-item description.
- `wmkf_amount` (Money, USD; MinValue 0) — amount for this line. Negative rejected by the drain server-side before `createRecord` (Dataverse Money won't enforce; drain is the authoritative guard).
- `wmkf_lineorder` (Integer 0..100000) — display order within `(request, year, category)`.
- `wmkf_rolecode` (String 60) — fixed-row discriminator (`principal-investigators`, `consumable-supplies`, `facilities-overhead`); null for dynamic rows.
- `wmkf_headcount` (Integer 0..100000) — Personnel-only (`wmkf_category = 100000000`); null otherwise.
- `wmkf_effortpct` (Integer 0..100) — Personnel-only; null otherwise.

## Read paths

- **(Future)** PA cover-doc builder — reads rows grouped by year + category to populate a Word template (drives whether `wmkf_name` synthesis is consumed or PA assembles its own strings — open Connor item).
- **(Future)** Aggregate consumers — sum `wmkf_amount` with the WMKF-spend / cost-share category filter for `akoya_request` / `akoya_expenses` / `wmkf_totalothersources`.

## Write paths

- **(Future)** Intake drain at submit — creates 5–30 child rows in one pass, then PATCHes parent aggregates (`docs/BUDGET_FORM_SPEC.md` § "Idempotency + drain step ordering").
- **(Future)** Connor's status-gated PA recompute flow — recomputes parent aggregates post-submit over **active children only**; child Update incl. `statecode`→Inactive deactivation, **No Delete trigger** (Connor S162 ruling, 2026-05-18; defunct children are deactivated, not deleted). **P1-Update is CLOSED — verdict FAIL** (Connor maker-portal run 2026-05-20): the as-written trigger-level Filter-rows mechanism does not evaluate at runtime. Per the gate design a FAIL routes the *recompute mechanism* to a fallback with **zero schema rework** — it did NOT block the schema deploy (slice-0 deployed S178). The mechanism is now **Option A′** (flow-body conditional: trigger has no Filter rows, flow body fetches parent `wmkf_phaseiistatus` and short-circuits) — A′ PASSED Steps 7′+9′ on proxy. P4 (real-schema re-verify of A′ on `wmkf_proposalbudgetline`) is post-deploy and gates PA-flow-live only. Authoritative live status: **`docs/INTAKE_PORTAL_BUDGET_ROSTER_RECONCILE_STATUS.md`**.

## Cross-system

| Target | Mapping |
|---|---|
| `akoya_request` (`Money`, "Requested Amount") | Sum of WMKF-spend `wmkf_amount` (categories NOT IN 100000007–9), all years. |
| `akoya_request.wmkf_totalothersources` (`Money`) | Sum of cost-share `wmkf_amount` (categories IN 100000007–9). |
| `akoya_expenses` (`Money`, "Total Project Budget") | `akoya_request + wmkf_totalothersources`. |

## Migration disposition

Net-new entity (slice 0). No backfill — all population is forward-only via the intake drain + PA recompute. No legacy data.

## Open questions / gotchas

- **Entity-set name CONFIRMED post-deploy (2026-05-22).** `wmkf_proposalbudgetlines` — live, HTTP 200.
- **Naming + category labels — RESOLVED S163 (2026-05-18, Justin decision), no longer pending Connor.** Entity name LOCKED as `wmkf_proposalbudgetline` (`wmkf_budgetline` dropped — see header **Naming** line). Cost-share category labels normalized to spaced form (`Waived Indirect` / `Waived Tuition` / `Other Cost Share`). Both were flagged as Connor review items; both are now closed. (Renaming a deployed entity is still painful — the lock exists precisely so `--execute` is safe on this axis.)
- **`@odata.bind` keys are PascalCase** (`wmkf_Request@odata.bind`); lowercase produces `0x80048d19`.
- **Forever-filter discipline.** Every "what is WMKF asked to fund?" query must carry the cost-share exclusion filter; missing it silently inflates totals.
