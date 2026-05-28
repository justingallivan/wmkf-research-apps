---
name: project-appresearcher-collapse-post-pilot
description: wmkf_appresearcher is structural redundancy; collapse into wmkf_potentialreviewer post-pilot (no historical h-index needed)
metadata:
  type: project
---

`wmkf_appresearcher` (bibliometric 1:1 sidecar to `wmkf_potentialreviewer`) is structural redundancy. The original "sidecar so identity row doesn't churn on metric refresh" rationale doesn't survive scrutiny: cadence concerns are light, no historical-snapshot requirement exists, and the vendor-entity argument I (Claude) initially cited turned out to be wrong — `wmkf_potentialreviewers` is `IsCustomEntity=true, IsManaged=false` (custom Foundation entity, not vendor).

The user pointed out the dispositive framing: since promotion doesn't move data (it just sets `wmkf_potentialreviewer.wmkf_contact` lookup → `contact`), `wmkf_potentialreviewer` *itself* functions as a reviewer-domain sidecar to `contact`. Adding another 1:1 sidecar (`wmkf_appresearcher`) below that is one layer too many.

Sparse-row reality reinforces: `wmkf_potentialreviewer` rows already have variable completeness — Reviewer Finder rows are rich, applicant-submitted rows (via `wmkf_source`) are sparse. Adding bibliometric attrs (nullable on applicant-source rows) continues that pattern; doesn't introduce it.

**Why:** Confirmed by user S196 (2026-05-28) walking through the design: cadence-churn argument too thin, vendor-entity argument doesn't apply (custom Foundation entity), no historical h-index requirement. The split adds a join hop in every reviewer-finder query for no structural benefit.

**How to apply:**

- **Don't act mid-pilot.** Per intake-portal slice-0 timeline posture, avoid churn while pilot stabilizes. Slate for post-pilot, same window as Wave 1-style cleanup work.
- **Detailed implementation plan:** `docs/APPRESEARCHER_COLLAPSE_PLAN.md` (written S196 2026-05-28). Covers all 7 phases, decision points (D0.1 affiliation reconciliation needs Connor's call), caller enumeration, risks, rollback, ~6h effort estimate. Pre-flight check section guards against staleness — re-verify before executing.
- **Live state surprises surfaced during planning:** `wmkf_apppublication` + `wmkf_apppublicationauthor` are deployed (logical name has no `_z_`; schema-as-code FILE has `_z_`) with 0 rows in prod, despite having an FK to `wmkf_appresearcher`. Plan drops both alongside (cheaper than retargeting).
- **Caller count is 4** (corrected S196 via Codex review): save-candidates, my-candidates, **review-manager/reviewers** (Codex P0 catch — joins on `_wmkf_potentialreviewer_value`, surfaces affiliation/website/h-index/citations to Review Manager UI), contact-enrichment-service. Plus 8 scripts (audit/smoke/probe tier) listed in the plan's Phase 4.5.
- **Codex-flagged risks in original plan:** missing pre-drop snapshot/backup (Phase 5.0 added); invalid `String (no cap)` spec for affiliation (D0.1 now requires explicit max-length); publication-author entity-existence check needed before drop; forward-doc references in REVIEWER_POSTGRES_TO_DATAVERSE_PLAN must be reconciled (D0.6); pre-flight check expanded from 4 to 10 items.
- **Living doc:** `docs/REVIEWER_DATA_MODEL.md` § "Open design notes" carries the rationale + planned-collapse note; entity row in the at-a-glance table is annotated.
- **Atlas mislabel that triggered this:** `docs/atlas/dataverse-wmkf-potentialreviewers.md` previously called the entity "vendor entity + extensions." That was wrong and now corrected. Verify any future doc/memory claim about ownership of reviewer-domain entities — `IsCustomEntity=true, IsManaged=false` is the live signal.

Linked: [[memory-store-propagation]], [[project-reviewer-postgres-to-dataverse-migration]].
