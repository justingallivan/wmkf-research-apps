---
title: Baseline Test Repairs Review Receipt
domain: repository-verification
kind: audit
status: complete
summary: "Sol, root and subscription-OAuth Claude Fable approved the seven baseline test repairs; verification results are recorded in the linked execution record."
canonical: false
owner: product-engineering
related:
  - docs/plans/BASELINE_TEST_REPAIRS_EXECUTION_2026-10-03.md
  - docs/audits/MEETING_TRACKER_READ_PERFORMANCE_REVIEW_2026-10-03.md
---

# Baseline test repairs review receipt

This is local source approval for the seven pre-existing failing Jest suites
identified during the Meeting Tracker performance work. It is not deployment
approval or evidence of measured latency improvement. The earlier performance
implementation is unchanged by these repairs.

## Review chain and fingerprint

Luna (`gpt-6-luna`, `/root/baseline_fixes_luna`) performed reconnaissance,
implementation, tests and builds. Sol (`gpt-6.1-sol`,
`/root/baseline_fixes_sol`) reviewed read-only and accepted the final source with
no findings after the exact Graph-specifier negative and actual owner-job SQL
capture were added. Root independently reviewed the final patch and its
consumers, including the real projector, query predicates, rollback path and
exact cron schedule inventory. No further runtime correction was required.

[VERIFIED via Git and source review] Parent commit:
`4b95863de903ca064173581236eaac2842e51bc7`. SHA-256 of the final
`git diff --binary -- scripts tests` reviewed by Sol and root:
`56942629dda294f2289d768b0f95ea4ce96b510d69205f3d0a3bb0330ab3850c`.
Only documentation reconciliation followed this source freeze.

Contract reconciliation covered the Graph import exception and its rejecting
complement; owner-export route to store query; maintenance subtask failure to
run audit; rehearsal SQL to projector to explicit rollback; and real Next build
wrapper versus test-only config isolation. No new schema, route, production
configuration, durable application state or UI async state was introduced.
Recommendation Evidence: N/A; the named repair recommendations are implemented.

## Claude Fable method and disposition

[VERIFIED via Claude CLI result envelopes] Both read-only reviews used
`claude-fable-5-1`, returned success and reported no permission denials. The
Claude Code subprocess ran outside the Codex sandbox using the existing
Keychain-backed `claude.ai` Max subscription OAuth session. Provider API-key
and authentication-override variables were removed. No direct provider API,
Ultrareview or substitute review product was used.

The initial review approved the repairs and named three nonblocking follow-ups.
Root accepted one bounded final batch: explicit-null cleanup-field checks with
negative rollback coverage; a maintenance title matching the assertions; and
reconciliation of the cron inventory record. Fable's final source verdict was
**APPROVE** with no blocking findings. It accepted verification counts from the
provided evidence; it did not run tests or read verification logs.

The final review read Stage 1c just before Luna saved its documentation update.
Root closed that documentation-only remainder by checking the saved record:
the original 23-route/21-scheduled figure is explicitly historical; the current
inventory is 24 cron handler files, 23 exact scheduled paths and 22 scheduled routes.
The normal and recovery transcription paths are recorded alongside existing
staff-launched review-panel work. This classifies current behavior under the
user's delegated judgment; it introduces no runtime authorization policy.
The execution record was subsequently updated with the final verification
results. No third Fable round was needed for those factual documentation edits.

The verdicts below are preserved verbatim, including their point-in-time pending
verification and documentation observations. Consult the
[execution record](../plans/BASELINE_TEST_REPAIRS_EXECUTION_2026-10-03.md) for
current results. Raw local result files are ephemeral:
`/tmp/wmkf-baseline-repairs-fable-result.json` and
`/tmp/wmkf-baseline-repairs-fable-final-result.json`.

## Initial Fable review — verbatim

## Verdict: APPROVE

No blocking defects. All seven repairs are genuine fixes and none weakens the protection it touches. I read the patch, the evidence file, and the changed and enforcing sources.

**Tests you actually ran: NOT RUN.** The pass counts come from the evidence file only; I did not open the Jest logs. Lint, types, the canonical build and the 69 gates are still marked ongoing there, so this is a source approval, not a gate-complete or production claim.

## Focus items

1. **Graph internal-import exception — sound.**
   - The exemption matches on diagnostic file, original import string and resolved target together, and defaults to deny (`tests/helpers/graph-service-boundary.js:187-190`).
   - The live probe's two imports match the entries exactly (`scripts/probe-meeting-transcription-e2e-readiness.js:329-330`), and they are the only direct internal imports in the tracked runtime dirs.
   - The negatives discriminate: the extensionless `…/http` resolves to the same target but is rejected on the specifier, and the sibling file and `auth.js` are both rejected (`tests/unit/graph-service-boundary.test.js:192-211`).
   - The façade need is real: nothing in `lib/services/graph*` issues a `/permissions` call, and `getFileMetadataByPath` selects `file`, not `folder` (`lib/services/graph/files.js:277-278`).

2. **Cron reconciler mock — failure and audit behaviour preserved.**
   - The new test rejects with a coded error and asserts the code-only result, `failedSubtasks`, `ok: false` and `completeRun` with status `failed`, matching `pages/api/cron/maintenance.js:256-257` and `:308-322`.
   - The mocked return shape matches the real one (`lib/services/meeting-tracker-transcription/service.js:711-712`).
   - The real service's reconciliation logic is still exercised in `tests/unit/meeting-tracker-transcription-recovery.test.js:34`, so the mock does not remove its coverage.

3. **Evaluation-export `n/a` — pinned on the real query.**
   - The chain is route `evaluation-export.js:15` → `runtime.js:389-391` → `store.js:1925` → `store.js:134-147`.
   - The test captures that function's own SQL and requires the owner predicate and the request-less predicate to be adjacent, with params `[42, 100]` (`tests/unit/test-request-visibility-census.test.js:90-101`). A matching substring elsewhere in the file cannot satisfy it.

4. **Cron registry — exact.**
   - `drain-transcriptions` is one route key, and both `vercel.json:37-38` entries are compared as full path strings with the querystring kept (`tests/unit/test-request-scheduled-job-census.test.js:65-74`).
   - Cron expressions are not pinned for any route; that is pre-existing and out of scope.

5. **Rehearsal preflight — correct.**
   - The 20 expected keys equal the projector's 20 (`lib/services/transcription-pilot/runtime.js:46-67`).
   - The database-target, hash, marker, speaker and rollback guards are all retained (`scripts/meeting-transcription-rehearsal-fixture.js:183-187`, `:206`, `:209`, `:213`).
   - `RETURNING` now supplies all four columns the two new flags are derived from (`lib/services/transcription-pilot/model.js:71-73`).

6. **`workflow/next` mock — test-local and necessary.**
   - The real `withWorkflow` returns an async `buildConfig(phase, ctx)` function (`node_modules/@workflow/next/dist/index.js:397`), so `nextConfig.headers()` could not be asserted through it.
   - A grep of the wrapper for `headers` and `redirects` finds nothing, so it does not alter the surface under test.
   - `next.config.js:229` is unchanged and the header and redirect assertions are intact.

## Non-blocking findings

- **`tests/unit/test-request-scheduled-job-census.test.js:31-36` — `allowed` asserts an unrecorded owner decision.**
  - Scenario: the file defines `allowed` as an owner decision (`:22`), but the Stage 1c record in `docs/plans/TEST_REQUEST_FACTORY_DESIGN_2026-09-19.md:245` never mentions transcription. It still says 23 routes and 21 scheduled; there are now 24 routes and 23 schedule entries.
  - Substance looks right: the worker only claims request-bound jobs under an explicit `on` or `test:<id>` mode (`store.js:597-599`).
  - Smallest fix: the owner confirms, then one sentence and corrected counts go into the Stage 1c record.
  - Disconfirming check: grep that record for `drain-transcriptions`.

- **`scripts/meeting-transcription-rehearsal-fixture.js:204-205` — the new column guards have no test teeth.**
  - Scenario: drop the four columns from `RETURNING` (`:98-99`). The `!= null` checks then pass on `undefined`, both flags compute to false, and every test stays green because the mock row supplies the columns regardless.
  - Smallest fix: use `!== null`, and assert that `INSERT_SQL` contains the four column names in the existing ready-row SQL test.
  - Disconfirming test: a mock row with `content_purged_at: new Date()` must throw `preflight_projection_failed`.

- **`tests/unit/maintenance-cron-handler.test.js:153` — the title over-claims.**
  - Scenario: remove the `withDalContext` wrap at `maintenance.js:252-255` and the test still passes, because nothing asserts the trusted context.
  - Smallest fix: drop "through the trusted context" from the title, or assert it.

## Final bounded Fable confirmation — verbatim

## Verdict: APPROVE

No blocking findings. Two of my three earlier findings are closed in source; the third is closed only in the test file's comment, not in the Stage 1c design record. That remainder is documentation-only and falls inside the reconciliation you said may finish after review.

**Tests I ran: none.** I did not open any logs either. All pass counts, lint, types, build and the 69 gates are accepted from your message and the execution record. The final-batch Jest run was still in progress under Luna, so the eight new negative tests are approved on reading, not on an observed pass.

## Findings status

1. **Rehearsal column guards — closed.**
   - The four checks are now strict `!== null` (`scripts/meeting-transcription-rehearsal-fixture.js:204-205`), so a column missing from `RETURNING` rejects instead of passing as `undefined`.
   - The SQL test pins the four column names in `RETURNING` (`tests/unit/meeting-transcription-rehearsal-fixture-operator.test.js:21`).
   - Eight negative cases (four missing, four populated) each require `preflight_projection_failed`, a final `ROLLBACK` and no `COMMIT` (`:55-90`).
   - The four missing-column cases are the ones that discriminate the strict check.

2. **Maintenance test title — closed.**
   - The title is now "runs publication reconciliation and marks its failure" (`tests/unit/maintenance-cron-handler.test.js:153`), and the assertions match it.

3. **Stage 1c record — partially closed.**
   - The test file now carries the distinction: 24 routes, 23 scheduled paths, 22 distinct routes, with the design record's 23/21 labelled as the 2026-09-23 snapshot (`tests/unit/test-request-scheduled-job-census.test.js:20-23`).
   - Those counts match `pages/api/cron` (24 files) and `vercel.json` (23 paths) and are asserted at `:67` and `:75-76`.
   - The `drain-transcriptions` note records existing staff-launched behaviour alongside review panels (`:36-41`).
   - However, `docs/plans/TEST_REQUEST_FACTORY_DESIGN_2026-09-19.md` still contains no mention of transcription at all. The census header (`:8`) says that record "explains each decision", and for this route it does not yet.
   - I accept root's delegated classification; no runtime authorization or test-request policy changed.

## Documentation to reconcile (non-blocking)

- **Stage 1c design record:** add the one-sentence `drain-transcriptions` classification and the current counts, or the description of correction 3 overstates what was done.
- **Execution record:** `docs/plans/BASELINE_TEST_REPAIRS_EXECUTION_2026-10-03.md:41-45` still says the only post-full-run edits were the Graph and owner-job SQL discriminators, and reports 114 focused tests. It does not record the final batch (the operator script change, the eight negative tests, the title change) or the final full-Jest result.

## What I read

- **Read this round:** my prior verdict, the execution record, the operator script's guard and SQL regions, the operator test's SQL and preflight tests, the maintenance test titles and the reconciliation test, the full scheduled-job census test, the `vercel.json` cron paths, the `pages/api/cron` listing, and greps of the Stage 1c design doc.
- **Not re-read:** the other five repairs and the performance source, which I take as unchanged from the prior review.

This is local source approval only, with no production promotion or measured-latency claim. No plan file was created.
