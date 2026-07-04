---
title: "Dataverse Data-Access Layer — Staged Migration Plan"
domain: data-layer
kind: plan
status: active
summary: "Ratchet-gated migration of ~86 raw DynamicsService caller files into per-entity adapters; ends with fail-closed restriction context. Approved S328."
canonical: false
cataloged: 2026-07-04
owner: product-engineering
related:
  - docs/CLAUDE_REMEDIATION_PLAN.md
  - docs/APPLICATION_STATE_ATLAS.md
  - lib/services/dynamics-service.js
  - lib/dataverse/adapters/reviewer-suggestion.js
  - docs/CI_GATES_REFERENCE.md
---

# Dataverse Data-Access Layer — Staged Migration Plan

**Approved by owner (S328, 2026-07-04):** scope = every route/service/cron goes
through per-entity adapters, EXCEPT the entity-generic power tools
(Dynamics Explorer, Dataverse Bulk Export), which stay raw by design;
restriction context folds INTO the layer as a deliberate late stage;
delivery = ratchet + gate (freeze new raw usage immediately, convert
opportunistically + occasional dedicated sessions).

**Execution status: NOT STARTED.** This document is the plan. No stage below
has run.

## Why (baseline evidence)

All counts `[VERIFIED 2026-07-04 via session greps; units noted per claim; the
complement (adapters/transport/exempt tools) was excluded from each count]`.
Stage 0 replaces these literal greps with a constant-resolving census.

- **86 files** across `pages/`, `lib/`, `shared/` call `DynamicsService.`
  directly, excluding the service itself, `lib/dataverse/adapters/`, and the
  exempt power tools (only 1 of the 86 is under `shared/`).
- **4 adapter modules** exist (`lib/dataverse/adapters/`: contact,
  potential-reviewer, researcher, reviewer-suggestion) against ≥15 entity sets
  in live use.
- **39 hand-built OData `filter:` strings** outside adapters/exempt files.
- **97 files** carry their own `bypassDynamicsRestrictions` wrapper.
- **18 raw call-site lines** query `'wmkf_appreviewersuggestions'` outside its
  own 53KB adapter — drift, not design.
- Hottest raw entity: `'akoya_requests'` — **74 raw call-site lines** outside
  adapters/exempt files. Literal counts UNDERCOUNT overall usage because some
  callers pass constants (e.g. `SUGGESTION_SET`, `PROMPTS_ENTITY`); the
  Stage-0 inventory script must resolve constants, not grep literals.
- Recurring failure modes this layer removes: guessed entity-set names (two
  404s in S328 alone: `wmkf_prompts`, `wmkf_aiprompts`), per-route SELECT
  drift, per-route GUID validation, forgotten restriction wrappers. Three CI
  gates (`trust-boundary-guid`, `route-lifecycle-auth`, parts of `api-routes`)
  police after the fact what the layer makes unrepresentable.

## Ground rules for every stage (executor: read before each stage)

1. **Assumption re-verification preamble (mandatory, fresh context).** Before
   starting a stage, run in a FRESH session/agent with no memory of prior
   stages: `node scripts/check-dataverse-access-layer.js --report` (Stage 0
   builds it) and diff its counts against the stage's Preconditions. If any
   named file, symbol, or count no longer matches the tree, STOP and reconcile
   the plan first (edit this doc; note the drift in the Stage log). Never
   execute a stage against assumptions the probe cannot reproduce.
2. **Green means the FULL suite** plus the gate set for touched surfaces
   (`docs/CI_GATES_REFERENCE.md`), plus `npm run build`. Claiming green on a
   subset is a violation (memory: feedback-green-requires-full-test-suite).
3. **One caller file per commit** during conversion waves. Rollback is
   `git revert <commit>`; nothing requires multi-file atomic changes except
   where a stage says so explicitly.
4. **No renames or physical moves of existing modules until Stage 8.** New
   code lands in new files; existing callers change imports in place. This
   keeps greps and the Atlas stable throughout.
5. **Tests-before rule.** Each stage names the tests that must EXIST AND PASS
   before its first edit. If they don't exist, writing them IS the first task
   of the stage — characterization tests capture current behavior before any
   refactor.
6. **Behavior freeze.** Conversion changes imports and call shapes, never
   response DTOs, filter semantics, or error contracts. Any observed diff in a
   route's output is a stage-stopping bug.
7. **Probe scripts get committed** (`docs/CLAUDE_REMEDIATION_PLAN.md`).
8. **Label live-state claims** `[VERIFIED via X]` / `[ASSUMED]` in every stage
   report.

## Permanent exemptions (owner-approved)

- `pages/dynamics-explorer.js` + its API routes; `pages/dataverse-bulk-export.js`
  + its API routes (entity-generic by design).
- `lib/services/dynamics-service.js` itself (the transport).
- Non-entity transport concerns stay on DynamicsService: `createAndSendEmail`,
  `addEmailAttachment`, `executeChangeset` plumbing, `resolveEntitySetName`.
  Adapters COMPOSE these; they are not CRUD to wrap.
- `scripts/` (probes/one-offs): advisory-only in the gate, never blocking.

---

## Stage 0 — Inventory probe + baseline (no behavior change)

**Goal:** a committed, re-runnable census attributing every raw call site to
(file, entity, method), resolving in-file constants to entity-set strings.

**Tests before:** none beyond the probe's own self-test fixture.

**Work:**
1. `scripts/check-dataverse-access-layer.js` — walks `pages/` + `lib/` +
   `shared/` (minus exemptions), finds `DynamicsService.<method>(` call sites,
   resolves first-arg constants within the file, emits
   `{file, entity, method, line}` JSON + per-entity rollup. `--report`
   prints; default mode compares against
   `scripts/dataverse-access-allowlist.json` (created Stage 1) and exits 0
   silently when that file is absent.
2. Self-test with synthetic fixtures (violating file, constant-resolved file,
   exempt file) following the `check:*` self-test pattern in
   `docs/CI_GATES_REFERENCE.md`.
3. Append the census output as Appendix A of this doc (per-entity counts).

**Verify:** probe totals reconcile with the baseline greps above (explain any
delta — constant resolution will push counts UP); full suite + build green
(nothing behavioral touched); commit probe + self-test.

## Stage 1 — Ratchet gate (freeze new raw usage)

**Goal:** no NEW file may call DynamicsService raw, effective immediately.

**Tests before:** Stage 0 self-test green.

**Work:**
1. `scripts/dataverse-access-allowlist.json` = exact Stage-0 census (file →
   entity/method list). Gate `npm run check:dataverse-access-layer` fails on
   (a) any raw call site NOT in the allowlist, (b) any allowlist entry whose
   file no longer has raw calls (forces shrink — no zombie entries).
2. Register in `package.json`, the CI workflow, `docs/CI_GATES_REFERENCE.md`,
   and the `/start` skill's gate list.
3. Self-test: fixtures proving both failure modes fire.

**Verify:** gate green at baseline; deliberately add a raw call in a scratch
file → gate red → remove; full suite + build green.

## Stage 2 — Adapter core toolkit (foundation, zero callers moved)

**Goal:** the primitives every adapter shares, proven against the 4 existing
adapters before any new adapter exists.

**Tests before (write first):**
- Unit tests for the toolkit: OData filter builder (quote-escaping, GUID
  rejection matching `check:trust-boundary-guid` conventions, and/or chaining),
  entity-set registry (unknown entity → throw, never guess), select-list
  builder.
- Characterization coverage for the 4 existing adapters' public methods.
  Where a public method has no covering test, add golden-path + one
  failure-path tests BEFORE refactoring it onto the toolkit.

**Work:**
1. New `lib/dataverse/core/`: `entity-registry.js` (canonical entity-set names
   + per-entity SELECT constants, seeded from the Stage-0 census — the S328
   entity-name-guessing incident is the motivating case), `odata.js`
   (filter/select builders), `errors.js` (sanitized error wrapper).
2. Convert the 4 existing adapters to consume the toolkit. Behavior-preserving;
   their tests are the safety net.

**Verify:** full suite + build; the adapters' downstream integration suites
(reviewer routes) green; gate still green (allowlist unchanged).

## Stages 3–6 — Conversion waves (the bulk; ratchet shrinks)

Per-file recipe (the loop a cheaper model executes):

1. Re-verify (Ground rule 1); confirm the file still appears in the allowlist
   with the expected entity/methods.
2. Tests-before: the route/service must have a contract test asserting its
   golden-path response DTO shape and one failure path. If absent, write it
   against CURRENT behavior and commit it separately first.
3. Ensure the target adapter exposes the needed method; if not, add it WITH
   unit tests, in its own commit, before the caller moves.
4. Swap the caller's raw calls for adapter calls. No DTO/filter/error changes.
5. Remove the file from the allowlist. Run: the file's suites, adapter suites,
   `check:dataverse-access-layer`, touched-surface gates, full suite, build.
6. One commit. Report the delta: allowlist N → N−1.

**Wave order (bed the pattern on cheap wins, then the giant):**

- **Wave 3 — bypass repairs + small entities.** The raw
  `wmkf_appreviewersuggestions` call sites (adapter already exists);
  `wmkf_appreviewanswers` (reader already hoisted to
  `lib/services/review-answers.js` in S328 — wrap as adapter);
  `wmkf_ai_prompts` (new adapter absorbing `lib/services/prompt-store.js`
  queries + `pages/api/admin/prompts/*`); `wmkf_policies`,
  `wmkf_reviewquestions`, `wmkf_appsystemsettings`. Exit: those entities'
  allowlist entries = 0.
- **Wave 4 — identity/people.** `contacts`, `systemusers`,
  `wmkf_apprequestpersons`, remaining `wmkf_potentialreviewerses` strays
  (adapters exist for two of these — extend, never duplicate).
- **Wave 5 — `akoya_requests` (the giant).** Split by access pattern, in this
  order: (a) read-only single-record fetches, (b) read-only queries/lists,
  (c) writes — each write site gets an adapter method whose test asserts the
  exact PATCH body, (d) changeset participants (e.g. the external submit flow)
  LAST — they compose `executeChangeset` and need the most care.
- **Wave 6 — long tail.** `akoya_requestpayments`,
  `sharepointdocumentlocations`, `emails`/`accounts`/`annotations`,
  `wmkf_portalmemberships`, `wmkf_appgrantcycles`, anything the census adds.

Each wave ends with: allowlist strictly smaller, full suite + build green, and
a one-paragraph wave report appended to the Stage log.

## Stage 7 — Restriction context folds into the layer (invariant change)

**This deliberately changes a CLAUDE.md safety invariant. It requires an
explicit owner go/no-go at stage start, even though the direction was approved
S328.**

**Preconditions:** allowlist contains ONLY exempt files; Waves 3–6 complete.

**Tests before (write first):**
- Fail-closed unit tests: raw entity CRUD on DynamicsService without
  restriction context THROWS (new mode); adapters succeed (they acquire
  context internally); exempt tools still function via their explicit wrapper.
- An integration canary proving a converted route works with its route-level
  `bypassDynamicsRestrictions` wrapper REMOVED.

**Work (in order, each step green):**
1. Adapters acquire restriction context internally (one shared helper in
   `lib/dataverse/core/`).
2. DynamicsService gains fail-closed enforcement for entity CRUD (transport
   methods exempt), behind a temporary env flag: ON in dev/test, OFF in prod
   for one deploy cycle; flip prod ON after a clean cycle; then delete the
   flag.
3. Mechanically strip now-redundant route-level wrappers (one file per commit,
   full suite green each).
4. Reconcile docs: CLAUDE.md Universal Safety Invariants wording,
   `docs/SECURITY_ARCHITECTURE.md`, agent-wiki topics, this doc — full
   fact-level reconciliation (`/sweep`), not appends.

**Verify:** full suite, build, ALL `check:*` gates, plus a production probe of
one high-traffic route per app after each deploy step.

## Stage 8 — Ratchet becomes law; close out

- Allowlist file deleted; the gate hardcodes the permanent exemptions and
  fails on ANY other raw call site.
- Appendix A regenerated as the final census (exemptions only).
- `DEVELOPMENT_LOG.md` milestone; Atlas + agent-wiki reconciliation; this
  doc's `status:` → `superseded` by the closing report.

---

## Plan self-check protocol (meta)

This plan was produced under the fresh-context rule: baseline counts were
probed live in S328, each quantity claim re-derived with a disconfirming
query (complement sets excluded), and a fresh-context adversarial review
verified the plan's checkable claims against the tree before the plan was
committed (result in the Stage log). At execution time the same protocol is
Ground rule 1 — plus, after EACH stage completes, the executor spawns one
fresh-context reviewer whose only brief is: "read the next stage's
Preconditions, probe the tree, report every assumption that no longer holds."
Drift found → this doc is edited BEFORE the next stage starts.

## Stage log

- 2026-07-04 (S328): plan authored; owner approved scope/restrictions/cadence.
  Execution not started.
- 2026-07-04 (S328): fresh-context adversarial verification of every checkable
  claim (independent grep re-derivation, exclusions applied): **0 refuted**.
  Notables from the reviewer: the single `shared/` caller is
  `shared/utils/review-report-docx.js`; a naive un-anchored `akoya_requests`
  grep over-counts to 118 via `akoya_requestpayments` — Stage 0's census must
  use exact-token matching; `check:dataverse-access-layer` is collision-free
  in package.json; the CLAUDE.md invariant Stage 7 changes is at CLAUDE.md
  "Universal Safety Invariants" ("Use explicit Dynamics restriction context;
  preserve fail-closed auth and restriction behavior") — the go/no-go stands.

## Appendix A — Baseline census

Populated by Stage 0 (`scripts/check-dataverse-access-layer.js --report`).
Until then the literal-grep baseline stands: 86 caller files / ≥15 entity sets
/ 39 filter strings / 97 bypass files / 18 suggestion-entity and 74
akoya_requests raw call-site lines (units and exclusions per the Why section).
