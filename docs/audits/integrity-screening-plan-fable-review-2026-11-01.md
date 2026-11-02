---
title: Fable review of Integrity screening accuracy and refresh plan
domain: integrity-screener
kind: audit
status: active
summary: "Read-only subscription-OAuth Fable review of the initial Integrity plan; conditional verdict with controller dispositions in the revised plan."
canonical: false
cataloged: 2026-11-01
owner: product-engineering
related:
  - docs/plans/INTEGRITY_SCREENING_ACCURACY_AND_REFRESH_PLAN_2026-11-01.md
---

# Independent Fable review — initial plan

[VERIFIED via CLI receipt, 2026-11-01 Pacific] Reviewed plan commit `704da4145`. Requested model `fable`; reported model `claude-fable-5-1`, first-party provider. Host authentication reported `claude.ai` subscription OAuth. The child inherited only basic host/path/locale variables, with no API/project credentials. Read/Grep/Glob only, safe mode, strict empty MCP configuration, no fallback model. No live probes or edits. Exit 0, success, 46 turns, 395952 ms, no permission denials. Session `301b9451-5b08-4a9f-81f7-6c99f5c1245a`. Model metadata reports list-price accounting estimates, which are not evidence of an API-credit charge; no API-key authentication was supplied or authorized.

[VERIFIED via owner message] Justin explicitly approved repository disclosure and potential subscription usage/credits, OAuth only, after the initial automatic approval rejection. That authorization does not cover API credits, implementation, production writes, or application-provider probes.

[HISTORICAL REVIEW] The following is the unedited reviewer result for the initial plan. Its claims and recommendations are the reviewer's assertions, not independently verified controller findings. The current plan records accepted/modified/declined dispositions and supersedes this initial proposal; in particular, the provider-relaxed-query explanation below was not live-tested.

## Verbatim result

**Verdict: READY WITH NAMED CHANGES.** No P0 findings. Seven P1 plan corrections are needed before implementation; none requires rework of the plan's overall shape.

Review mechanism: Read/Grep/Glob only against the worktree. No shell, no probes, no web, no credentials, no `.env` files. I did not invoke the session's advisor tool, because the owner prohibited other agents, models, and alternate review products. No tool failures occurred.

## Evidence check on the plan's own claims

Every "VERIFIED via source" row in plan section 2 holds against the code I read. Two of them deserve sharper wording:

- **Tier 7 is the mechanism for both reported pairs.** `lib/services/integrity-matching-service.js:356-362` accepts any shared surname when full normalized lengths differ by at most 3. "anthony leung" (13) vs "robert a leung" (14) and "scott bailey" (12) vs "aileen m bailey" (15) both pass. Tier 1 at line 285-288 gives "yuan he" 100 with no other evidence. Confirmed by reading, not execution.
- **The importer's silent row loss is worse than described.** `scripts/import-retraction-watch.js:182-186,265-266` reads line by line and drops any row whose field count is short, so a quoted field containing a newline silently loses that record and the next. Per-row write errors are swallowed at lines 247-253 and the script prints success at line 318. The live corpus may therefore already be missing rows. State UNKNOWN.

## P1 findings

1. **Legacy approvals regress to "Incomplete screen" if version 2 becomes the only coverage predicate.** `lib/services/workbench/integrity-service.js:378-383` checks `!sourceComplete` before `approved`, and `hasCompleteSourceCoverage` at lines 235-252 is the single predicate used for both status display and the approval gate (line 391, line 588). Requiring `sourceCoverageVersion === 2` there flips every existing approved run to `incomplete`. The plan names a precedence test at line 94 but not the design. Correction: split the predicate into "complete under the version it was recorded with" for status and "eligible for a new approval" for the gate, and give unapproved version-1 runs a reason text that says "screened under earlier rules; run a new screen" instead of the current line 380 wording. Extend `tests/unit/workbench-integrity-review-service.test.js:161-191` and `tests/integration/integrity-screening-reviews.pg.test.js` with an approved-v1 fixture.

2. **The name-conflict predicate is under-specified and would create silent false negatives for prefix given names.** The plan rejects "incompatible complete given names" before fuzzy fallbacks. Tier 6 at `integrity-matching-service.js:349-354` currently accepts prefix relationships such as "Yu He" vs "Yuan He", which are common romanization variants in the corpus. Correction: define conflict as "neither given name is an initial, a known variant, nor a prefix of the other"; prefix pairs stay as `ambiguous_name` candidates. Also add fixtures for compacted initials ("RA Leung" normalizes to first token `ra`, length 2, so Tier 3 at lines 303-316 misses it) and for single-token names, which `extractNameParts` at line 231 treats as surname only and which lose all matching once Tier 7 is removed.

3. **Strict "mixed valid/invalid equals error" will block approvals for the common relaxed-query case.** When Google finds no `pubpeer.com` pages for a rare name it pads results with off-domain pages. Under the plan's A3 table row 3 that becomes a permanent source error, so the person can never be approved, only held. Correction: filter off-domain results and record an excluded count; analyze the on-domain subset; an empty on-domain subset reports "No PubPeer results returned by the indexed search", the same as a confirmed-empty response. Reserve the source error for malformed or unsafe URLs. Disconfirming check: read the saved `rawResults` for request 1002852 and see whether off-domain results co-occurred with any on-domain ones.

4. **Fixed column widths plus a zero-rejected-rows gate can make the monthly refresh fail permanently.** `scripts/setup-database.js:118-131` has `record_id VARCHAR(50)`, `publisher VARCHAR(255)`, `subject VARCHAR(255)`, `original_paper_doi VARCHAR(100)`, `retraction_nature VARCHAR(100)`. Retraction Watch subject strings are multi-valued and routinely long. Today's importer hides width failures in the swallowed error count. Correction: the first dry run must report width violations per column; the migration should widen those columns to TEXT before the first managed publication, or the plan must define truncation as an explicit counted transform.

5. **Session advisory lock and a shared staging table are unsafe under connection pooling and concurrent runs.** The repo's precedent is transaction-scoped locking on a dedicated client: `lib/services/alert-service.js:30-36`. The IRS pattern uses a fixed staging table name (`lib/services/irs-bmf-service.js:427-430`), which collides if a manual and a scheduled run overlap. Correction: use `CREATE TEMP TABLE` for staging on the dedicated client, so it is session-scoped and auto-dropped on any failure, and take `pg_try_advisory_xact_lock` inside the publish transaction. A second concurrent run then sees the identical checksum and records an unchanged check.

6. **B3's repeatable-read snapshot restructures the engine loop and adds a dedicated client to the paid path.** `lib/services/integrity-service.js:81-227` interleaves Retraction Watch, PubPeer, and news per applicant with streamed progress events that `pages/api/integrity-screener/screen.js:100-116` forwards. Preparing all people's Retraction Watch results first in one transaction changes that stream and every unit test that mocks `sql` as a function. Correction: read the singleton metadata row before and after the per-applicant Retraction Watch queries on the existing pool. If checksum or published timestamp differs, mark the Retraction Watch source with a fixed error in strict mode. This achieves one coherent generation per saved run without a transaction near network calls.

7. **Production-only write gate contradicts the isolated-database rehearsal, and the shared cron auth bypasses dev.** `lib/utils/cron-auth.js:42-45` returns true under `NODE_ENV=development`. `pages/api/cron/drain-submissions.js:58-84` shows the strict precedent. Correction: the route uses a strict secret check plus a `VERCEL_ENV === 'production'` gate, and the refresh service exposes a function or CLI entry that takes an explicit connection string so rehearsal runs outside the route. The plan also needs to state where the dataset metadata lives in result JSON. `hasCompleteSourceCoverage` requires `results` to remain a per-person array of roster length (lines 238, 245), so embed provenance inside each person's `sources.retraction_watch` rather than at a new top level or column.

## P2 findings

- **Standalone false-clean remains.** Non-strict `serpSearch` returns `[]` on any failure (`integrity-service.js:548-551,608-615`), which `searchPubPeer` reports as "No PubPeer discussions found." (lines 415-423). The plan preserves standalone semantics, so the standalone empty-state text should say the result is unconfirmed, or the plan should state this gap explicitly.
- **Comma split makes the "Last, First" swap unreachable for corpus rows.** `processSearchResults` splits authors on `[;,]` at line 326, while the importer splits on `;` only at `import-retraction-watch.js:70`. `normalizeName`'s comma handling at `integrity-matching-service.js:209` never sees corpus authors, and suffixes such as "Smith, Jr" fragment. A1 should not claim comma-order support; add a fixture.
- **Sentinel-string concern detection.** `hasConcerns` is any summary not containing "no concerns found" (lines 433, 510). In standalone mode the fail-soft text "Unable to analyze search results" counts as a concern. Out of scope to fix, but A2's "source-level flag" label should not imply a positive finding.
- **Maintenance logging is already fail-soft and pruned.** `startRun` returns null on failure and `completeRun` swallows errors (`lib/services/maintenance-service.js:912-946`); rows are pruned after 90 days (lines 419-430). The singleton table must be the only durable provenance, and a post-commit logging failure needs an explicit alert, not just a console line.
- **The `vercel.json` cron entry is activation.** `main` auto-deploys, and Vercel crons run on production only. The plan's file table lists `vercel.json` within increment B; make it a separate later commit after the controlled first refresh.
- **Header names must be pinned.** The importer depends on `Record ID`, `Title`, `Author`, `RetractionDate`, `OriginalPaperDOI`, `RetractionNature`, `Reason`, `URLS` (`import-retraction-watch.js:274-286`). The GitLab CSV header set relative to the old Labs file is UNKNOWN; the first dry run must print a header diff.
- **Consumer fan-out gaps.** Add `tests/unit/workbench-integrity-tab.test.js:72`, `tests/e2e/workbench-integrity.spec.js:20`, and `scripts/test-retractions.js:130` to the confidence-label consumer list.

## Safe simplifications

- Reuse `csv-parse`, `pg-copy-streams`, and the dedicated `Pool` with `withVerifyFullSslmode` already used by `irs-bmf-service.js:29-37,149-155`; both packages are in `package.json`.
- Drop the stable-`id` preservation requirement. No foreign key or consumer references `retractions.id`; `record_id` appears only as `recordId` in saved JSON (`integrity-service.js:351`). The keyed merge on `record_id` already preserves the natural key.
- Keep the numeric `confidence` key in JSON unchanged and remove it only from human-readable surfaces. Readers already tolerate unknown keys.
- Consider delivering the 45-day stale-data warning as a maintenance alert first, deferring the three UI surfaces and exports.
- Next migration number is currently 092 (`lib/db/migrations-manifest.json:92` ends at 091). Re-check at implementation time.

## Recommendation and evidence table

| Recommendation | Evidence | Disconfirming check |
|---|---|---|
| Split coverage predicate for status vs new approval | `workbench/integrity-service.js:235-252,378-391,588` | Load an approved run with `sourceCoverageVersion: 1` under the new code; status must stay `approved` |
| Treat prefix given names as ambiguous, not conflicting | `integrity-matching-service.js:349-354` | Fixture "Yu He" vs "Yuan He" must remain a candidate; "Anthony" vs "Robert" must not |
| Filter off-domain PubPeer results instead of erroring | `integrity-service.js:385-423,595-597` | Saved 1002852 `rawResults` show off-domain results alongside zero on-domain results |
| Widen or explicitly truncate narrow columns before first publish | `setup-database.js:118-131`; `import-retraction-watch.js:247-253` | Dry run reports zero width violations on the real CSV |
| Temp-table staging plus xact lock | `alert-service.js:30-36`; `irs-bmf-service.js:427-430` | Two overlapping dry runs complete without a staging-name collision |
| Before/after metadata read instead of snapshot transaction | `integrity-service.js:81-227`; `screen.js:100-116` | A refresh committed mid-screen produces a Retraction Watch source error in strict mode |
| Strict secret plus production gate, with out-of-route rehearsal entry | `cron-auth.js:42-45`; `drain-submissions.js:71-84` | Route returns refusal under `VERCEL_ENV=preview` even with a valid secret |
| Embed provenance in `sources.retraction_watch` | `workbench/integrity-service.js:238,245` | `hasCompleteSourceCoverage` passes on a version-2 fixture carrying dataset metadata |

## Residual unknowns

- Live corpus row count, last import date, missing-row extent, and whether `POSTGRES_URL` is pooled through a transaction-mode pooler.
- Current Crossref GitLab CSV header set, field widths, and file size; function time budget fit (cron default is 120 seconds at `vercel.json:29-31`, overridable per route as in `refresh-irs-bmf.js:25-31`).
- Whether the off-domain PubPeer results in 1002852 co-occurred with on-domain results.
- Any scheduler outside this repository.

**Final verdict: READY WITH NAMED CHANGES.** Apply the seven P1 corrections to the plan text before implementation begins; the P2 items can be folded in during implementation.
