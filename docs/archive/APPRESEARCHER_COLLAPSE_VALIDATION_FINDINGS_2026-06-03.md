# Appresearcher Collapse Validation Findings — 2026-06-03

Scope: read-only audit of recent documentation/memory artifacts against repository code and live prod Dataverse. No code, docs, memory, or Dataverse records were modified except this requested findings file.

## CONSISTENT

### A. Live Dataverse state

- **A1 dropped entities/entities sets: CONSISTENT.** Raw prod `EntityDefinitions(LogicalName='...')` probe returned 404 for `wmkf_appresearcher`, `wmkf_apppublication`, and `wmkf_apppublicationauthor`. Entity set probes returned 404 for `wmkf_appresearchers`, `wmkf_apppublications`, and `wmkf_apppublicationauthors` with "Resource not found for the segment ...".
- **A2 17 folded bibliometric attrs: CONSISTENT.** Prod `wmkf_potentialreviewers` metadata has all 17 expected fields. Types matched: Strings for `wmkf_primaryaffiliation`, `wmkf_department`, ORCID/Scholar/url/source fields; Integers for `wmkf_hindex`, `wmkf_i10index`, `wmkf_totalcitations`; Memo for `wmkf_keywords`; DateTime for `wmkf_lastchecked`, `wmkf_metricsupdatedat`, `wmkf_contactenrichedat`.
- **A2 max lengths: CONSISTENT.** String metadata casts returned `wmkf_primaryaffiliation MaxLength=500`, `wmkf_department=255`, `wmkf_orcid=50`, `wmkf_organizationname=100`; other folded URL/source fields also exist.
- **A3 backfill landed: CONSISTENT, with count nuance.** Filtered prod query `wmkf_potentialreviewerses?$filter=wmkf_primaryaffiliation ne null&$count=true` returned `@odata.count=331`. That is low-300s and consistent with the backfill claim direction, but not the exact 339 sidecar count. Spot check returned person rows with h-index/citations on the person, e.g. `Ram Madabhushi` had `wmkf_hindex=15`, `wmkf_totalcitations=2885`, and long `wmkf_primaryaffiliation` on `wmkf_potentialreviewerses`.
- **A4 compat shadow kept: CONSISTENT.** Prod metadata has `wmkf_organizationname` on `wmkf_potentialreviewers` as String with `MaxLength=100`.

### B. Code consistency

- **B5 no live runtime sidecar entity-set queries: CONSISTENT.** `rg "wmkf_appresearchers" lib pages scripts --glob '!scripts/.appresearcher-snapshot.jsonl'` found only `scripts/backfill-appresearcher-to-potentialreviewer.js:71`, a one-shot backfill script. No `lib/` or `pages/` runtime hit.
- **B6 researcher adapter: CONSISTENT.** `lib/dataverse/adapters/researcher.js:17` sets `ENTITY_SET = 'wmkf_potentialreviewerses'`; `:95` maps `affiliation` to `wmkf_primaryaffiliation`; there is no create path; file header `:7-9` says identity fields are not written here.
- **B7 potential reviewer adapter: CONSISTENT.** `lib/dataverse/adapters/potential-reviewer.js:18-29` includes `wmkf_primaryaffiliation` in `FIELD_SELECT`; `:94-95` writes affiliation to both `wmkf_primaryaffiliation` and `wmkf_organizationname`; `:151-152` does the same in update, with `wmkf_organizationname` clamped by `FIELD_MAX` at `:45-48`.
- **B8 seven reviewer-affiliation readers: CONSISTENT.** All seven checked paths select/read `wmkf_primaryaffiliation` and prefer it over `wmkf_organizationname` for reviewer/person affiliation:
  - `pages/api/review-manager/reviewers.js`: select in researcher hydration and fallback at `:193`; `wmkf_primaryaffiliation` selected at `:349`.
  - `pages/api/reviewer-finder/my-candidates.js`: fallback at `:175`; person bibliometrics selected at `:317`.
  - `pages/api/review-manager/render-emails.js`: person select includes both at `:91`; reviewer affiliation fallback at `:169`; proposal institution remains request `wmkf_organizationname` at `:178`.
  - `pages/api/workbench/enrich-recommended.js`: fallback at `:155`.
  - `pages/api/dynamics-explorer/chat.js`: selects both at `:885` and `:1481`; fallback at `:1497`.
  - `lib/external/verify-suggestion-token.js`: `REVIEWER_SELECT` includes both at `:81-82`.
  - `pages/api/external/review/[token]/context.js`: fallbacks at `:209`, `:224`, and `:358-359`.
- **B9 deleted schema/atlas files: CONSISTENT.** `ls lib/dataverse/schema/wave2` showed no `wmkf_app_researcher.json`, `wmkf_app_publication.json`, or `wmkf_app_z_publication_author.json`; `ls docs/atlas` showed no `dataverse-wmkf-appresearcher.md`.
- **B10 five collapse callers: CONSISTENT.** `rg` confirmed `researcherAdapter` callers in `save-candidates`, `my-candidates`, `workbench/enrich-recommended`, `contact-enrichment-service`, and no `orcid-service.js` caller.

### C. Docs/memory consistency that matched

- **Collapse done/shipped in canonical top-level docs: CONSISTENT.** `CLAUDE.md:238`, `docs/REVIEWER_DATA_MODEL.md:14,235`, `docs/REVIEWER_ARCHITECTURE.md:3`, `docs/atlas/dataverse-wmkf-potentialreviewers.md:42,74`, `docs/atlas/postgres-publications.md:57`, and `.claude-memory/project-appresearcher-collapse-post-pilot.md:8` all state that the sidecar was collapsed/dropped and bibliometrics live on the person.
- **Numbers partially reconcile: CONSISTENT with nuance.** Live metadata confirms 17 folded fields and max lengths 500/255/100. Live person rows with `wmkf_primaryaffiliation ne null` are 331, which reconciles with the doc phrase "low-300s" but not with exact `339 sidecars backfilled` wording.

### D. Other session artifacts

- **D14 remove-reviewer feature: CONSISTENT.** `pages/api/reviewer-finder/my-candidates.js:500-512` calls `suggestionAdapter.softDelete(suggestionId, { actingUserSystemId, alsoRevokeToken: true })`, with comments confirming atomic revoke + `wmkf_selected=false` and no person/contact touch. `ReviewerManagePanel.js:1110-1138` uses that DELETE path; the menu item is only rendered in the `canManage` actions cell at `:1298` and `:1336`. `CandidatesPanel.js:46-75` uses the same DELETE path, and the remove button is `canManage` gated at `:140-153`. `ReviewersTab.js:108-116` defines `refreshAll()` to reload both candidates and Review Manager reviewer lists.
- **D15 D26 allowlist: CONSISTENT.** `shared/config/d26Allowlist.js` has 36 entries, includes `1002788`, and excludes `1002826` (verified by local module import). `docs/REQUEST_WORKBENCH_BUILD_PLAN.md:150-154` matches the 36-entry shape and the `1002788` replacement. Live Dataverse `akoya_requests` probe found `akoya_requestnum='1002788'`, title `Dec 2026 Project Title TEST 2`.
- **D16 smoke helper: CONSISTENT.** `scripts/smoke-test-candidate.mjs:48` sets `DEFAULT_REQUEST_NUM='1002788'`; `:130-132` sets firstname `ZZZ Smoke` and lastname `Test (DELETE)`; teardown comment `:183-186` says no sidecar exists anymore; `:237-259` reports `Cleanup PARTIAL` when promoted contacts cannot be deleted.
- **D17 identity-resolution diagnosis: CONSISTENT.** `DiscoveryService.checkInstitutionMismatch` exists and is institution-only (`lib/services/discovery-service.js:1104+`). `SerpContactService.findScholarProfileViaGoogle` takes the first Scholar citations URL and returns `scholarName`/`institutionMismatch` without a displayed-name guard (`lib/services/serp-contact-service.js:408-446`). `ContactEnrichmentService._attachScholarMetrics` persists Scholar URL/ID/metrics unless `institutionMismatch` is true (`lib/services/contact-enrichment-service.js:349-383`). No current name-guard was found.
- **D18 contact promotion permission memory/code claim: CONSISTENT.** `lib/dataverse/adapters/contact.js:34-43` filters `findByEmail` on `emailaddress1` only, no `statecode` filter. The memory claim about no DeleteAccess was not destructively re-tested, per instruction.

### Gates

- **`npm run lint`: CONSISTENT/PASS.** Exit 0. Output: `ESLint: 0 errors, 42 warnings in 24 files`.
- **`npx jest tests/unit/reviewer`: CONSISTENT/PASS.** Exit 0. Output: `PASS (135) FAIL (0)`.
- **`npm run check:atlas`: CONSISTENT/PASS.** Exit 0. Output: `Atlas coverage OK: 32 Postgres table(s), 32 Dataverse entity set(s).`
- **`npm run check:atlas:self-test`: CONSISTENT/PASS.** Exit 0. Output: `Coverage self-test OK — 12/12 patterns detected.`
- **`npm run check:fact-consistency`: CONSISTENT/PASS.** Exit 0. Output: `fact-consistency OK — 260 live doc/memory file(s) scanned`.
- **`npm run check:doc-currency`: CONSISTENT/PASS.** Exit 0. Output: `No drift markers found across 8 patterns.`
- **`npm run check:drain-table-mentions`: CONSISTENT/PASS.** Exit 0. Output: `drain-table-mentions OK — 239 live doc/memory file(s) scanned`.

## DISCREPANCY

- **P1 — `docs/APPLICATION_STATE_ATLAS.md` still calls dropped sidecar the Postgres researcher source of truth.** Evidence: `docs/APPLICATION_STATE_ATLAS.md:28` says Dataverse `wmkf_appresearcher` is source of truth for `researchers`; `:30` says `researcher_keywords` folded into `wmkf_appresearcher.wmkf_keywords`. This conflicts with the same file's newer rows `:40-42` saying `wmkf_appresearcher` is dropped and bibliometrics are on `wmkf_potentialreviewers`.
- **P1 — `docs/atlas/postgres-researchers.md` has stale current-state mappings to `wmkf_appresearcher`.** Evidence: `docs/atlas/postgres-researchers.md:49` cites Dataverse `wmkf_appresearcher` count 334; `:70` says enrichment targets `wmkf_potentialreviewer` + `wmkf_appresearcher`; `:79` maps metrics to `wmkf_appresearcher`; `:81` says `wmkf_appresearchers` has 334 rows; `:85` says bibliometric snapshot → `wmkf_appresearcher`. Live probe says the entity is 404, and code writes metrics to `wmkf_potentialreviewerses`.
- **P1 — `docs/atlas/dataverse-wmkf-apppublication-and-appgrantcycle.md` contains internally stale publication sections despite the top warning.** Evidence: top banner `:5` says `wmkf_apppublication` and `wmkf_apppublicationauthor` were dropped, but `:9-19` still labels `wmkf_apppublication` "DEPLOYED but EMPTY"; `:41-47` labels `wmkf_apppublicationauthor` "DEPLOYED (empty)"; `:55-60` table says `wmkf_appresearcher`, `wmkf_apppublication`, and `wmkf_apppublicationauthor` are deployed. Live `EntityDefinitions` returned 404 for all three.
- **P1 — `docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md` still presents the sidecar model as current.** Evidence: `:100` says all six Wave 2 entities are deployed today including `wmkf_appresearcher` and publication entities; `:171-174` says one reviewer = one `wmkf_potentialreviewer` + one `wmkf_appresearcher` + N suggestions. Live probe and collapse docs show only person + engagement remain.
- **P1 — `docs/API_ROUTE_SECURITY_MATRIX.md` persistence rows are stale.** Evidence: `:135` says `/api/reviewer-finder/my-candidates` PATCH updates `wmkf_appresearcher`; `:137` says `/save-candidates` upserts `wmkf_appresearcher`; `:148` says `/workbench/enrich-recommended` writes back to `wmkf_appresearcher`. Code evidence: `lib/dataverse/adapters/researcher.js:17` writes `wmkf_potentialreviewerses`.
- **P1 — `docs/REQUEST_WORKBENCH_BUILD_PLAN.md` has a stale enrichment target.** Evidence: `docs/REQUEST_WORKBENCH_BUILD_PLAN.md:31` says `enrich-recommended` writes back per-person to `wmkf_appresearcher`. Code evidence: `pages/api/workbench/enrich-recommended.js:238` calls `researcherAdapter.upsertByPotentialReviewer`, and that adapter targets `wmkf_potentialreviewerses`.
- **P2 — Memory index still points institution-match readers to the dropped entity.** Evidence: `.claude-memory/MEMORY.md:118` says "`wmkf_appresearcher.wmkf_primaryaffiliation` is uncurated free text." The target memory file itself is correct at `.claude-memory/project-reviewer-institution-match.md:11`, saying `wmkf_potentialreviewer.wmkf_primaryaffiliation`.
- **P2 — Workbench invite workflow memory still says candidate detail maps off the sidecar.** Evidence: `.claude-memory/project-reviewer-workbench-invite-workflow.md:15` says `my-candidates` maps persisted detail off the `wmkf_appresearcher` sidecar. Code maps it off person rows: `pages/api/reviewer-finder/my-candidates.js:307-318`.
- **P2 — Component header comment still describes a sidecar write.** Evidence: `shared/components/reviewers/CandidateEditModal.js:10-12` says edits hit `wmkf_potentialreviewer` + bibliometric sidecar `wmkf_appresearcher`. Actual PATCH path writes person identity via `potential-reviewer.js` and bibliometrics via `researcher.js` to `wmkf_potentialreviewerses`.
- **P2 — `.claude-memory/MEMORY.md` deferred-tail claim is stale.** Evidence: `.claude-memory/MEMORY.md:108` says "Deferred tail: 5 secondary organizationname readers + long-tail prose docs." Code check found the seven named affiliation readers have been migrated to prefer `wmkf_primaryaffiliation`; the remaining issue is stale prose/docs, not those readers.
- **P2 — V2 plan exact count wording is stale after live post-drop probe.** Evidence: `docs/archive/APPRESEARCHER_COLLAPSE_PLAN_V2.md:3` says "339 sidecars backfilled (verified exact)" and `:50` says `wmkf_primaryaffiliation` set on `330/339` sidecar rows pre-drop. Current live person count with `wmkf_primaryaffiliation ne null` is 331. This is not a code/schema failure, but exact current-state count claims should use 331 person rows or clearly label the old 339 as pre-drop sidecar count.
- **P2 — Build gate inconclusive/hung.** `./node_modules/.bin/next build` emitted `Next.js 16.2.6`, finished TypeScript, entered `Creating an optimized production build ...`, then produced no further output for an extended wait. It was terminated with `pkill -f "next build"` and exited 143. This is neither a code pass nor a compile failure; it needs a clean rerun or timeout investigation before claiming build green.

## Verdict

The live Dataverse schema/data and runtime code are consistent with the appresearcher collapse, but the session's doc/memory set is **not fully consistent**: several current-state docs and memory pointers still describe `wmkf_appresearcher` / publication entities as live targets, and the build gate did not complete.
