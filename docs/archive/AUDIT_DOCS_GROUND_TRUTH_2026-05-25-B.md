# Documentation Ground-Truth Audit - 2026-05-25-B

**Scope:** Fresh independent pass over docs, memory, Atlas pages, gate scripts, route matrix, and selected source paths. Prior baseline/template: `docs/AUDIT_DOCS_GROUND_TRUTH_2026-05-25.md`.

**Method:** Read prior audit first, then ran live probes and gates sequentially. For `check:memory-drift`, used the read-only `:no-write` variant to honor this audit's write-only-new-report constraint; the committed report was fresh and the gate logic is the same after the report is present.

## Executive Summary

- Overall health is strong: all required green gates passed, including Atlas coverage (`30` PG / `32` DV), API route coverage (`93` routes), canonical facts, pointer gates, stale table/prompt mention gates, prompt-injection tagging, and doc-currency.
- CONFIRMED: the only failing gate output is the expected Field Set D `doc_label_collision`. No `spec_without_entity`, probe-error, or large stale-row-count blocker is currently hiding behind it.
- CONFIRMED: S184 intake attach endpoints, `pending_attachments`, `MaintenanceService.sweepIntakePending`, and the `/api/intake/submit` A1 guard exist in source; the prior audit's intake-attach P0 is obsolete after S184.
- CONFIRMED: both requested spot checks look sound: `probeEntitySetCount`'s injectable signature is backward-compatible and exported for tests; the point-in-time helper is imported by all 4 intended gates with no remaining local constant copies.
- Residual risk class: low-to-moderate. The mechanical gates are healthy, but memory/current-session prose still has one misleading applicant UI carryover and the memory report retains non-blocking noisy drift buckets.

## Checks Run

| Check Name | Command | Result | Notes |
|---|---|---:|---|
| Repo HEAD | `git rev-parse HEAD` | PASS | `ebeb69bcd39a0508bb8a608e247e35c66237b9b7` |
| Dataverse live probe | `node scripts/audit-dataverse-state.js` | WARN | Completed; expected 404s for `wmkf_appproposalsearches` and `wmkf_app_z_publication_authors`; metadata schema probe ended with `ERR 501` for unsupported `startswith` on metadata entities. |
| Postgres live probe | `node scripts/audit-postgres-state.js` | PASS | Completed; emitted Node typeless-package warning only. |
| Atlas coverage | `npm run check:atlas` | PASS | `Atlas coverage OK: 30 Postgres table(s), 32 Dataverse entity set(s).` |
| Atlas self-test | `npm run check:atlas:self-test` | PASS | `Coverage self-test OK — 12/12 patterns detected.` |
| API route matrix | `npm run check:api-routes` | PASS | `API route security matrix covers 93 route file(s).` |
| Fact consistency | `npm run check:fact-consistency` | PASS | `211 live doc/memory file(s)`; canonical facts current: `app-definition-count=17`, `requireappaccess-endpoint-count=52`, `api-route-file-count=93`. |
| Fact self-test | `npm run check:fact-consistency:self-test` | PASS | Prose fixtures and independent derive cross-check passed. |
| Canonical pointers | `npm run check:canonical-pointers` | PASS | `211 live file(s) scanned, 9 pointer(s) verified against 3 registered fact id(s).` |
| Canonical pointer self-test | `npm run check:canonical-pointers:self-test` | PASS | Valid/invalid pointer fixtures handled correctly. |
| Drain table mentions | `npm run check:drain-table-mentions` | PASS | `190 live doc/memory file(s) scanned; 12 allowlisted files skipped`. |
| Drain table self-test | `npm run check:drain-table-mentions:self-test` | PASS | Positive/negative fixtures and file-marker constraint passed. |
| Prompt storage mentions | `npm run check:prompt-storage-mentions` | PASS | `212 live doc/memory file(s) scanned; 1 allowlisted file(s) skipped`. |
| Prompt storage self-test | `npm run check:prompt-storage-mentions:self-test` | PASS | Positive/negative fixtures and file-marker constraint passed. |
| Prompt-injection tagging | `npm run check:prompt-injection-tagging` | PASS | `24 migrated surface(s) carry their markers, 0 pending`. |
| Prompt-injection self-test | `npm run check:prompt-injection-tagging:self-test` | PASS | `16/16 cases`. |
| Doc currency | `npm run check:doc-currency` | PASS | `No drift markers found across 8 patterns.` |
| Doc currency self-test | `npm run check:doc-currency:self-test` | PASS | `12/12 fixtures behaved as expected.` |
| Memory drift | `npm run check:memory-drift:no-write` | FAIL | Expected red: `memory drift check failed: 1 doc-label collision(s) — resolve before proceeding`; only Field Set D collision listed. |
| Spot-check unit tests | `npx jest tests/unit/reconcile-probe-entity-set-count.test.js tests/unit/point-in-time-files.test.js --runInBand` | PASS | `PASS (17) FAIL (0)`. |
| AGENTS symlink | `ls -l AGENTS.md CLAUDE.md && test AGENTS.md -ef CLAUDE.md` | PASS | `AGENTS.md -> CLAUDE.md`; target matches. |

## Live State Snapshot

**Dataverse probe (`node scripts/audit-dataverse-state.js`)**

| Entity Set | Result | Notes |
|---|---:|---|
| `wmkf_appresearchers` | 334 rows | Bibliometric sidecar exists. |
| `wmkf_appreviewersuggestions` | 336 rows | Suggestion lifecycle ledger exists. |
| `wmkf_apppublications` | 0 rows | Entity exists, empty. |
| `wmkf_appgrantcycles` | 10 rows | Grant-cycle entity exists. |
| `wmkf_appproposalsearches` | ERR 404 | Not deployed; matches Atlas claim. |
| `wmkf_app_z_publication_authors` | ERR 404 | Not deployed. |
| `wmkf_appsystemsettings` | 46 rows | Wave 1 settings. |
| `wmkf_appuserpreferences` | 20 rows | Wave 1 preferences. |
| `wmkf_appuserappaccesses` | 84 rows | Wave 1 app access. |
| `wmkf_potentialreviewerses` | 4,267 rows | Vendor reviewer/person record. |
| `akoya_requests` | 5,000 rows returned | Probe output is capped/sample-shaped; do not infer total population. |
| `contacts` | 5,000 rows returned | Same cap caveat. |
| `accounts` | 4,605 rows | Live org count. |
| `systemusers` | 222 rows | Internal users. |
| `wmkf_ai_prompts` | 11 rows | Matches refreshed Atlas. |
| `wmkf_ai_runs` | 329 rows | Matches refreshed Atlas. |

Key Dataverse scalar checks: `docs/atlas/dataverse-wmkf-ai-run-and-prompt.md:6` says `wmkf_ai_run` = 329 rows and line 48 says `wmkf_ai_prompt` = 11 rows; both match the probe.

**Postgres probe (`node scripts/audit-postgres-state.js`)**

| Table | Rows | Notes |
|---|---:|---|
| `api_usage_log` | 1,702 | Volatile operational table. |
| `dynamics_feedback` | 2 | Matches Atlas. |
| `dynamics_query_log` | 1,417 | Matches Atlas. |
| `dynamics_restrictions` | 0 | Empty RBAC scaffold. |
| `dynamics_user_roles` | 6 | Matches Atlas. |
| `expertise_matches` | 344 | Matches Atlas. |
| `expertise_roster` | 38 | Matches Atlas. |
| `external_rate_limit` | 0 | Matches Atlas. |
| `grant_cycles` | 13 | Drain-only reviewer table. |
| `health_check_history` | 2,884 | Volatile; Atlas line 81 says 2,964, so this count drifted after the report's earlier probe or from retention cleanup. |
| `intake_audit` | 0 | Matches Atlas. |
| `intake_drafts` | 0 | Matches Atlas. |
| `integrity_screenings` | 41 | Matches Atlas. |
| `irs_exempt_orgs` | 1,264,156 | Reference table. |
| `maintenance_runs` | 1,514 | Volatile; Atlas line 81 says 1,498. |
| `model_pricing_audit` | 0 | Empty. |
| `panel_review_items` | 278 | Matches Atlas. |
| `panel_reviews` | 35 | Matches Atlas. |
| `playing_with_neon` | 10 | Present live. |
| `policy_publish_audit` | 26 | Present live. |
| `proposal_searches` | 0 | Drain-only/dead. |
| `publications` | 0 | Drain-only/dead. |
| `researcher_keywords` | 1,028 | Drain-only. |
| `researchers` | 331 | Drain-only. |
| `retractions` | 68,248 | Matches Atlas. |
| `reviewer_suggestions` | 337 | Drain-only. |
| `screening_dismissals` | 0 | Matches Atlas. |
| `search_cache` | 0 | Empty. |
| `submission_jobs` | 0 | Matches Atlas. |
| `system_alerts` | 149 | Volatile; Atlas line 81 says 150. |
| `user_profiles` | 9 | Matches Atlas. |

Key source scalars from gates: 17 app definitions, 52 `requireAppAccess` endpoint files, 93 API route files, 9 canonical pointers, 24 prompt-injection migrated surfaces.

## Spot-Check Results

### `probeEntitySetCount` Refactor (`44d8232`)

- CONFIRMED: `scripts/reconcile-memory-claims.js:323-329` now has signature `async function probeEntitySetCount(token, entitySet, opts = {})`, with optional `_fetch` and `_baseUrl` injection points.
- CONFIRMED: production callers remain compatible. `resolveEntitySet` still calls `probeEntitySetCount(token, c)` at `scripts/reconcile-memory-claims.js:315`, and `probeDataverseEntities` still calls `probeEntitySetCount(tokenResult.token, resolved.entitySet)` at line 384.
- CONFIRMED: export is correct and side-effect-safe. `module.exports = { probeEntitySetCount }` is at `scripts/reconcile-memory-claims.js:532`, and `main()` is guarded by `if (require.main === module)` at line 534.
- CONFIRMED: the new tests cover the intended distinction: `$top=1` timeout => `unknown`, `$count` timeout => `status:200` with `count_error:'timeout'`, non-timeout `$count` exception => `unknown`, and `$top=1` 404 => `probe_404` (`tests/unit/reconcile-probe-entity-set-count.test.js:46-113`). Targeted Jest run passed.

### Shared Point-In-Time Helper Extraction (`ebeb69b`)

- CONFIRMED: shared constants and classifier live in `scripts/lib/point-in-time-files.js:29-57`, exporting `POINT_IN_TIME_BASENAMES`, `POINT_IN_TIME_PREFIXES`, and `isPointInTimeBasename`.
- CONFIRMED: all 4 intended callers import the helper: `scripts/check-canonical-pointers.js:26`, `scripts/check-drain-table-mentions.js:59`, `scripts/check-fact-consistency.js:36`, and `scripts/check-prompt-storage-mentions.js:40`.
- CONFIRMED: all 4 callers use `isPointInTimeBasename(path.basename(full))` and retain only comments pointing to the shared module; `rg` found no leftover local `POINT_IN_TIME_BASENAMES` or `POINT_IN_TIME_PREFIXES` copies outside the shared helper and tests.
- CONFIRMED: targeted Jest run for `tests/unit/point-in-time-files.test.js` passed as part of `PASS (17) FAIL (0)`.

## Findings

### P1 - Expected Field Set D Collision Still Keeps Memory-Drift Red

**Description:** The advisory memory-drift gate remains red on the known Field Set D label collision. This is the only failing gate output and should not be silenced until Connor resolves the label conflict.

**Evidence:** `npm run check:memory-drift:no-write` output:

```text
memory drift check failed: 1 doc-label collision(s) — resolve before proceeding
  - Field Set D: {"label":"Field Set D","sources":["docs/atlas/dataverse-akoya-request.md: 107 instead says Field Set D = PD Assignment (writes existing wmkfprogramdirector, no new akoyarequest fields)","docs/atlas/dataverse-akoya-request.md#2: memory-drift stays red by design on this doclabelcollision","docs/atlas/dataverse-akoya-request.md#3: ready","docs/atlas/dataverse-akoya-request.md#4: the deployment isn't in doubt, the label is","docs/atlas/dataverse-akoya-request.md#5: wmkfaifitassessment (Picklist) + wmkfaifitrationale (Memo) — ready","docs/DYNAMICS_AI_FIELDS_SPEC_v3_cn.md: PD Assignment"]}
```

`CLAUDE.md:46` explicitly says this red state is advisory and not a P0 blocker until Connor resolves Field Set D.

**Confidence:** CONFIRMED via command output and source read.

**Recommended action:** Keep the gate red; resolve by owner decision. Until then, plans/code should name concrete fields, not "Field Set D."

### P2 - `SESSION_PROMPT.md` Misstates The Applicant UI Location And Current Attachment Model

**Description:** The session carryover says "the form code in `shared/components/intake/` is still on the old single-call attachment model." That directory does not exist, and the current `/apply` page is only a smoke-test landing page with no form or file-upload UI.

**Evidence:** `SESSION_PROMPT.md:122-125` states the stale path/model. `find shared -maxdepth 3 -type d` shows no `shared/components/intake`, and `pages/apply/index.js:4-6` says "No form, no draft staging, no Dynamics writes yet." Lines `60-63` render "Form modules and institution selection arrive in a later release."

**Confidence:** CONFIRMED via file reads and path search.

**Recommended action:** Update the next session prompt/handoff wording. The next UI task is not "rewrite existing `shared/components/intake` single-call file inputs"; it is to build or wire the applicant form UI in the actual current location.

### P2 - Memory Report Has Non-Blocking Noise Buckets That Can Look Like Hidden Drift

**Description:** `docs/RECONCILIATION_REPORT.json` has `spec_without_entity: []` and `probe_errors: 0`, so no hidden blocking drift is behind Field Set D. It still contains non-blocking buckets that can mislead readers: `entity_without_atlas` has `wmkf_app_proposal_search` with `row_count: 0`, `stale_row_count` has two `wmkf_app_request_person`/`wmkf_apprequestpersons` 5,000-vs-5,561 entries, and `postgres_table_mismatch` lists deployed tables that are not in `schema.sql`.

**Evidence:** `docs/RECONCILIATION_REPORT.json:14-35` shows `spec_without_entity: []`, one `entity_without_atlas`, and two stale-row-count entries. `scripts/check-memory-drift.js:67-97` fails only on `spec_without_entity`, large stale counts (>50%), `doc_label_collision`, and probe errors; it intentionally does not fail on those non-blocking buckets. Atlas also says `wmkf_appproposalsearches` is not deployed at `docs/atlas/dataverse-wmkf-apppublication-and-appgrantcycle.md:33-36`, matching the live 404 probe.

**Confidence:** CONFIRMED via file reads and command output.

**Recommended action:** Consider narrowing/report-labeling these buckets so future auditors do not mistake them for hidden blockers: distinguish schema-as-code-but-deferred entities, capped Dataverse count probes, and intentionally incomplete `schema.sql` coverage.

## What Looks Solid

- CONFIRMED: S184 shipped context exists in source: `pages/api/intake/draft/upload-token.js`, `pages/api/intake/draft/attach.js`, `lib/db/migrations/013_intake_drafts_pending_attachments.sql`, `MaintenanceService.sweepIntakePending` in `lib/services/maintenance-service.js:255`, and the `/api/intake/submit` A1 guard at `pages/api/intake/submit.js:205-207`.
- CONFIRMED: route count is now 93 and the route matrix gate agrees.
- CONFIRMED: `docs/atlas/dataverse-wmkf-ai-run-and-prompt.md` was refreshed to 329 `wmkf_ai_runs` and 11 `wmkf_ai_prompts`, matching the live Dataverse probe.
- CONFIRMED: `docs/atlas/postgres-infra-tables.md` now labels operational/log table counts as "last observed" snapshots at line 3, reducing the prior audit's row-count-staleness risk.
- CONFIRMED: `pages/api/cron/drain-submissions.js:9-39` now accurately states implemented drain states through `files_moved -> dynamics_patched`, with only `dynamics_patched -> status_flipped` and `status_flipped -> completed` build-pending.
- CONFIRMED: audit-doc point-in-time exclusions are centralized and cover both `AUDIT_` and legacy `DOCS_GROUND_TRUTH_AUDIT_` prefixes.
- CONFIRMED: `AGENTS.md` is still a symlink to `CLAUDE.md`.

## Recommended Work Order

1. Resolve the Field Set D label collision with Connor, then update the two conflicting docs and rerun `npm run check:memory-drift`.
2. Correct `SESSION_PROMPT.md` so the next UI task points at the actual current applicant surface instead of nonexistent `shared/components/intake/`.
3. Optionally clean up memory-drift report noise buckets so future audits can read the red state without second-guessing non-blocking entries.

## Residual Risk

- I did not run the mutating `npm run check:memory-drift` because this audit was instructed to write only this `-B` report. The committed reconciliation report was generated on `2026-05-25T03:53:23.022Z`, so `:no-write` evaluated fresh data read-only.
- I did not verify production/preview environment variables (`INTAKE_BLOB_RW_TOKEN`, Cloudmersive flags, etc.); this audit focused on repository ground truth and live database probes, not Vercel environment state.
- I did not exhaustively semantically validate every archived or point-in-time document. The gates intentionally exclude those surfaces, and this pass sampled them only when current-state claims or gate behavior depended on them.
