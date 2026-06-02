# `wmkf_appresearcher` Collapse — V2 (execute-now cutover)

**Status:** Proposed for **immediate execution** (mid-pilot), pending Codex ground-truth review + user sign-off on the open decisions below.

**Supersedes the *timing* of** `docs/APPRESEARCHER_COLLAPSE_PLAN.md` (S196), which said "post-pilot, do not execute now." That posture was driven by a data-preservation caution that no longer applies (see "Why now"). The S196 doc remains the reference for the **exhaustive doc-cleanup file list** (its Phase 6) and detailed mechanics; this V2 overrides the parts that changed and re-grounds every state claim against a live probe.

**Goal (unchanged):** eliminate the `wmkf_appresearcher` 1:1 bibliometric sidecar by folding its fields into `wmkf_potentialreviewers` directly, drop the sidecar + the two empty publication tables, and leave the reviewer domain at two tables (person + engagement) instead of three. This V2 also formalizes **`wmkf_department` as a person-level field** populated by both reviewer search and reviewer self-correction, for use in staff write-ups.

---

## Why now (the calculus changed)

The S196 "wait" rationale was *preserve the data / avoid mid-pilot churn*. Per the user (2026-06-02): the ~339 sidecar rows are **almost entirely last cycle's reviewers**, with ~2–4 experimented with this cycle, and **cross-cycle reviewer overlap is near zero**. So:

- The **data is disposable** — there is no precious bibliometric history to migrate carefully. We can skip the heavy data-migration/snapshot/integrity-gate machinery the S196 plan budgeted (most of its ~8h).
- The remaining risk is **purely code coupling** (the callers below), not data loss. That risk is the same whenever we do this, so "later" buys nothing.

Net: this becomes a **clean cutover** — add fields → repoint callers → re-enrich the live reviewers → drop. A one-shot JSONL export is kept as cheap insurance, but no multi-phase data-preservation apparatus.

---

## Live ground truth (probed 2026-06-02 against prod `wmkf.crm.dynamics.com`)

> **Independently verified by a network-enabled Codex probe, 2026-06-02** — every count, attribute total, max-length, and the collision set below was reproduced. Full findings: `docs/DATAVERSE_LIVE_PROBE_FINDINGS_2026-06-02.md`. Three additions from that run are folded in below: a **clean link-shape audit** (0 anomalies), `wmkf_notes` **0 populated rows**, and the obsolete `wmkf_app_z_publication_authors` set returns **404** (only the `wmkf_apppublicationauthor` logical name is deployed).

**Row counts**
| Entity set | Rows | S196 (2026-05-28) |
|---|---|---|
| `wmkf_appresearchers` | **339** | 334 (grew by 5) |
| `wmkf_apppublications` | **0** | 0 |
| `wmkf_apppublicationauthors` | **0** | 0 |
| `wmkf_potentialreviewerses` | **4269** | 4267 |

**Entity naming (corrected):** person **logical name = `wmkf_potentialreviewers`** (trailing "s"); entity **set = `wmkf_potentialreviewerses`**. Several S196 references to `wmkf_potentialreviewer` (singular) are wrong for metadata calls.

**Both publication entities still EXIST** (`EntityDefinitions` 200) with 0 rows → drop with the sidecar (S196 D0.2 holds).

**Sidecar `wmkf_appresearcher` — 24 `wmkf_` attrs (live):**
`wmkf_appresearcherid`(PK), `wmkf_potentialreviewer`(Lookup), `wmkf_name`, `wmkf_normalizedname`, `wmkf_potentialreviewername`, `wmkf_email`, `wmkf_emailsource`, `wmkf_orcid`, `wmkf_orcidurl`, `wmkf_googlescholarid`, `wmkf_googlescholarurl`, `wmkf_hindex`, `wmkf_i10index`, `wmkf_totalcitations`, `wmkf_primaryaffiliation`(500), `wmkf_department`(255), `wmkf_website`, `wmkf_facultypageurl`, `wmkf_keywords`(Memo), `wmkf_notes`(Memo), `wmkf_lastchecked`, `wmkf_metricsupdatedat`, `wmkf_contactenrichedat`, `wmkf_contactenrichmentsource`.

> **Two fields S196's 17-field list missed:** `wmkf_notes` (Memo) and `wmkf_potentialreviewername` (denormalized name copy). Both need an explicit migrate/skip decision (see D-N).

**Person `wmkf_potentialreviewers` — 23 `wmkf_` attrs (live):**
`wmkf_potentialreviewersid`(PK), `wmkf_name`, `wmkf_firstname`, `wmkf_lastname`, `wmkf_prefix`(Picklist), `wmkf_title`, `wmkf_emailaddress`, `wmkf_organizationname`(**100**), `wmkf_areaofexpertise`, `wmkf_reviewerdescription`, `wmkf_whyreviewerwaschosen`(Memo), `wmkf_source`(Picklist), `wmkf_contact`(Lookup), `wmkf_city`/`wmkf_state`/`wmkf_street`/`wmkf_street1`/`wmkf_zipcode`/`wmkf_telephone`, + virtual/name companions.

**Collision check (clean):** of the sidecar's fields, **only `wmkf_name` already exists on the person** (person's wins — D0.3). Every bibliometric field is absent from the person → safe additive deploy, no collisions.

**Population:** `wmkf_primaryaffiliation` set on **330/339**; `wmkf_department` set on **4/339** (so department is real but barely populated — consistent with "captured only when enrichment happened to surface it").

**Link-shape audit (Codex, 2026-06-02) — CLEAN:** across all 339 sidecar rows, `_wmkf_potentialreviewer_value` had **0 null, 0 dangling, 0 duplicate** links. The 1:1 alt-key is intact, so backfill can assume every sidecar maps to exactly one live person. (This does NOT make the audit skippable — it's the gate that *proved* it clean; keep it as a pre-backfill/pre-drop check per Phase 2.0/5.)

**`wmkf_notes`:** exists on the sidecar, **0 populated rows** → skipping it (D-NOTES) is data-safe today. NB: the *engagement* notes field `wmkf_appreviewersuggestion.wmkf_notes` is a different field and IS populated (3 non-null) — do not conflate.

---

## Deltas vs the S196 plan (what this V2 corrects)

1. **Caller count 4 → 5.** S196 missed `pages/api/workbench/enrich-recommended.js` (added S211; calls `researcherAdapter.upsertByPotentialReviewer`). `orcid-service.js` is **NOT** a caller (S196 didn't list it; a loose grep falsely flagged it — its "researcher-url" refs are ORCID JSON keys).
2. **Field inventory + 2** (`wmkf_notes`, `wmkf_potentialreviewername`).
3. **Entity logical-name correction** (`wmkf_potentialreviewers`).
4. **Timing**: execute now, not post-pilot.
5. **Lighter sequencing**: disposable data → drop the multi-phase integrity-gate/snapshot apparatus; keep one cheap export.

### Verified app callers (5 files + adapter)
| File | Touch | Notes |
|---|---|---|
| `lib/dataverse/adapters/researcher.js` | the adapter | delete after switchover |
| `pages/api/reviewer-finder/save-candidates.js` | `upsertByPotentialReviewer` | reviewer-search save |
| `pages/api/reviewer-finder/my-candidates.js` | direct query + `updateById` | candidate browser/edit |
| `pages/api/workbench/enrich-recommended.js` | `upsertByPotentialReviewer` | **new vs S196 (S211)** |
| `pages/api/review-manager/reviewers.js` | direct `queryRecords` join | surfaces h-index/citations/affiliation/website to the reviewer list (Review Manager + Workbench) |
| `lib/services/contact-enrichment-service.js` | adapter import + refs | enrichment pipeline |

### Scripts referencing the sidecar (7)
`scripts/check-drain-table-mentions.js` + `scripts/check-doc-currency.js` (**CI gates — must update before drop**), `scripts/audit-dataverse-state.js`, `scripts/probe-bill-vendor-fields.js`, `scripts/smoke-find-by-name.js`, `scripts/smoke-recent-suggestions.js`, `scripts/wave2-reshape-drop.js`.

### Other local dependencies to update before deleting the adapter (Codex #10)
Not prod callers, but they reference the sidecar/adapter and must be reconciled before `researcher.js` is deleted:
- `scripts/smoke-test-candidate.mjs` — queries `wmkf_appresearchers` in its teardown (deletes the bibliometric sidecar by `_wmkf_potentialreviewer_value`); post-collapse there's no sidecar to delete.
- `scripts/backfill-postgres-to-dataverse.js` — imports the researcher adapter (S196 also flagged; verify its Postgres source state at execution per `project-w6-table-drop-pending`).
- `shared/components/reviewers/CandidateEditModal.js` — doc-comment/contract reference (no live query, but reconcile the comment).
- `tests/unit/adapters-caller-id.test.js` and `tests/unit/reviewer-adapters-writeback.test.js` — exercise the researcher adapter; update/retire when the adapter is folded in.

---

## Decisions

### Locked (carried from S196, re-verified)
- **D0.2** Drop both publication tables (0 rows) with the sidecar; drop order junction → publication → sidecar.
- **D0.3** `wmkf_name` collision → person's wins; don't migrate the sidecar copy.
- **D0.4** `wmkf_email` is a dup of the person's `wmkf_emailaddress` (the de-dupe alt-key) → **skip**.
- **D0.5** `wmkf_normalizedname` was a researcher-table dedupe key with no consumer outside the adapter → **skip**.

### New / open (need user + Codex input)
- **D-AFF (affiliation canonical):** person `wmkf_organizationname` is **String(100)** — too short for richer affiliation; sidecar `wmkf_primaryaffiliation` is **String(500)**, populated on 330. **Recommend: adopt `wmkf_primaryaffiliation` (500) as canonical on the person, retire `wmkf_organizationname`.**
  - **Existing truncation (Codex #6):** `lib/dataverse/adapters/potential-reviewer.js` already *clamps* `wmkf_organizationname` to 100 on write, so any affiliation stored only there may already be irreversibly truncated. The sidecar's 500-char copy is the only place a long value survives — another reason to make it canonical, and to source the backfill from the sidecar.
  - **⚠ Scope is broader than a write-path change (Codex #7):** many live paths *read* `wmkf_organizationname` as reviewer affiliation/context — at least external-reviewer context, the Workbench dashboard + resolve-request, email rendering, Dynamics Explorer, and the reviewer manager. Retiring the field means migrating all those readers, not just the sidecar writers. **Decision needed:** either (a) `wmkf_primaryaffiliation` becomes the single canonical affiliation and every reader switches, or (b) `wmkf_organizationname` stays as a short display/account field and `primaryaffiliation` is the "full" companion. This is the largest open item in the plan — enumerate the readers (grep) before committing.
  - Alternative: keep `organizationname`, accept the 100-cap (smallest change, perpetuates truncation).
- **D-DEPT (department):** carry `wmkf_department` (String, **propose 255 to match the sidecar**) onto the person. It's a per-person, stable, write-up field. **Two writers going forward:** (a) reviewer search/enrich pipeline (`save-candidates`/`enrich-recommended` already pass `department` through the adapter — they just need a source value), and (b) reviewer self-correction at accept (new accept-form field → propagates to the person). Surface it in the `reviewers.js` projection for write-ups.
- **D-NOTES (`wmkf_notes`):** sidecar Memo, **not** in the adapter's FIELD_SELECT and not written by live code. **Recommend: skip** (don't migrate) — Codex confirmed **0 populated rows** (2026-06-02), so the skip is data-safe today. (Re-confirm at execution; don't conflate with the populated engagement-notes field.)
- **D-DENORM (`wmkf_potentialreviewername`):** denormalized name copy on the sidecar. **Recommend: skip** (the person IS the name source).
- **D-BACKFILL (depth):** given disposable data, two options — (a) **light backfill** all 339 rows (cheap, idempotent, preserves the live reviewers' enrichment; no snapshot/integrity-gate phases), or (b) **skip backfill**, re-enrich only the live reviewers after cutover. **Recommend (a)** — it's minutes of risk-free work and keeps the handful of live reviewers' data intact.

---

## Phased plan (lighter cutover)

**Phase 0 — Decide** D-AFF, D-DEPT length, D-NOTES, D-DENORM, D-BACKFILL (above). Connor's delegated creator authority covers the field adds (`project-dataverse-creator-privileges`); update `docs/INTAKE_PORTAL_SCHEMA_CHANGES.md`.

**Phase 1 — Schema add (additive, idempotent).** New `lib/dataverse/schema/wave6/` manifest adding **17** bibliometric fields to `wmkf_potentialreviewers` — derived: 24 sidecar `wmkf_` attrs − 2 structural (`appresearcherid` PK, `potentialreviewer` lookup) − 5 skips (`name` D0.3, `email` D0.4, `normalizedname` D0.5, `notes` D-NOTES, `potentialreviewername` D-DENORM) = 17 (`emailsource`, `orcid`, `orcidurl`, `googlescholarid`, `googlescholarurl`, `hindex`, `i10index`, `totalcitations`, `primaryaffiliation`, `department`, `website`, `facultypageurl`, `keywords`, `lastchecked`, `metricsupdatedat`, `contactenrichedat`, `contactenrichmentsource`), with `wmkf_primaryaffiliation` String(500) + `wmkf_department` String(255). Deploy via `scripts/apply-dataverse-schema.js`. Validation gate: re-probe attrs, confirm types + no collision. (If D-NOTES/D-DENORM flip to migrate, the count rises accordingly.)

**Phase 2 — Light backfill (if D-BACKFILL = a).**
- **2.0 Link-shape audit gate (KEEP — Codex P0 #1).** Even though the data is disposable, backfill *writes into live `wmkf_potentialreviewers` rows*, so it must not run against a malformed link set. Re-run the null/dangling/duplicate `_wmkf_potentialreviewer_value` audit (it was clean on 2026-06-02 — 0/0/0) and refuse to backfill unless it's clean. This is the one S196 integrity gate the lighter plan KEEPS; the snapshot/multi-phase apparatus is what gets dropped, not this.
- **2.1 Backfill.** One-shot script: for each of 339 sidecars, PATCH its fields onto the linked person (metrics overwrite; descriptive fields fill-if-empty; affiliation per D-AFF, sourced from the sidecar's 500-char value). Dry-run first. Keep a one-shot JSONL export of the 339 sidecar rows as cheap rollback insurance.

**Phase 3 — Adapter consolidation.** Fold `researcher.js` writeback methods into `potential-reviewer.js` (`upsertBibliometricsByEmail`, `updateBibliometrics`); append the new fields to its `FIELD_SELECT` so reads return identity + bibliometrics in one query (the join hop the collapse removes). Unit tests.

**Phase 4 — Caller switchover (5 files).** Repoint each off the sidecar to the consolidated adapter / person query; smoke-test after each. Update the 2 CI-gate scripts + others. Verify `grep -rln "wmkf_appresearcher\|adapters/researcher'" pages/ lib/` → zero.

**Phase 5 — Drop.**
- **Deployment-staleness window (Codex P0 #3):** the `grep` proves the *source* is clean, but prod may still be running old serverless instances (or a just-deployed route) that query the sidecar. After the Phase 4 deploy, **wait for the new deployment to be fully live and smoke the reviewer surfaces against it** before dropping anything. A green grep on a not-yet-deployed branch is not sufficient.
- Then: re-run the 2.0 link-shape audit → cheap JSONL export → `EntityDefinitions` existence check → drop junction → publication → sidecar → delete adapter + wave2 manifests. Re-enrich the live reviewers.

**Phase 6 — Docs.** Per the S196 Phase 6 file list (atlas pages, REVIEWER_DATA_MODEL, REVIEWER_ARCHITECTURE, memory entries), plus this V2 marked EXECUTED. Run `check:fact-consistency` + `check:atlas`.

---

## Department capture (the feature that motivated this)

Beyond the collapse, `wmkf_department` becomes load-bearing for write-ups:
- **Search/enrich path:** `save-candidates` + `enrich-recommended` already thread `department` through `upsertByPotentialReviewer`; wire the discovery/enrichment source to actually populate it when a candidate's department surfaces.
- **Accept path:** add a "Department" field to the Stage-2a accept form → `contactEdits.department` → propagate onto the person (alongside the name/affiliation propagation discussed separately).
- **Surface:** add `department` to the `reviewers.js` projection so staff write-ups can read title + department + affiliation from one place.

(The separate, related work — propagating reviewer self-corrections to person/contact and the affiliation→`contact.parentcustomerid` account match — is tracked apart from this collapse; the collapse just makes the person the single home those land in.)

---

## Risks / rollback (reduced)

- **Caller miss** → smoke-test each + the Phase 5 grep gate (JS, no types) + the post-deploy staleness window.
- **Data loss** → near-zero stakes (disposable), plus the one-shot JSONL export.
- **Point of no return** → Phase 5 entity drop; everything before is reversible.
- **Recreate path after the drop (Codex #9):** the JSONL export alone isn't a rollback — pair it with a *tested* recreate path before dropping: retain the wave2 schema manifests until the drop succeeds, document the relationship/alt-key recreation order (the `wmkf_apppublicationauthor → wmkf_appresearcher` lookup + the sidecar's 1:1 alt-key on `wmkf_potentialreviewer`), and have a restore script that can re-deploy the entity + re-import the JSONL. "The data lives on the person now" is not enough if a missed caller still expects the sidecar *shape*.

## Pre-flight (re-verify immediately before Phase 1)
Row counts, attribute inventory + types both entities, collision check, the **5-caller** + 7-script grep (anything new = analyze first), publication-entity existence, longest `wmkf_primaryaffiliation`. (This V2's probe is the current baseline; confirm nothing drifted between now and execution.)

---

## Codex review outcome (2026-06-02)

**Part 2 — ground truth: independently confirmed.** A network-enabled Codex probe reproduced every count, attribute total, max-length, and the collision set; full findings in `docs/DATAVERSE_LIVE_PROBE_FINDINGS_2026-06-02.md`. No discrepancies with this doc. Added: clean link audit (0/0/0), `wmkf_notes` 0 rows, `_z_` set 404.

**Part 1 — structure/risk findings, folded in above:**
- P0 — keep the link-shape audit as a pre-backfill gate (→ Phase 2.0).
- P0 — add a post-deploy / pre-drop staleness window (→ Phase 5).
- D-AFF is broader than a write-path change: many readers of `wmkf_organizationname` must migrate too (→ D-AFF, now the largest open item).
- Existing `organizationname` 100-char clamp in `potential-reviewer.js` may have already truncated values (→ D-AFF; back-fill from the sidecar's 500-char copy).
- Rollback needs a tested recreate path, not just the JSONL export (→ Risks).
- Extra local deps to reconcile before deleting the adapter: `smoke-test-candidate.mjs`, `backfill-postgres-to-dataverse.js`, `CandidateEditModal.js`, two unit tests (→ "Other local dependencies").
- SAFE: phase order, drop order (junction→publication→sidecar), light-backfill recommendation, D-AFF direction.

**Remaining open decisions for the user:** D-AFF scope (a vs b), D-DEPT length, D-BACKFILL depth, and confirming D-NOTES/D-DENORM skips.
