---
name: project-appresearcher-collapse-post-pilot
description: wmkf_appresearcher sidecar collapse into wmkf_potentialreviewers — ✅ SHIPPED 2026-06-02 (S213); entity dropped, bibliometrics on the person
metadata:
  type: project
  status: active
  scope: reviewer
  last_verified: 2026-07-02 via code-grounded memory triage: researcher adapter targets wmkf_potentialreviewerses; Atlas says appresearcher/apppublication/apppublicationauthor dropped; runtime refs read/write person fields
---

## Recall Rule

Read this when: any reference to `wmkf_appresearcher` / `wmkf_apppublication` / `wmkf_apppublicationauthor` resurfaces, or you're touching reviewer bibliometric fields / affiliation reads.

Do:
- Read bibliometrics + affiliation from the person row `wmkf_potentialreviewers` (trailing s); prefer `wmkf_primaryaffiliation`.
- Treat the collapse as DONE (shipped S213, 2026-06-02) — the three sidecar entities are DROPPED (404).

Do not:
- Re-execute or re-plan the collapse; the "don't act mid-pilot" guidance below is SUPERSEDED.
- Assume `wmkf_appresearcher` still exists or write to it; zero runtime refs remain.
- Assume a single call site, or trust a bare "count" — the collapsed person fields are written by **4 adapter-method call sites** (save-candidates, my-candidates, workbench/enrich-recommended, contact-enrichment-service) and additionally READ by `review-manager/reviewers` via the `_wmkf_potentialreviewer_value` expand; grep both the adapter writes and the expand reads before touching them.

Ground truth: `docs/archive/APPRESEARCHER_COLLAPSE_PLAN_V2.md` (as-executed), `docs/archive/DATAVERSE_LIVE_PROBE_FINDINGS_2026-06-02.md`, `docs/atlas/dataverse-wmkf-potentialreviewers.md`. Optional deferred tail = remove the `wmkf_organizationname` compat-shadow fallback.

**STATUS 2026-06-02 — ✅ SHIPPED (S213).** The collapse is DONE: 17 bibliometric fields added to `wmkf_potentialreviewers`, all 339 sidecars backfilled onto persons, adapter + callers repointed (`researcher.js` now writes the person; `affiliation → wmkf_primaryaffiliation`), and `wmkf_appresearcher` + `wmkf_apppublication` + `wmkf_apppublicationauthor` DROPPED (404). As-executed record: `docs/archive/APPRESEARCHER_COLLAPSE_PLAN_V2.md`. Phase 6 follow-up reconciled the main current docs/memory; dated/archive snapshots remain historical. The 7 `wmkf_organizationname` affiliation readers were migrated to prefer `wmkf_primaryaffiliation`; `wmkf_organizationname` remains as a clamped 100-char compat shadow, and removing that fallback is deferred. Smoke scripts were repointed off the dropped entity. Zero runtime refs to `wmkf_appresearchers` remain. Everything below is historical. The "don't act mid-pilot" guidance is superseded. User decided to do the collapse NOW because the sidecar data is disposable (339 rows, almost all last-cycle reviewers, near-zero cross-cycle overlap). Live plan: **`docs/archive/APPRESEARCHER_COLLAPSE_PLAN_V2.md`** (execute-now lighter cutover) — decisions locked (D-AFF = canonical `wmkf_primaryaffiliation`(500) + migrate adapter & 7 reviewer-affiliation readers + keep the 100-char `wmkf_organizationname` compat shadow; light backfill all 339; `wmkf_department` String(255) on person; skip `wmkf_notes`(0 rows) + `wmkf_potentialreviewername`). Ground truth re-probed + Codex-confirmed 2026-06-02 (`docs/archive/DATAVERSE_LIVE_PROBE_FINDINGS_2026-06-02.md`). **Caller count is 5, not 4** — the S196 plan missed `pages/api/workbench/enrich-recommended.js` (S211); `orcid-service.js` is NOT a caller. Entity logical name is `wmkf_potentialreviewers` (trailing s). The S196 doc remains the reference for exhaustive doc-cleanup.

---

`wmkf_appresearcher` (bibliometric 1:1 sidecar to `wmkf_potentialreviewer`) is structural redundancy. The original "sidecar so identity row doesn't churn on metric refresh" rationale doesn't survive scrutiny: cadence concerns are light, no historical-snapshot requirement exists, and the vendor-entity argument I (Claude) initially cited turned out to be wrong — `wmkf_potentialreviewers` is `IsCustomEntity=true, IsManaged=false` (custom Foundation entity, not vendor).

The user pointed out the dispositive framing: since promotion doesn't move data (it just sets `wmkf_potentialreviewer.wmkf_contact` lookup → `contact`), `wmkf_potentialreviewer` *itself* functions as a reviewer-domain sidecar to `contact`. Adding another 1:1 sidecar (`wmkf_appresearcher`) below that is one layer too many.

Sparse-row reality reinforces: `wmkf_potentialreviewer` rows already have variable completeness — Reviewer Finder rows are rich, applicant-submitted rows (via `wmkf_source`) are sparse. Adding bibliometric attrs (nullable on applicant-source rows) continues that pattern; doesn't introduce it.

**Why:** Confirmed by user S196 (2026-05-28) walking through the design: cadence-churn argument too thin, vendor-entity argument doesn't apply (custom Foundation entity), no historical h-index requirement. The split adds a join hop in every reviewer-finder query for no structural benefit.

**How to apply:**

- **Don't act mid-pilot.** Per intake-portal slice-0 timeline posture, avoid churn while pilot stabilizes. Slate for post-pilot, same window as Wave 1-style cleanup work.
- **Detailed implementation plan:** `docs/archive/APPRESEARCHER_COLLAPSE_PLAN.md` (written S196 2026-05-28). Covers all 7 phases, decision points (D0.1 affiliation reconciliation needs Connor's call), caller enumeration, risks, rollback, ~6h effort estimate. Pre-flight check section guards against staleness — re-verify before executing.
- **Live state surprises surfaced during planning:** `wmkf_apppublication` + `wmkf_apppublicationauthor` are deployed (logical name has no `_z_`; schema-as-code FILE has `_z_`) with 0 rows in prod, despite having an FK to `wmkf_appresearcher`. Plan drops both alongside (cheaper than retargeting).
- **Runtime touchpoints (grep-derived; the collapse already executed S213, so this is a maintenance map, not a pre-drop gate — and the "count" depends on what you count):** **4 `researcherAdapter` method call sites** — `save-candidates` (`upsertByPotentialReviewer`), `my-candidates` (`updateById`), `workbench/enrich-recommended` (`upsertByPotentialReviewer`), `contact-enrichment-service` (`upsertByPotentialReviewer`); **0** `getByPotentialReviewer` callers remain. **Plus `review-manager/reviewers`** (Codex P0 catch — a *consumer*, not an adapter call: it reads the `_wmkf_potentialreviewer_value` expand and surfaces affiliation/website/h-index/citations to the Review Manager UI). Plus the script tier (audit/smoke/probe). Re-grep `upsertByPotentialReviewer|updateById|getByPotentialReviewer` (adapter writes) AND `_wmkf_potentialreviewer_value` (field reads) before relying on this. (`capture-self-reported-orcid.js` also calls the adapter, but for ORCID identity, not the collapsed bibliometrics.)
- **Codex-flagged risks in original plan:** missing pre-drop snapshot/backup (Phase 5.0 added); invalid `String (no cap)` spec for affiliation (D0.1 now requires explicit max-length); publication-author entity-existence check needed before drop; forward-doc references in REVIEWER_POSTGRES_TO_DATAVERSE_PLAN must be reconciled (D0.6); pre-flight check expanded from 4 to 10 items.
- **Living doc:** `docs/REVIEWER_DATA_MODEL.md` § "Open design notes" carries the rationale + planned-collapse note; entity row in the at-a-glance table is annotated.
- **Atlas mislabel that triggered this:** `docs/atlas/dataverse-wmkf-potentialreviewers.md` previously called the entity "vendor entity + extensions." That was wrong and now corrected. Verify any future doc/memory claim about ownership of reviewer-domain entities — `IsCustomEntity=true, IsManaged=false` is the live signal.

Linked: [[memory-store-propagation]], [[project-reviewer-postgres-to-dataverse-migration]].
