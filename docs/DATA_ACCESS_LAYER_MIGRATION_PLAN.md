---
title: "Dataverse Data-Access Layer — Staged Migration Plan"
domain: data-layer
kind: plan
status: active
summary: "Ratchet-gated migration of raw/aliased DynamicsService callers into per-entity adapters; ends fail-closed. Approved S328; amended after S329 Codex review."
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

**Execution status: ALL STAGES 0–8 COMPLETE (S329, 2026-07-04).** Census
probe, law gate (allowlist deleted), core toolkit, 18 adapters, all
conversion waves, restriction fold-in. Final census: 12 identities / 11
files, all non-entity-transport. Two items remain OPEN outside the staged
plan: the mechanical strip of 79 legacy `bypassDynamicsRestrictions` importer
files `[VERIFIED 2026-07-04 via grep -rl "^import.*bypassDynamicsRestrictions"
pages lib shared, minus core/context.js]` (functionally correct as-is — the
legacy wrapper IS a trusted context) and the PROD `DATAVERSE_DAL_ENFORCEMENT`
flip (owner deploy decision). The doc stays `status: active` until those two
close — deliberately NOT flipped to superseded despite the Stage 8 text, to
avoid declaring false completion.

## Why (baseline evidence)

All literal counts `[VERIFIED 2026-07-04 via session greps; units noted per
claim; the complement (adapters/transport/exempt tools) was excluded from each
count]`. Stage 0 replaces these literal greps with an alias-aware,
constant-resolving census because literal `DynamicsService.` calls are a floor,
not the full migration surface.

- **86 files** across `pages/`, `lib/`, `shared/` call `DynamicsService.`
  directly, excluding the service itself, `lib/dataverse/adapters/`, and the
  exempt power tools (only 1 of the 86 is under `shared/`).
- **4 adapter modules** existed at baseline (`lib/dataverse/adapters/`:
  contact, potential-reviewer, researcher, reviewer-suggestion) against ≥15
  entity sets in live use. (9 as of the S329 adapter wave — see Stage log.)
- **39 hand-built OData `filter:` strings** outside adapters/exempt files.
- **97 files** carry their own `bypassDynamicsRestrictions` wrapper.
- **18 raw call-site lines** query `'wmkf_appreviewersuggestions'` outside its
  own 53KB adapter — drift, not design.
- Hottest raw entity: `'akoya_requests'` — **74 raw call-site lines** outside
  adapters/exempt files. Literal counts UNDERCOUNT overall usage because some
  callers pass constants (e.g. `SUGGESTION_SET`, `PROMPTS_ENTITY`); the
  Stage-0 inventory script must resolve constants, not grep literals.
- Literal `DynamicsService.` counts also UNDERCOUNT usage because live code
  injects the service behind aliases: `dynamics = DynamicsService` in BILL
  onboarding and honorarium orchestration `[VERIFIED via
  lib/bill/onboard-reviewer-service.js:71]` `[VERIFIED via
  lib/bill/honorarium-onboard-orchestrator.js:68]`, and `dyn =
  deps.dynamics || DynamicsService` in reviewer merge `[VERIFIED via
  lib/services/reviewer-merge.js:202]` `[VERIFIED via
  lib/services/reviewer-merge.js:322]`. Stage 0 must trace those aliases and
  injected default clients before any baseline is accepted.
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
- `lib/services/dataverse-export/` is part of the Dataverse Bulk Export
  exemption, not an application data-access layer. It uses raw token/fetch
  helpers for the entity-generic tool `[VERIFIED via
  lib/services/dataverse-export/fetch-client.js:205]` `[VERIFIED via
  lib/services/dataverse-export/fetch-client.js:335]` and is imported by the
  exempt export API routes `[VERIFIED via
  pages/api/dataverse-export/metadata.js:15]` `[VERIFIED via
  pages/api/dataverse-export/run.js:21]`.
- `lib/services/dynamics-service.js` itself (the transport).
- `lib/dataverse/core/` and `lib/dataverse/adapters/` are the only application
  DAL internals that may compose entity CRUD after Stage 8. Current adapters
  already call the transport directly `[VERIFIED via
  lib/dataverse/adapters/contact.js:58]` `[VERIFIED via
  lib/dataverse/adapters/contact.js:83]` `[VERIFIED via
  lib/dataverse/adapters/reviewer-suggestion.js:192]` `[VERIFIED via
  lib/dataverse/adapters/reviewer-suggestion.js:1022]`; the final gate must
  permit these internal calls while banning application raw usage.
- Non-entity transport concerns stay on DynamicsService: `createAndSendEmail`,
  `addEmailAttachment`, and `resolveEntitySetName`. `executeChangeset` stays as
  batch transport only, but it is NOT a permanent application escape hatch:
  before Stage 7, all entity-changing `$batch` usage must move behind a DAL/core
  changeset helper or an explicitly exempt power-tool path. Live
  `executeChangeset` accepts POST/PATCH/DELETE operation URLs `[VERIFIED via
  lib/services/dynamics-service.js:1026]`, so leaving it public to routes would
  bypass the Stage-7 raw-CRUD invariant.
- `scripts/` (probes/one-offs): advisory-only in the gate, never blocking.

---

## Stage 0 — Inventory probe + baseline (no behavior change)

**Goal:** a committed, re-runnable census attributing every raw transport use
to (file, entity, method, call identity), resolving in-file constants and
service aliases to entity-set strings.

**Tests before:** none beyond the probe's own self-test fixture.

**Work:**
1. `scripts/check-dataverse-access-layer.js` — walks `pages/` + `lib/` +
   `shared/` + `modules/` (minus exemptions and DAL internals), parses JS/TS modules, finds:
   direct `DynamicsService.<method>(...)`; imported/required aliases; defaulted
   dependency aliases such as `const { dynamics = DynamicsService } = deps`;
   variables such as `const dyn = deps.dynamics || DynamicsService`; and method
   calls on those aliases (`dynamics.updateRecord(...)`, `dyn.disassociate(...)`,
   etc.). The probe resolves first-arg constants within the file, tags unresolved
   dynamic clients as `entity: "unresolved"`, and emits
   `{file, entity, method, line, callIdentity}` JSON + per-entity rollup.
   `--report` prints; default mode compares against
   `scripts/dataverse-access-allowlist.json` (created Stage 1) and exits 0
   silently when that file is absent.
2. The probe must treat `executeChangeset` specially: parse each operation URL
   built in the same file when possible, attribute entity-changing operations to
   their entity sets, and mark unparseable operation arrays as `entity:
   "changeset-unresolved"` so the allowlist cannot hide a batch escape hatch.
3. Self-test with synthetic fixtures (violating file, constant-resolved file,
   alias/default-dependency file, aliased method call, changeset operation URL,
   exempt file) following the `check:*` self-test pattern in
   `docs/CI_GATES_REFERENCE.md`.
4. Append the census output as Appendix A of this doc (per-entity counts).

**Verify:** probe totals reconcile with the baseline greps above (explain any
delta — constant and alias resolution may push counts UP, while exemption
precision may move tool-helper files out of the application surface); full
suite + build green (nothing behavioral touched); commit probe + self-test.

## Stage 1 — Ratchet gate (freeze new raw usage)

**Goal:** no NEW file may call DynamicsService raw, effective immediately.

**Tests before:** Stage 0 self-test green.

**Work:**
1. `scripts/dataverse-access-allowlist.json` = exact Stage-0 census collapsed
   into line-tolerant count keys: `file`, alias/direct/changeset `kind`,
   `clientMethod`, `entity`, and `count`. Gate
   `npm run check:dataverse-access-layer` fails on (a) any raw access key NOT in
   the allowlist, or any current count above the allowed count, including new
   raw calls added to a legacy file, (b) any allowlist count above the current
   census count or a vanished key (forces shrink — no zombie entries), and (c)
   any unresolved alias/changeset key added after Stage 0. Rationale: source
   lines are intentionally omitted so unrelated edits in legacy files do not
   break the ratchet and invite blind regeneration.
2. Register in `package.json`, the CI workflow, `docs/CI_GATES_REFERENCE.md`,
   and the `/start` skill's gate list.
3. Self-test: fixtures proving all three failure modes fire.

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
  `wmkf_appreviewanswers` as a full read/write adapter, not just the hoisted
  reader. The reader is `lib/services/review-answers.js` `[VERIFIED via
  lib/services/review-answers.js:1]`; the write surface includes answer
  snapshot URL/body helpers `[VERIFIED via
  lib/external/review-answer-snapshot.js:1]` `[VERIFIED via
  lib/external/review-answer-snapshot.js:91]` and changeset writers in external
  review submit, staff upload, and mark-received-no-file `[VERIFIED via
  pages/api/external/review/[token]/submit.js:190]` `[VERIFIED via
  lib/services/review-upload.js:250]` `[VERIFIED via
  pages/api/review-manager/mark-received-no-file.js:94]`. This adapter must own
  the alternate-key upsert URL/body contract and expose a DAL/core batch helper
  for atomic parent+answer writes before any caller moves.
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
- Fail-closed unit tests: raw entity CRUD on DynamicsService without an
  authorized DAL context THROWS; adapters succeed only when called under a
  trusted entry-point context; exempt tools still function via their explicit
  wrapper.
- Batch tests: route/service code cannot call `DynamicsService.executeChangeset`
  directly for entity-changing operations; the DAL/core changeset helper parses
  or receives every operation entity and enforces the same authorized context.
- Integration canaries proving converted routes work after their raw
  `bypassDynamicsRestrictions` wrappers are removed ONLY where the route first
  establishes an explicit trusted DAL context after auth. Current routes place
  auth before bypass `[VERIFIED via pages/api/admin/prompts/index.js:58]`
  `[VERIFIED via pages/api/admin/prompts/index.js:62]` `[VERIFIED via
  pages/api/reviewer-finder/my-proposals.js:38]` `[VERIFIED via
  pages/api/reviewer-finder/my-proposals.js:49]`; Stage 7 must preserve that
  entry-point auth-to-context ordering.

**Work (in order, each step green):**
1. Add a shared `lib/dataverse/core/context.js` helper that entry points call
   only after route auth / cron auth / token verification. It returns a scoped
   trusted DAL context token or runs a callback; adapters require that context
   and fail closed without it. Do not let adapters silently bypass restrictions
   for arbitrary library callers.
2. Move entity-changing batch work behind `lib/dataverse/core/changeset.js`.
   That helper composes `DynamicsService.executeChangeset`, validates each
   operation entity, rejects unresolved entities outside explicit exempt paths,
   and requires the same trusted DAL context as normal adapter CRUD.
3. DynamicsService gains fail-closed enforcement for entity CRUD and direct
   entity-changing `executeChangeset` use outside DAL/core/exempt tools, behind
   a temporary env flag: ON in dev/test, OFF in prod for one deploy cycle; flip
   prod ON after a clean cycle; then delete the flag.
4. Mechanically strip now-redundant route-level `bypassDynamicsRestrictions`
   wrappers only after replacing them with the explicit post-auth DAL context
   helper (one file per commit, full suite green each). Leaf helpers that
   currently document caller-owned context, such as `prompt-store` and
   `program-director-resolver` `[VERIFIED via lib/services/prompt-store.js:14]`
   `[VERIFIED via lib/services/program-director-resolver.js:31]`, must keep that
   trust-boundary shape or move behind an adapter method that still requires the
   caller's trusted context.
5. Reconcile docs: CLAUDE.md Universal Safety Invariants wording,
   `docs/SECURITY_ARCHITECTURE.md`, agent-wiki topics, this doc — full
   fact-level reconciliation (`/sweep`), not appends.

**Verify:** full suite, build, ALL `check:*` gates, plus a production probe of
one high-traffic route per app after each deploy step.

## Stage 8 — Ratchet becomes law; close out

- Allowlist file deleted; the gate hardcodes the permanent exemptions plus the
  approved DAL internals (`lib/dataverse/core/`, `lib/dataverse/adapters/`) and
  fails on ANY raw transport use outside those zones. The gate remains
  alias-aware and changeset-aware so legacy aliases cannot become a new escape
  hatch.
- Appendix A regenerated as the final census (permanent exemptions + approved
  DAL internals only).
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
- 2026-07-04 (S329): second adversarial review (Codex, fresh thread) refuted
  the ORIGINAL probe/gate design: 2 P0 (literal-grep census misses aliased
  writers, e.g. `dynamics`/`dyn` injection in BILL onboarding and reviewer
  merge; `executeChangeset` exemption was a raw-CRUD backdoor under Stage 7)
  + 4 P1 (Bulk Export helper subtree unexempted; Stage 8 wording banned the
  adapters themselves; Wave 3 missed the answer-snapshot write surface;
  Stage 7 risked erasing caller-owned auth-to-context ordering). Plan amended
  in place (Codex patch, Claude-verified citations); execution still NOT
  started.
- 2026-07-04 (S329): **Stage 0 executed** (Codex build, Claude review).
  `scripts/check-dataverse-access-layer.js` (Babel-AST census: direct calls,
  import/require aliases, defaulted dependency + fallback aliases, changeset
  operation-URL attribution) + self-test (6 fixture kinds, all pass) +
  package.json registration. Census: 211 call identities / 84 files / 21
  entity buckets (Appendix A). Alias detection proven live: 10 identities in 4
  alias-only files invisible to literal grep. Review verified: 5 dropped
  files are comment-only mentions; independent literal recount = 85 files
  with Stage-0 exemptions. Full suite 3836/3837 (pricing-canary pre-existing
  red), build clean. The allowlist drift-comparison path ships untested until
  Stage 1's self-test per plan staging.
- 2026-07-04 (S329): **Stage 1 executed** (Codex build, Claude review).
  `scripts/dataverse-access-allowlist.json` generated from the current census:
  181 line-tolerant allowlist keys covering 211 raw access entries.
  `scripts/check-dataverse-access-layer.js` now preserves line numbers in
  `--json` output while default-mode comparison uses
  `file` + `kind` + `clientMethod` + `entity` counts. Self-test fixtures prove
  green baseline plus count-exceeds, stale-entry/count-below, and new-unresolved
  red modes. CI, `docs/CI_GATES_REFERENCE.md`, and `/start` gate-list
  registration added; `package.json` scripts were already present from Stage 0.
  Baseline gate and self-test green `[VERIFIED 2026-07-04 via
  npm run check:dataverse-access-layer]` `[VERIFIED 2026-07-04 via
  npm run check:dataverse-access-layer:self-test]`; targeted red modes green
  `[VERIFIED 2026-07-04 via
  node scripts/check-dataverse-access-layer-self-test.js --mode count-exceeds]`
  `[VERIFIED 2026-07-04 via
  node scripts/check-dataverse-access-layer-self-test.js --mode stale-entry]`
  `[VERIFIED 2026-07-04 via
  node scripts/check-dataverse-access-layer-self-test.js --mode new-unresolved]`.

- 2026-07-04 (S329): **Stage 2 executed** (Opus worktree build, Claude review,
  merge `316797fc`). New `lib/dataverse/core/`: `odata.js` (escape/eq/eqRaw/
  eqGuid/startsWith/contains/and/or/select; `eqGuid` throws on non-GUID per the
  trust-boundary convention), `entity-registry.js` (`entitySet()` throws on any
  name outside the 18 Stage-0 census buckets — the S328 guessed-name 404s are
  now unrepresentable; canonical primary SELECTs for the 3 adapter entities,
  byte-equal to the originals), `errors.js` (`adapterError` business-error
  shape; transport errors still propagate unwrapped). All 4 adapters converted,
  tests-first: 43 new tests (23 toolkit + 20 characterization) written before
  conversion and passing unchanged after. Deliberate scope keeps: suggestion
  filter strings stay local (GUID/numeric comparisons, no escaping primitive
  applies); specialized SELECT projections (merge/biblio) stay in their
  adapters; existing custom guard messages not swapped for `eqGuid`. Merged
  state: full suite 3879/3880 (pricing-canary pre-existing), build clean,
  ratchet + trust-boundary-guid green.

- 2026-07-04 (S329): **Adapter wave executed** (4 parallel Opus worktree
  builds, Claude review + serial merge `281f4280`…`65b4b7cb`; Codex post-impl
  review of Stage 2 returned NOT REFUTED with one LOW test-strictness finding,
  closed in `fac94619`). New adapters, contract-mirroring only, NO callers
  moved (allowlist unchanged): `policy.js` (wmkf_policies + versions, 10
  methods), `review-question.js`, `ai-prompt.js` (all 15 census identities
  incl. the prompt-seed caller), `review-answer.js` + `core/changeset.js`
  (alt-key upsert contract, registry-validated batch ops, answers-before-
  parent atomic order; restriction enforcement deferred to Stage 7 by design),
  `grant-request.js` (Wave 5a/b reads: getById passthrough-select + 3 shared
  profiles, findByRequestNumber/findByIds/findMeetingDatesByProgramDirector;
  6 resistant read-shape clusters documented in the adapter for caller-side
  conversion). 76 new tests; merged state full suite 3958/3958 (pricing-canary
  fixed in `36ee834b`), build clean, ratchet + atlas green. Known deliberate
  divergences recorded for conversion commits: static registry set-name
  resolution replaces runtime `resolveEntitySetName` in the answer path;
  `readRatingsBySuggestion` carries no bypass wrapper; policy
  `queryActiveSlotByCode` escapes `wmkf_code` (was raw-interpolated).

- 2026-07-04 (S329): **Conversion batch 1 merged** (7 parallel Sonnet worktree
  clusters, serial Claude merges `6b67ace8`…`abc66f78`). 33 caller files
  converted per the Stage 3–6 recipe `[VERIFIED via git diff --name-only
  53ca8f7e..abc66f78]` (tests-before where coverage was absent — 23 new test
  files, adapter-method tests included); adapter layer grew to 11
  (`system-user.js`, `app-request-person.js` new; `contact.js` +6 bridge
  methods; `reviewer-suggestion.js` +9 mirrored methods). Allowlist 181 → 132;
  gate green after every merge (conflicts resolved by regenerating the
  allowlist from the live census via `buildAllowlist` — the gate itself is the
  parity proof). Merged state: full suite 4056/4056, build clean. Documented
  skips → sequential tail: `expertise-finder/proposals.js`,
  `grantee-deliverables/awardees.js`, `grantee-deliverables/cycle-export.js`,
  `dashboard.js#listProposals` (caller-owned business filters per the
  grant-request adapter design note), plus all akoya write files, cross-entity
  files, and unresolved census entries.

- 2026-07-04 (S329): **Waves 3–6 COMPLETE** (tails 1–3: 3 further Sonnet
  worktree agents + Claude closeout, merges `1ac8ba46`…`d6fd5593`). Akoya
  write conversions with exact-PATCH-body tests; business-filter files onto
  `queryRequests`/`queryAllRequests` passthroughs (filters stay caller-built
  per the adapter design note); all cross-entity files incl. the 3 changeset
  flows onto `core/changeset.js` (operation arrays byte-identical per
  unchanged integration tests); BILL/merge injection seams reshaped to
  adapter-shaped deps; all 6 unresolved-census files resolved and converted;
  `core/changeset.js` gained bare-collection POST for the review-questions
  editor; `dynamics-explorer-taxonomy.js` exempted (sole importer is the
  exempt Explorer route). Adapter layer: 18 modules `[VERIFIED via ls
  lib/dataverse/adapters]`. Allowlist 132 → 12, all 12 non-entity-transport
  `[VERIFIED via allowlist entity scan — 0 non-transport]`. Full suite
  4163/4163; build clean. Stage 7 precondition MET.

- 2026-07-04 (S329): **Stage 7 executed** (Sonnet worktree build, Claude
  review + merge; owner go given in-session). Trusted context = the EXISTING
  ALS store (no second trust concept): `core/context.js` `withDalContext`
  wraps `bypassDynamicsRestrictions` with a DAL label `[VERIFIED via
  lib/dataverse/core/context.js:46]`; `DynamicsService`
  create/update/delete/disassociate/executeChangeset assert trusted context
  under `DATAVERSE_DAL_ENFORCEMENT` (explicit on/off; unset = on outside
  production — a committed `.env.development` is impossible here, .gitignore
  excludes `.env*`) `[VERIFIED via lib/services/dynamics-context.js:123 +
  5 assert sites in dynamics-service.js]`; `runChangeset` asserts
  independently for call-site attribution. Reads keep prior `checkRestriction`
  behavior; exempt tools unaffected (no entity CRUD in their paths). 8 canary
  wrapper strips landed one-per-commit; 79 files still import
  `bypassDynamicsRestrictions` post-merge `[VERIFIED via grep, exact query in
  the execution-status note; the build report's own pre-merge count was 82]`
  (mechanical strip = follow-up pass — they remain functionally correct, the
  legacy wrapper IS a trusted context). Suite 4181/4181 with enforcement ON
  in tests; build clean; access-layer/route-lifecycle-auth/api-routes gates
  green. CLAUDE.md invariant wording + wiki reconciled this commit. PROD flag
  flip = pending owner deploy decision.

- 2026-07-04 (S329): **Stage 8 executed** (Sonnet worktree build, Claude
  review; merge `3cf4a506`, build commit `21fc7e66`). Allowlist file DELETED;
  gate is law: fails on any identity not `non-entity-transport`, with the
  permitted surface a CLOSED method-name set (`createAndSendEmail`,
  `addEmailAttachment`, `createEmailActivity`, `logAiRun` `[VERIFIED via
  scripts/check-dataverse-access-layer.js:66-71]`) and unknown method names
  failing closed as `unknown-method:*` `[VERIFIED via :710]` — closing the
  silent-pass gap where unrecognized methods defaulted to transport. Self-test
  reworked to law-mode fixtures (entity / unresolved-alias /
  changeset-unresolved / unknown-method reds; clean + exempt greens). Suite
  4181/4181; build clean; atlas green post-deletion. CI_GATES_REFERENCE
  reconciled.

- 2026-07-05 (S329): **Codex post-impl adversarial review of Stage 7
  completed** (read-only, `task-mr77bsot-gt2byy`; verdict: **needs changes
  before Stage 7 is security-complete**). Findings:
  - **High**: `DynamicsService.createEmailActivity` (`dynamics-service.js:1231`),
    `addEmailAttachment` (`:1302`), and `sendEmail` (`:1337`) perform
    Dataverse POST/action calls with NO `assertTrustedDalContext` — these are
    exactly the 4 method names Stage 8's gate classifies
    `non-entity-transport` (`scripts/check-dataverse-access-layer.js:66`), so
    the law-mode gate stays green while these paths remain unguarded raw
    writes. Refutes "entity-changing network paths are fail-closed."
  - **Medium**: "trusted context" is ALS-presence only, not proof of
    post-auth establishment (`context.js:46,66`; `dynamics-context.js:140`)
    — cannot distinguish a caller-owned post-auth wrap from an arbitrary
    `withDynamicsContext`/legacy-bypass context. No concrete wrap-before-auth
    bug found in the 6 sampled canary routes.
  - **Medium**: `pages/api/grant-reporting/extract.js:590` calls
    `DynamicsService.logAiRun` (guarded, writes via `createRecord`) with no
    DAL context — if `DATAVERSE_DAL_ENFORCEMENT=on` in prod, this
    authenticated route's audit write throws and is swallowed at `:600`.
  - **Low/Medium**: `tests/unit/dal-enforcement.test.js:87` doesn't cover the
    email helpers, `withDynamicsContext` as a write-trusted context, or
    unset/production `NODE_ENV` defaults.
  Not yet fixed. Stage 8's "law" framing (commit `41edacd9`) predates this
  finding — treat the email-write gap as open before calling Stage 7/8
  security-complete or flipping `DATAVERSE_DAL_ENFORCEMENT` in prod.

- 2026-07-04 (S330): **Closed the S329 High finding.**
  `assertTrustedDalContext('DynamicsService.<method>')` added as the first
  statement in `createEmailActivity`, `addEmailAttachment`, and `sendEmail`
  (`dynamics-service.js:1231-1339`), mirroring the `createRecord` pattern;
  `createAndSendEmail` left unchanged (inherits enforcement from the three
  inner calls). Also closed the S329 Medium finding on
  `pages/api/grant-reporting/extract.js`: `tryLogAiRun` now wraps
  `DynamicsService.logAiRun` in `withDalContext('grant-reporting-extract-ai-log',
  ...)` — this audit write was throwing and being silently swallowed under
  `DATAVERSE_DAL_ENFORCEMENT=on`. Test coverage added to
  `tests/unit/dal-enforcement.test.js`: fail-closed + success cases for all
  three email methods, plus a case proving
  `withDynamicsContext({ restrictions: [], requestId })` counts as a
  write-trusted context for `createRecord` (closes the S329 Low/Medium test-gap
  finding). `npm run check:dataverse-access-layer` and its self-test still
  pass unchanged — Stage 8's `non-entity-transport` exemption for these four
  method names is intentional and stays; the new asserts are a runtime
  guard layered on top, not a gate change.

  The S329 Medium finding on "ALS-presence-only trust" (no way to
  distinguish a caller-owned post-auth wrap from an arbitrary
  `withDynamicsContext`/legacy-bypass context) is **accepted as-is, not
  fixed**: tightening `hasTrustedDalContext`/`assertTrustedDalContext` today
  would break the non-test live-tree files that import
  `bypassDynamicsRestrictions` — all trusted by design under the current
  model. (Census when scoping the strip: `git grep -l "import.*bypassDynamicsRestrictions" -- lib pages scripts`
  — tracked files only, so worktree clones are excluded by construction;
  the count moves with ongoing conversions, so it is deliberately not
  frozen here.)
  Revisit when the mechanical strip of those legacy bypass call sites runs;
  no code change made this session.

- 2026-07-04 (S330): **Stage 8 law-mode census correction executed** (Codex
  correction plan approved in session `019f3064-8e05-7aa1-995c-330287fd581d`;
  implementation left uncommitted for review). Finding→fix map:
  1. Cross-module exported aliases/re-exports could make downstream raw calls
     invisible → exporting a recognized alias/namespace now emits
     `unattributable-use:export`; source-based ESM/CJS re-exports emit
     `unattributable-use:reexport-from-source`.
  2. Destructured, extracted, or `.bind()`-bound methods could bypass call
     attribution → every recognized alias/namespace reference is now audited
     after alias collection; only sanctioned direct-call shapes or non-exported
     alias creation are allowed.
  3. Passing a client/namespace as an argument could hide later calls → any
     non-call reference such as `sink(DynamicsService)` or `sink(dyn)` now
     emits `unattributable-use:Identifier`.
  4. Computed method strings could produce zero entries → computed/unresolved
     method members now fail closed as `unattributable-use:MemberExpression`
     (including inline `require(...).DynamicsService['create' + 'Record']`).
  5. Inline `require()` / awaited dynamic `import()` chains and source aliases
     could be stored, passed, or re-exported → literal direct
     `require(...).DynamicsService.<method>(...)` / dynamic-import namespace
     calls are attributed normally, while all other source-expression shapes
     fail as `unattributable-use:inline-require` or
     `unattributable-use:dynamic-import`.
  6. `modules/` was outside the law census → `SCAN_DIRS` is now
     `pages`, `lib`, `shared`, `modules`.

  Self-test coverage added for all red classes plus greens for sanctioned
  direct non-entity calls, tracked non-exported aliases, and resolvable
  awaited dynamic-import direct calls. Live burn-down: **zero reds** after the
  correction (`node scripts/check-dataverse-access-layer.js` exited 0), so no
  call-site refactors and no new exemptions were needed.

  Accepted residuals: `scripts/` remains outside the blocking law boundary
  (probes/one-offs are advisory here; do **not** infer that all script writes
  use `enterDynamicsBypassForScript` or any equivalent wrapper), and directory
  symlinks remain skipped by the scanner to avoid duplicate/out-of-root
  traversal. The review findings were **uncensused**, not **unguarded**:
  runtime `assertTrustedDalContext` still guarded entity writes and the S330
  email-helper methods; this correction closes the static-census silent-green
  gap rather than adding the first runtime guard.

## Appendix A — Census (Stage 0 baseline → Stage 8 final)

**Stage 8 FINAL census** `[VERIFIED 2026-07-04 via
node scripts/check-dataverse-access-layer.js --report, post-S330 correction]`:

| Entity | Calls | Files | Methods |
|---|---:|---:|---|
| non-entity-transport | 12 | 11 | createAndSendEmail:9, createEmailActivity:1, logAiRun:2 |

12 call identities / 11 files / 1 bucket — the closed permanent
DynamicsService surface. Every entity-attributed identity is gone (211 → 12);
the law gate fails on anything else, including unknown method names.

---

Stage-0 baseline for the historical record `[VERIFIED 2026-07-04 via the same
probe pre-Stage-1]`:

Literal-grep baseline retained for comparison: 86 caller files / ≥15 entity
sets / 39 filter strings / 97 bypass files / 18 suggestion-entity and 74
akoya_requests raw call-site lines (units and exclusions per the Why section).

Stage-0 AST census:

- Total call identities: 211
- Caller files: 84
- Entity buckets: 21

Delta against the 86-file literal baseline: **-2 caller files**. The AST probe
adds four real alias-only caller files missed by literal `DynamicsService.`
greps: `lib/bill/honorarium-onboard-orchestrator.js`,
`lib/bill/onboard-reviewer-service.js`,
`lib/services/reviewer-acceptance-drain.js`, and
`lib/services/reviewer-merge.js` `[VERIFIED 2026-07-04 via
node scripts/check-dataverse-access-layer.js --json]`. It drops five
literal-only files whose `DynamicsService.` occurrences are comments or docs,
not calls: `lib/external/calendar-invite.js`,
`lib/services/contact-enrichment-service.js`,
`lib/services/dynamics-context.js`, `lib/utils/guid.js`, and
`shared/utils/review-report-docx.js` `[VERIFIED 2026-07-04 via
literal/AST set diff]`. Rerunning the literal scan with the Stage-0 Permanent
exemptions today yields 85 files; the remaining one-file gap from the stored
86-file snapshot is exemption/snapshot precision, not an extra live call
identity.

| Entity | Calls | Files | Methods |
|---|---:|---:|---|
| akoya_requests | 79 | 48 | createRecord:2, disassociate:1, getRecord:44, queryAllRecords:9, queryRecords:7, updateRecord:16 |
| wmkf_appreviewersuggestions | 27 | 15 | executeChangeset:3, getRecord:9, queryAllRecords:6, updateRecord:9 |
| wmkf_ai_prompts | 15 | 4 | createRecord:2, getRecord:3, queryRecords:7, updateRecord:3 |
| contacts | 13 | 8 | createRecord:1, getEntityKey:1, getRecord:6, queryRecords:2, updateRecord:3 |
| non-entity-transport | 12 | 11 | createAndSendEmail:9, createEmailActivity:1, logAiRun:2 |
| wmkf_appreviewanswers | 10 | 6 | executeChangeset:3, queryAllRecords:3, resolveEntitySetName:4 |
| systemusers | 9 | 8 | getRecord:7, queryRecords:2 |
| unresolved | 9 | 6 | getRecord:2, queryAllRecords:2, queryRecords:1, resolveLogicalName:1, updateRecord:3 |
| wmkf_potentialreviewerses | 9 | 7 | getRecord:4, queryRecords:5 |
| wmkf_policies | 6 | 2 | getRecord:3, queryRecords:2, updateRecord:1 |
| sharepointdocumentlocations | 4 | 2 | queryRecords:4 |
| wmkf_policyversions | 4 | 1 | createRecord:1, queryRecords:2, updateRecord:1 |
| wmkf_apprequestpersons | 3 | 3 | queryAllRecords:1, queryRecords:2 |
| wmkf_granteedeliverables | 3 | 1 | createRecord:1, queryRecords:1, updateRecord:1 |
| accounts | 2 | 2 | getRecord:1, queryRecords:1 |
| changeset-unresolved | 1 | 1 | executeChangeset:1 |
| wmkf_ai_runs | 1 | 1 | createRecord:1 |
| wmkf_appgrantcycles | 1 | 1 | queryAllRecords:1 |
| wmkf_portalmemberships | 1 | 1 | queryRecords:1 |
| wmkf_proposalbudgetlines | 1 | 1 | createRecord:1 |
| wmkf_reviewquestions | 1 | 1 | queryRecords:1 |
