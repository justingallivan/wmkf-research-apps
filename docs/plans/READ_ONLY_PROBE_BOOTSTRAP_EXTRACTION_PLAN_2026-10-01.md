---
title: Read-only probe bootstrap extraction — C5
status: released
domain: architecture
kind: plan
summary: Share only the identical environment loader and token request in three Akoya diagnostic scripts, preserving their distinct read and output behavior.
canonical: false
owner: product-engineering
---

# Read-only probe bootstrap extraction — C5

## Implementation status — 2026-10-01

[VERIFIED via commits and synthetic tests] Tests-first commit `0032abaf0` passed 22 tests against the original scripts. Extraction commit `cf0aa7477` adds the helper, three caller replacements, scoped README note and direct helper coverage; the final focused suite passes 25 tests. Sol approved `cf0aa7477`; the orchestrator independently verified exact token source and byte-identical GET/IIFE suffixes with Babel AST locations, including unchanged taxonomy constants. Runtime behavior claims below remain limited to source and isolated Mode A evidence.

[VERIFIED via mutation runs] Membership precedence, cwd-relative lookup and altered token-field mutations each failed their targeted assertions; all were restored and the focused suite passed. Report tests assert representative output, not full golden reports; the unchanged-source comparison supplements those assertions. Full Jest passed 1,189 suites / 18,784 tests / 5 snapshots, with 6 suites / 98 tests skipped. Fable approved implementation `cf0aa7477` on the first pass through host OAuth session `785a49f1-8082-449c-ad13-94efb839806d`, with no substantive findings. API-key variables were removed; no substitute review product was used. Canonical build, type checks, four runtime syntax checks, and lint passed (0 errors / 123 existing warnings). Build emitted two existing Turbopack dynamic-filesystem warnings and two Node localStorage ExperimentalWarnings. All eight scoped gates and their available self-tests passed sequentially: secret-scan, dynamics-context-boundary, script-suggestion-writers, dataverse-access-layer, doc-symbol-refs, build-claim-freshness, docs-catalog and harness-framing. All PR checks subsequently passed on head `5a3376640`, including CI Jest, PostgreSQL integration and the preview build. No live Dataverse or credential verification occurred.

[VERIFIED scoped `/contract-reconcile` and `/sweep`] Operator entry → explicit loader → unchanged token POST → unchanged per-script GET/report/exit paths is covered by source comparison and synthetic execution. There is no new persistence, schema, status/enum, route or application consumer; those audits are N/A. Partial failure remains taxonomy-specific; no retry, background work or stale UI state is introduced. Caller search finds exactly the three script importers and test fixtures, with no imports under lib/pages/shared/modules. README now identifies helper ownership. The candidate survey records current disposition separately from historical rankings. Atlas and Power Tools references describe dated probe evidence; they make no changed bootstrap-ownership claim and remain historical. No live stale ownership claim remains in this bounded sweep; unrelated documentation and live data were not audited.

[VERIFIED merge; OWNER-REPORTED deployment] The owner accepted the synthetic Mode A rehearsal and authorized promotion on 2026-10-01. [PR 389](https://github.com/justingallivan/wmkf-research-apps/pull/389) merged as `31c3ace4a`; the owner then confirmed Production deployment. The PR records prior successful Production deployment `6793252574` / source `0cfc9726f` as the rollback target. Source rollback is reverting the PR merge; no persisted-data rollback is needed. This report does not claim an independent post-deploy sign-in or live probe rehearsal.

## Approved design and validation requirements (historical plan)

The following sections preserve the approved pre-implementation design. Their `[PLANNED]` labels describe that decision point; the implementation evidence above and final review record below determine actual completion. The owner promotion decision and deployment report are recorded above.

## Scope and decision

[VERIFIED via git fetch and source inspection 2026-10-01] Baseline `0f86cc2149b144126cf128cce86211bae962dc9c`, branch `codex/c5-probe-bootstrap`. C1–C4 are merged. The user explicitly chose to do the remaining C5 now, overriding the survey's do-later priority. This clone has no CodeGraph index; source/caller searches are used without creating one.

[PLANNED] Extract the repeated environment loader and identical `getToken` function from exactly:

- `scripts/probe-akoya-wmkf-type-misc.js`
- `scripts/probe-akoya-wmkf-type-taxonomy.js`
- `scripts/probe-akoya-active-nodate.js`

Add one CommonJS leaf, `scripts/lib/akoya-readonly-probe-bootstrap.js`, exporting `loadProbeEnvLocal` and `getToken`. Require both in each script and explicitly call `loadProbeEnvLocal()` at the former top-level loader position. Importing the helper must not load a file, mutate the environment, or request a token. The loader uses `path.join(__dirname, '..', '..', '.env.local')` from its new scripts/lib location, preserving the original checkout-root lookup. Keep the `getToken` body identical. No dependency injection framework, options, token cache, timeout, retry, validation policy, dotenv replacement, or general-purpose client.

[VERIFIED via `lib/dataverse/client.js`:31–56 and 93–125] The existing client is not a drop-in substitute: it accepts differently formatted environment lines/single quotes, uses membership rather than truthiness for precedence, validates missing credentials, changes token-error text/truncation, and adds telemetry. Do not modify it or adopt its loader/token function in this extraction.

[PLANNED] Preserve shebangs, immediate script execution, console output, query strings, headers, aggregation, pagination, timestamps, exit paths and error boundaries. Do not move the async IIFE, add main guards/exports to the entry scripts, consolidate their `get` helpers, or migrate other probes. No live execution, target/credential changes, data writes, new interlock bypass, or policy change is authorized. Application service-principal token requests described below are existing script behavior to mock; agent sessions continue to use OAuth subscriptions only.

## Contract trace and preservation matrix

Surface: operator script startup. Entry: Node executes one of the three files. Inputs: process environment and optional checkout-root `.env.local`. Helper: environment mutation, then one token request. Persistence: none added; only in-process environment/token and diagnostic stdout/stderr. Consumers: each script's own GET/aggregation/reporting logic and human readers of dated output. HTTP route/client state/schema/enum migrations are N/A. Prior finding: three duplicate startup blocks, not three equivalent Dataverse clients.

| Contract | Verified baseline mechanism | Required preservation |
|---|---|---|
| Environment lookup | misc:14–23, taxonomy:21–30, active-nodate:18–27 | Resolve from script checkout, never cwd. Missing file is a no-op; exists/read failures remain synchronous outside the IIFE catch. |
| Parser grammar | `/^([A-Z0-9_]+)=(.*)$/`, split on newline, trim value, remove enclosing double quotes | No key trimming, lowercase acceptance, export syntax, inline-comment stripping, single-quote stripping, multiline support, or interpolation. Values can contain `=`. CRLF lines retain a trailing carriage return after splitting and fail the regex entirely: skip them, do not normalize them. Preserve empty values. |
| Precedence | `if (!process.env[k]) process.env[k] = v` | Existing nonempty strings win; absent and empty strings can be replaced. Preserve duplicate-line order and the empty-then-nonempty case. |
| Token | misc:25–36, taxonomy:36–47, active-nodate:29–40 | Read current process env at call time; POST exact tenant URL with existing content type and URLSearchParams fields/order. Scope remains literal `${DYNAMICS_URL}/.default` including any trailing-slash effect. Return access_token as received. With absent credentials, the tenant URL and form values contain literal `undefined`; do not validate or replace them. |
| Token failure | `if (!r.ok) throw new Error(...)`; awaited text/json | Keep exact `Token: <status> <full text>` error, rejection/JSON-error propagation, and no new missing-token or missing-credential validation. Failed token prevents subsequent data reads. |
| Misc data reads | misc:38–57 | Its get follows nextLink, retains first response and aggregates rows; non-collection metadata returns directly. HTTP errors throw. Missing named type exits 0. |
| Taxonomy data reads | taxonomy:49–74 and its IIFE | get returns `{status,ok,body}`; caller paginates type rows, logs list/aggregate failures, and metadata failure exits 1. Preserve its absolute-nextLink conversion and all MIG/NAT/joint aggregation. |
| Active/no-date reads | active-nodate:42–53 and its IIFE | get returns body.value or []; two bounded queries, no pagination loop. HTTP errors throw. Do not silently add pagination. |

[VERIFIED via source] These legacy scripts call fetch directly for their GETs; this slice does not add or remove a restriction/interlock call. Do not claim that moving the bootstrap proves target-policy compliance or modernizes these probes. Any policy concern discovered during review is a separately scoped finding, not permission to change behavior inside this extraction.

[PLANNED] Partial-result behavior stays script-specific: taxonomy may report partial/empty aggregates on failed reads; misc and active/no-date throw on failed reads. No new retry or background work. Every await and caller error boundary remains in place. No persisted success state is introduced.

## Tests before extraction

[PLANNED] Put suites under `tests/unit/` so the configured Jest discovery runs them. Use the `@jest-environment node` docblock and suite-owned deny-by-default fetch, not the global setup stub; `tests/unit/test-request-factory-cli-plain-node-load.test.js` is the existing plain-Node pattern. Luna first creates executable characterization on the original three scripts and commits it before runtime changes. Keep expectations independent of the new helper and pin exact observable token request, environment precedence, output/error/exit behavior. Do not use a round trip through the same implementation as the only oracle.

Preferred full-entry harness: copy only the three checked-in scripts into a temporary synthetic checkout; after extraction also copy the new helper into scripts/lib. Supply a synthetic `.env.local` under that temporary root. Launch child Node with an explicit minimal environment, an absolute Node executable and a test-only preload that replaces fetch before the script starts. Never inherit project/provider credentials, NODE_OPTIONS, or another loader. Run from a different temporary cwd with a decoy environment file to test path resolution. A deny-by-default fetch mock must throw on any unplanned request; no real network fallback. Record observed requests to a separate JSON log under the synthetic root, leaving report output unchanged. Direct child stdout/stderr to files under that root so immediate process.exit cannot discard buffered pipe output on macOS. Preserve real child exit semantics, including the misc exit-0 and taxonomy exit-1 branches. Bound child execution time and output, and clean up only test-owned temporary files. No real repository `.env.local` is read, written, copied, or removed. Use only dummy credential/token strings in fixtures or logs.

[PLANNED] Test the copied shared helper under the synthetic root after extraction as well, using a child entry fixture; never call the actual checkout helper loader in-process: importing is inert; explicit loading occurs when called; token acquisition happens only when called. If any token-only test runs in-process, snapshot/restore process.env and install/restore its own throwing fetch; never call the actual checkout loader. For module mocking, avoid leaking environment, fetch, module cache, timers, console hooks or filesystem stubs into other suites. Do not add runtime test seams merely for testing. A test harness is not a general script runner to maintain outside this task.

Required coverage:

1. For each original entry point, successful synthetic token+GET flow, exact token request and emitted report, plus rejected token/no subsequent GET. The child preload fixes Date inside the child process for timestamped output.
2. Parser table: missing file, empty file, read failure, absent/empty/nonempty environment values, repeated keys, uppercase/digits/underscore keys, leading spaces/lowercase/export lines ignored, comments, CRLF assignments skipped entirely, double versus single quotes, embedded `=`, inline `#`, whitespace trimming and empty quoted strings. Assert actual resulting values, not just loader call counts.
3. Token response/error table: exact URL/form encoding including special characters and trailing slash; success field extraction, missing access_token, missing credential values serialized as literal `undefined` in URL/form, non-2xx with long text, rejected fetch, text failure and invalid JSON. Preserve existing outputs/errors rather than tightening validation. Repeated calls must remain uncached and observe current env.
4. Distinct read behavior: a second page actually contains unique rows for misc and taxonomy; active/no-date receives a nextLink but does not follow it. Pin representative query/headers and per-script error handling. A taxonomy failed list/aggregate and misc no-type early exit must retain their existing semantics.
5. Unrelated cwd/root decoy: prove the loader uses only the synthetic checkout root. Ensure helper import alone makes no env/fs/token activity. Prove loader read failure remains outside the script's PROBE ERROR catch, while token failure reaches it.

[PLANNED] Mutation proof: temporarily change truthiness precedence to membership, change loader lookup to cwd, and alter a token request field. Each mutation must cause the relevant test to fail; restore and rerun. Once extracted, compare the copied getToken body and the remaining per-script GET/IIFE source against baseline (excluding only imports, loader replacement, and removed function) to verify the runtime diff has stayed narrow.

## Implementation and reviews

1. Orchestrator writes this plan using Luna's reconnaissance and `/contract-reconcile`. Fable reviews through the host OAuth Claude session, with API-key variables removed. Resolve substantive findings before implementation.
2. Luna implements pre-change tests, then the helper and three caller replacements. Read relevant rules; commit working steps. No unrelated cleanup.
3. Sol reviews callers, parser edge cases, exact token wire behavior, test isolation and failure branches. Luna addresses substantive findings; orchestrator takes over if cycles become incremental or cosmetic.
4. Orchestrator independently reviews the final diff and evidence, then requests an ordinary OAuth-only Fable adversarial implementation review. Evaluate findings; use one bounded follow-up for fixes, not an open-ended polish loop. No API-agent authentication or substitute metered review product.
5. Push a reviewable PR and finish required checks. Merge remains an explicit later owner decision.

## Validation and durable documentation

[PLANNED] Run new characterization/helper suites before and after extraction; syntax-check all four runtime files. Run full Jest, canonical build, lint, type checks, and current relevant gates with self-tests sequentially: secret-scan, dynamics-context-boundary, script-suggestion-writers, dataverse-access-layer, doc-symbol-refs, build-claim-freshness, docs-catalog and harness-framing. Inspect package.json and CI reference for current commands/scopes. No fixture-writing gate parallelism. A gate does not prove parser, wire, or pagination equivalence; executable tests do.

[PLANNED] Add a concise helper contract header and a narrowly scoped note in scripts/README.md identifying the three consumers and preserved legacy parsing. Use `/sweep` for that ownership fact across scripts docs, source, tests, Atlas, memory and wiki. Keep dated survey/probe results historical; do not reinterpret their row counts as current data. No schema, app route, env contract, or live storage ownership change is planned. New helper remains scripts-only; verify no application importer. No repository-wide docs cleanup.

## Release and rollback

[ASSUMED conservative classification] Keep survey Tier 2 because startup handles authentication configuration, even though the change is operator-only and adds no application import. Use approved Mode A isolated automation for the integrated rehearsal: execute the real entry points from the synthetic checkout with fixture responses, record stdout/stderr, request logs and tested SHA, and run the canonical application build. This is a local script integration subject; no live tenant is needed to exercise the changed startup seam. No Tier 2 exemption is being declared.

[PLANNED release gate] Before merge, the owner must review and accept that Mode A rehearsal evidence as the staff acceptance step, record the last-known-good production deployment/rollback target, and explicitly authorize merge under `docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md`. Until those concrete items are recorded, promotion is blocked; implementation, automated validation and PR review can complete. External naive-user rehearsal is not applicable because no external-user flow changes. If the owner requires additional live authentication evidence, that is a separate authorized rehearsal against a named compatible target; it is not silently inferred from this request. Synthetic execution does not verify live tenant authentication, current Dataverse data or target-policy compliance. Do not run actual probes against live services in this task.

Rollback is reverting the extraction commit or checking out the prior script version; no data rollback or manifest regeneration. No deployment, production-state or credential claims are made by this plan. Missing release evidence remains outstanding rather than implied by passing mocked tests.

## Review status

[HISTORICAL plan review] Source reconnaissance established the seam and the differing GET contracts before implementation. Characterization, implementation, builds, CI and release were future steps at that review; current evidence is recorded at the top of this document. Fable round 1 requested explicit synthetic-helper isolation, child clock/log/stdio controls, parser expectations, Jest discovery/environment, accurate source references and decidable promotion requirements. Those changes are incorporated. Fable approved round 2 through the host OAuth session `2460000b-ba03-4192-8e22-1c3d4d43f15d` on 2026-10-01 with no remaining substantive findings. This approves implementation, not promotion.
