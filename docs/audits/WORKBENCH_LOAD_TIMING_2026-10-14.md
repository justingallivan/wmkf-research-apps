# Workbench Staff Deliberations load timing

October 14, 2026. Branch: `codex/workbench-load-timing`, based on `78a557958`. Built and locally verified; production promotion pending.

## Evidence

[VERIFIED via signed-in Chrome Network panel] Two normal reloads of the D26 Staff Deliberations page measured dashboard 1.48/1.25 seconds, followed by deliberations 3.39/3.60 seconds. First deliberations request started 2.63 seconds after navigation, spent 3.38 seconds waiting for server response, and 1.65 ms downloading. This is server-response latency evidence, not attribution of every millisecond to Dataverse. The ranking reduced-motion/drop and save queue paths are not involved.

[VERIFIED via source] WorkbenchShell resolves cycle metadata before giving StaffDeliberationsPanel its cycle/program. The API guards the reviewers app, establishes DAL context and resolves the writeup viewer. The list reads the complete request cohort, document facts, visits, schedules, materials, distribution receipts and preparation state before rendering. Core requests/documents/visits retain capped-read errors; optional data retains its existing explicit availability fallbacks. No client loading dependency changed in this patch.

[VERIFIED via read-only live-data probe] `scripts/probe-workbench-load-timing.js` bundles the real services for Node CommonJS interop. It requires explicit production-read opt-in, refuses production deployment mode, enables the write-blocking interlock, resolves the staff identity and program, then runs the dashboard and list twice. Local service timings exclude route auth, browser, network-to-Vercel and Vercel cold-start costs. The local environment is not asserted identical to production; test-request classification was explicitly aligned using `TEST_REQUEST_ISOLATION=on`. The initial unaligned probe was excluded from this comparison.

| Local service | Baseline, ms | Final, ms |
|---|---|---|
| Dashboard | 394, 400 | 512, 308 |
| Staff Deliberations | 1002, 1056 | 731, 747 |

Baseline was the original sequential/full-projection service plus the same measurement wrappers, before the functional changes. Final mean is approximately 28% lower; two samples per condition are not a benchmark or production guarantee. A preliminary candidate measured 741/480 ms, demonstrating timing variability. Both final responses match both baseline responses after omitting only `serverNowIso`: SHA-256 `84624481f821b7aca08228f862c01c4fc994c7ca0c295d3bb9b0d7e9ed281260`. Each has 13 rows: 7 ordinary and 6 test. No proposal text or credentials are retained in the [measurement receipt](WORKBENCH_LOAD_TIMING_2026-10-14.json).

Reproduce candidate (authorized local staff identity/profile required):

```sh
TEST_REQUEST_ISOLATION=on DATAVERSE_ALLOW_PROD_READS=yes node scripts/probe-workbench-load-timing.js --email=<staff-email> --profile-id=<id> --cycle=D26
```

## Change and invariants

- The adapter’s opt-in list-facts projection removes document prose, large input snapshots and cleanup payloads. It intersects with the existing schema-gated select; all other adapter callers retain the full projection. The consumer still receives provenance, milestones, correction and group/leadership fields.
- Independent document, visit, schedule and materials reads overlap after the authorized complete request cohort is known. All six promises are joined. Document failures/caps take precedence over auxiliary failures; no successful partial list is returned. On failure, reporting now waits for the slowest read to settle. There are no new write paths or data stores.
- Request-local AsyncLocalStorage measurement returns fixed step labels/durations via `Server-Timing` on successful dashboard and deliberations responses. It does not collect payloads, IDs or credentials. `service_total` excludes route auth/viewer work; nested program timing is not additive with its child timings. No `Timing-Allow-Origin` is added.

Contract trace: WorkbenchShell → StaffDeliberationsPanel → authenticated existing GET route → list service → existing Dataverse adapters/Postgres readers → unchanged projected body → existing list UI. Durable schema, new routes, writes/partial-write success, enum changes and client stale-state changes: N/A. Existing generation guard remains untouched. Fan-out changes only reads and can increase simultaneous dependency calls; observe throttling during rollout. No caching/staleness trade-off introduced.

## Verification and review

- 82 focused tests pass across seven suites, including full-versus-trimmed adapter response parity for Draft/Review/Final, hidden draft files, correction and leadership checkpoints, schema gates, snapshot exclusion, documentless rows, concurrent timing isolation, complete-read waiting and double failures.
- Changed-file ESLint, type checking and production build pass. The initial dependency symlink and missing installed package were resolved by installing lockfile-exact dependencies in the isolated worktree; no dependency manifest change.
- API route, Atlas, status parity, GUID boundary, Dataverse access layer and route/service boundary gates and their sequential self-tests pass. Existing external-materials guard-recognition warnings are unrelated.
- [Two Claude Opus OAuth reviews](WORKBENCH_LOAD_TIMING_OPUS_2026-10-14.md): no blocking findings; error-precedence recommendation addressed and tested.

## Release and scoped reconciliation

No production code/configuration or records changed during this work. A draft PR is the review boundary; campaign Tier 2 promotion requires the owner’s explicit merge/push decision. Before promotion, record current production deployment for rollback; after promotion inspect Server-Timing on signed-in D26 reloads and confirm counts/statuses. Rollback is the prior code deployment, with no schema/data reversal.

Scoped sweep: searched existing Workbench responsiveness plans and audit names for staff-deliberations/cycle-list/Server-Timing claims. This is an additional server-read optimization; historical September client migration evidence is not rewritten. No new data ownership/schema contract requires Atlas changes. This dated receipt owns the new performance claim; production improvement remains unverified.
