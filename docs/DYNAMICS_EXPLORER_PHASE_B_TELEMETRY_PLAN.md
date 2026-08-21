---
title: "Dynamics Explorer Phase B — Request Telemetry Plan"
domain: dataverse
kind: plan
status: active
summary: "Implementation contract for durable per-request Explorer outcomes and exact request/round correlation across tool, usage, and feedback telemetry."
canonical: false
cataloged: 2026-08-21
owner: product-engineering
related:
  - docs/DYNAMICS_EXPLORER_BEHAVIOR_CAMPAIGN_PLAN.md
  - pages/api/dynamics-explorer/chat.js
  - pages/dynamics-explorer.js
  - lib/services/llm-client.js
  - docs/atlas/postgres-infra-tables.md
---

# Dynamics Explorer Phase B — Request Telemetry Plan

**Status:** IMPLEMENTED AND FABLE-REVIEWED IN SOURCE — migration 033 is
generated but not applied; the branch is not deployed and Production
schema/runtime evidence remains open

**Owner decision:** proceed with request-level measurement before changing Explorer behavior

**Evidence date:** 2026-08-21

## 1. Outcome

Phase B makes one Explorer chat request—not a browser session and not an
individual tool call—the unit of analysis. Once migration 033 is applied, one query can
answer how many accepted requests completed, were truncated, exhausted the
round limit, failed, or lost their client; how many model rounds they used; and
which tool and model-usage rows belong to each request.

This is telemetry only. It does not change Dataverse permissions, prompts,
tool behavior, model choice, or the answer shown to the user.

## 2. Evidence and current gap

### 2.1 Verified current contracts

| Claim | Producer | Persistence | Consumer | Evidence | Status |
|---|---|---|---|---|---|
| A request UUID already exists | `/api/dynamics-explorer/chat` after auth and body validation | Request-local only | Error SSE and server logs | `pages/api/dynamics-explorer/chat.js` | VERIFIED |
| Model rounds are counted | Chat loop increments `round` once before every model call | Response-local only | `complete` SSE | `pages/api/dynamics-explorer/chat.js` | VERIFIED |
| Tool executions are logged | Each executed or denied tool calls `logQuery` | `dynamics_query_log` | Analysis scripts and 365-day cleanup | Chat route, setup schema, maintenance service | VERIFIED |
| Model completion reasons are normalized | `LLMClient.complete/stream` | Nullable `api_usage_log.stop_reason` on completed calls | Usage analysis | `lib/services/llm-client.js`, migration 032 | VERIFIED |
| Feedback is session-correlated | Explorer page posts `sessionId` | `dynamics_feedback` | Admin feedback surface | Explorer page, feedback route/service | VERIFIED |
| Request outcomes are durable | Chat route + `dynamics-explorer-request-telemetry.js` | `dynamics_explorer_requests` | Aggregate analysis probe | Source, migration 033, focused tests | VERIFIED IN SOURCE; NOT DEPLOYED/MIGRATED |

The current `dynamics_query_log` aggregates remain a tool-call proxy, not a
request measure. A browser `session_id` can contain several requests, and one
model round may execute several tools. The committed read-only aggregate probe
on 2026-08-21 found 65 post-boundary tool rows across 13 sessions, with one
session at or above 15 tool calls. Those numbers cannot establish the number or
outcome of requests.

Rows before 2026-08-08 retain broken `record_count` semantics. Phase B does not
rewrite them, and any tool-result trend must keep that boundary explicit.

### 2.2 Contract-reconcile scope

- **Entry points:** Explorer page, chat route, feedback route, maintenance cron,
  and the committed analysis scripts.
- **Persistence:** a new request table plus nullable correlations on the query,
  usage, and feedback tables.
- **Consumers:** monthly outcome analysis, per-request failure diagnosis,
  feedback review, retention cleanup, and future eval-harness selection.
- **Excluded:** prompt/LEXICON changes, Dataverse schema or writes, dashboards,
  alerting, eval execution, and retroactive reconstruction of old requests.

## 3. Design decision

### 3.1 Preserve each table's unit of meaning

Create `dynamics_explorer_requests` for exactly one mutable lifecycle row per
accepted chat request. Do **not** write a synthetic “terminal” row into
`dynamics_query_log`:

- `dynamics_query_log` remains one row per tool execution or denial;
- `api_usage_log` remains one row per model attempt;
- `dynamics_feedback` remains one row per user feedback event; and
- `dynamics_explorer_requests` becomes one row per chat request.

This avoids teaching every existing query-log consumer to exclude a sentinel
row whose `query_type`, `record_count`, and timing would have different
semantics.

### 3.2 Schema

At implementation time, allocate the next migration number (currently expected
to be 033; re-check the manifest first), add it to
`lib/db/migrations-manifest.json`, and make `scripts/setup-database.js`
byte-for-contract equivalent for a fresh install.

New table:

```sql
CREATE TABLE dynamics_explorer_requests (
  request_id UUID PRIMARY KEY,
  user_profile_id INTEGER REFERENCES user_profiles(id) ON DELETE SET NULL,
  session_id VARCHAR(100),
  outcome VARCHAR(24) NOT NULL DEFAULT 'running'
    CHECK (outcome IN (
      'running', 'completed', 'truncated', 'max_rounds',
      'refused', 'error', 'client_disconnected'
    )),
  rounds_used SMALLINT NOT NULL DEFAULT 0 CHECK (rounds_used >= 0),
  model VARCHAR(100),
  stop_reason VARCHAR(50),
  error_stage VARCHAR(50),
  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP,
  CHECK (
    (outcome = 'running' AND completed_at IS NULL)
    OR (outcome <> 'running' AND completed_at IS NOT NULL)
  )
);
```

Add nullable correlation columns:

```sql
ALTER TABLE dynamics_query_log
  ADD COLUMN request_id UUID,
  ADD COLUMN request_round SMALLINT;

ALTER TABLE api_usage_log
  ADD COLUMN request_id UUID,
  ADD COLUMN request_round SMALLINT;

ALTER TABLE dynamics_feedback
  ADD COLUMN request_id UUID REFERENCES dynamics_explorer_requests(request_id)
    ON DELETE SET NULL;
```

`session_id` remains nullable because the current authenticated chat contract
accepts a request without one. `request_round` is one-based and denotes the
model call that produced the tool call or usage row. Several tool rows may
validly share the same request and round. Historical and non-Explorer rows
remain `NULL`.

Do not add foreign keys from high-volume query or usage logs to the request
table. Their writes are best-effort, their retention windows differ, and
request telemetry must not turn a missing parent row into a logging failure.

Indexes:

- request rows by `started_at DESC`;
- request rows by `(outcome, started_at DESC)`;
- request rows by `(user_profile_id, started_at DESC)`;
- request rows by `session_id`;
- partial `(request_id, request_round)` indexes on query and usage logs where
  `request_id IS NOT NULL`; and
- a partial feedback `request_id` index where non-null.

No prompt, answer text, tool output, query text, or error message is added to
the request table. Existing query parameters keep their current privacy and
retention contract.

## 4. Lifecycle contract

### 4.1 Start

After app authorization and basic request-body validation succeed, the chat
route:

1. mints the existing UUID;
2. awaits a best-effort insert of the `running` request row; and
3. continues even if telemetry persistence fails.

Starting before role, restriction, taxonomy, or model work means failures in
those stages are measurable. Method, authentication, and invalid-body rejects
are not accepted Explorer requests and do not get request rows. A missing or
empty optional `sessionId` is normalized to null; telemetry does not introduce
a new client validation failure.

### 4.2 Per-round propagation

The existing counter remains authoritative: increment once immediately before
each `callClaude` invocation and pass `{ requestId, requestRound }` through that
call.

- Extend `LLMClient`'s optional logging context with `requestId` and
  `requestRound`. `_logSuccess` and `_logFailure` pass them to `logUsage`.
  Other callers omit them and preserve current behavior.
- Pass the same pair to every `logQuery` generated by that model response,
  including denied and failed tool executions.
- Return `stopReason` and `refused` from the Explorer's `callClaude` wrapper;
  the shared client already normalizes both.

The usage and query writes remain fire-and-forget. The request lifecycle write
is awaited because it is the durable aggregate; all three paths remain
fail-soft toward the user.

### 4.3 Terminal classification

Classify exactly once from the route's actual terminal branch:

| Route branch | Outcome | `rounds_used` | Stop reason |
|---|---|---:|---|
| No tool blocks, ordinary final answer | `completed` | Current round | Final normalized value |
| No tool blocks, normalized `max_tokens` | `truncated` | Current round | `max_tokens` |
| No tool blocks, normalized refusal | `refused` | Current round | `refusal` |
| Loop reaches `MAX_TOOL_ROUNDS` | `max_rounds` | Limit reached | Last model stop reason, normally `tool_use` |
| Unhandled route/model/tool-preflight exception | `error` | Completed model calls | Last known value or null |
| Response closes before a terminal branch is committed | `client_disconnected` | Completed model calls | Last known value or null |

Recoverable tool errors that are returned to the model do not by themselves
make the request an `error`; their query-log rows remain available for a joined
tool-error count. Unknown future stop reasons are preserved in `stop_reason`
and use `completed` when the response has no tool blocks, rather than being
silently remapped to an invented failure class.

`error_stage` uses a small server-owned vocabulary such as `context`, `model`,
`tool`, `response`, and `telemetry`. Do not persist exception text. It is null
for non-error outcomes.

The outer exception path must check `disconnectObserved` before classifying an
abort rejection. Once a request/response abort or close has set that flag, the
catch path finalizes the same `client_disconnected` outcome (or no-ops if the
event handler already won) and must not emit or persist `error`. This makes the
compare-and-set race idempotent in both identity and value.

### 4.4 Idempotent finalization

Implement one request-specific helper with two operations, `startRequest` and
`finalizeRequest`. Finalization must be an atomic compare-and-set:

```sql
UPDATE dynamics_explorer_requests
SET outcome = $outcome,
    rounds_used = $rounds,
    model = $model,
    stop_reason = $stopReason,
    error_stage = $errorStage,
    completed_at = NOW()
WHERE request_id = $requestId AND outcome = 'running'
RETURNING request_id;
```

If the start insert failed or disappeared, the helper may attempt one terminal
`INSERT ... ON CONFLICT DO NOTHING` so a recovered database can still record
the outcome. If another terminal path won, the loser does nothing. This is
at-most-one terminal state, not an event ledger.

Before writing a terminal SSE event, set an in-memory `terminalIntent` and then
await the fail-soft finalizer. The response `close` handler checks that intent.
This ordering prevents the client page's immediate `reader.cancel()` from
overwriting a normal completion as `client_disconnected`.

### 4.5 Disconnect and process-loss boundary

Attach request `aborted` and response `close` handlers and create an
`AbortController` for the request. Either event without terminal intent:

1. sets `disconnectObserved` before any abort can reject;
2. aborts the in-flight `LLMClient.stream` call through its existing signal
   contract;
3. prevents another model round from starting; and
4. best-effort finalizes `client_disconnected`.

Already-running Dataverse tool calls are not promised to cancel. Their results
must not start another model round after the abort is observed.

A function crash, forced termination, or database outage can leave `running`
behind. The initial implementation does not add a background state mutation.
Analysis classifies a `running` row older than ten minutes as derived
`abandoned`; live `running` rows stay separate. This boundary must be named in
reports rather than pretending disconnect detection is perfect.

## 5. Client and feedback correlation

Add `requestId` to successful `complete` SSE payloads (error payloads already
carry it). Store it on the assistant message beside `rounds`. When the user
submits feedback for that response, post the request ID with the existing
session and conversation context.

The server never trusts that client-supplied correlation. When both session
values are non-null, look up a request row matching all three values:

- `request_id = supplied request ID`;
- `user_profile_id = authenticated profile`; and
- `session_id = supplied session ID`.

Save the verified ID or `NULL`. If either the request row or feedback payload
lacks a session ID, leave the correlation null rather than weakening the match
to user-plus-UUID. A missing telemetry row, an old client, or an
invalid/mismatched ID must not prevent feedback from being saved. The feedback
admin surface may show the correlation and request outcome, but building a new
analytics dashboard is out of scope.

## 6. Retention and analysis

Delete request rows after 365 days, aligned with `dynamics_query_log`. Keep the
existing 90-day `api_usage_log` policy. Because feedback uses `ON DELETE SET
NULL`, retained feedback remains valid after request cleanup. Extend the
maintenance result with a separate request-row deletion count and cover its
failure isolation.

Update `scripts/probe-dynexp-query-log-analysis.mjs` (or a narrowly named
successor) so the post-Phase-B section uses the request table rather than
session/tool-call heuristics. Preserve the earlier query-log analysis as a
clearly dated historical section.

Acceptance query shape:

```sql
WITH classified AS (
  SELECT
    CASE
      WHEN outcome = 'running'
       AND started_at < NOW() - INTERVAL '10 minutes' THEN 'abandoned'
      ELSE outcome
    END AS request_outcome,
    rounds_used,
    EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000 AS duration_ms
  FROM dynamics_explorer_requests
  WHERE started_at >= date_trunc('month', NOW())
)
SELECT request_outcome,
       COUNT(*) AS requests,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY rounds_used) AS p50_rounds,
       percentile_cont(0.9) WITHIN GROUP (ORDER BY rounds_used) AS p90_rounds
FROM classified
GROUP BY request_outcome
ORDER BY request_outcome;
```

Additional joined checks must be possible without heuristics:

- tool calls and tool failures per request/round from `dynamics_query_log`;
- tokens, latency, model, and provider stop reason per request/round from
  `api_usage_log`; and
- user feedback and terminal outcome from `dynamics_feedback` to the request
  table.

## 7. Failure invariants

| Invariant | Enforcement and proof |
|---|---|
| Telemetry failure never withholds a valid user answer | Start/final writes catch and log their own failure; route tests inject DB rejection |
| A request has at most one durable terminal classification | Primary key plus `outcome = 'running'` compare-and-set; competing-finalizer test |
| Normal completion is not reclassified by `res.close` | Set terminal intent before finalization/SSE; close-race test |
| One round may own several tool rows | Propagate, do not uniqueness-constrain, `(request_id, request_round)` |
| Old and non-Explorer rows remain valid | All correlation columns nullable; migration parity test |
| Feedback cannot be attached across users or sessions | Authenticated three-column lookup; negative route tests |
| Missing session or telemetry does not discard or misattach feedback | Missing/invalid correlation becomes null; feedback still returns success |
| Request telemetry contains no user content | Fixed schema and insert-shape tests; no free-text error persistence |
| Query-log historical analysis remains bounded | 2026-08-08 warning retained in script and docs |
| Stale `running` is not reported as an active request forever | Ten-minute derived `abandoned` classification in analysis |

## 8. Implementation sequence

1. Re-probe the migration manifest and current schemas; add the existing-DB
   migration, manifest entry, fresh-install parity, indexes, and Atlas update.
2. Add the request telemetry helper and its idempotent start/finalize tests.
3. Propagate request/round through `logQuery`, `LLMClient`, and `logUsage`;
   preserve null behavior for every other app.
4. Wire chat start, terminal classification, abort/close behavior, and complete
   SSE request ID.
5. Add authenticated feedback correlation and the optional admin read field.
6. Extend maintenance cleanup and the committed aggregate probe.
7. Reconcile the campaign plan, Postgres Atlas, API security matrix, service
   catalogue if a service is added, memory/session handoff, and relevant wiki.
8. Deploy deliberately, apply the migration with
   `node scripts/apply-migrations.js`, read back columns/indexes/tracker state,
   then run one harmless signed-in request and verify the request, usage, and
   tool rows join by the same ID. Do not manufacture feedback in Production.

## 9. Verification gates

### Focused tests

- request helper: start, every terminal outcome, terminal upsert after missing
  start, and competing finalizers;
- chat route: normal, truncated, refused, max-round, preflight error, model
  error, disconnect during an in-flight model call, disconnect before terminal
  intent, and close after terminal intent;
- multi-tool round: several query rows share one request/round;
- `LLMClient`/usage logger: success and failure correlation, plus unchanged
  nulls for other callers;
- client terminal-state parsing: request ID stored for completion and error;
- feedback route/service: owned match, wrong user, wrong session, unknown ID,
  old client, and telemetry lookup failure;
- maintenance: request retention and failure isolation; and
- migration/fresh-install shape and index parity.

### Required gates

Run each gate before its self-test, sequentially, using the current registry in
`docs/CI_GATES_REFERENCE.md`:

- focused Jest suites, then the expanded Explorer/LLM/feedback/maintenance
  suites;
- TypeScript check;
- migration and migration-coverage gates;
- Postgres Atlas and data-access gates;
- API-route security and route-boundary gates;
- model/LLM gates;
- docs, fact, wiki, and service-catalogue gates as implicated; and
- a production build.

Green tests prove only the branches they exercise. Promotion additionally
requires migration readback and the signed-in read-only join smoke described
above.

## 10. Acceptance and non-goals

Phase B is complete only when:

1. every authenticated, body-valid Explorer request attempts one lifecycle row;
2. normal organic requests resolve to a durable terminal outcome or a visibly
   derived `abandoned` state;
3. request, round, tool, and usage correlation is exact for new rows; feedback
   correlation is exact when both session IDs are present and otherwise
   deliberately null;
4. the monthly distribution query runs without session/tool-count heuristics;
5. historical null rows and the 2026-08-08 record-count boundary remain honest;
6. cleanup, Atlas, route matrix, and current campaign guidance agree; and
7. a Production smoke proves one joined request without a Dataverse write.

Not included: retroactive backfill, a dashboard, alerts/SLOs, prompt changes,
behavior tuning, eval execution, Dataverse schema changes, or a guarantee that
process death can always be distinguished from a lost client.

## 11. Sweep report for this plan

- **Mode:** B — domain truth audit, limited to the Phase B telemetry contract.
- **Authoritative evidence:** chat/page/feedback/LLM/usage/maintenance source,
  Postgres setup and migrations, Atlas, committed aggregate probe, and current
  tests.
- **Claims:** request UUID, round counting, terminal classification, lifecycle
  persistence, nullable cross-table correlation, verified feedback linkage,
  and retention are VERIFIED IN SOURCE; Production migration/deployment and
  joined-row evidence remain open.
- **Durable restatements in scope:** this plan, the parent campaign plan,
  Explorer campaign memory, and session handoff.
- **Historical surfaces left unchanged:** dated pre/post Aug 8 aggregate
  evidence and the March 2026 security review snapshot.
- **Durable reconciliation:** both Atlas surfaces, the API matrix, service
  catalog, parent campaign plan, campaign memory, and session handoff are
  updated in this implementation commit with the source-versus-Production
  boundary explicit.
- **Remaining unknown:** exact disconnect coverage under platform process loss;
  it is deliberately represented as stale `running` → derived `abandoned`.

## 12. Adversarial review record

Claude Fable reviewed the full plan under a P0/P1-only brief on 2026-08-21 and
returned `CHANGES REQUIRED` with two material findings:

1. an abort rejection could race the disconnect finalizer and persist an
   ordinary disconnect as `error`; and
2. `session_id NOT NULL` contradicted the current accepted request contract,
   which permits a missing session ID.

Sections 3–5, 7, 9, and 10 now require a disconnect flag set before abort, the
same `client_disconnected` classification from both competing paths, a nullable
session ID, and fail-closed feedback correlation when session evidence is
missing. A delta-only Fable confirmation returned `READY`: both P1s are
materially resolved. The review raised no other P0/P1 concern.

`[ADVERSARIAL-REVIEW-RECEIPT: docs/DYNAMICS_EXPLORER_PHASE_B_TELEMETRY_PLAN.md]`

The review transcript is retained in
`docs/audits/dynamics-explorer-phase-b-fable-review-2026-08-21.md`.

### Implementation review

After implementation and local verification, OAuth-authenticated Claude Fable
performed one read-only P0/P1-only review of the full diff from base
`1b552cae`. It traced caller → persistence → consumer across the route,
lifecycle service, migration/fresh setup, query/usage correlation, feedback
verification, cleanup, analysis, documentation, and tests. Verdict: **READY**;
no P0/P1 defect and no required change. Per owner direction, no second loop was
opened for minor or speculative concerns.

The implementation review record is retained in
`docs/audits/dynamics-explorer-phase-b-fable-implementation-review-2026-08-21.md`.

`[ADVERSARIAL-REVIEW-RECEIPT: docs/DYNAMICS_EXPLORER_PHASE_B_TELEMETRY_PLAN.md]`
