# J27 Read Model Build Review — 2026-11-09

Printed in full because this session has read-only filesystem access. No review file was created.

**Scope:** Steps C/D in `5e315bffe`, `256d4341c`, and `a7499a3ec`, against `97f696faf`. Observed HEAD is `a43364fbb`, whose reflog entry identifies the subsequent review-brief commit. Step F and step E page recomputation are excluded.

**Change surface:** Pure stage derivation and server-side input assembly for request resolution and the dashboard.

**Entry points:** `/api/workbench/resolve-request` and `/api/workbench/dashboard`.

**Persistence:** Reads existing Dataverse requests, suggestions and calendars; Postgres screenings, jobs and reviews. No new durable schema.

**Consumers:** Existing request/list response consumers, future step E composition, and unit tests.

**Prior findings being verified:** The brief’s five deviations and named implementation decisions.

## Findings

1. **CHANGE REQUIRED — Simulation mode redirects ordinary integrity reads to the wrong database.**

   Evidence: `lib/services/workbench/j27-integrity-jobs.js:13,180`; `lib/services/workbench/j27-integrity-simulation.js:9`; `lib/services/workbench/j27-read-model-inputs.js:123`; `pages/api/workbench/integrity/[requestId].js:43`.

   [VERIFIED via source and in-memory reproduction] The new batch reader inherits the jobs module’s deployment-wide simulation SQL selector. When simulation is enabled, ordinary requests also query the isolated simulation database, although the existing Integrity endpoint chooses its database per request. Missing ordinary screenings then become confirmed `latest: null`, suppressing their integrity task and blocker.

   The reproduction supplied a flagged ordinary screening in the application database and an empty simulation database: **application calls 0; simulation calls 1; no returned screening**.

   Residual risk: Applies to simulation-enabled Preview; production does not enable this selector.

2. **CHANGE REQUIRED — Capped suggestion results become confirmed negative evidence.**

   Evidence: `lib/dataverse/adapters/reviewer-suggestion.js:466`; `lib/services/dynamics/read-ops.js:315`; `lib/services/workbench/j27-read-model-inputs.js:117`; `lib/services/workbench/j27-read-model.js:203`.

   [VERIFIED via source and in-memory reproduction] `queryAllRecords` reports `capped`, but the new adapter discards it. If a batch reaches the 5,000-row ceiling before returning another request’s suggestions, that request receives confirmed `anySuggestion: false`. A request whose only peer-review evidence is an unselected suggestion can consequently remain in initial assessment.

   The reproduction returned `{ records: [requestA], capped: true }` for requests A/B: the adapter resolved successfully and omitted B.

   Residual risk: Requires a capped suggestion batch; current live cardinality was not measured.

3. **VERIFIED — Production memo guards exclude the new memo columns.**

   Evidence: `lib/services/workbench/j27-read-model-inputs.js:37,50`; `lib/utils/initial-assessment-rationale-readiness.js:3`; `lib/utils/meeting-roster-readiness.js:3`; `lib/services/workbench/staff-review-summary-service.js:9`.

   [VERIFIED via source] All memo gates exclude production. Sharing the summary gate for visit assessment matches its existing route guard. The change still widens request projections with the non-memo `REQUEST_FIELDS`.

   Residual risk: Actual column provisioning was not probed; deployment/target guards are not metadata checks.

4. **VERIFIED WITH LIMITS — Missing Postgres configuration is caught; latest-selection semantics are correct within the selected database.**

   Evidence: `lib/services/workbench/j27-read-model-inputs.js:89`; `lib/services/workbench/j27-integrity-jobs.js:176`; `lib/services/workbench/integrity-service.js:151,554`.

   [VERIFIED via source and local package probe] The installed Postgres client initializes lazily. Without `POSTGRES_URL`, invocation raises `missing_connection_string`; the async reader converts that throw into a rejection caught by `loadJ27Facts`. This failure therefore becomes unavailable integrity evidence, rather than escaping into a dashboard 500.

   [VERIFIED via source] Global latest ordering, job association, post-selection target filtering, null-target acceptance, and the shared flag predicate match the specified contract. Finding 1 concerns database selection before that query.

   Residual risk: No live SQL execution or complete HTTP integration test was performed.

5. **VERIFIED WITH CORRECTION — Reads are batched, but the literal dashboard query budget is inaccurate.**

   Evidence: `lib/services/workbench/dashboard-service.js:247`; `lib/dataverse/adapters/reviewer-suggestion.js:464`; plan C7 at `docs/plans/J27_READ_MODEL_AND_DISCOVERY_PLAN_2026-11-08.md:122`.

   [VERIFIED via source and in-memory reproduction] There are no per-row fact reads. However, 26 request IDs issue **two** suggestion queries; the adapter chunks at 25, and each query may paginate. “One adapter invocation per page” is accurate; “one Dataverse query per page” is not.

   Residual risk: Latency grows with chunks and pagination.

6. **ACCEPTED — The five disclosed deviations are reasonable within this build’s scope.**

   Evidence: `lib/services/workbench/j27-read-model.js:187,217,228,275`; `tests/unit/j27-read-model.test.js:23`.

   [VERIFIED via source] Task-aware basis, status-based roster presence, literal terminal-row Chairs blockers, primary-task ordering, and separate dashboard count fixtures implement the stated decisions. None warrants reversal.

   The brief’s claim that memo-disabled production makes **every** J27 row degraded is overbroad: decided rows can remain `full`, because terminal outcomes omit task inputs and the decided phase has no higher rows.

## New Issues

- **P2 — Incorrect integrity database selection.** Select the database by request identity. If both ordinary and simulated evidence remain supported, partition mixed batches and preserve independent failure handling. Add a simulation-enabled ordinary-request regression test.
- **P2 — Incomplete suggestion evidence treated as complete.** Reject capped results so the existing catch marks the fact unavailable; test a capped batch with an omitted request.
- **P3 — Read-budget documentation mismatch.** Describe the 25-ID chunking and pagination explicitly, including any mixed-database budget introduced by the integrity fix.

Additional validation limitation: `tests/unit/j27-read-model.test.js:314` makes several keys unavailable in every “one key unavailable” case. Those cases do not independently prove each key’s basis contribution.

## Recommendation Evidence

| Recommendation | Current prerequisite | Available at execution point | Evidence actually tested | Disconfirming check | Status |
|---|---|---|---|---|---|
| Select integrity store per request | Simulation and ordinary stores coexist | Yes: request IDs enter reader at `j27-integrity-jobs.js:176` | Ordinary flagged row bypassed; only simulation queried | Existing GET route selects simulation only for designated IDs | VERIFIED defect; fix untested |
| Reject capped suggestion reads | Pagination returns completeness metadata | Yes: adapter call at `reviewer-suggestion.js:466` | Capped A/B batch silently omitted B | Read helper explicitly returns `capped`; adapter has no check | VERIFIED defect; fix untested |
| Correct query-budget wording | Adapter chunks at 25 | Yes: `reviewer-suggestion.js:464` | 26 IDs produced two calls | Dashboard does not constrain batches to 25 | VERIFIED |

## Audit Coverage and Validation

- **Whole flow:** Traced authenticated routes → services → adapters/SQL → derivation → DTOs → existing client response storage. Step E rendering/recomputation remains deferred.
- **Partial success:** Independent thrown fact-read failures degrade correctly; capped-result handling fails as described above.
- **Async/stale state:** Existing request and list loaders retain generation checks on response/error writes. No new client async state was added.
- **Helper semantics:** Existing rollup filtering/count calculations remain unchanged. The new integrity reader improperly inherits the jobs helper’s database-selection behavior.
- **Durable surfaces:** No schema or route additions. No migration required for this diff.
- **Documentation:** Reviewed the brief and plan; identified budget and “every row degraded” inaccuracies. No reconciliation edits performed.
- **Symbol consumers:** New model consumers are the two server services; existing UI does not yet consume its task/phase contract.

[VERIFIED via in-memory execution] **100/100 pure-model cases passed**, using the existing test bodies with a small assertion harness—not Jest. Targeted probes reproduced both defects and the query count.

Full Jest suites, repository gates, live database probes, and browser checks were not run. Early read-only Git commands triggered denied macOS cache-file creation attempts; subsequent checks avoided that Git launcher. No files were edited or committed.

## Final Verdict

**READY WITH NAMED CHANGES**

Required changes: correct per-request integrity database selection, reject capped suggestion evidence, and reconcile the read-budget wording. Add regression coverage for both reproduced defects before treating steps C/D as complete.

Codex session ID: 01a1be81-48b7-79c3-b37b-b2637f25bc3d
Resume in Codex: codex resume 01a1be81-48b7-79c3-b37b-b2637f25bc3d

---

## Resolution (Claude, 2026-11-09 UTC, commit `6f3bd34b7`)

- Finding 1 fixed: `readLatestIntegrityStates` partitions ids by `isJ27IntegritySimulationRequest`, queries the application database for ordinary requests and the isolated store for designated ones, and marks only a failed partition's requests `unavailable` (`detail: 'read-failed'`). Regression: simulation-enabled ordinary request reads the application database; failed simulation partition leaves ordinary rows intact.
- Finding 2 fixed: `existsAnySuggestionForRequests` throws on `capped`/`hasMore`/non-array records; `loadJ27Facts` maps the rejection to `unavailable`. Regression: capped and paged batches both refuse.
- Finding 3 fixed: plan C7 states the 25-id chunking, pagination and the partition budget; resolution's single id never chunks.
- Validation limitation fixed: the basis table flips one key at a time on a full page row; `rosterMemo` is tested separately because a loaded roster supersedes it.
- The "every J27 row degraded in production" claim in the brief is narrowed per the review: decided rows stay `full`.

Verdict after resolution: READY for owner review; Jest suites for the touched surfaces and the touched-surface gates pass locally (`reviewer-suggestion-rollup` remains red on the base commit, untouched).
