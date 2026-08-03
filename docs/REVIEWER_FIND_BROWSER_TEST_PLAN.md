---
title: Reviewer Find Browser Test and Rehearsal Plan
domain: reviewer-workbench
kind: plan
status: active
summary: "Layered, side-effect-controlled browser verification for Reviewer Find warm revisits and targeted refreshes."
canonical: false
cataloged: 2026-08-02
owner: product-engineering
related:
  - docs/REVIEWER_FIND_PERFORMANCE_PLAN.md
  - docs/REVIEWER_WARM_STAGE_PRODUCER_SPEC.md
  - docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md
  - docs/REVIEWER_E2E_REHEARSAL_RUNBOOK.md
---

# Reviewer Find Browser Test and Rehearsal Plan

> **Status (2026-08-02):** [PARTIALLY IMPLEMENTED] Layers A and B, the scoped
> warm-effect observation ledger, and the authenticated read-only Layer C runner
> are built. The deterministic suite passes. A normal staff session and the
> complete cached/reconciled observation ledger passed against exact Preview
> deployment `dpl_8i1S7ocMLFuWF2E7neWrwQgLojxU` at commit `5b359733`, after
> temporarily registering the stable branch-alias callback. The Layer C
> preflight then failed closed because the former fixture, request `1002788`,
> had a roster bound to a different proposal; the browser scenario did not run.
> On 2026-08-02 the owner designated request `1002914` as the Reviewer Find
> no-send fixture. A production read-only audit found a current fallback proposal,
> five unengaged applicant recommendations/slots, and no Postgres Find roster.
> It therefore needs one explicit no-send cold search before Layer C can exercise
> warm revisits. The temporary
> Azure callback, branch-only production-read override, and local auth state
> were removed after the test. Layer D sandbox fixtures and mutation rehearsal
> remain planned and unbuilt.
>
> **Primary objective:** prove that returning to a previously searched request
> renders persisted Reviewer Find candidates promptly, preserves request
> isolation, performs only bounded warm revalidation, and never silently turns
> a revisit into proposal download, provider work, a full applicant refresh, or
> a durable write.

## 1. Decision summary

Use four complementary verification layers. No one layer is treated as proof of
the others.

| Layer | Runs against | Auth | External side effects | What it proves |
|---|---|---|---|---|
| A. Deterministic browser contract | Real built Next.js pages in a credential-free isolated test root with Playwright route fixtures | Synthetic signed staff session | None, enforced before server startup | Rendering, request switching, disabled/enabled actions, stale-state UX, and client request discipline |
| B. Server contract companion | Real route/service code with dependency spies or controlled adapters | Existing route test auth | None | Exact provider/download/read/write call counts, closed request bodies, target binding, CAS, and promotion gates |
| C. Authenticated live read-only smoke | Deployed app and its configured live reads | Normal Microsoft staff sign-in saved locally | Reads only | Deployment/auth/routing integration and the real cached-before-reconciled experience |
| D. Sandbox mutation rehearsal | Preview/local app pointed at a verified Dataverse sandbox and non-production companion stores | Normal staff sign-in | Allowlisted test-record writes; email disabled | Targeted refresh, partial persistence, lease recovery, reset, and post-run reconciliation across real integrations |

The deterministic suite is the required merge gate. The live read-only smoke is
the required enablement evidence for the current branch. The sandbox mutation
suite becomes an enablement gate only after sandbox parity exists. Production
mutation is not part of this plan.

## 2. Verified constraints and evidence

- [VERIFIED 2026-08-02 via `playwright.config.js`,
  `tests/e2e/program-director-invite.spec.js`, and `tests/e2e/README.md`] The
  repository already runs real Next.js pages in Playwright against a production
  Webpack build, installs a synthetic NextAuth staff session, and route-mocks
  Workbench/external-review APIs. [VERIFIED 2026-08-02 via `instrumentation.js`
  and `lib/utils/migration-drift.js`] Browser interception does **not** by itself
  make a local run side-effect-free: `next start` loads `.env.local`, and server
  startup can query Postgres, create `system_alerts`, and email operations before
  the first browser request. Layer A therefore requires a credential-free
  isolated test root and environment before the server starts. The current CI
  run has no live credentials, but that incidental property is not the new gate.
- [VERIFIED 2026-08-02 via
  `docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md`] Browser route mocks are
  the side-effect-free default. A local or Preview deployment that points at
  production Dataverse is production-capable for reads and is denied writes by
  the Dataverse target/write interlock; Dataverse protection alone does not
  control Postgres, Graph, Blob, email, provider, or job side effects.
- [VERIFIED 2026-07-26 via the campaign release strategy's recorded
  `scripts/probe-sandbox-reviewer-schema.mjs` result] The reachable Dataverse
  sandbox did not contain the custom Reviewer entities or required policy rows.
  Sandbox write rehearsal therefore depends on a parity gate; it is not an
  immediately available test environment.
- [VERIFIED 2026-08-02 via owner decision plus production read-only audit]
  Request `1002914` is the Reviewer Find no-send fixture: a D26 proposal that is
  not proceeding, temporarily marked Advancing for this test, with five
  applicant recommendations and no invitation/review lifecycle activity.
  Request `1002788` retains other historical smoke duties but is no longer this
  plan's Reviewer Find fixture. Request `1002794` is a real request and is not
  used by this browser plan.
- [OBSERVED 2026-08-02 during the attempted authenticated local exercise; to be
  made reproducible by the planned preflight] A normal
  signed-in session reached the locally served production build, but the local
  Dataverse target did not resolve request `1002788`; the dashboard consequently
  could not load that request. Authentication success does not establish target
  or fixture readiness.
- [VERIFIED 2026-08-02 via `scripts/save-playwright-auth-state.mjs`] A normal
  Microsoft sign-in can be saved to a gitignored Playwright storage-state file.
  It is a local, expiring credential and cannot be assumed to remain valid for
  unattended CI or a later session.
- [VERIFIED via `docs/REVIEWER_FIND_PERFORMANCE_PLAN.md`] The hard warm-revisit
  contracts are zero expensive provider/proposal-byte calls on an unchanged
  revisit, zero full-batch applicant reenrichment caused by one stale stage,
  zero stale overwrite, and zero unsafe actions while authority is cached or
  stale. Absolute warm latency SLOs are not yet supported by a live baseline.
- [VERIFIED 2026-08-02 via current source and Opus review] Warm roster telemetry
  currently emits request-local timing fields to `console.info` without a
  correlation ID or effect counts. Existing `api_usage_log` covers LLM usage,
  while Graph, proposal download, publication/contact providers, writes, email,
  and jobs do not provide the correlated named-seam silence proof required by Layer C.
  A scoped observation slice is therefore a prerequisite to—not evidence from—
  the live smoke.

## 3. Contract-reconcile map

### Change surface and entry points

The browser plan covers the staff Workbench request page, `Reviewers -> Find`,
and the APIs used by cached roster bootstrap, reconciliation, proposal binding,
applicant-recommended reviewer display, targeted stage refresh, and promotion.

### Persistence and external dependencies

- Postgres `reviewer_find_roster` is the warm display source.
- Dataverse supplies current request, reviewer suggestion, identity, and
  engagement authority.
- Graph/SharePoint supplies canonical proposal metadata and, only for explicit
  cold or proposal-dependent work, proposal bytes.
- Claude and publication/contact providers are explicit cold or targeted-stage
  dependencies, never warm-render dependencies.
- Blob, email, and background jobs are not required to prove Reviewer Find warm
  behavior.

### Consumers and failure visibility

The consumers are candidate grouping/cards, evidence dates, selection and
promotion controls, request navigation, Invite/Track downstream state, telemetry,
and staff operational messages. Partial or failed authority reads must leave
cached cards visible but read-only, with a targeted retry; they must not erase
prior evidence or initiate a cold search.

### Load-bearing invariants

| Invariant | Browser proof | Server proof | Live proof |
|---|---|---|---|
| Cached candidates render before delayed reconciliation | Layer A orders mocked responses and observes the DOM | Layer B verifies cached route is Postgres-only | Layer C records cached and reconciled milestones |
| Unchanged revisit performs no expensive work | Layer A rejects unexpected browser requests | Layer B spies on proposal/provider services and asserts exactly zero calls | Layer C correlates the run with the bounded ledger at its named sanctioned seams |
| Cached/stale authority cannot promote | Layer A exercises visible controls | Layer B exercises both promotion services | Layer C observes controls only; it does not click a mutation |
| One stale stage refreshes only one candidate/stage | Layer A asserts the single target-only POST | Layer B verifies server-derived dependencies and per-target persistence | Layer D performs the allowlisted real refresh |
| A -> B -> A navigation cannot leak or overwrite state | Layer A delays A responses across both switches | Layer B tests stale CAS/generation outcomes | Layer C proves dashboard -> `1002914` -> dashboard -> `1002914`; cross-request live proof waits for a second authorized fixture |
| Production smoke causes no writes | Layer C aborts browser non-GET requests | Layer B proves warm route semantics and observation-ledger negative controls | Layer C uses the implemented scoped observation ledger to account for named server-internal seams |

A route-mocked browser cannot prove that server code avoided an internal provider
or Dataverse call because the request never reached that server code. Conversely,
a route/service unit test cannot prove React committed cached cards before a slow
reconciliation response. The paired A+B scenario is therefore the minimum proof.

## 4. Layer A — deterministic Reviewer Find browser suite

### 4.1 Harness

Extend the existing Playwright harness rather than create another browser stack,
but do not reuse its current local server-launch semantics until they are made
side-effect safe:

1. Add a dedicated `reviewer-find-warm.spec.js` and helper under `tests/e2e/`.
2. Add a separate `playwright.reviewer-find.config.js`, not another project in
   the shared config. It uses its own port, `reuseExistingServer: false`, a
   Reviewer Find-only `testMatch`, its own npm script and CI step, and builds and
   starts from a
   temporary root populated from tracked repository files, excluding `.env*`,
   `.auth`, reports, results, and other untracked state. Reuse the installed
   dependencies with Webpack, but inherit only an explicit environment allowlist
   containing throwaway NextAuth values, port, PATH/runtime necessities, and no
   service credentials.
3. Before `next build` and again before `next start`, fail if the isolated child
   environment contains a Dataverse/Postgres/Graph/Blob/provider/email/job
   credential or target. Add a self-test that presents sentinel credentials to
   the parent and proves they are absent from the child. Do not add a general
   runtime bypass flag that production could use to skip safety controls.
4. Install the same synthetic signed staff session pattern used by the Program
   Director invitation spec.
5. Register a same-host API catch-all **before** the specific mocks because
   Playwright evaluates the most recently registered matching route first. Exempt
   document navigation, `/_next/*`, and static assets; fail every unrecognized
   `/api/*` call. Specific route mocks are registered after the catch-all.
6. Maintain a request ledger containing method, normalized path, request ID,
   candidate key, stage, and response milestone. It contains no names, emails,
   proposal text, or provider bodies.
7. Fail any request to an external host and any unexpected mutating method.

### 4.2 Scenario fixtures

Use opaque synthetic GUIDs and clearly fictitious people. Fixtures are scenario
data, not a mirror of production records.

| Scenario | Required state |
|---|---|
| `warm_current` | Persisted roster with current applicant and discovered candidates; reconciliation is delayed; no stale stages |
| `warm_authority_error` | Cached roster succeeds; Dataverse reconciliation fails; cards remain visible/read-only with a retry message |
| `one_target_stale` | One candidate has exactly one stale inexpensive stage; other candidates remain current |
| `explicit_expensive_refresh` | One proposal/provider-dependent stage is stale and offers an explicit action; mount does not invoke it |
| `request_switch` | Requests A and B have different names, IDs, candidate keys, generations, and delayed responses |
| `no_history` | Empty roster; idle `Prepare search` state; no proposal/applicant/provider work before a click |
| `same_name_distinct_anchors` | Two candidates share a display name but have different authoritative keys and remain separate |
| `unknown_complements` | Unknown authority, stage, result, and failure codes remain read-only and visibly unclassified |
| `snapshot_changed` | First reconciled response returns `409 roster_snapshot_changed`; the browser restarts cached -> reconciled once and discards the superseded generation; a second conflict stops with the visible guarded error and never loops a third time |

### 4.3 Required browser assertions

1. Cached cards become visible while the mocked reconciliation request is still
   unresolved.
2. Cached cards are display-only; selection, add, save, and promotion actions
   remain disabled until current authority permits the specific action.
3. Reconciliation changes only the candidate/state named by the authoritative
   response and never clears unrelated cards.
4. A reconciliation failure preserves cached evidence and exposes only an
   authority retry; it creates no proposal or provider request.
5. An unchanged revisit calls neither proposal load/download nor applicant
   enrichment, Claude, publication/COI discovery, contact discovery, Blob, email,
   or job APIs.
6. One stale inexpensive stage produces at most one target-only refresh request.
   Its body contains only request ID, candidate key, stage, and expected roster
   token; browser-supplied evidence or authority fields are absent.
7. A stale expensive stage does nothing until a staff member explicitly invokes
   its action.
8. During A -> B -> A navigation, late success, error, and `finally` outcomes
   from either previous generation do not alter the current request.
9. The no-history page remains idle until `Prepare search`. Mount must not POST
   `load-proposal`; clicking `Prepare search` is separately proven to initiate
   that explicit SharePoint-download/Blob-copy preparation. `Run reviewer search`
   and `Run another search` remain disabled until preparation supplies the
   required proposal state and are tested as subsequent explicit cold actions;
   `Retry reviewer state` is tested as the same primary-button surface in its
   error state.
10. The visible `Evidence checked as of <date>` values come from the response and
    are not rewritten to the browser's current time.
11. A `409 roster_snapshot_changed` response restarts cached -> reconciled from
    the fresh generation exactly once; late outcomes from the abandoned
    generation cannot update the page. A second conflict reaches the implemented
    guarded failure state and produces no third bootstrap attempt.
12. The primary Workbench path sends explicit `mode=cached|reconciled`. The
    server's surviving no-mode compatibility branch is pinned in Layer B; no
    browser scenario is invented for it because the live Workbench always passes
    parent-owned roster state.

### 4.4 Timing assertions

Do not make a wall-clock threshold the initial deterministic CI contract. CI
first proves ordering by holding reconciliation open and observing cached DOM
state. The test also records `warm_panel_mounted`,
`warm_cached_roster_visible`, `warm_first_candidate_interactive`, and
`warm_full_reconciliation_complete` as separate milestones for later
aggregation. The authenticated Layer C runner is stricter: it fails closed if
cached candidate UI is not visibly read-only **before** reconciliation settles,
or if cached visibility exceeds the provisional two-second bound or full
reconciled UI readiness exceeds the provisional five-second bound. Those are
manual smoke guardrails, not CI or production release SLOs.

These milestone events are initially synthesized by the Playwright harness from
DOM and response observations; they do not yet exist as browser runtime events.

The existing provisional product hypotheses remain cached visible within two
seconds and first qualified interaction within five seconds. The current
rollout intentionally keeps roster actions disabled, so Layer C records full
reconciled UI readiness in place of an unavailable qualified interaction. These
become release budgets only after enough authenticated shadow/smoke runs
establish a baseline; the plan owner records the sample window and percentile
before enforcement.

## 5. Layer B — server contract companion

For each Layer A scenario, map the matching existing route/service coverage and
add only the residual gaps using the same scenario identifier. This avoids both
treating a UI mock as proof of server behavior and duplicating the extensive
current contract suite.

[VERIFIED 2026-08-02 via current test inventory] The starting denominator already
includes at least these suites: `reviewer-roster-endpoint.test.js` (cached,
reconciled, mode validation, DAL context, and snapshot conflict),
`reviewer-warm-validation-service.test.js`,
`workbench-reviewer-stage-refresh-service.test.js`,
`workbench-reviewer-stage-refresh-route.test.js`,
`reviewer-stage-freshness.test.js`, plus roster-store, projection, promotion,
and warm-stage-producer suites. Stage 0 must produce an assertion -> existing
test -> residual-gap matrix before Stage 2 adds tests; a raw test count is not a
coverage claim.

Required assertions:

- cached roster mode performs the Postgres roster read and exactly zero
  Dataverse, Graph, Blob, proposal-byte, Claude, publication, contact, email, or
  job calls;
- reconciled mode performs only the documented Postgres/Dataverse/Graph-metadata
  allowlist and makes zero Graph downloads or provider calls;
- no-history GET remains read-only and performs no implicit cold work;
- unknown or duplicated mode/stage/body fields reject before provider or write;
- target-only refresh derives authority server-side, invokes only the named
  candidate/stage producer, and returns per-target persistence outcome;
- current, stale-CAS, live lease, valid expired lease, malformed lease, and
  authority-changed complements retain their fail-closed semantics;
- both promotion paths re-read server authority and block cached, incomplete,
  failed, unknown, or changed evidence;
- every partial failure names the candidate/stage and never reports count-only
  success;
- request/candidate generations prevent stale completion from overwriting a
  newer request or roster token; and
- structured test telemetry emits only bounded identifiers, timings, reason
  codes, and call counts.

Lease corruption and other persistence-only complements stay in Layer B. They do
not justify manufacturing malformed live records merely to exercise a browser.

## 6. Layer C — authenticated deployed read-only smoke

### 6.0 Scoped observation prerequisite

Layer C is blocked until a production-safe, bounded observation mechanism exists.
Do not infer server-internal silence from browser methods or LLM usage logs.

Implement a Reviewer Find warm observation context with these constraints:

1. A browser run supplies a random observation ID used **only** for correlation;
   the server validates its bounded format and never treats it as auth, target,
   fixture, or write authority.
2. Before instrumentation, produce a caller -> effect-capable operation ->
   authoritative chokepoint matrix for every path reachable from cached and
   reconciled modes. Instrument the named, sanctioned call sites in that matrix
   at the lowest shared chokepoint available—including the Dataverse core
   boundary, LLM client, Graph service, roster Postgres store, and the named
   Blob/provider/email/job boundaries. The route establishes a request-scoped
   context and those chokepoints report normalized effect classes: Postgres read/write, Dataverse
   read/write/action, Graph metadata/download, Blob read/write, proposal load,
   Claude, publication/COI/contact provider, email, and job enqueue. This is
   not process-wide interception: a future direct raw SQL, fetch, or Blob call
   outside the named sanctioned seams requires a new inventory entry and review.
3. Structured events contain observation ID, route/mode, effect class, operation,
   count, reason code, and elapsed time only—no request/reviewer PII, proposal
   text, query text, URLs containing record IDs, or provider bodies.
4. A static contract gate fails when the warm reachable-path inventory names a
   sanctioned effect-capable path without an instrumented chokepoint. Unit tests include
   positive controls proving every inventoried chokepoint produces a detectable
   event and negative controls proving a normal unobserved request does not
   change application behavior. Absence is not meaningful unless the inventory
   gate and positive control for that effect class pass.
5. The initial sink is bounded structured application logs; no new production
   table is introduced by this plan. Retrieval uses the named Vercel project's
   runtime-log query filtered by exact deployment ID, observation ID, and bounded
   time window, then saves the redacted events with the result JSON. If that
   query cannot reliably retrieve a positive-control event from the same
   deployment, Layer C remains blocked rather than being downgraded silently.
6. Instrumentation failure must not grant authority or report a pass. It makes
   the smoke result `observation_incomplete`.

### 6.1 Authentication

Use normal Microsoft sign-in. Save Playwright storage state to the existing
gitignored `.auth/` location when a human is available. Never commit, print, or
copy the credential into CI. Layer C is interactive/on-demand by construction:
the existing capture script is headed and waits for a human. If stored state is
absent or expired, mark Layer C blocked and continue Layers A and B; do not wait
for input during an unattended run and do not enable an auth bypass.

An existing signed-in Chrome window is useful for an immediate manual smoke but
is not a durable test dependency. The repeatable runner should use Playwright
storage state captured by `scripts/save-playwright-auth-state.mjs`.

**Preview authentication procedure verified (2026-08-02):** [VERIFIED via a
normal Microsoft staff sign-in] Azure AD accepted the exact stable branch-alias
callback after it was temporarily registered, and the runner bound that alias to
the inspected immutable Preview deployment and commit. The earlier
`AADSTS50011` result remains historical evidence that an unregistered Preview
callback fails closed; it is no longer the active Layer C blocker. Do not replay
cookies, change redirect targets, or bypass authentication. A pre-merge Layer C
run still requires an owner-approved callback registration for the exact stable
test host, exact-deployment/commit/alias attestation before and after browser
activity, and rollback of the callback and local auth state afterward. Otherwise
the required confirmation is the runner's explicit post-merge production
read-only confirmation using the already registered production callback.

The pre-merge Layer C target is the branch's Vercel Preview deployment operating
in the release strategy's read-only-shadow mode: production Dataverse reads are
explicitly allowed, the Dataverse target/write interlock is on, and no browser
mutation is permitted. A Production deployment run is a separate post-merge
read-only confirmation, not a prerequisite that forces unreviewed code onto
`main`.

### 6.2 Mandatory preflight

Before opening the Workbench, a read-only preflight must report and verify:

1. application base URL, exact Vercel deployment ID, commit, and deployment class
   (`preview` for the pre-merge gate; `production` only post-merge);
2. classified Dataverse target hostname, without printing credentials;
3. successful authenticated app access;
4. configured request alias -> GUID -> request-number agreement;
5. request `1002914` exists in that target and remains marked Advancing for the
   dedicated smoke request;
6. the Reviewer Find proposal binding resolves through the normal priority
   order—`Reviewer Materials/Proposal_1002914.pdf`, then
   `Phase I/ProjectDescription.pdf`—with versioned metadata available without
   downloading bytes; the 2026-08-02 audit observed the fallback binding;
7. a persisted Reviewer Find roster exists for a warm exercise, or the run is
   explicitly reported as not ready; and
8. the scoped observation mechanism and its positive controls are available; and
9. the requested smoke mode is `read-only`.

The prior local failure—valid auth but request absent in the configured target—is
therefore a preflight failure, not a browser-product failure.

### 6.3 Read-only enforcement and scenario

- Abort on browser `POST`, `PUT`, `PATCH`, or `DELETE` and on any navigation to
  an invitation/send/repair action.
- Navigate dashboard -> `1002914`, observe cached cards, wait for reconciliation,
  return to the dashboard, then revisit `1002914`.
- Do not click Prepare search, Prepare again, Retry preparation, proposal-file
  selection, Run reviewer search, Run another search, Retry reviewer state,
  refresh stage, confirm identity/address, promote,
  exclude, remove results, invite, or send.
- Attach a correlation ID to logs only; it is not write authority.
- Review the correlated server observation ledger after the run. It must show zero proposal
  downloads/Blob copies, Claude/publication/contact calls, full-batch applicant
  enrichment, Dataverse/Postgres writes, email, and job enqueueing. Browser
  request inspection alone is not accepted as proof of server-internal silence.
- Save a redacted JSON result locally. Live screenshots and traces are disabled
  by default. If a failure requires them, save them only under the separately
  gitignored `.artifacts/reviewer-find-live/<observation-id>/`, never under the
  CI-uploaded `playwright-report/`; the product-engineering owner reviews and
  deletes them within seven days. The JSON result contains request number,
  commit/deployment, target classification, milestones, call counts, and
  pass/fail reasons—not reviewer PII or auth state.

Use only request `1002914` in Layer C. Request `1002794` is a real request with
named reviewers and is out of scope for live artifacts. Request-switch race
coverage remains deterministic in Layer A until a second true dummy request is
explicitly designated.

### 6.4 Fixture ownership

The `1002914` warm roster, once created, is owned by the Reviewer Find smoke.
[VERIFIED 2026-08-02 via production read-only audit] It currently has no
Postgres Find roster; its five applicant suggestions and five request slots are
all unengaged, with no invite, accept, decline, or review artifact. Retain those
inputs because they exercise the applicant-ingestion and COI latency under test.

The owner authorized using `1002914` for this test and required that no external
email be sent. Preparing its warm fixture is therefore limited to the explicit
Find cold-search path. It must not promote candidates, navigate to a send action,
invoke `/api/review-manager/send-emails`, or invoke any other invitation endpoint.
The authenticated Layer C runner remains GET/HEAD/OPTIONS-only and never seeds,
repairs, promotes, invites, or sends.

[HISTORICAL 2026-08-02 via redacted preflight
`rfw_0220cf3aa30f1176eb375682adc6139a`] The former fixture `1002788` failed
closed as `stale / proposal_binding_changed`. That result explains why the
fixture changed; it is not the current Layer C prerequisite.

## 7. Layer D — sandbox mutation rehearsal

### 7.1 Parity gate

Do not implement or run this layer until all of these are independently verified:

- current Reviewer Dataverse entities, fields, relationships, and permissions
  exist in the sandbox;
- policy/config seed rows exist;
- Preview/local runtime is classified as non-production and points to the sandbox;
- Postgres, Graph/SharePoint, Blob, provider, email, and job targets are separately
  classified and controlled;
- email is disabled/captured with no token or invitation-lifecycle write hidden
  behind rendering; and
- a reset procedure has passed on a disposable fixture.

Provisioning sandbox parity is a separate Tier 2 implementation with its own
schema/data review. This browser plan does not authorize it.

### 7.2 Fixture contract after parity

Create one stable logical alias, such as `reviewer-find-warm-smoke`, resolved by a
server-side environment configuration to a sandbox request GUID. Do not hard-code
a production GUID into sandbox tests.

The idempotent seed/verify/reset tool should create or repair only tagged fixture
records and provide:

- the canonical proposal path and a known metadata/content version;
- applicant-recommended and applicant-excluded inputs;
- one fully current candidate;
- one candidate with a single inexpensive stale stage;
- one candidate with a proposal/provider-dependent stale stage;
- one incomplete applicant candidate;
- two same-name candidates with distinct authoritative anchors; and
- one handled/engaged reviewer that should leave the active Find bucket.

Use fictitious identities and non-sendable contacts. A controlled email address
is not required for Reviewer Find warm testing; email delivery belongs to the
separate invitation rehearsal.

### 7.3 Mutation safety and assertions

The mutation runner requires both an explicit command-line write acknowledgement
and successful server-derived non-production target/fixture checks. A browser
flag alone cannot grant write authority.

Exercise only:

1. targeted inexpensive reconciliation/refresh;
2. one explicit proposal/provider-dependent targeted refresh when provider test
   policy permits it;
3. a stale-CAS complement from a controlled concurrent update; and
4. promotion rejection for incomplete/unknown evidence.

Do not send invitations. On completion or interruption, run reconciliation and
reset. The run is failed until expected writes, retained evidence, and cleanup
outcomes are named. Cleanup failure is reported and owned; it is never hidden by
a green browser assertion.

## 8. Implementation sequence and ownership

### Stage 0 — inventory and test contracts

- Freeze scenario names and the request/API ledger schema.
- Inventory every network route the Reviewer Find page uses from mount through
  reconciliation and targeted refresh.
- Produce an assertion -> existing test -> residual-gap matrix for the current
  route/service suites; do not recreate already-covered cases.
- Inventory all `reviewer-roster` callers. Record the no-mode compatibility GET
  as a Layer B server contract; current source has no live browser caller because
  `ReviewerFindPanel` always passes parent-owned roster state.
- Specify the separate Reviewer Find Playwright config, distinct port,
  `reuseExistingServer: false`, credential-free temporary test root/environment,
  and sentinel credential self-test before launching a local Next server.
- Inventory the `1002914` Reviewer Find cold-search scope and prove that it
  cannot reach invitation/send endpoints.
- Add a read-only preflight that distinguishes auth, deployment, target, request,
  proposal, and roster readiness failures.
- Record current sandbox parity as failed until re-probed.

**Exit:** a dry-run preflight fails with a specific reason and makes no write;
the Layer B denominator and compatibility callers are named; the isolated server
design proves startup receives no live credentials.

### Stage 1 — deterministic browser suite

- Build Layer A fixtures and strict route interception.
- Add cached-before-reconciled, authority error, no-history, stale target,
  unknown complement, same-name, and A -> B -> A tests.
- Store trace/screenshot/report artifacts on failure.
- Add the first-conflict restart and second-conflict latch assertions.

**Exit:** the suite runs headlessly and unattended from the credential-free test
root with zero startup or request-time external effects, including when the
parent shell contains sentinel credentials.

### Stage 2 — paired server contract tests

- Fill only the residual gaps in the Layer B scenario matrix.
- Spy on every expensive and durable dependency, not merely the HTTP routes seen
  by the browser.
- Require reason-coded outcomes and negative tests that would pass if a guard
  were deleted.

**Exit:** each browser scenario has server-side side-effect proof where relevant.

### Stage 3 — scoped observation slice

- Produce the warm reachable-path/chokepoint matrix, add the bounded observation
  context and effect classifications in §6.0, and add the static inventory gate.
- Add positive/negative controls at each named instrumented seam.
- Establish a reliable, redacted log retrieval procedure against a named
  deployment and time window.

**Exit:** a controlled non-production test proves both a known effect and a
known-zero effect can be distinguished. No schema migration is introduced.

### Stage 4 — authenticated deployed read-only runner

- Extend the existing auth-state workflow with read-only preflight and a
  Reviewer Find runner.
- Add correlation, structured redacted result output, and observation-ledger review.
- Add `.artifacts/reviewer-find-live/` to `.gitignore`; keep live artifacts out
  of the Playwright CI reporter and delete exceptional artifacts within seven days.
- Run first against the exact Vercel Preview deployment/commit in read-only-shadow
  mode, only when a valid normal staff session and a warm `1002914` roster are present in the
  target. Retrieve logs from that deployment by observation ID and require the
  same-deployment positive control. A later Production run is post-merge only.

**Exit:** one signed-in `1002914` dashboard -> request -> dashboard -> same-request
warm revisit passes with no write or expensive-call evidence at the named sanctioned seams. If the warm fixture,
auth state, or complete correlated observation is missing, the gate is blocked.
This is enablement evidence, not permission to merge or deploy.

### Stage 5 — sandbox parity and mutation runner

- Re-probe and separately provision Reviewer sandbox parity.
- Build the idempotent tagged fixture and reset process.
- Implement Layer D only after all side-effect targets are classified.

**Exit:** targeted refresh and rejection paths pass, expected writes reconcile,
and reset leaves no unowned fixture data.

### Stage 6 — CI and release adoption

- Add the deterministic browser suite to the existing path-filtered E2E workflow.
- Invoke the dedicated Reviewer Find config/script as a separate CI step; do not
  run it through the shared config or allow it to reuse port 3100.
- Extend that path filter to include `pages/api/workbench/**`,
  `pages/workbench/**`, `lib/services/workbench/**`,
  `lib/services/reviewer-roster-store.js`,
  `lib/services/reviewer-stage-freshness.js`, the Reviewer Find observation
  context, and its relevant provider/write seam files.
- Keep authenticated live smoke manual/on-demand until a reviewed staff test
  identity exists; do not store a human auth session as a CI secret by default.
- Require Layer A+B for pull requests changing warm Reviewer Find surfaces.
- Require the Stage 3 observation slice and Layer C/Stage 4 before enabling the
  feature branch for production users.
- Require Layer D before any later release depends on real targeted-refresh
  mutation rehearsal outside controlled production.

## 9. Acceptance matrix

| Gate | Required result |
|---|---|
| Determinism | Layer A passes from a credential-free temporary root without startup or request-time external effects, external network, or human input |
| Auth separation | Synthetic auth is used only for mocked automation; live smoke uses normal Microsoft sign-in |
| Cached UX | Cached cards render before reconciliation and remain visible through authority failure |
| Warm cost | Unchanged revisit records exactly zero proposal-byte, Blob-copy, Claude, publication, contact, email, and job calls |
| Warm writes | Unchanged revisit records exactly zero Dataverse/Postgres/Blob writes |
| Targeting | One stale stage invokes one candidate/stage target and no full batch |
| Safety | Cached/stale/unknown state cannot select or promote in UI or server services |
| Isolation | A -> B -> A late responses never contaminate the active request |
| Partial failure | Prior evidence remains visible; failure is candidate/stage-specific and retryable where defined |
| Production posture | Layer C is GET/read-only and observation-ledger reconciled; incomplete observation blocks the gate and no production mutation is automated |
| Sandbox posture | Layer D stays blocked until parity, target, fixture, side-effect, and reset gates all pass |

## 10. Observability and artifacts

Every run produces a bounded summary:

- branch/commit or deployment identifier;
- browser-suite/scenario version;
- environment and classified target;
- logical request alias and request number;
- milestone durations;
- normalized route/call counts;
- cache and miss reason codes;
- stale-generation/CAS outcomes;
- expected and observed writes; and
- cleanup status.

Never include proposal text, reviewer names, emails, provider response bodies,
session cookies, auth headers, or raw Dataverse payloads. Browser traces from live
data are off by default; exceptional live artifacts use the local-only directory,
seven-day retention, and product-engineering ownership defined in §6.3. CI uploads
only deterministic synthetic Layer A reports.

## 11. Explicit non-goals and open operating decisions

This plan does not:

- automate production writes or real email;
- use request `1002794` in live browser tests or artifacts;
- provision the Dataverse sandbox;
- invent a permanent CI staff identity;
- treat a browser route mock as proof of server call counts;
- set a cold-search latency SLO; or
- convert the provisional two-second/five-second warm hypotheses into gates
  before live baselines exist.

Before Stage 5, the owner must separately approve sandbox provisioning and name
the reset owner. Scheduled Layer C is deliberately deferred; proposing it later
requires approval of a non-human or dedicated staff test identity and its
credential rotation/least-privilege policy. Neither decision blocks Stages 0–3
or an interactive Layer C run with a currently valid normal staff session.

## 12. Rollback and failure handling

- Layers A/B add tests, test helpers, an isolated-server launcher/config, and CI
  path filters; revert that slice if the harness destabilizes unrelated E2E work.
- The scoped observation slice is behavior-neutral when no observation ID is
  present. Roll it back independently if logging volume, redaction, or seam
  behavior differs from its tests; Layer C then returns to blocked.
- Layer C is read-only. An auth, target, request, proposal, roster, or observation
  preflight failure stops before navigation and reports the missing prerequisite.
- Layer D records fixture IDs before mutation, uses idempotent cleanup, and treats
  cleanup failure as an operational incident on the sandbox fixture.
- A failed browser run does not trigger automatic repair, refresh, search,
  promotion, invitation, or cleanup against an unverified target.

The implementation is complete only when the layer's own evidence is green; a
passing deterministic browser suite cannot be used to waive the authenticated
read-only smoke required for production enablement.

## 13. Adversarial review record

Claude Opus reviewed the first draft read-only on 2026-08-02 and returned
`NEEDS REWORK`. The blocking findings were: local Playwright startup could load
live credentials and perform alert/email side effects before route interception,
and the production smoke required correlated effect telemetry that did not
exist. Major findings covered the existing Layer B denominator, incomplete CI
path filters, the actual `Prepare search` cold-work gate, the surviving no-mode
roster path, `1002788` fixture ownership, live-artifact PII, and docs-catalog
drift. The revision incorporated those findings and then underwent the closure
review recorded below.

Opus then performed a closure review and returned `READY WITH NAMED CHANGES`.
Those changes are incorporated above: a separate config/port with server reuse
disabled, compatibility-route coverage moved to Layer B, a reachable-path to
chokepoint observation gate, the existing fixture cleanup contract, the second
snapshot-conflict latch, exact control labels, and a named Vercel Preview/log
retrieval path. No Opus finding remains intentionally unaddressed in this plan.
