---
title: Route→Service Consolidation Plan
domain: architecture
kind: plan
status: active
summary: "Staged extraction of business logic from pages/api routes into per-domain services; routes become thin shells. Every stage leaves the build green."
canonical: true
cataloged: 2026-07-04
owner: product-engineering
related:
  - docs/DATA_ACCESS_LAYER_MIGRATION_PLAN.md
  - docs/API_ROUTE_SECURITY_MATRIX.md
  - docs/CLAUDE_REMEDIATION_PLAN.md
  - docs/CI_GATES_REFERENCE.md
---

# Route→Service Consolidation Plan

**Objective.** Today 49 `pages/api` route files reach the Dataverse layer directly (47 import
adapters; 2 more import `DynamicsService` only) and carry inline
business logic — the largest are 20-40 KB route files, some streaming (SSE) and at least one
multi-verb (`my-candidates.js` dispatches GET/PATCH/DELETE) (`review-manager/send-emails.js` 39.5 KB,
`reviewer-finder/my-candidates.js` 34 KB, `reviewer-finder/save-candidates.js` 29.3 KB
`[VERIFIED 2026-07-04 via ls]`). This plan moves that logic into per-domain services under
`lib/services/<domain>/`, leaving each route a thin shell: **guard → validate input → establish DAL
context → call service → map result/error to HTTP.** The DAL migration (Stages 0-8, complete)
cleaned the layer *below* (adapters); this campaign cleans the layer *above* (routes). It ends,
like the DAL campaign, with a census gate that becomes law.

**Execution status: ALL STAGES 0–7 COMPLETE (S331, 2026-07-05).** Written Session 330 (2026-07-04); passed the P0
adversarial plan review (Codex, 3 rounds, SATISFIED with zero live-state errors). Executed
end-to-end in Session 331: Stages 0-7, census 49→0, gate promoted to permanent law
(`check:route-service-boundary`, law mode). The Baseline table below and the wave table's
counts are the historical 2026-07-04 record; the Stage Log at the bottom is the execution
record and carries the per-stage review verdicts.

**Executor profile.** Each stage is written to be executed by a cheaper model (Sonnet-class) with no
prior context, following this document plus the per-stage checklist. Judgment calls are pre-made
here; anything not pre-made is marked **STOP-AND-ASK**.

---

## Baseline (probed, not assumed)

| Fact | Value | Evidence |
|---|---|---|
| Route files importing `lib/dataverse/adapters` | 47 | `[VERIFIED 2026-07-04 via grep -rl "lib/dataverse/adapters" pages/api --include="*.js"]` |
| — by domain | workbench 16, review-manager 10, reviewer-finder 6, admin 4, external 3, cron 3, expertise-finder 2, grant-reporting 1, phase-i-dynamics 1, field-primer 1 | same grep, grouped by first path segment |
| Union in-scope routes (adapters ∪ dynamics-service, outside exempt dirs) | **49** | `[VERIFIED 2026-07-04 via sorted-union grep, re-probed after P0 round 1]` |
| — DynamicsService-only routes (in scope, no adapter import) | 2: `pages/api/grant-reporting/extract.js`, `pages/api/test-email.js` (root-level — no domain dir) | `[VERIFIED 2026-07-04 via comm -13 of the two grep lists]` |
| Full test suite | 4188/4188 green | `[VERIFIED 2026-07-04 via npm test]` |
| Existing per-route tests | partial — e.g. `tests/integration/withdraw-sufficient-route.test.js` `[VERIFIED 2026-07-04 via ls]`, `send-emails-route.test.js` `[VERIFIED 2026-07-04 via grep, this session]` | full inventory is a Stage 0 deliverable |
| Adapters | 18 files in `lib/dataverse/adapters/` | `[VERIFIED 2026-07-04 via ls]` |
| Services layout | flat `lib/services/` (~60 files) + one subdir precedent (`lib/services/dataverse-export/`) | `[VERIFIED 2026-07-04 via ls]` |
| DAL-gate exempt dirs to carry over | `pages/api/dynamics-explorer/`, `pages/api/dataverse-export/` | `[VERIFIED 2026-07-04 via scripts/check-dataverse-access-layer.js:35-41 EXEMPT_DIRS]` |

## Architecture decisions (pre-made — executors do not relitigate)

1. **Route shell contract.** Every converted route contains only: HTTP-method dispatch, auth guard
   (unchanged from current), input validation/GUID checks, `withDalContext('<route-label>', ...)`,
   **one method-specific service call per HTTP verb** (a multi-verb route like
   `my-candidates.js` GET/PATCH/DELETE dispatches first, then calls one service method per
   verb), and result/error→HTTP mapping. No adapter imports, no `DynamicsService` imports, no
   multi-step business logic. Routes whose verbs carry independent partial-success semantics
   (P0 review flagged `my-candidates.js` — separate validation, projection, partial-save,
   duplicate-key, token, delete paths) get a pre-stage decomposition commit that splits the
   handler into per-verb functions IN PLACE, tests green, before any extraction.
1a. **Streaming route contract.** SSE/streaming routes keep response framing (headers, event
   writes, `res.end()`) in the route shell; the service exposes an async iterator or
   `onEvent(event)` callback and never touches `res`. The P0 review identified three streaming
   in-scope routes: `review-manager/send-emails.js` (SSE headers/events at ~:108-144, emits
   `error`→`end`, `result`/`complete`), `reviewer-finder/generate-emails.js` (~:203),
   `workbench/enrich-recommended.js` (~:119). Each gets a pre-extraction contract commit
   defining its event vocabulary (names, payloads, ordering, terminal events) pinned by tests
   BEFORE extraction. `[VERIFIED via Codex P0 review 2026-07-04 with file:line evidence]`
2. **Service placement.** New services live in `lib/services/<domain>/` subdirectories
   (`review-manager/`, `reviewer-finder/`, `workbench/`, …), following the `dataverse-export/`
   precedent. Existing flat services are NOT moved (out of scope).
3. **Service contract.** Services take plain argument objects (never `req`/`res`), return plain
   values, and throw typed errors carrying enough for the shell to map to HTTP. **Error shape
   (finalized by the pilot + P1 amendment 1):** every domain error extends the shared base
   `ServiceHttpError` (`lib/services/service-http-error.js` — `httpStatus` required, optional
   `body` = exact JSON the shell sends, optional `code`); shells map
   `res.status(e.httpStatus).json(e.body ?? { error: e.message })`. Routes whose existing
   non-2xx envelopes are NOT `{ error }`-shaped (e.g. `{ ok:false, reason }` in
   `external/review/[token]/respond.js`, `{ status, errors }` in `admin/review-questions.js`)
   set `body` explicitly so the envelope is preserved byte-exact. Services assume a trusted DAL
   context already exists — they never establish one. Context establishment stays at the route
   (post-auth), per the Stage 7 DAL doctrine in `docs/DATA_ACCESS_LAYER_MIGRATION_PLAN.md`.
4. **Trust-wrapper conversion while touching.** When a converted route currently uses legacy
   `bypassDynamicsRestrictions`, replace it with `withDalContext` in the same commit (semantically
   identical thin wrapper `[VERIFIED 2026-07-04 via lib/dataverse/core/context.js:46-54]`; advances
   the in-campaign bypass strip). Two guards per route (P0 review change 6): (a) AST/precheck
   that the existing call passes a STRING label — `withDalContext` throws on missing/non-string
   labels where `bypassDynamicsRestrictions` accepts a bare function
   `[VERIFIED via lib/services/dynamics-context.js:67-75 vs lib/dataverse/core/context.js:47-49]`
   `[RECHECKED after lib/services/dynamics-context.js change: comment-only edit at :112-119, bypassDynamicsRestrictions still at :67]`;
   (b) a same-or-wider-scope assertion: the new context boundary must enclose every
   Dataverse-touching statement the old one enclosed — shelling a route must never strand a
   Dataverse call outside the trusted scope (the characterization tests plus enforcement-on jest
   env catch this: a stranded call throws). Owner direction 2026-07-04: strip is in-campaign;
   prod `DATAVERSE_DAL_ENFORCEMENT` flip happens BEFORE the strip completes; trust-model
   tightening comes at the end of the strip — not part of this plan.
5. **No behavior changes.** Route URLs, auth guards, response envelopes, and status codes are
   preserved exactly where tests can assert them. This is a motion refactor, not a redesign.
   Divergence discovered mid-stage → **STOP-AND-ASK**.
6. **Gate, then law.** A new census gate (`check:route-service-boundary`) ratchets the count of
   `pages/api` files importing adapters/`dynamics-service` down per wave and becomes fail-closed
   law at the final stage — the playbook the DAL migration proved.

## Non-goals

Frontend, `DynamicsService` internal split, moving existing flat services, changing auth guards or
security-matrix rows (beyond noting "logic moved"), the trust-model tightening itself, and the
Dynamics Explorer / dataverse-export subtrees (exempt, carried over from the DAL gate).

---

## Self-checking method (the interval rule)

Two loops, both mandatory:

**Planning checkpoints (before execution).**
- **P0 — adversarial plan review.** Codex reviews THIS document against live code. Acceptance bar
  (from `docs/CLAUDE_REMEDIATION_PLAN.md`): corrections may only concern proposed work, never live
  state. Any live-state correction → fix the baseline, re-probe, re-review.
- **P1 — pilot retrospective.** After Stage 1 (pilot), a fresh-context review compares the pilot
  diff against the route-shell contract; this plan is then amended before any wave starts, and the
  amendments are committed with the pilot.

**Execution checkpoints (every stage).**
- **Pre-stage re-probe.** The executor re-runs the Baseline probes plus the Stage 0 census script
  and diffs against the counts in the previous Stage Log entry. Drift (routes added/moved since
  the plan was written) → update the stage's file list BEFORE starting and log the delta. Never
  execute against a stale file list.
- **Post-stage fresh-context review.** After each stage merges, a FRESH-context agent (Codex
  preferred; else a new-session agent that has read only this plan + the stage diff) reviews the
  stage against its checklist. Interval rule: **no stage starts while the previous stage's review
  has unresolved findings.** Findings and resolutions land in the Stage Log; High findings block.
- **Green gates between stages.** `npm test` (full), `npm run build`, `npm run check:api-routes`
  (+ self-test), `npm run check:route-lifecycle-auth` (+ self-test),
  `npm run check:dataverse-access-layer` (+ self-test), and — once it exists —
  `npm run check:route-service-boundary` (+ self-test). A red gate is a P0 stop.

---

## Stages

### Stage 0 — Census, probe script, test inventory (no production code changes)

**Tests that must exist before this stage:** none (this stage creates the measurement).

1. Write `scripts/check-route-service-boundary.js`: for every file under `pages/api` (excluding the
   two carried-over exempt dirs), detect imports of `lib/dataverse/adapters/*` and
   `lib/services/dynamics-service`.
   `[RECHECKED after scripts/check-route-service-boundary.js change: spec still accurate — review rounds hardened it on top of this contract (b3bbdad4 binding-level re-export taint + fail-closed non-literal sources; dc60b3e6 unresolved-binding propagation; 52652882 late-assignment provenance; round-4 fix same-file alias-chain propagation); live census 49, gate + self-test green]` Modes: `--report` (rollup by domain), default = ratchet mode
   against a committed baseline file `scripts/route-service-boundary-baseline.json`
   (`{ "boundaryImportingRoutes": <N> }`, N = union of both import kinds). Fail if the count
   RISES; a falling count must update the baseline in the same commit. **Reuse the hardened
   scanner machinery from `scripts/check-dataverse-access-layer.js`** — extract its shared
   primitives (alias/namespace collection, dynamic-import recognition, export/re-export
   detection, the sanctioned-reference audit, fail-closed unknown handling) into a shared
   module both gates import, and add adapter-source detection (`lib/dataverse/adapters/*`) as a
   second recognized source family. Do NOT re-implement a looser import matcher: the P0 review
   (change 5) and the S330 gate correction both established that naive per-file import/alias
   detection is evadable by ordinary indirection.
   The census REPORT must classify every in-scope route into a wave bucket explicitly,
   including the two DynamicsService-only routes and any root-level `pages/api/*.js` file
   (e.g. `pages/api/test-email.js` has no domain directory) — no route may fall outside the
   taxonomy silently; an unclassifiable route is a Stage 0 error to resolve, not skip.
2. Write its self-test with synthetic fixtures. RED fixtures must prove the adapter-source
   family INHERITS the hardened scanner behavior, not just the trivial case: (a) direct
   adapter import in a route; (b) adapter import via in-file alias; (c) adapter re-export
   through a wrapper module consumed by a route; (d) dynamic `import()` of an adapter source;
   (e) inline `require('<adapter path>')...` chain; (f) `dynamics-service` import (the second
   source family); (g) a root-level `pages/api/*.js` route with a boundary import — proving
   root-level files are classified, not skipped. GREEN fixtures: a clean shell route; a
   route importing only `lib/services/<domain>/` services; the exempt dirs untouched.
   **Caution:** fixture files containing import strings can trip the repo's scanner gates —
   use a temp fixture root the gate is pointed at (the dataverse self-test's temp-root +
   `--root` pattern), never fixtures under `pages/`.
3. Register both in `package.json` and `docs/CI_GATES_REFERENCE.md`; add to the `/start` gate list
   in `.claude/skills/start/SKILL.md`.
4. Test inventory: for each in-scope route (the census output), record in the Stage Log whether any
   unit/integration test exercises it (grep `tests/` for the route path and handler name).
   Deliverable: route → test file(s) → "characterization gap yes/no" table.
5. Commit. **Done means:** gate + self-test green, baseline JSON committed, inventory table in the
   Stage Log, full suite green at the prior count or better.

### Stage 1 — Pilot: one mid-size route with an existing integration test

**Pilot file:** `pages/api/review-manager/withdraw-sufficient.js` (8 KB; existing
`tests/integration/withdraw-sufficient-route.test.js`) `[VERIFIED both exist 2026-07-04 via ls]`.

**Tests that must exist before this stage:** the existing integration test PLUS characterization
additions for any gap the Stage 0 inventory flagged: status codes for (a) unauthenticated,
(b) wrong method, (c) happy-path envelope, (d) at least one domain error path.

1. Create `lib/services/review-manager/withdraw-sufficient-service.js` holding all business logic;
   route becomes the shell per Decision 1; legacy wrapper → `withDalContext` (Decision 4).
   `[RECHECKED after lib/services/review-manager/withdraw-sufficient-service.js change: step executed 2026-07-05 —
   service created, route shelled (65 lines) onto withDalContext('review-manager-withdraw-sufficient'), baseline
   49→48; integration 14/14, service unit 13/13, full suite 4205/4205, build + gates green; P1 review pending]`
2. Add a unit test for the SERVICE (logic-level, adapters mocked) — the new test layer that could
   not exist while logic lived in the route.
3. Run the full verification block. Census count drops by ≥1; update baseline JSON same commit.
4. **P1 checkpoint:** fresh-context review of the pilot diff; amend this plan's decisions and
   per-wave checklist with what the pilot taught; commit the amendments.
5. **Done means:** all gates green, route file is a shell (target <~80 lines), service unit test
   exists, P1 findings resolved, plan amended.

**Pilot limitation + secondary checkpoints (P0 review change 4).** `withdraw-sufficient.js`
proves partial-success/state-before-email extraction but teaches NEITHER the streaming nor the
multi-verb pattern. Two additional mandatory checkpoints:
- **P1s (streaming pilot):** the smallest streaming route,
  `reviewer-finder/generate-emails.js` (23.6K vs `enrich-recommended.js` 30.2K,
  `send-emails.js` 39.5K `[VERIFIED 2026-07-04 via ls]`), converts as its own named
  micro-stage **2s** in the wave table — with its own baseline update, verification block,
  and fresh-context review — BEFORE any other streaming route may start. `send-emails.js`
  is correspondingly its own stage **2b**, gated on the 2s review clearing;
  `enrich-recommended.js` stays in wave 4 but may not start before 2s clears either.
- **P1m (multi-verb pilot):** the first multi-verb route converted gets the same treatment
  BEFORE `my-candidates.js` may start.

### Stages 2-5 — Domain waves

Wave order balances risk against learning: the pilot's domain completes first (shared namespace,
patterns fresh), then the next-smallest coherent domain, then the largest, then the fail-closed
tail. **The authoritative file list for every wave is the Stage 0 census re-run at wave start** —
the domain counts below are the 2026-07-04 baseline, recorded for delta-checking, not as a frozen
list.

| Stage | Wave | Expected census delta | Notes |
|---|---|---|---|
| 2 | review-manager, non-streaming | 8 (domain has 10: pilot converted in Stage 1, `send-emails.js` deferred to 2b, 8 remain) | One `lib/services/review-manager/` namespace. Convert smallest-first. |
| 2s | **P1s streaming-pilot micro-stage**: `reviewer-finder/generate-emails.js`, pulled forward from wave 3 | 1 | Own baseline update + fresh-context review (the P1s checkpoint). No other streaming route may start until this review clears. |
| 2b | `review-manager/send-emails.js` | 1 | Streaming; starts only after P1s clears. `render-emails.js` and `send-emails.js` visibly share email-template concerns `[ASSUMED — executor verifies overlap before extracting]`: if confirmed, extract ONE shared module, not two copies. |
| 3 | reviewer-finder, remaining | 5 (`generate-emails.js` already converted in 2s) | Heavy read paths; `my-candidates.js` (34 KB, multi-verb — P1m applies) and `save-candidates.js` (29.3 KB) last. Characterization tests must pin response envelopes BEFORE moving — clients depend on exact shapes. |
| 4 | workbench | 16 routes | Largest wave — split into ≥3 commit series (`grantee-deliverables/` sub-tree as its own series); re-probe between series. |
| 5 | tail | admin 4, external 3, cron 3, expertise-finder 2, grant-reporting 2 (incl. DynamicsService-only `extract.js`), phase-i-dynamics 1, field-primer 1, root-level 1 (`test-email.js`) — 17 total, closing the 49-route union | Cron routes keep `verifyCronSecret` + context shape exactly; external routes keep token-verification guards untouched. These are fail-closed production surfaces — any ambiguity is **STOP-AND-ASK**. Root-level routes have no domain dir; their services go under the closest domain namespace (Stage 0 classification decides, recorded in the Stage Log). |

**Per-wave contract (identical for Stages 2-5):**
- **Pre-extraction envelope inventory (P1 amendment 2):** before moving logic, list every non-2xx
  response body shape the route emits (grep its `res.status(...).json(...)` calls); pin moved
  envelopes in tests; non-`{ error }` shapes use `ServiceHttpError.body` (Decision 3).
- **Tests before:** every route in the wave has characterization coverage (write the gaps found in
  Stage 0 FIRST, as their own commit, green before extraction begins). The minimum
  (auth/method/envelope/one error path) applies only to plain request-response routes.
  Routes with streaming, partial success, lifecycle ordering, optimistic locking, or
  method-specific envelopes must pin those behaviors specifically (P0 review change 7):
  `send-emails` — SSE event parsing and ordering, partial sent/skipped/failed arrays,
  fail-closed templateType, lifecycle-after-send, campaign-config non-clobber (extend
  `tests/integration/send-emails-route.test.js`); `my-candidates` — GET/PATCH/DELETE pinned
  separately, duplicate-email partial success and savedFields (extend
  `tests/unit/my-candidates-partial-save-on-email-conflict.test.js`). The Stage 0 inventory
  marks which routes carry these traits so wave executors don't rediscover them.
- **Per-file loop:** extract service → shell the route → service unit test → targeted jest →
  **static shell audit (P1 amendment 3):** grep the shelled route for adapter/`dynamics-service`/
  `bypassDynamicsRestrictions` imports (must be none), exactly one string-labeled
  `withDalContext` per verb, no residual business logic — the behavior suite alone won't catch
  a route that kept the legacy wrapper (the integration tests mock below it) → commit (one
  route or one small cluster per commit).
- **Wave close:** full verification block; baseline JSON updated — expected delta = the stage's
  "Expected census delta" column, and the running sum across Stages 1-5 must land exactly on
  the 49-route union (1+8+1+1+5+16+17 = 49); post-stage fresh-context review; Stage Log entry
  with before/after counts.

### Stage 6 — Boilerplate unification (conditional)

Only after Stages 2-5: if ≥3 waves produced near-identical shell boilerplate, extract a single
`lib/api/route-shell.js` helper (method check + error→HTTP mapping only; auth guards stay explicit
per route — `check:route-lifecycle-auth` matches literal `requireAppAccess` argument lists, so
verify the helper shape against that gate's matcher before adopting it). If shells diverged
legitimately, record "no helper — divergence is real" in the Stage Log and skip. **STOP-AND-ASK
if unsure.**

### Stage 7 — Ratchet becomes law

Baseline JSON deleted; `check:route-service-boundary` fails on ANY `pages/api` import of adapters
or `dynamics-service` outside the exempt dirs. Self-test reworked to law-mode fixtures. Reconcile:
`docs/API_ROUTE_SECURITY_MATRIX.md` notes where logic moved; CLAUDE.md Source-Of-Truth pointers if
the service layout rule changes; agent-wiki topics touched by the waves
(`reviewer-workbench-lifecycle`, `reviewer-origination`, `dataverse-dynamics`). Final full-suite +
build + all-gates run. Campaign close-out entry in `DEVELOPMENT_LOG.md`.

---

## Stage Log

*(append-only; every entry records: date/session, commits, census counts before/after, test totals,
review verdict + findings + resolutions)*

- 2026-07-04 (S330): Plan drafted. Baseline probed (47 adapter-importing routes; 8 dynamics-service
  importers outside exempt dirs, union then still unprobed — historical record of the round-1
  live-state error; resolved to 49 the same day, see next entries; suite 4188/4188). Sent to P0.
- 2026-07-04 (S330): **P0 round 1 (Codex, owner-run console session): NOT SATISFIED** — 1
  live-state error (wave table implied 47-route coverage while the true union is 49; the two
  DynamicsService-only routes `grant-reporting/extract.js` and `test-email.js` were unstaged)
  + 7 required changes. All folded in: union re-probed to 49 `[VERIFIED via sorted-union grep]`;
  Stage 0 gains explicit union classification incl. root-level routes; Decision 1 amended for
  multi-verb dispatch + pre-stage decomposition; new Decision 1a streaming contract with three
  identified SSE routes; P1s/P1m secondary pilots added (streaming pilot = `generate-emails.js`,
  pulled forward; `send-emails.js` moves to end of streaming set); gate design now reuses the
  hardened dataverse-scanner primitives via a shared module + adapter-source detection;
  Decision 4 gains the string-label AST precheck and same-or-wider-scope assertion;
  characterization minimums upgraded for streaming/partial-success/multi-verb routes.
  Sent to P0 round 2.
- 2026-07-04 (S330): **P0 round 2 (Codex): NOT SATISFIED** — round-1 repairs verified live
  (union 49, streaming trio, smallest streamer, 48 string-label bypass calls probed), but 1
  residual live-state error (objective still said "single-verb files" while naming multi-verb
  `my-candidates.js`) + 3 changes. Folded in: objective wording fixed; P1s made a named
  micro-stage **2s** with its own census delta, `send-emails.js` split out as stage **2b**,
  wave deltas restated to sum exactly to 49 (1+8+1+1+5+16+17); gate self-test spec expanded to
  prove adapter-source detection inherits the hardened scanner classes (alias/re-export/
  dynamic-import/inline-require) plus root-level route classification. Sent to P0 round 3.
- 2026-07-04 (S330): **P0 round 3 (Codex): SATISFIED — zero live-state errors.** All round-2
  repairs verified against live code (objective wording vs `my-candidates.js:69` dispatch;
  stage deltas vs live census 47/8/49 with the running-sum rule; SSE confirmed for all three
  streaming routes; gate self-test spec vs the hardened scanner's audit classes). P0 closed;
  plan promoted draft → active. Execution not started; Stage 0 is the next action for this
  campaign, in a dedicated session, after the owner's prod `DATAVERSE_DAL_ENFORCEMENT` flip
  per the agreed sequencing.
- 2026-07-04 (S331): **Stage 0 executed.** Pre-stage re-probe matched the S330 baseline with
  zero drift `[VERIFIED via sorted-union grep this session: 47 adapter-importing, union 49,
  DynamicsService-only = grant-reporting/extract.js + test-email.js]`. Built:
  `scripts/lib/ast-scan-core.js` (shared scanner core extracted from the dataverse gate —
  parse/walk/alias/dynamic-import/re-export/export-scope primitives plus a
  `createSourceRecognizers(isModuleSource)` factory; DynamicsService-specific attribution,
  `unattributable-use` audit, and law-mode stayed in `scripts/check-dataverse-access-layer.js`,
  which now imports the core — its inserted lines are import plumbing only
  `[VERIFIED via git diff]`, behavior pinned by its unchanged 27-assertion self-test);
  `scripts/check-route-service-boundary.js` (`--report` wave-bucket rollup + default ratchet
  vs `scripts/route-service-boundary-baseline.json` `{ "boundaryImportingRoutes": 49 }`,
  fail-closed on unclassifiable routes; re-export taint resolves relative specifiers and does
  NOT propagate through legitimate service use of adapters); self-test with temp-root fixtures
  covering red classes (a)–(g) from the Stage 0 spec plus green shell/service/exempt-dir
  fixtures. Registered in `package.json`, `docs/CI_GATES_REFERENCE.md`,
  `.claude/skills/start/SKILL.md`, and `.github/workflows/test.yml` (workflow rows were a gap
  caught in owner review — CI enumerates gates explicitly). Live census 49 == baseline; wave
  buckets sum 1+8+1+1+5+16+17 = 49.
  **Test inventory (deliverable 4):** 49/49 routes classified; all 49 have at least one
  route-exercising test. (An initial sweep reported `workbench/dashboard.js` as untested;
  the disconfirming grep found `tests/integration/workbench-routes.test.js:57-59` loads its
  handler directly `[VERIFIED via that file]` — table corrected before commit.) "No gap"
  here means *some* handler/endpoint test exists; positive rows were spot-checked, not each
  re-read, and the per-wave minimum (auth/method/envelope/one error path) is still verified
  at wave start per the per-wave contract. Trait routes confirmed: streaming = `review-manager/send-emails.js`,
  `reviewer-finder/generate-emails.js`, `workbench/enrich-recommended.js`; multi-verb =
  `reviewer-finder/my-candidates.js`. Thin coverage flagged for wave planning:
  `reviewer-finder/save-candidates.js` (29.3 KB) and `workbench/enrich-recommended.js` are
  each covered only by `tests/unit/reviewer-route-identity-gate.test.js`. Full route→test
  table below.
- 2026-07-04 (S331): **Post-stage review round 1 (Codex adversarial, fresh-context): NOT
  SATISFIED — 2 Highs**, both confirmed against source and fixed same session:
  (1) import-then-export wrappers escaped the boundary-equivalent taint (`reexport: true`
  was only set for `export … from` / CJS export-right require); fixed with binding-level
  taint — `boundaryExports` tracks which exported names re-publish a boundary binding, and
  a consumer is counted only when it imports a tainted name (namespace imports taint if any
  tainted export exists). False-positive guard verified live: `lib/services/prompt-store.js`
  re-exports `PROMPT_STORE_ERROR_CODES` from an adapter, but `reviewer-finder/
  prompt-override.js` imports only local service functions, so it correctly stays out of the
  census (a coarse file-level fix wrongly pushed the count to 50; the binding-level design
  holds it at 49).
  (2) Non-literal `require()`/dynamic `import()` sources fell through silently (fail-open);
  fixed with `unresolved` markers that HARD-FAIL with `file:line` when in an in-scope route
  or in a `module.exports` re-export position of a route-reachable module. **Scoping
  decision (owner-ratified, flagged to re-review):** the hard-fail is NOT "any
  route-reachable module" — 6 benign non-literal requires exist live (bundler-avoidance in
  `lib/dataverse/client.js`, lazy backend selection in `app-access-service.js`,
  `database-service.js`, `settings-service.js`, `prompt-resolver.js` fallback import), 4
  route-reachable; the broad reading would red the live gate on day one. Mirrors the
  dataverse gate's boundary-decision-relevant scoping; no per-file exemptions added.
  Self-test grew to 9 red / 5 green fixture classes incl. (h) ESM import-then-export
  wrapper, (i) CJS binding re-export wrapper, (j)/(k) non-literal import()/require() in a
  route (hard-fail), (l) GREEN service-uses-adapter-exports-own-functions; all proven
  non-decorative against the saved pre-patch gate (it exited 0 on h/i/j/k). Live census 49
  unchanged; dataverse gate + self-test untouched-green. Post-stage re-review: see next
  entry (interval rule — Stage 1 may not start until it clears).
- 2026-07-05 (S331): **Post-stage review round 2 (Codex adversarial): NOT SATISFIED — 1
  High.** Round-1 fixes (h/i, direct j/k) confirmed materially covered and the non-literal
  scoping decision accepted in principle, but the unresolved taint did not propagate through
  LOCAL BINDINGS: `const a = require(process.env.ADAPTER_PATH); module.exports = a;` (or
  `= { a }` / `exports.a = a`) evaded — the non-literal require was recorded unresolved but
  not re-exported, and the export of `a` carried no unresolved provenance (Codex proved
  evasion with a virtual-FS probe: `analyzeRoot()` returned `[]`). Fixed same session:
  `collectFileInfo` now records `unresolvedBindings` for every name a declarator binds when
  its init (climbing await/paren wrappers, destructuring included) is a non-literal
  `require()`/`import()`; a module becomes unresolved-equivalent when any unresolved binding
  is identity-exported, with propagation through whole-namespace exports. False-positive
  posture held: the three live lazy-backend services (`app-access-service.js`,
  `database-service.js`, `settings-service.js`) assign `require(modName)` inside a getter
  (assignment, not identity export) and stay green with all three route-reachable. New
  fixtures (n)/(o)/(p) proven non-decorative against the saved round-1 gate (it returned
  exit 0 on all three; patched gate exits 2 naming each wrapper with file:line); GREEN (q)
  module-scope-require-own-function-exports stays clean. Live census 49 unchanged. Round-3
  re-review pending.
- 2026-07-05 (S331): **Post-stage review round 3 (Codex adversarial): NOT SATISFIED — 1
  High**, the adjacent variant of round 2: LATE-ASSIGNED bindings carried no provenance
  (`let a; a = require(p); module.exports = a` evaded both the unresolved hard-fail AND, in
  the literal-adapter variant, the boundary count — Codex in-memory probe returned `[]`).
  Round 2's declarator fixes (n)/(o)/(p) were confirmed closed and q/lazy services green.
  Fixed same session: `assignedIdentifierTarget` records provenance when a
  require()/import() (wrapper-climbing) is the RHS of a plain identifier assignment —
  literal sources → `importedBindings`, non-literal → `unresolvedBindings`; the existing
  identity-export propagation needed no changes. The three lazy-backend getter services'
  late assignments now ENTER the unresolved-binding set and stay green solely via the
  identity-export check (they export own functions / `{ DatabaseService }`) — verified
  live, census 49 with all three route-reachable. New fixtures: (r) late-assign non-literal
  wrapper (hard-fail path), (s) late-assign literal adapter wrapper (boundary-count path);
  both proven evading the saved round-2 gate (exit 0) and caught by the patched gate.
  Self-test now 10 red / 5 green. Round-4 re-review pending.
- 2026-07-05 (S331): **Post-stage review round 4 (Codex adversarial): NOT SATISFIED — 1
  High, WITH class adjudication.** Round-3 fix verified good (literal late-assign counted,
  non-literal fails closed, lazy services + q green, census 49). Codex enumerated the
  remaining binding-flow evasion class and ruled: same-file ALIAS CHAINS are the only
  realistic remaining shape (`const a = require('<adapter>'); const b = a;
  module.exports = b` — probe-confirmed evading both count and hard-fail paths);
  object-property namespace construction "adjacent but less likely"; array assignment
  destructuring "adversarial-only for this codebase"; function-returned require outside the
  ratchet (route-side non-literal already fails closed). Fixed same session: alias edges
  collected from Identifier→Identifier declarators and plain assignments (wrapper-climbing),
  post-walk fixpoint propagates importedBindings AND unresolvedBindings provenance across
  chains of any length; identity-export checks unchanged (alias collection is
  module-agnostic like the existing binding captures — the identity-export check remains the
  noise filter). Fixtures (t) literal length-3 alias chain (count path) and (u) non-literal
  alias chain w/ late-assign hop (hard-fail path), both proven evading the saved round-3
  gate. Self-test 11 red / 5 green. Lazy services + q green; live census 49 unchanged.
  Round-5 re-review = clearance verification (verify alias fix + confirm the round-4 class
  enumeration is fully dispositioned).
- 2026-07-05 (S331): **Post-stage review round 5 (Codex, clearance verification): SATISFIED
  — zero findings. Stage 0 interval-rule review CLEARS; Stage 1 may start.** Codex
  re-probed its round-4 alias shapes in-memory (literal 2-hop and 3-hop chains counted;
  non-literal alias hop hard-fails `unresolved-boundary-source`; green shapes l/q return
  empty), confirmed live census 49 with the three lazy-backend services absent, confirmed
  the round-4 class enumeration fully dispositioned, and confirmed Stage Log rounds 3-4
  accurate. Operational note: the round-5 run through the plugin companion hung (0 commands
  logged in 20 min — matches the known plugin job-tracking bugs); killed, job record
  cleaned, relaunched via synchronous `codex exec --sandbox read-only`, completed normally.
  Prefer `codex exec` for review runs when the companion path stalls.
- 2026-07-05 (S331): **Stage 1 (pilot) executed and P1-cleared.** Pre-stage re-probe: census
  49, zero drift. Phase A (`eefd606b`): 4 characterization tests added (405+Allow, auth
  short-circuit, exact happy-path envelope, 404 domain error) — none of the four plan-minimum
  classes pre-existed; 14/14 green. Phase B (`f87f4f7e`): route 172→65-line shell;
  `lib/services/review-manager/withdraw-sufficient-service.js` (166 lines) preserves
  per-suggestion partial-success `results[]` verbatim + state-before-email `ifMatch` ordering;
  legacy bypass → `withDalContext('review-manager-withdraw-sufficient')` (string label +
  same-or-wider scope verified — `withDalContext` at `lib/dataverse/core/context.js:46-54`
  delegates to `bypassDynamicsRestrictions`); 13-test service unit suite; census 49→48,
  baseline same commit; suite 4205/4205; build green.
  **P1 retrospective (Codex, fresh-context): PASS-WITH-FINDINGS, no Highs.** Medium: pilot
  error shape too narrow as campaign template → fixed same session with shared base
  `ServiceHttpError` (`lib/services/service-http-error.js`; `httpStatus`/`body`/`code`;
  shells map `e.body ?? { error: e.message }`; `WithdrawSufficientError` now extends it,
  signature unchanged, 31/31 tests green). Low: behavior suite alone can't prove shell shape
  (integration test mocks `dynamics-context` below `withDalContext`) → static shell audit
  added to the per-file loop. All five P1 amendments folded into Decision 3 + per-wave
  contract. Operational notes: two more Codex hangs this stage — root cause found:
  `codex exec` in a non-TTY background shell blocks on stdin ("Reading additional input from
  stdin..."); ALWAYS launch with `< /dev/null`. Watchdog upgraded to session-file-growth
  stall detection (8 min frozen = stall) rather than wall-clock-only.
- 2026-07-05 (S331): **Stage 2 (review-manager non-streaming wave) executed.** Pre-stage
  re-probe: census 48, review-manager 9 (8 wave + send-emails→2b), zero drift. Phase A
  (`76a8d2eb`): envelope inventory + characterization gaps for all 8 routes (70/70 across 9
  suites); asymmetries pinned before extraction — reviewers.js sequential batch PATCH
  (midway failure leaves earlier writes applied), render-emails + reviewers 405 without
  Allow, download-review binary 200 + golden headers, materials-preflight sanitized
  200-failure. Phase B in three clusters (`442a588e`, `638ab89e`, `199fdd5f`): 8/8 routes
  shelled to `lib/services/review-manager/` services with ServiceHttpError mapping (explicit
  `body` on every non-`{error}` envelope), legacy bypass → labeled `withDalContext` (labels
  kept; scopes same-or-wider per route, widenings noted per cluster commit), static shell
  audits clean, per-route service unit suites added. Census 48→40 — exactly the plan's
  expected wave delta; running sum 1+8 = 9 of 49. (Disconfirming grep note: two
  review-manager routes outside the census — `send-review-reminder.js`, `upload-review.js`
  — still call `bypassDynamicsRestrictions` without boundary imports `[VERIFIED via grep
  this session]`; they are bypass-strip work, not route-service census work.) Cluster 1 additionally received a
  line-by-line independent verification by a second agent (an accidental duplicate executor
  turned verifier — findings matched the committed work). Wave-close verification: all
  gates green, suite 4274/4274 (369 suites), build exit 0. Post-stage fresh-context review:
  next entry (interval rule — stage 2s may not start until it clears).
- 2026-07-05 (S331): **Stage 2 post-stage review (Codex, fresh-context): SATISFIED — zero
  findings. Stage 2 CLEARS; micro-stage 2s may start.** All six risky semantics verified at
  file:line (sequential batch PATCH, sanitized 200, best-effort mint cleanup, 409 triple +
  writtenToDynamics:false, no-Allow 405 + per-recipient skips, binary send in shell); no
  scope narrowing found; census 40 independently re-run; characterization files proven
  unchanged through extraction via git diff. Reviewer re-ran the four non-mutating gates
  itself (self-tests blocked by read-only sandbox — covered by the owner-side full sweep).
- 2026-07-05 (S331): **Stage 2s (streaming pilot) executed and P1s-cleared.** Phase A
  (`845dac6b`): full SSE event vocabulary pinned pre-extraction per Decision 1a —
  progress/email_generated/result/complete/error with payload key sets, terminal sequences,
  non-terminal per-candidate failure, time-budget abort; 11/11. Phase B (`44c8f97f`): route
  630→164-line shell (405/auth/rate-limit order, SSE framing, res.end everywhere);
  `lib/services/reviewer-finder/generate-emails-service.js` (578 lines) exposes
  `generateEmails(args, onEvent)`, never touches `res`, terminal failures emit one `error`
  event and RESOLVE (not throw); one `withDalContext('reviewer-finder-generate-emails')`
  widened over and retired both legacy step scopes. Census 40→39. (`eac878d5`/`7ec80250`:
  stray agent *.log files removed from the extraction commit + root `/*.log` gitignore.)
  **P1s checkpoint (Codex, fresh-context): SATISFIED, no blocking findings — P1s CLEARS;
  2b may start.** Resolve-after-terminal-error ratified as THE streaming template; template
  notes for 2b/enrich-recommended recorded: shell owns headers/serialization/res.end;
  res.write failures are transport failures, not service-domain errors; pin the FULL
  conditional event vocabulary before extraction (send-emails: partial sent/failed/skipped
  arrays + lifecycle-after-send ordering; enrich-recommended: empty/terminal frames +
  progress ordering). Operational note: harness background tasks hosting codex exec were
  externally reaped twice (task + watchdog pair-killed, codex process dying with them);
  protocol now: launch codex exec DETACHED (`nohup … & disown`, output to scratchpad,
  `< /dev/null`) with a disposable poller — the review survives poller loss.
- 2026-07-05 (S331): **Stage 2b executed and cleared — review-manager domain closed.**
  Phase A (`e56bf221`): full conditional SSE vocabulary pinned per P1s template notes (9
  added, 20→29 route tests; 61/61 combined), and the render-emails overlap question the
  wave table had left open is now RESOLVED with evidence: `loadCycleConfigs` was duplicated
  with different field projections; HTML helpers are not shared. Phase B (`2201a9b2`):
  shared `cycle-config-loader.js` preserving each caller's exact historical projection (no
  silent superset); `send-emails-service.js` (842 lines) on the 2s template; route
  871→105-line shell; one `withDalContext('review-manager-send')` (old bypass additionally
  wrapped only non-Dataverse framing — 4b satisfied). Census 39→38 `[VERIFIED via
  check:route-service-boundary run this session]`. **Post-stage review (Codex,
  fresh-context): SATISFIED, no findings — 2b CLEARS, Stage 3 may start.** Reviewer
  verified both historical projections at pinned file:lines, swept lib/ for a third
  cycle-config duplicate (none — grant-cycles-dataverse.js, maintenance-service.js,
  grant-cycle.js adapter are different concerns), confirmed all seven Dataverse touchpoints
  inside the new context, guard order, lifecycle-after-send + failure-skips-lifecycle,
  characterization byte-integrity via git diff. Milestone sweep: all gates green, suite
  4307/4307 (371 suites), build exit 0. Running sum: 11 of 49 converted `[VERIFIED via
  census 49→38 across the per-stage boundary gate runs logged above]`.
- 2026-07-05 (S331): **Stage 3 (reviewer-finder wave) executed; P1m ratified with caveat.**
  Phase A (`807fe7ea`): envelope inventory + characterization for all 5 routes (full suite
  4336 at close); my-candidates found ALREADY decomposed per-verb (Decision 1 pre-stage
  requirement structurally satisfied); my-proposals found already on withDalContext.
  Cluster 1 (`83ddf2cb`): contact-history/load-proposal/my-proposals — load-proposal's
  method-before-auth order preserved; census 38→35. Cluster 2 (`db1d1a76`):
  save-candidates 541→76-line shell, 474-line service, partial-success envelopes byte-exact
  (422 always carries both rejected counts; 200 keys conditional — historical asymmetry
  verified against `git show` by the reviewer); identity-gate suite 42/42 unmodified;
  census 35→34. Cluster 3 (`26b098b1`): my-candidates P1m pilot — 705→115-line shell, one
  service method per verb, one context around dispatch (same scope as historical single
  bypass), duplicate-email 409 partialSuccess/savedFields preserved with
  accumulator-outside-try; census 34→33. Suite 4384/4384.
  **Post-stage review (Codex, fresh-context): PASS-WITH-FINDINGS — zero code findings; the
  one LOW was this missing Stage Log entry (resolved by this entry). Stage 3 CLEARS; Stage
  4 may start. P1M RULING: multi-verb template RATIFIED with one caveat** — "one context
  around dispatch" applies only when the historical route had one shared auth/trust
  boundary for all verbs; a future multi-verb route with branch-specific auth or DAL scopes
  must preserve those branch boundaries. The five ratified P1m notes (record for future
  multi-verb conversions): (1) one context around dispatch per the caveat above; (2)
  per-verb error mapping in per-verb shell handlers, never one generic catch (verbs kept
  different 500 messages; proposals-mode sanitizes while siblings leak dev details); (3)
  validation placement follows branch entanglement — branch-independent input checks stay
  in the shell, validations interleaved with body-shape dispatch move into the service as
  typed errors (hoisting reorders observable behavior); (4) typed-error passthrough
  (`instanceof ServiceHttpError → rethrow`) must precede provider-error translation or
  domain errors get eaten; (5) partial-success accumulators (savedFields) declared OUTSIDE
  the try so the catch can report partial success — pin with a dedicated test before
  moving. Running sum: 16 of 49 converted `[VERIFIED via census 49→33 across the per-stage
  boundary gate runs logged above]`.
- 2026-07-05 (S331): **Stage 4 (workbench wave, 16 routes, three series) executed.**
  Series A (`5d1fa746` phase A, `f27fb128` extraction): 9 core routes; all single-verb, no
  P1m concerns; binary routes on send-in-shell; manual-reviewer's 409 conflict-code family
  as explicit bodies; one ratified deviation (manual-reviewer service imports
  lookupReviewerIdentity from its canonical lib home; mock retarget verified plumbing-only);
  census 33→24. Series B (`4e2dec35`): enrich-recommended on the 2s template — all three
  streaming routes now converted; census 24→23. Series C (`5fa5638b`): grantee-deliverables
  subtree in nested lib/services/workbench/grantee-deliverables/; abstract.js is the first
  live application of the P1m caveat (two historical branch-specific DAL scopes preserved
  as two per-verb contexts); send-invite's partial-success statusPersisted:false and
  generate's ETag idempotency moved verbatim; census 23→17.
  **Wave-close red-gate catch and fix (`4d40a326`, `5f88c393`, `c87ec743`):** the full
  sweep caught check:model-override-warming red — series A had moved applicant-reviewers'
  loadModelOverrides() warm into the service, but the gate contract requires the awaited
  call at ROUTE level (per-cluster targeted gates don't include this gate; the wave-close
  full sweep exists for exactly this). Fixed to a single route-level warm; the series-A
  service test that pinned service-side warming was superseded and inverted to pin
  NOT-called (the endpoint suite pins the once-only route-level call). Lesson for Stage 5
  executors: when a route touches model resolution, the warm stays in the shell.
  Wave-close final: all gates green, suite 4504/4504 (395 suites), build exit 0. Running
  sum: 32 of 49 converted `[VERIFIED via census 49→17 across the per-stage boundary gate
  runs logged above]`. Post-stage review: next entry.
- 2026-07-05 (S331): **Stage 4 post-stage review (Codex, fresh-context): SATISFIED — zero
  findings. Stage 4 CLEARS; Stage 5 may start.** P1m-caveat application in abstract.js
  verified exact against historical scopes via git show; 2s-template compliance verified;
  the model-override-warming fix chain ratified (inverted pin "closes the prior bad pin
  rather than masking behavior") and the systemic question answered: the gate scans route
  import graphs transitively and only accepts route-level awaited warms
  (check-model-override-warming.js:256), so the service-warm class cannot silently recur;
  all 15 sibling routes checked clean. High-risk semantics, characterization integrity
  (both declared exceptions exactly as declared, no other drift), and the census chain
  33→24→23→17 all verified.
- 2026-07-05 (S331): **Stage 5 (fail-closed tail, 17 routes, four batches) executed —
  census ZERO, 49/49 converted.** Batch 1 (`8f731a0d`/`57fed98c`): admin ×4 +
  expertise-finder ×2 + field-primer + root test-email (service placed under
  lib/services/admin/ — requireSuperuser diagnostic tooling; guards byte-untouched;
  test-email's two branch labels kept via dispatch-selected label; field-primer Mode B
  verified pure-LLM → context stays on Mode A only); census 17→9. Batch 2 (`b85c870f`):
  grant-reporting ×2 + phase-i-dynamics — S330 audit fix preserved as a DECLARED
  Decision-3 exception (extract-service keeps its per-write
  withDalContext('grant-reporting-extract-ai-log'), narrower trust preferred over widening
  across the LLM pipeline); classifyFile moved to its canonical
  lib/services/grant-reporting/classify-file.js home; census 9→6. Batch 3 (`5f4dc863`):
  external token routes — token boundaries byte-identical (token IS the auth); drain
  contract (enqueue accept_pending BEFORE Dataverse PATCH) pinned at both levels; context's
  five branch-specific scopes preserved per the P1m caveat; census 6→3. Batch 4
  (`787feb00`, `a1a07876`): two cron routes with NAMED idempotency mechanisms
  (grantee-deliverable-reminders: claim-before-send — status flip with If-Match BEFORE
  createAndSendEmail, so double-send is impossible and the failure mode is a missed
  reminder; generate-grantee-titles: write-when-empty + fresh-ETag If-Match) — then a
  STOP-AND-ASK on drain-submissions that surfaced a REAL LATENT PRODUCTION DEFECT: the
  drain's adapter writes ran with no trusted DAL context, fail-closed under
  DATAVERSE_DAL_ENFORCEMENT since the S330 prod flip (enforcement probe confirmed; drain
  suites mock dynamics-service wholesale which is why tests were green; prod logs clean
  because idle ticks 200 regardless). Owner-side ruling: fixed in `787feb00` —
  processJob wraps every state handler in withDalContext('drain-submissions') per the DAL
  Stage 7 doctrine; regression test drives the real context machinery; the catch-path
  SAFETY-NET recordFailure runs outside the context (handler-local recordFailure calls run
  inside it — harmless PG/alert bookkeeping, no Dataverse writes; precision per the Stage 5
  review LOW). **MORNING FLAG: verify prod intake drains end-to-end;
  jobs that parked terminal since the flip may need manual requeue.** (`787feb00` also
  carries the two cron extractions — commit message describes only the fix; recorded here
  for accuracy.) Final extraction (`a1a07876`): 892-line drain engine service; census
  3→1→0. Suite 4670/4670 (409 suites). Running sum: 49 of 49 converted `[VERIFIED via
  census 49→0 across the per-stage boundary gate runs logged above]`. Post-stage review:
  next entry.
- 2026-07-05 (S331): **Stage 5 post-stage review (Codex, fresh-context):
  PASS-WITH-FINDINGS — DRAIN FIX RULED CORRECT; Stage 5 CLEARS; Stages 6-7 may start.**
  The latent defect confirmed real on BOTH write paths (handleScanning grant-request create
  AND handleFilesMoved budget-line creates); fix verified with nested-bypass safety
  (dynamics-context ALS wrapper) and no drain-breaking issue in lease renewal, recovery, or
  classifier paths. All security boundaries verified byte-preserved (strict drain secret,
  shared cron secrets before context, external token boundaries + accept_pending
  enqueue-before-PATCH); all four declared Decision-3 exceptions scope-identical to
  historical wrappers; both cron idempotency mechanisms verified at file:line; census chain
  17→9→6→3→1→0 exact; self-test decoupling sound. One LOW (resolved same session): the
  recordFailure-placement wording overstated — only the catch-path safety-net call runs
  outside the per-job context; handler-local calls run inside (harmless, PG/alert only);
  service header + this log corrected. Also: the stage-close sweep transiently reported the
  boundary gate red — root-caused to the self-test's live-baseline coupling (broke the day
  the census hit 0) + a SIGKILL-orphaned temp fixture dir that the gate provably cannot
  scan; fixed in `84f8af91` (--baseline override, fall/rise/equal fixture-local pins).
- 2026-07-05 (S331): **Stage 6 decision (owner): NO shared shell helper — divergence is
  real.** Evidence across the waves: byte-pinned 405 asymmetries (Allow vs no-Allow), the
  P1m ruling that per-verb error mapping is not shareable, dev-details 500 branches,
  method-before-auth ordering in load-proposal, and streaming/binary shells that share no
  boilerplate. A helper would invite normalizing characterized asymmetries. Recorded and
  skipped per the plan's decision branch.
- 2026-07-05 (S331): **Stage 7 executed — ratchet became LAW; CAMPAIGN CLOSED.** Gate
  default mode is now law (any in-scope boundary-importing route exits 1 naming every
  route; zero is the only passing state; mirrors the dataverse gate's Stage 8 posture);
  `--baseline` and the entire ratchet path REMOVED; `route-service-boundary-baseline.json`
  deleted; `--report`/`--json` keep a domain rollup (wave buckets retired with the
  campaign). Self-test reworked to law-mode fixtures: red classes (a)-(u) each assert the
  law failure names the route; green-only tree exits 0; temp-root discipline unchanged.
  Docs reconciled: `docs/CI_GATES_REFERENCE.md` both rows law-style; `/start` skill gate
  comment; `docs/API_ROUTE_SECURITY_MATRIX.md` header note (logic moved to
  `lib/services/<domain>/`; URLs/guards/envelopes unchanged; per-route rows untouched);
  agent-wiki topics dataverse-dynamics / reviewer-workbench-lifecycle /
  reviewer-origination / security-auth refreshed. Verification: law gate + law self-test
  green; agent-wiki/doc-currency/fact-consistency/canonical-pointers green; full suite
  4670/4670; build exit 0. Campaign totals (all `[VERIFIED via this session's gate/jest
  runs + ls]`): 49 routes → 0 across Stages 1-5, executed in one session (S331); 51 files
  across 11 new domain-service directories (services + their shared helpers); suite
  4188→4670 (+482 tests: characterization + service unit suites); five fresh-context stage
  reviews plus P1/P1s/P1m checkpoints (all cleared; findings resolved same-session); one
  real latent production defect found and fixed (drain DAL context). Completion is
  recorded in the header's execution-status line (frontmatter stays `active` per the
  docs-catalog status enum and the DAL plan's precedent).

### Stage 0 route→test inventory (2026-07-04, S331)

| route (`pages/api/`) | test file(s) | gap | traits |
|---|---|---|---|
| test-email.js | test-email-auth.test.js | no | root-level |
| admin/policies.js | admin-policies-route.test.js | no | |
| admin/prompts/[name].js | admin-prompts-publish.test.js | no | |
| admin/prompts/index.js | admin-prompts-list.test.js | no | |
| admin/review-questions.js | admin-review-questions-route.test.js | no | |
| cron/drain-submissions.js | drain-record-failure.test.js, drain-submissions-telemetry.test.js | no | cron |
| cron/generate-grantee-titles.js | generate-grantee-titles-cron.test.js | no | cron |
| cron/grantee-deliverable-reminders.js | grantee-deliverable-reminders-cron.test.js | no | cron |
| expertise-finder/batch-match.js | expertise-finder-batch-match-route.test.js | no | |
| expertise-finder/proposals.js | expertise-finder-proposals-route.test.js | no | |
| external/review/[token]/context.js | external-review-routes.test.js | no | external-token |
| external/review/[token]/respond.js | external-review-routes.test.js, email-token-resolvers.test.js, respond-required-address.test.js | no | external-token |
| external/review/[token]/submit.js | external-review-submit-route.test.js | no | external-token |
| field-primer/generate.js | field-primer-generate-route.test.js | no | |
| grant-reporting/extract.js | grant-reporting-extract-routes.test.js, grant-reporting-extract-payload-boundary.test.js | no | DynamicsService-only |
| grant-reporting/lookup-grant.js | classify-file.test.js, lookup-grant.test.js | no | `[RECHECKED after lib/services/grant-reporting/classify-file.js change: both suites still cover this route; that file is classifyFile's canonical home since Stage 5 batch 2 (authored+read this session), consumed by lookup-grant-service and load-proposal-service]` |
| phase-i-dynamics/summarize.js | phase-i-dynamics-summarize-payload-boundary.test.js, phase-i-dynamics-summarize-v2-payload-boundary.test.js, phase-i-dynamics-summarize-route.test.js | no | |
| review-manager/campaign-config.js | campaign-config-route.test.js | no | |
| review-manager/download-review.js | review-manager-download-review.test.js | no | |
| review-manager/mark-received-no-file.js | mark-received-no-file-route.test.js | no | |
| review-manager/materials-preflight.js | materials-preflight.test.js | no | |
| review-manager/regenerate-token.js | review-manager-token-routes.test.js | no | |
| review-manager/render-emails.js | render-emails-route.test.js | no | |
| review-manager/reviewers.js | auth-routes.test.js, review-manager-reviewers-answers.test.js, review-manager-reviewers-live-questions.test.js, review-manager-reviewers-outstanding-dto.test.js, review-manager-reviewers-synthesis-dto.test.js | no | |
| review-manager/send-emails.js | auth-routes.test.js, cross-user-isolation.test.js, send-emails-route.test.js | no | streaming/SSE (stage 2b) |
| review-manager/synthesize-reviews.js | synthesize-reviews.test.js | no | |
| review-manager/withdraw-sufficient.js | withdraw-sufficient-route.test.js | no | Stage 1 pilot |
| reviewer-finder/contact-history.js | contact-history-route.test.js | no | |
| reviewer-finder/generate-emails.js | auth-routes.test.js, cross-user-isolation.test.js, generate-emails-route.test.js | no | streaming/SSE (stage 2s pilot) |
| reviewer-finder/load-proposal.js | load-proposal.test.js | no | |
| reviewer-finder/my-candidates.js | my-candidates-faculty-page-url-gate.test.js, my-candidates-partial-save-on-email-conflict.test.js | no | multi-verb (P1m) |
| reviewer-finder/my-proposals.js | auth-routes.test.js, my-proposals-route.test.js | no | |
| reviewer-finder/save-candidates.js | reviewer-route-identity-gate.test.js | no (thin) | |
| workbench/applicant-reviewers.js | applicant-reviewers-endpoint.test.js | no | |
| workbench/dashboard.js | workbench-routes.test.js | no | |
| workbench/download-proposal-document.js | workbench-download-proposal-document-route.test.js | no | |
| workbench/enrich-recommended.js | reviewer-route-identity-gate.test.js | no (thin) | streaming/SSE |
| workbench/export-candidates.js | workbench-export-candidates-route.test.js | no | |
| workbench/manual-reviewer.js | manual-reviewer-endpoint.test.js | no | |
| workbench/promote-applicant-reviewer.js | promote-applicant-reviewer-contact.test.js, promote-applicant-reviewer-endpoint.test.js | no | |
| workbench/proposal-documents.js | workbench-proposal-documents-route.test.js | no | |
| workbench/resolve-request.js | workbench-resolve-request-route.test.js | no | |
| workbench/triage.js | workbench-triage-endpoint.test.js | no | |
| workbench/grantee-deliverables/abstract.js | grantee-deliverables-abstract-route.test.js | no | |
| workbench/grantee-deliverables/awardees.js | grantee-awardees-route.test.js | no | |
| workbench/grantee-deliverables/cycle-export.js | grantee-cycle-export-route.test.js | no | |
| workbench/grantee-deliverables/generate.js | grantee-deliverables-generate-route.test.js | no | |
| workbench/grantee-deliverables/recipients.js | grantee-recipients-route.test.js | no | |
| workbench/grantee-deliverables/send-invite.js | grantee-send-invite-route.test.js | no | |
