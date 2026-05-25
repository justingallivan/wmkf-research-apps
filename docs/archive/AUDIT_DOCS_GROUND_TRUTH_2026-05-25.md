# Documentation Ground-Truth Audit — 2026-05-25

**Scope:** `docs/`, `.claude-memory/`, `SESSION_PROMPT.md`, `CLAUDE.md`, Atlas pages, route matrix, and selected source paths used to verify concrete claims.

**Method:** mechanical gates first, then live probes and targeted code reads. This audit intentionally separates (a) current code/database facts from (b) stale or point-in-time audit prose.

## Executive Summary

The documentation system is much healthier than it was on 2026-05-19: the core mechanical gates pass, the reviewer-domain Postgres drain-table claims are guarded, route counts are canonicalized, and the Atlas now covers more surfaces.

The remaining problems are concentrated in three classes:

1. **Current-state docs overstate in-progress intake attach work.** Several docs describe `/api/intake/draft/upload-token`, `/api/intake/draft/attach`, `pending_attachments` handling, and stale-pending sweeps as if they are live. Current source has only `pages/api/intake/draft.js` and `pages/api/intake/submit.js`; no attach/upload-token route exists yet.
2. **The memory-drift gate is currently non-authoritative.** `check:memory-drift:no-write` evaluates a stale 2026-05-19 report and fails on Wave 2 `spec_without_entity` probe_404 entries. Fresh Dataverse audit proves several of those entity sets exist. The likely bug is in `scripts/reconcile-memory-claims.js`: it stops on the first candidate entity-set 404 instead of trying later candidates such as the deployed no-underscore set names.
3. **Atlas row counts are stale on fast-moving operational tables.** These are mostly not architectural contradictions, but the Atlas is a ground-truth surface, so stale counts should either be refreshed or converted to "last observed" language.

## Checks Run

Sequential gates:

```bash
npm run check:atlas
npm run check:atlas:self-test
npm run check:api-routes
npm run check:doc-currency
npm run check:doc-currency:self-test
npm run check:fact-consistency
npm run check:fact-consistency:self-test
npm run check:canonical-pointers
npm run check:canonical-pointers:self-test
npm run check:drain-table-mentions
npm run check:drain-table-mentions:self-test
npm run check:prompt-storage-mentions
npm run check:prompt-storage-mentions:self-test
npm run check:prompt-injection-tagging
npm run check:prompt-injection-tagging:self-test
npm run check:memory-drift:no-write
```

Results:

- PASS: Atlas coverage, 30 Postgres tables and 32 Dataverse entity sets.
- PASS: Atlas self-test, 12/12 patterns.
- PASS: API route matrix, 91 route files.
- PASS: Doc-currency, 8 patterns.
- PASS: Doc-currency self-test, 12/12 fixtures.
- PASS: Fact-consistency, canonical facts current: app definitions = 17, `requireAppAccess` endpoint files = 52, API route files = 91.
- PASS: Fact-consistency self-test.
- PASS: Canonical pointers, 9 pointers verified.
- PASS: Canonical pointers self-test.
- PASS: Drain-table mentions, 184 live doc/memory files scanned, all drained-table mentions annotated.
- PASS: Drain-table mentions self-test.
- PASS: Prompt-storage mentions, 206 live doc/memory files scanned, all stale `wmkf_prompt_template` mentions annotated.
- PASS: Prompt-storage mentions self-test.
- PASS: Prompt-injection tagging, 24 migrated surfaces, 0 pending.
- PASS: Prompt-injection tagging self-test, 16/16.
- FAIL, advisory: `check:memory-drift:no-write`, because the committed 2026-05-19 reconciliation report still contains 7 Wave 2 `spec_without_entity` probe_404 entries.

Live probes:

```bash
node scripts/audit-dataverse-state.js
node scripts/audit-postgres-state.js
```

The Postgres probe required network escalation after sandbox DNS failure; the rerun completed read-only.

## Verified Live State Snapshot

Dataverse, from `scripts/audit-dataverse-state.js`:

| Entity set | Rows | Notes |
|---|---:|---|
| `wmkf_appresearchers` | 334 | Exists; contradicts stale `spec_without_entity` report entries. |
| `wmkf_appreviewersuggestions` | 336 | Exists. |
| `wmkf_apppublications` | 0 | Exists, empty. |
| `wmkf_appgrantcycles` | 10 | Exists, Dataverse-primary for cycles. |
| `wmkf_appproposalsearches` | 404 | Not deployed. |
| `wmkf_app_z_publication_authors` | 404 | Not deployed. |
| `wmkf_appsystemsettings` | 46 | Wave 1 settings. |
| `wmkf_appuserpreferences` | 20 | Wave 1 prefs. |
| `wmkf_appuserappaccesses` | 84 | Wave 1 access. |
| `wmkf_potentialreviewerses` | 4,267 | Vendor reviewer/person record. |
| `akoya_requests` | 5,000 returned by count probe | Count endpoint is capped/sample-shaped in script output; do not treat as full population size. |
| `contacts` | 5,000 returned by count probe | Same caution. |
| `accounts` | 4,605 | Was 4,601 in older docs. |
| `systemusers` | 222 | Internal users. |
| `wmkf_ai_prompts` | 11 | Atlas page still says 10. |
| `wmkf_ai_runs` | 329 | Atlas page still says 325. |

Postgres, from `scripts/audit-postgres-state.js`:

| Table | Rows | Notes |
|---|---:|---|
| `api_usage_log` | 1,724 | Atlas compact page says 2,044. |
| `dynamics_query_log` | 1,417 | Atlas says 1,359. |
| `dynamics_feedback` | 2 | Atlas says 1. |
| `health_check_history` | 2,964 | Atlas says 2,927. |
| `system_alerts` | 150 | Atlas says 110. |
| `maintenance_runs` | 1,498 | Atlas says 73. |
| `model_pricing_audit` | 0 | Atlas lists schema, not count. |
| `external_rate_limit` | 0 | Matches Atlas. |
| `intake_drafts` | 0 | Matches Atlas. |
| `intake_audit` | 0 | Matches Atlas. |
| `submission_jobs` | 0 | Matches Atlas. |
| `researchers` | 331 | Drain-only; matches Atlas. |
| `researcher_keywords` | 1,028 | Drain-only; matches Atlas. |
| `publications` | 0 | Drain-only/dead; matches Atlas. |
| `reviewer_suggestions` | 337 | Drain-only; matches Atlas. |
| `grant_cycles` | 13 | Drain-only; matches Atlas. |
| `proposal_searches` | 0 | Drain-only/dead; matches Atlas. |
| `retractions` | 68,248 | Matches Atlas. |
| `irs_exempt_orgs` | 1,264,156 | Large reference table. |

## Findings

### P0 — Intake Attach Docs State Future Endpoints As Current

`CLAUDE.md:127` says applicant attachments "land here via a three-call dance" and names `/api/intake/draft/upload-token` plus `/api/intake/draft/attach`. `docs/atlas/postgres-infra-tables.md:73` says `pending_attachments` holds uploads between those endpoints and that stale entries are swept by the maintenance cron.

Current code evidence:

- `rg --files pages/api/intake` returns only `pages/api/intake/draft.js` and `pages/api/intake/submit.js`.
- `pages/api/intake/draft.js:51-53` explicitly says attachment management is not in scope and points to `/api/intake/draft/attach`.
- `lib/services/maintenance-service.js:145-152` scans only `intake_drafts.attachments`, not `pending_attachments`.
- No maintenance code currently sweeps stale `pending_attachments`.

The schema support exists (`lib/db/migrations/013_intake_drafts_pending_attachments.sql`), and there are new untracked local utility files in the working tree, so this appears to be an in-progress build. The live docs should say "planned / partially scaffolded" until the routes and sweep exist.

### P0 — `CLAUDE.md` Contradicts The Built Drain Cron

`CLAUDE.md:260` says `submission_jobs` is drained by `/api/cron/drain-submissions` but adds "(cron not yet built)." Current code has `pages/api/cron/drain-submissions.js`, and `vercel.json` schedules it every two minutes.

Nuance: the route itself is built, but `pages/api/cron/drain-submissions.js:13-16` and `:35-39` still mark later state handlers as build-pending. This should be rewritten as "cron exists; downstream states partially built / parked" rather than "cron not yet built."

### P0 — Memory-Drift Gate Fails On Stale Or False Wave 2 404s

`npm run check:memory-drift:no-write` failed with 7 `spec_without_entity` entries from `docs/RECONCILIATION_REPORT.json` generated on 2026-05-19.

Fresh Dataverse probe disproves several of those as current-state claims:

- `wmkf_appresearchers` exists, 334 rows.
- `wmkf_appreviewersuggestions` exists, 336 rows.
- `wmkf_apppublications` exists, 0 rows.
- `wmkf_appgrantcycles` exists, 10 rows.

Two probe_404s are real:

- `wmkf_appproposalsearches`
- `wmkf_app_z_publication_authors`

Likely tooling bug: Wave 2 schema files use underscored names such as `wmkf_app_grant_cycle`, while deployed entity sets use no-underscore names such as `wmkf_appgrantcycles`. `scripts/reconcile-memory-claims.js:291` returns as soon as any candidate returns `probe_404`, so it can stop before trying later candidates that would resolve. Fix the resolver to continue past 404 candidates and prefer Atlas-declared `**Entity set:**` values.

### P1 — `docs/atlas/dataverse-wmkf-ai-run-and-prompt.md` Has Stale Counts

The page says:

- `wmkf_ai_run` = 325 rows at line 6.
- `wmkf_ai_prompt` = 10 rows at line 48 and line 71.

Fresh Dataverse probe says:

- `wmkf_ai_runs` = 329.
- `wmkf_ai_prompts` = 11.

This is expected operational growth, but the page is a canonical Atlas page. Either refresh the counts with a new "Last verified" date or change the headings to "last observed count" so row-count churn does not look like contradiction.

### P1 — `docs/atlas/postgres-infra-tables.md` Is Stale And Too Compact For Churny Tables

The page is marked "Last verified: 2026-05-07" and several operational counts have already drifted:

- `dynamics_query_log`: 1,359 documented vs 1,417 live.
- `dynamics_feedback`: 1 documented vs 2 live.
- `health_check_history`: 2,927 documented vs 2,964 live.
- `system_alerts`: 110 documented vs 150 live.
- `maintenance_runs`: 73 documented vs 1,498 live.
- `api_usage_log`: 2,044 documented vs 1,724 live.

These are not source-of-truth contradictions; they are normal logs. But they show that "compact Atlas" pages are risky when they mix durable schema facts with volatile counts. Recommendation: split volatile observability tables into a "last observed" block or omit exact counts except when a count is operationally meaningful.

### P1 — Inline Drain-Submissions Header Is Stale Against Its Own File

`pages/api/cron/drain-submissions.js:27-39` says the implementation includes only `queued→scanning` and `scanning→request_created`; it lists `files_moved` and `dynamics_patched` as build-pending.

Later in the same file:

- `request_created → files_moved` handler starts at line 469.
- `files_moved → dynamics_patched` handler starts at line 627.
- `BUILD_PENDING_STATES` at line 80 contains only `dynamics_patched` and `status_flipped`.

This is code-comment drift, but it is exactly the sort of thing later docs copy into memory. Update the header to reflect the actual partial state.

### P2 — `INTAKE_BLOB_RW_TOKEN` Is Listed As Required For Production-Only Paths Before The Attach Endpoint Exists

`CLAUDE.md:127` places `INTAKE_BLOB_RW_TOKEN` in "Required for production-only paths" and describes attach endpoint startup behavior. The drain route also uses the token when moving files from Blob to SharePoint, so the variable is genuinely needed for the intake drain once attachment rows exist. The doc problem is not the variable itself; it is the endpoint wording.

Recommended wording: "Required for applicant-intake attachment/drain paths; attach endpoints are in progress until `/api/intake/draft/upload-token` and `/api/intake/draft/attach` land."

### P2 — Prior Audit Exclusion Lists Are Now Too Specific

Several gates exclude `DOCS_GROUND_TRUTH_AUDIT_2026-05-19.md` by exact basename, while this new audit uses the safer `AUDIT_` prefix. Exact-date exclusions create a trap for future audit docs named the same way but with a new date.

Recommendation: either standardize all point-in-time audits under the `AUDIT_` prefix or broaden exact `DOCS_GROUND_TRUTH_AUDIT_*` exclusions in:

- `scripts/check-fact-consistency.js`
- `scripts/check-canonical-pointers.js`
- `scripts/check-drain-table-mentions.js`
- `scripts/check-prompt-storage-mentions.js`

## What Looks Solid

- Reviewer-domain Postgres drain status is coherent across gates, Atlas pages, route matrix, and live code. The old high-risk class "Reviewer Finder still reads Postgres" did not reappear in this pass.
- API route matrix is current at 91 route files.
- Canonical scalar facts are current at 17 app definitions, 52 `requireAppAccess` endpoint files, and 91 route files.
- Prompt-storage entity naming is guarded: `wmkf_ai_prompt` is current; stale `wmkf_prompt_template` mentions are annotated.
- The Field Set D collision remains intentionally visible through the memory-drift mechanism. Do not resolve by silencing the gate; resolve by owner decision on the label.

## Recommended Work Order

1. Fix current-state doc overclaims around intake attach:
   - `CLAUDE.md:127`
   - `CLAUDE.md:260`
   - `docs/atlas/postgres-infra-tables.md:72-77`
   - `pages/api/cron/drain-submissions.js:27-39`
2. Patch `scripts/reconcile-memory-claims.js` candidate probing so one 404 does not stop later entity-set candidates.
3. Regenerate `docs/RECONCILIATION_REPORT.json` after the resolver fix and confirm the only remaining intentional blockers are real.
4. Refresh or de-emphasize volatile row counts in:
   - `docs/atlas/dataverse-wmkf-ai-run-and-prompt.md`
   - `docs/atlas/postgres-infra-tables.md`
5. After those are clean, rerun the full gate set and live probes before declaring documentation ground truth restored.

## Residual Risk

This was broad but not exhaustive semantic verification. The green gates prove coverage and known-pattern hygiene, not full truth. The highest remaining risk is fragmented intake-portal prose because active work is mid-flight and the docs are already speaking in the future-perfect tense.
