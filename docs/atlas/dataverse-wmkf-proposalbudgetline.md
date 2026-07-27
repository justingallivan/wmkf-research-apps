# Atlas: `wmkf_proposalbudgetline` (Dataverse, WMKF child entity)

**Last verified:** schema deployment and entity-set metadata 2026-05-22 (S178); current application paths re-verified from source 2026-07-27.
**Live row count:** **UNKNOWN** — no post-implementation live row-count probe was run in this reconciliation. The historical 2026-05-22 pre-build probe observed 0 rows and must not be treated as current.
**Entity set:** `wmkf_proposalbudgetlines` (confirmed live, HTTP 200, 2026-05-22)
**Schema spec:** `lib/dataverse/schema/wave4/wmkf_proposalbudgetline.json`
**Naming:** LOCKED as `wmkf_proposalbudgetline` (Justin decision 2026-05-18, S163 — `wmkf_budgetline` alternative dropped; was flagged for Connor naming review, now closed).
**Lookup `@odata.bind` key** (confirmed from live metadata 2026-05-22): `wmkf_Request` (→ `akoya_request`) — PascalCase; bind as `wmkf_Request@odata.bind`.

## Source of truth

**Per-year, per-category budget rows for an intake-portal proposal.** Child of `akoya_request` (parental, cascade delete). The current submit route freezes validated flat `draft_json.budget_lines` rows with pre-generated child GUIDs into `submission_jobs.payload.children.budget_lines`; the current drain materializes those rows in this entity through `lib/dataverse/adapters/proposal-budget-line.js`.

That shipped child-row write is only part of the planned intake flow. After creating the budget rows, the current drain advances the job to `dynamics_patched` and parks it there. Person children, parent aggregate patches, status transition, and the remaining terminal stages are not built. The planned status-gated PA recompute is also not evidence that parent aggregates are currently synchronized. Authoritative shape/spec context: `docs/BUDGET_FORM_SPEC.md` v3 + `docs/INTAKE_PORTAL_SCHEMA_CHANGES.md` 2026-05-14 entry.

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

No current application read path was found in the 2026-07-27 source trace.

- **Unbuilt / proposed:** PA cover-doc builder — would read rows grouped by year + category to populate a Word template.
- **Unbuilt / proposed:** Aggregate consumers — would sum `wmkf_amount` with the WMKF-spend / cost-share category filter for `akoya_request` / `akoya_expenses` / `wmkf_totalothersources`.

## Write paths

- **Shipped, partial intake drain:** `pages/api/intake/submit.js` validates flat budget rows and freezes one pre-generated GUID per child in the queued payload. `lib/services/cron/drain-submissions-service.js` `handleFilesMoved` re-validates each row, builds the Dataverse payload, and calls `proposalBudgetLineAdapter.create`. Written GUIDs are checkpointed in `submission_jobs.dynamics_patches.budget_lines` for retry safety.
- **Current stopping point:** after budget-line creation, the job advances to `dynamics_patched`; the dispatcher deliberately parks that build-pending state. Parent aggregate patches, person children, status transition, and completion are unbuilt.
- **Unbuilt / proposed:** status-gated PA recompute over active children. Historical design and maker-portal experiments are tracked in `docs/INTAKE_PORTAL_BUDGET_ROSTER_RECONCILE_STATUS.md`; they do not establish a live production write path.

## Cross-system

| Target | Mapping |
|---|---|
| `akoya_request` (`Money`, "Requested Amount") | Sum of WMKF-spend `wmkf_amount` (categories NOT IN 100000007–9), all years. |
| `akoya_request.wmkf_totalothersources` (`Money`) | Sum of cost-share `wmkf_amount` (categories IN 100000007–9). |
| `akoya_expenses` (`Money`, "Total Project Budget") | `akoya_request + wmkf_totalothersources`. |

## Migration disposition

Net-new entity (slice 0). No backfill and no legacy data. Current forward population is through the shipped budget-line portion of the intake drain; the broader drain and PA recompute remain incomplete as described above.

## Open questions / gotchas

- **Entity-set name CONFIRMED post-deploy (2026-05-22).** `wmkf_proposalbudgetlines` — live, HTTP 200.
- **Naming + category labels — RESOLVED S163 (2026-05-18, Justin decision), no longer pending Connor.** Entity name LOCKED as `wmkf_proposalbudgetline` (`wmkf_budgetline` dropped — see header **Naming** line). Cost-share category labels normalized to spaced form (`Waived Indirect` / `Waived Tuition` / `Other Cost Share`). Both were flagged as Connor review items; both are now closed. (Renaming a deployed entity is still painful — the lock exists precisely so `--execute` is safe on this axis.)
- **`@odata.bind` keys are PascalCase** (`wmkf_Request@odata.bind`); lowercase produces `0x80048d19`.
- **Forever-filter discipline.** Every "what is WMKF asked to fund?" query must carry the cost-share exclusion filter; missing it silently inflates totals.
