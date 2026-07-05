---
title: Route→Service Consolidation Plan
domain: architecture
kind: plan
status: draft
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
business logic — the largest are 20-40 KB single-verb files (`review-manager/send-emails.js` 39.5 KB,
`reviewer-finder/my-candidates.js` 34 KB, `reviewer-finder/save-candidates.js` 29.3 KB
`[VERIFIED 2026-07-04 via ls]`). This plan moves that logic into per-domain services under
`lib/services/<domain>/`, leaving each route a thin shell: **guard → validate input → establish DAL
context → call service → map result/error to HTTP.** The DAL migration (Stages 0-8, complete)
cleaned the layer *below* (adapters); this campaign cleans the layer *above* (routes). It ends,
like the DAL campaign, with a census gate that becomes law.

**Status: PLAN ONLY — not executed.** Written Session 330 (2026-07-04). Requires plan-review
checkpoint P0 (below) before Stage 0 starts.

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
   values, and throw typed errors carrying enough for the shell to map to HTTP (domain Error
   subclass with `httpStatus`; exact shape finalized in the pilot). Services assume a trusted DAL
   context already exists — they never establish one. Context establishment stays at the route
   (post-auth), per the Stage 7 DAL doctrine in `docs/DATA_ACCESS_LAYER_MIGRATION_PLAN.md`.
4. **Trust-wrapper conversion while touching.** When a converted route currently uses legacy
   `bypassDynamicsRestrictions`, replace it with `withDalContext` in the same commit (semantically
   identical thin wrapper `[VERIFIED 2026-07-04 via lib/dataverse/core/context.js:46-54]`; advances
   the in-campaign bypass strip). Two guards per route (P0 review change 6): (a) AST/precheck
   that the existing call passes a STRING label — `withDalContext` throws on missing/non-string
   labels where `bypassDynamicsRestrictions` accepts a bare function
   `[VERIFIED via lib/services/dynamics-context.js:67-75 vs lib/dataverse/core/context.js:47-49]`;
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
   `lib/services/dynamics-service`. Modes: `--report` (rollup by domain), default = ratchet mode
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
2. Write its self-test with synthetic fixtures (red: fixture route importing an adapter above
   baseline; green: clean shell route). **Caution:** fixture files containing import strings can
   trip the repo's scanner gates — use an env-var-pointed fixture root (the
   `check:api-routes:self-test` pattern), never fixtures under `pages/`.
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
  `send-emails.js` 39.5K `[VERIFIED 2026-07-04 via ls]`), is pulled FORWARD across wave order
  and converted as the streaming pilot — full verification block plus a fresh-context review
  of the event-contract extraction — BEFORE any other streaming route (including wave 2's
  `send-emails.js`) may start. `send-emails.js` therefore moves to the END of the streaming
  set, after P1s clears.
- **P1m (multi-verb pilot):** the first multi-verb route converted gets the same treatment
  BEFORE `my-candidates.js` may start.

### Stages 2-5 — Domain waves

Wave order balances risk against learning: the pilot's domain completes first (shared namespace,
patterns fresh), then the next-smallest coherent domain, then the largest, then the fail-closed
tail. **The authoritative file list for every wave is the Stage 0 census re-run at wave start** —
the domain counts below are the 2026-07-04 baseline, recorded for delta-checking, not as a frozen
list.

| Stage | Wave | Baseline size | Notes |
|---|---|---|---|
| 2 | review-manager | 10 routes incl. pilot (9 remaining) | One `lib/services/review-manager/` namespace. Convert smallest-first; `send-emails.js` (39.5 KB) LAST. `render-emails.js` and `send-emails.js` visibly share email-template concerns `[ASSUMED — executor verifies overlap before extracting]`: if confirmed, extract ONE shared module, not two copies. |
| 3 | reviewer-finder | 6 routes | Heavy read paths; `my-candidates.js` (34 KB) and `save-candidates.js` (29.3 KB) last. Characterization tests must pin response envelopes BEFORE moving — clients depend on exact shapes. |
| 4 | workbench | 16 routes | Largest wave — split into ≥3 commit series (`grantee-deliverables/` sub-tree as its own series); re-probe between series. |
| 5 | tail | admin 4, external 3, cron 3, expertise-finder 2, grant-reporting 2 (incl. DynamicsService-only `extract.js`), phase-i-dynamics 1, field-primer 1, root-level 1 (`test-email.js`) — 17 total, closing the 49-route union | Cron routes keep `verifyCronSecret` + context shape exactly; external routes keep token-verification guards untouched. These are fail-closed production surfaces — any ambiguity is **STOP-AND-ASK**. Root-level routes have no domain dir; their services go under the closest domain namespace (Stage 0 classification decides, recorded in the Stage Log). |

**Per-wave contract (identical for Stages 2-5):**
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
  commit (one route or one small cluster per commit).
- **Wave close:** full verification block; baseline JSON updated (expected delta = wave size);
  post-stage fresh-context review; Stage Log entry with before/after counts.

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
  importers outside exempt dirs, union TBD at Stage 0; suite 4188/4188). Sent to P0.
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
  Awaiting P0 round 2.
