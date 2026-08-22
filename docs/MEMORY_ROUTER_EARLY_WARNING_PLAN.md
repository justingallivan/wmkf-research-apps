---
title: Memory Router Early-Warning Plan
domain: docs-governance
kind: plan
status: active
summary: "Built 8 KiB router early-warning notice across the checker, SessionStart/Stop hooks, and start/stop skills, with mutation-backed regression coverage."
canonical: false
cataloged: 2026-08-21
last_verified: 2026-08-22
owner: product-engineering
related:
  - docs/MEMORY_HYGIENE_RUNBOOK.md
  - docs/audits/memory-hygiene-best-practices-review-2026-08-21.md
  - scripts/check-memory-router.js
  - .claude/hooks/session-lifecycle.js
  - .claude/hooks/memory-router-guard.js
---

# Memory Router Early-Warning Plan

**Status: BUILT 2026-08-21 (v4).** All five phases shipped on
`codex/fable-memory-hygiene-runbook` as four commits: Phase 0 documents +
tracked sweep manifest (`e1dd1dc3`), Phases 1–2 thresholds module + checker
notice + hook conversions (`6b36f297`), Phase 3 Stop refactor + tests T1–T7
(`2c540cef`), Phase 4 skill text (the commit carrying this status update).
Build-time verification receipts:
[RECHECKED after scripts/lib/memory-router-thresholds.js change: built as specified; ladder asserted by self-test case 15]
[RECHECKED after scripts/check-memory-router.js change: notice verified live at the 9,040 B router; self-test 19/19]
[RECHECKED after scripts/check-memory-router-self-test.js change: fixtures a–e implemented as cases 11–15, all green]
The sections below are retained as the reviewed design contract the build
implements; §4 is the ongoing regression procedure.

**Later owner-approved follow-on (2026-08-22):** the companion review's R4/R5
were implemented separately: the router gate now emits a unique-direct-leaf
metric, and `weak-basis` accepts the paired harness `modified:` + dated
in-body `[VERIFIED]` evidence shape with fail-closed complement tests. These
follow-ons do not change this plan's thresholds or hook behavior.

**Post-build review (fourth Codex review, of the built diff, 2026-08-21):
two findings, both accepted and fixed in the commit carrying this note.**

1. **Pre-block save bypass (high).** An uncaught `saveState` between the
   invariant blocker and the strict-doc/review-receipt blockers meant a
   state-I/O failure fell to `main()`'s fail-open catch and cancelled those
   blockers (and the block-mode gate) with status 0. Fixed by removing that
   save — every subsequent path persists the pruned warnings itself
   (blocking exits via the locally caught `clearAdvisedKeyBeforeBlock`, the
   normal path via the advisory-stage save). New T8 tests inject a save
   failure per blocker (strict-doc / review-receipt / block-mode gate →
   still exit 2) and pin the advisory-stage fail-open message; all three
   blocker cases were verified to FAIL against the pre-fix hook.
2. **Mutation tests accepted any exception (medium).** The T1 mutation loop
   treated every throw from the contract assertion — including fixture or
   spawn infrastructure failures — as detection. Fixed in two rounds: the
   first fix added a per-mutation deviation oracle plus an
   `ERR_ASSERTION`-only rejection, but a fifth review showed the rejection
   still ran a SECOND execution whose own spawn failure converted to
   `ERR_ASSERTION`. A sixth review then showed a single-run
   `notDeepStrictEqual` violation check is entailed by the oracle and never
   exercises the suite's own assertion. Final form: exactly one execution
   per mutant — spawn health and the deviation oracle read the result, then
   the SAME pure contract-assertion helper T1 uses
   (`mrAssertContractOnResult`, no I/O) must reject that result inside
   `assert.throws` with `ERR_ASSERTION`.

v1 → v2 (first Codex review, five findings, all accepted): Stop advisory
became a single-emission aggregation path; the crossing predicate became
three tiers (crossing / growth-above / missing-baseline-suppressed);
thresholds moved to one dependency-free constants module with zero consumer
literals; the test procedure was corrected to the standalone `node` runner
with exact-boundary fixtures; Phase 0 grew the owner-decision semantic sweep.

v2 → v3 (second Codex review, three findings, all accepted and re-verified
against the live files):

1. **Dedup empty-state contract fixed.** v2 stored `lastAdvisedKey` only on
   emission, so a shrink left the old crossing key K in place and a
   byte-identical re-cross was suppressed. v3: the key is stored on EVERY
   stop evaluation — including the hash of the empty set — and emission
   requires non-empty AND changed (§ Phase 3, §3, T3).
2. **T1/T3 assertions strengthened from counts to exact content.** v2's
   `≤1 JSON object` passed on zero output and on lost gate advisories; v2
   also had no gate-only case. v3 asserts exact object counts AND required
   text fragments per path, adds the gate-only path, an exact byte-identical
   re-cross replay, and a combined router+block-mode case (exit 2, no
   advisory JSON).
3. **Phase 0 acceptance greps broadened from literal to semantic,
   case-insensitive patterns**, with the known live sites enumerated from a
   fresh grep at `2ef75439` — v2's patterns missed "full 57-gate battery",
   "optionally by a lower warn band", and "Owner decisions pending".

v3 → v4 (third pre-build review, three findings, all accepted):

1. **Dedup now closes every Stop exit and migration path.** Every blocking
   exit clears and saves the stored key; advisory-stage evaluations write a
   versioned key whose SHA-256 input is domain-separated JSON; inherited
   pre-v4 values never compare equal; and explicit replay, migration, and
   `saveState`-failure tests pin the contract (§2 Phase 3, §3, T3/T4/T7).
2. **T1 now proves the complete hook output contract.** Each path
   deep-compares exit status and the complete parsed object, including the
   exact ordered context string. Mutation cases prove that a dropped gate
   summary, duplicate producer, wrong event name, or advisory-mode exit 2
   makes the suite fail (§4 T1).
3. **Phase 0 now leaves tracked, line-complete sweep evidence.** The negative
   filter is removed; a dated audit artifact records the baseline SHA, exact
   commands, raw counts, and one classification row per hit; and a completion
   manifest diff rejects any current hit without a row (§2 Phase 0, §6).

This v4 plan incorporates the third pre-build review. The requested separate
read-only review of the v4 edit was completed 2026-08-21 before the build; it
found one flaw (a blanket fail-open rule that would have let a `saveState`
failure cancel a deliberate blocking `exit(2)`), fixed in this v4 text.

## 1. Problem and evidence

The repo-control claims in this section describe the **pre-build baseline**
as of 2026-08-21 (`2ef75439`), preserved as the problem record; the Phase 1–4
build (receipts in the status header) revised each control listed below —
threshold sourcing, the notice tier, and the Stop advisory changed; the write
guard's block-only-over-cap-worsening semantics did not — and current
behavior is documented in `docs/MEMORY_HYGIENE_RUNBOOK.md` and §2 below. The
harness load-limit facts and observed regrowth data remain current-as-written.

- The harness loads only the first 200 lines / 25 KB of `MEMORY.md`; content
  past that is silently dropped (current official Claude Code memory docs,
  retrieved 2026-08-21; the 2026-06-04 peak of 26,173 B at `91f75975` was past
  that line, so real tail-loss has happened once).
- All existing repo controls sleep below 11 KiB:
  - gate warn band `WARN_BYTES = 11 * 1024` [VERIFIED via
    `scripts/check-memory-router.js:49`], hard cap `TARGET_BYTES = 12 * 1024`
    [`:48`];
  - SessionStart pressure note with **locally hardcoded** `CAP = 12 * 1024`,
    `WARN = 11 * 1024` [VERIFIED via `.claude/hooks/session-lifecycle.js:285-286`
    — it does not import the checker; the write guard imports but ALSO keeps
    truthiness-fallback literals, `memory-router-guard.js:31-33`, which this
    plan treats as part of the same duplication defect];
  - the write-time guard blocks only over-cap worsening
    [`memory-router-guard.js:65-78`] and fails open [`:123-125`];
  - the Stop hook has no router-size awareness at all, and its control flow
    early-returns on the no-gate and all-gates-green paths before its single
    advisory emission [VERIFIED via `session-lifecycle.js:426-439` returns,
    `:440-457` advisory emit + `lastAdvisedKey` dedup].
- Observed regrowth spans ~166–500 B/day (dated per-window derivation in the
  companion review §4). At the worst observed rate, a 6 KiB post-diet router
  reaches 11 KiB in ~10 days and the 12 KiB cap in ~12.5 — inside a two-week
  calendar cadence. The 8,192 B routine-audit trigger in
  `docs/MEMORY_HYGIENE_RUNBOOK.md` §5 was prose only at this baseline
  (mechanical since Phase 1, `6b36f297`); it was crossed
  silently on 2026-08-13 (`840d082d`, 8,193 B). The router measured 9,040 B at
  `2ef75439`.

Goal: make the 8 KiB trigger fire mechanically at session start, in CI logs,
and — when the current session's edits are implicated — at session stop, so
the size trigger (not the calendar) is the primary cadence driver.

**Boundary semantics (single definition, used everywhere):** the notice fires
at `bytes >= NOTICE_BYTES` (8,192 B). The existing `> WARN_BYTES` and
`> TARGET_BYTES` comparisons are unchanged.

## 2. Design

### Phase 0 — document corrections and semantic sweep (no control changes)

Before editing the two shipped documents, create the tracked audit artifact
`docs/audits/memory-early-warning-phase0-sweep-<date>.md`. Record the baseline
commit SHA, then place the exact commands below in a stable command block before
running them. The artifact itself is in the `docs/` search domain, so its
command-block hit is expected and must receive a `quoted` row; classification
rows identify hits by command ID and `file:line` without repeating matched
phrases, preventing a self-expanding manifest.

Run the commands once against that initialized baseline, record each command's
raw hit count, and add exactly one baseline-manifest row for every `file:line`
hit. Do not copy matched text into the artifact; the locator and rationale are
sufficient and avoid creating new search hits. Allowed classifications are
`live-fixed`, `historical`, `quoted`, and `correct-current-state`; a line
mixing stale and current claims is `live-fixed`, because classification
happens before any filtering. Then apply the corrections:

1. Sweep ALL restatements of the 8 KiB crossing date to 2026-08-13 (the §1
   executive-conclusion restatement was missed by the first fix pass) and
   widen §1's regrowth figure to the observed 166–500 B/day range.
2. Correct the §4 diet attribution: `813da56a` is the 11,298 B *before* state;
   the diet landed in `0f7fad66`. Cite both commits.
3. Replace the "all 57 registered check:* scripts" claim with the true count of
   56 of 57 [DERIVED-FROM: package.json check:* census + session gate log; independent of TBD count]
   — every registered script except the mutating `check:memory-drift`, whose
   `:no-write` variant ran instead — listing the omission explicitly so the
   claim is reproducible without the ephemeral scratchpad log. This includes
   the "full 57-gate battery" phrasings, not only the "all 57" literal.
4. Runbook §19: before `git checkout -- docs/RECONCILIATION_REPORT.json`,
   require `git diff -- docs/RECONCILIATION_REPORT.json` and restore only when
   the diff is solely the accidental regeneration; otherwise stop and confirm
   with the owner.
5. Runbook §5/§10 cadence rationale: size trigger primary (mechanical, per
   this plan), calendar backstop, worst-case math stated.
6. **Owner-decision reconciliation:** the owner approved this plan's
   mechanism on 2026-08-21. Rewrite every live restatement in the review doc
   that still presents the warn-band decision as pending or frames R3 as a
   bare `WARN_BYTES` lowering. New framing: R3 is superseded by this plan
   (8 KiB notice + threshold consolidation); a separate 9,216 B warn-band
   lowering is NOT adopted — record it as considered-and-superseded, not
   rejected-on-merits.
7. Fix the review doc's `session-lifecycle.js:286-287` line references to
   `:285-286` (off-by-one carried from both v1 reviews; grep-verified).

**Known live sites to edit** (grep-enumerated at `2ef75439`; line numbers are
addresses for the editor, re-derive before editing — the review doc is
`docs/audits/memory-hygiene-best-practices-review-2026-08-21.md`):

- 57-count claims: review `:66` ("full 57-gate startup battery"), `:174`
  ("all 57 registered"), `:393` ("full 57-gate battery").
- Warn-band-as-pending sites: review `:345` ("optionally by a lower warn
  band, §10 Q4"), `:442-455` (Q4 answer incl. "~9 KiB — 9,216 B" caveat
  paragraph), `:518` context check, `:531` (Q14 tighten list item a),
  `:555` (R3 row). Analytical descriptions of the CURRENT 11 KiB band
  (`:39`, `:91`, `:116`, `:160-163`) are correct state and stay.
- Pending-decision framing at this plan's baseline: review `:571` ("Owner
  decisions pending: R3–R5…" — R3 left the pending list in this plan; R4/R5
  were unaffected here and were later owner-approved and implemented on
  2026-08-22).
- Off-by-one line refs: review `:117`, `:451`, `:555`.

**Acceptance sweep (case-insensitive, semantic — classify raw results before
filtering):**

```bash
rg -n -i "57-gate|all 57" docs/
rg -n -i "warn band|warn threshold|9 KiB|9,?216" docs/audits/memory-hygiene-best-practices-review-2026-08-21.md
rg -n -i "owner decisions?" docs/audits/memory-hygiene-best-practices-review-2026-08-21.md
rg -n "286-287" docs/
rg -n "2026-08-15" docs/MEMORY_HYGIENE_RUNBOOK.md docs/audits/memory-hygiene-best-practices-review-2026-08-21.md
```

After the corrections, rerun those exact commands without filters. Record the
completion raw counts and add one completion-manifest row per current
`file:line` hit. Retain disappeared baseline rows as `live-fixed`; classify
every remaining row `historical`, `quoted`, or `correct-current-state`.

**Completion check (documented manual diff; no new `package.json` gate):** for
each command, normalize the rerun output to sorted `command-id|file:line`
entries and diff it against the sorted completion-manifest locators in the
artifact. Any current hit missing a manifest row, any manifest locator absent
from the current output, any duplicate locator, or any current `live-fixed`
row fails Phase 0. Record the zero-diff result and confirm the artifact is
tracked with `git ls-files --error-unmatch
docs/audits/memory-early-warning-phase0-sweep-<date>.md`. Completion requires
the tracked artifact and zero unclassified live hits, not zero raw hits.

### Phase 1 — thresholds module + checker notice

- **New file `scripts/lib/memory-router-thresholds.js`** — dependency-free
  (no requires), exporting `MAX_LINES`, `MAX_BYTES`, `TARGET_BYTES`,
  `WARN_BYTES`, `NOTICE_BYTES` (new, `8 * 1024`), `MAX_PROSE_LEN`. This is the
  ONLY file in the repository where these numbers appear as literals.
- `scripts/check-memory-router.js`: import from the module; keep re-exporting
  the same names so existing importers (`memory-router-guard.js:27`,
  `check-memory-router-self-test.js:14`) keep working. Byte ladder in
  `validateStore`: `> TARGET_BYTES` → error (unchanged); else `> WARN_BYTES` →
  existing near-cap warning (unchanged); else `>= NOTICE_BYTES` → new notice
  warning: `MEMORY.md is <N> bytes, at/over the <NOTICE_BYTES>-byte
  routine-audit trigger — run the router diet per docs/MEMORY_HYGIENE_RUNBOOK.md
  §10 before the <WARN_BYTES>-byte warn band.` Delivered on the existing
  `warnings` channel (prints `warning:`, never fails the gate) — CI and
  `/start` inherit it with zero wiring changes.
- Self-test additions (`scripts/check-memory-router-self-test.js`):
  (a) store at exactly 8,192 B → exactly one notice-band warning, zero errors
  (pins the `>=` comparator);
  (b) 8,191 B → no byte warning;
  (c) 8,300 B → notice, not near-cap text;
  (d) 11,265 B → near-cap warning only (ladder exclusivity);
  (e) assert `NOTICE_BYTES < WARN_BYTES < TARGET_BYTES` and all
  `Number.isFinite`, so a future edit cannot invert or corrupt the ladder.
  Fixtures generated to exact byte length programmatically.

### Phase 2 — consumer conversion (both hooks), zero literals

- `.claude/hooks/session-lifecycle.js` `wikiAndRouterNotes()`: require the
  thresholds module inside try/catch and **validate numerically**
  (`Number.isFinite` and correct ordering). On failure: skip the router-size
  note entirely (the CI/start gate remains the backstop) — no fallback
  literals. Two note tiers: `>= NOTICE_BYTES` → routine-audit notice pointing
  at runbook §6/§10; `> WARN_BYTES` → existing near-cap wording (semantics
  unchanged).
- `.claude/hooks/memory-router-guard.js`: same conversion — import the module
  (directly, not via the checker), validate numerically, and on failure exit
  without blocking (explicit fail-open, replacing the current
  truthiness-fallback literals at `:31-33`). Behavior below the caps is
  unchanged.
- Acceptance grep: after Phases 1–2,
  `rg -n "1024" scripts/check-memory-router.js .claude/hooks/memory-router-guard.js .claude/hooks/session-lifecycle.js`
  returns **zero** threshold definitions — the only hits allowed anywhere are
  in `scripts/lib/memory-router-thresholds.js`.

### Phase 3 — Stop-hook single-emission aggregation + crossing tiers

**Structural change first:** refactor `stop()` so that every advisory
producer appends to a `stopAdvisories` array and the function has exactly ONE
`additionalContext('Stop', …)` call site at the end. Blocking behavior remains
unchanged: symlink-invariant failures, strict doc staleness, review-receipt
failures, and `block`-mode gate failures still exit 2 before advisory
evaluation. Immediately before EVERY such blocking return, delete
`state.lastAdvisedKey` and call `saveState(state)` inside the hook's existing
outer fail-open `try/catch`. Thus the next unblocked Stop must re-evaluate and
may emit. This cannot create a Stop loop: clearing the key emits no context and
requests no retry; a still-blocked invocation exits 2 for the original guard,
while the first unblocked invocation writes its new version-2 key before
returning. Remove the no-gate and all-gates-green early returns: no-gate,
green-gate, empty-advisory, and suppressed-duplicate paths all flow through
the key-writing finalizer before returning. Together with the blocking clears,
every normal `stop()` exit therefore writes or clears the stored key. The
existing gate advisory's message text is unchanged; only its emission point
moves.

**Dedup contract (v4, replaces v3's unversioned concatenation):**

- Preserve producer order in `orderedAdvisories = [...stopAdvisories]`. On
  EVERY `stop()` evaluation that reaches the advisory stage, compute
  `digest = SHA-256(JSON.stringify({ v: 2, advisories: orderedAdvisories,
  fingerprint }))`, including for the empty advisory array, then STORE
  `state.lastAdvisedKey = { v: 2, key: digest }` unconditionally before any
  optional emission. JSON serialization supplies field and array boundaries;
  the `v: 2` domain separates this contract, so distinct structures cannot
  collide without a SHA-256 collision.
- A previous key is comparable only when it is an object with `v === 2` and a
  valid `key` string. A legacy string or object with any other/missing version
  is non-comparable and therefore cannot suppress the first v4 emission, even
  if it encodes byte-identical advisory text and fingerprint state.
- EMIT only when the advisory set is non-empty AND the comparable previous
  digest differs. State-I/O failure semantics differ by path (review fix to
  the v4 draft — the blanket outer-catch rule would let an I/O error cancel a
  deliberate blocker): an advisory-stage write failure falls into the
  existing outer fail-open catch (no exit 2, no partial/malformed JSON);
  a BLOCKING-exit clear is wrapped in its own LOCAL try/catch so the
  `exit(2)` always still fires. The stale key that survives a failed
  blocking clear is an accepted micro-residual — it requires a state-I/O
  failure plus the exact block→shrink→restore sequence, and any later
  successful advisory-stage write overwrites it.
- Consequences (these are the T3 assertions): a repeat Stop in an identical
  failing state stays silent; a shrink below the trigger stores the
  empty-state key and emits nothing; a subsequent byte-identical re-cross
  produces the old digest K ≠ empty-state digest and EMITS again. A blocking
  exit between the cross and shrink clears the key; after shrink, exact
  restore, and unblock, the advisory is re-evaluated and EMITS. Reintroduced
  router debt cannot hide behind a stale or legacy key.

**Router-size producer, three tiers:**

- `start()` (fresh-session branch only — the resume path at
  `session-lifecycle.js:310-317` returns before state creation and must not
  overwrite): record `state.routerBytesAtStart` via `fs.statSync`
  (try/catch → `null`).
- `stop()` producer, evaluated only when `.claude-memory/MEMORY.md` ∈
  `changedOwnedPaths` (session-attributable edit) and thresholds imported
  validly:
  - **crossing** — `routerBytesAtStart` is a finite number `< NOTICE_BYTES`
    and current `>= NOTICE_BYTES`: "edits in this session carried the router
    over the routine-audit trigger; run the diet (runbook §10) or record the
    debt in the handoff."
  - **growth-above** — start `>= NOTICE_BYTES` and current > start: "the
    router was already at/over the trigger and grew further this session"
    (explicitly not called a crossing).
  - **missing baseline** — `routerBytesAtStart` is `null`/absent (legacy or
    resumed state): **suppress**; the next SessionStart note covers it.
- Ownership honesty: wording says "edits in this session", never exclusive
  causation — in shared worktrees another writer may also have moved the file;
  `changedOwnedPaths` proves participation, not sole authorship (documented
  boundary, same class as the write guard's).

### Phase 4 — skill text

- `.claude/skills/start/SKILL.md`: if `check:memory-router` prints the
  routine-audit notice, surface it in the Step 4 summary and propose the
  runbook §6 routine audit as a candidate task.
- `.claude/skills/stop/SKILL.md`: a stop-time router advisory means edits in
  this session moved the router to/past the trigger (or grew an already-over
  router — the advisory says which); either run the §10 diet now or record
  the debt explicitly in `SESSION_PROMPT.md`. No claim of sole causation.

## 3. Self-trace (lifecycle and provenance)

- **Threshold provenance:** one producer
  (`scripts/lib/memory-router-thresholds.js`), three consumers (checker;
  write guard; session hook). Consumers hold no numeric copies; on
  import/validation failure the gate fails loudly at require time (it is the
  enforcement path) while both hooks skip their advisory and remain fail-open.
  Drift between copies becomes structurally impossible rather than merely
  discouraged.
- **`routerBytesAtStart` lifecycle:** written once in the fresh-session
  branch of `start()`; never written on resume/compact (early return at
  `:310-317` — [VERIFIED this session]); read once per `stop()`; tolerates
  absence (tier 3 suppression); dies with the tmp state file. No transition
  can wedge a session.
- **`lastAdvisedKey` lifecycle (v4 contract):** cleared and saved immediately
  before every blocking exit; written as `{ v: 2, key: digest }` on every
  advisory-stage evaluation — non-empty digest on emission or
  suppressed-duplicate, empty-advisory digest when the set is empty. No
  reachable normal `stop()` exit can preserve a stale suppressing key.
  Comparison rejects every inherited string and every object whose version is
  not 2, so the first v4 advisory-stage evaluation re-emits when non-empty and
  then overwrites the legacy value. An advisory-stage write failure uses the
  outer fail-open catch and cannot turn Stop into a blocker; a blocking-exit
  clear failure is locally caught so it cannot turn a blocker into a
  pass-through (review fix; pinned by T4).
- **Stop output contract:** exactly zero or one JSON object on stdout per
  Stop invocation, in every path combination (none / gate-only / router-only /
  both), with the full object, ordered context, and exit status asserted by
  deep equality (T1).

## 4. Test and verification plan

Sequential, per the fixture-race rule. The hook test file is a **standalone
Node script** (own local runner; outside `jest.config.js:49-53` `testMatch` —
[VERIFIED, and the `npx jest` invocation empirically failed in the v1
review]), so it runs via `node`:

1. `npm run check:memory-router && npm run check:memory-router:self-test`
   (new fixtures a–e).
2. `node .claude/hooks/hook-enforcement.test.js` — extended with:
   - **T1 complete output-object and status contract, five paths:** every
     fixture asserts the process exit status. No-advisory (no-gate and
     green-gate variants) requires status 0 and byte-empty stdout. Gate-only,
     router-only, and combined advisory paths require status 0, exactly one
     JSON value, and `deepStrictEqual(parsed, expectedObject)`, where the
     COMPLETE expected object is
     `{ hookSpecificOutput: { hookEventName: 'Stop', additionalContext:
     expectedContext } }` with no omitted or extra fields. Build
     combined-path `expectedContext` as the exact gate text constructed from
     the fixture's gate name and sentinel gate output, followed by the
     production separator and exact router-tier text in producer order
     (omitting only components absent from other paths); never use fragments
     or `contains`. Add four isolated mutation subruns that replace the
     producer seam one mutation at a time — dropped gate summary, duplicated
     producer, wrong `hookEventName`, and advisory-mode exit 2.
     Each deliberately broken inner run MUST make the standalone suite exit
     nonzero; the outer mutation check passes only after observing all four
     failures;
   - **T2 tiers:** crossing fires; growth-above fires with distinct wording;
     missing baseline suppresses; untouched router suppresses;
   - **T3 dedup lifecycle with exact replay:** cross(state K) → emits;
     repeat Stop at K → silent; shrink below trigger → silent AND stored key
     becomes the version-2 empty-advisory key; restore the exact prior bytes
     and edit fingerprint (byte-identical K) → EMITS again. Also seed an
     inherited byte-identical legacy/unversioned key before the first v4
     evaluation and assert it re-emits and is replaced by `{ v: 2, key }`;
   - **T4 modes and blocking:** router advisory never exits 2 under either
     `CLAUDE_STOP_GATE_MODE` value; every symlink-invariant, strict-doc,
     review-receipt, and block-mode-gate fixture still exits 2 and persists a
     cleared key;
     combined router + block-mode gate failure → exit 2 with ZERO advisory
     JSON on stdout and a cleared saved key. Exercise
     block → shrink → exact restore → unblock and assert the restored advisory
     re-emits. Also force `saveState` to fail during a blocking clear and
     assert the process STILL exits 2 (the local try/catch review fix);
   - **T5 resume:** existing-state `start` preserves `routerBytesAtStart`;
   - **T6 thresholds module unreadable → hooks skip advisories, exit 0;**
   - **T7 key-state I/O failure:** force `saveState` to fail on the
     advisory-stage key write and assert the existing fail-open catch returns
     without exit 2 and without partial/malformed advisory JSON.
3. `npm run check:instruction-architecture` (hook wiring/shape).
4. `npm run check:harness-framing && npm run check:harness-framing:self-test`
   (skill + hook wording).
5. `npm run generate:docs-catalog` then `npm run check:docs-catalog`.
6. `npm run check:fact-consistency && npm run check:fact-consistency:self-test`.
7. `npm run check:doc-symbol-refs && npm run check:doc-symbol-refs:self-test`
   (new module path referenced from docs).
8. Live sanity at build verification: `node scripts/check-memory-router.js`
   ran against the then-9,040 B router and the notice appeared; Phase 0's
   acceptance sweep classified every remaining hit. The later routine audit
   in `docs/audits/memory-routine-audit-2026-08-21.md` dieted the router below
   the notice threshold.

If the hook test script must gate shipping, its `node` invocation is added to
the verification list of this plan only — registering it as a package
`check:*` script is out of scope (new-gate decisions belong to the owner).

## 5. Risks and author's adversarial pass (v4)

- **Stop refactor regression risk (accepted):** moving the existing gate
  advisory's emission point touches reviewed behavior; T1's complete-object,
  exact-context, and status assertions are the mitigation. Blocking decisions
  remain untouched; only their pre-return dedup-key clear is added and pinned
  by T4.
- **Notice fatigue:** at build time the router was already ≥8 KiB, so the
  notice intentionally fired every session until the first runbook audit
  dieted it below the trigger. If a later notice is ignored, posture remains
  no worse than the pre-build state.
- **Skip-on-failure trade:** if the thresholds module path breaks, hooks go
  silent instead of using stale numbers. Accepted because the CI/start gate
  fails loudly at require time in the same breakage (T6 covers the hook
  side).
- **Key-state writes (expanded in v4):** `lastAdvisedKey` is written on every
  advisory evaluation and cleared on every blocking exit, adding one small
  `saveState` on paths that previously wrote nothing. Bounded: the state file
  is already rewritten by `record()` on every tool use; failures fall into
  the existing fail-open catch and T7 proves they never block Stop.
- **Guard surface widening:** this plan touches `memory-router-guard.js`
  (import + validation swap only; block/allow logic untouched; failure mode
  remains fail-open).
- **`warnings` channel overload:** unchanged — notice never fails the gate;
  promoting 8 KiB to a failure would violate review R8 (no new blocking
  memory gates).
- **Import cycle check:** thresholds module requires nothing; checker and
  hooks require it; nothing requires the hooks. No cycle possible.
- **Line-number rot in Phase 0's site list:** the enumerated review-doc line
  numbers are addresses valid at `2ef75439` and MUST be re-derived by grep at
  edit time; the acceptance sweep, not the address list, is the completion
  authority.
- **Deliberately out of scope:** elapsed-time trigger (cross-session state);
  changes to `WARN_BYTES`/`TARGET_BYTES` values; new blocking gates; router
  content edits (the pending diet is runbook work, not this plan);
  registering the hook test as a package script.

## 6. Acceptance criteria

- Threshold literals exist in exactly one file (grep in Phase 2 proves it).
- Notice visible at ≥8,192 B in: gate output (hence `/start` and CI logs);
  SessionStart context; Stop context per the three-tier rules only, always
  advisory, exactly zero-or-one JSON object per Stop with content-preserving
  combination.
- Self-test fixtures a–e and hook tests T1–T8 green; all §4 checks green
  sequentially (T8 is the post-build blocker/save-failure coverage recorded
  in the status header).
- T1 mutation cases each fail the test suite for the intended reason; T7's
  forced key-write failure remains fail-open.
- Phase 0 landed with a TRACKED
  `docs/audits/memory-early-warning-phase0-sweep-<date>.md` containing the
  baseline SHA, exact unfiltered commands, baseline and completion raw hit
  counts, and one classification row per `file:line` hit
  (`live-fixed` / `historical` / `quoted` / `correct-current-state`). The
  completion manifest diff is zero, with no current hit lacking a row and no
  current `live-fixed` row.
- Commits separate: Phase 0 (docs) / Phases 1–2 (thresholds + consumers) /
  Phase 3 (Stop refactor) / Phase 4 (skills); worktree clean after each.

## 7. Rollback

Each phase is one commit; `git revert` restores cleanly. The thresholds
module is additive; reverting Phase 2 alone returns consumers to their prior
copies (guard literals, hook constants) without breaking the checker, because
the checker re-exports the same names either way. Reverting Phase 3 restores
the current `stop()` verbatim; the optional state fields (`routerBytesAtStart`,
the v4 `{ v: 2, key }` `lastAdvisedKey` semantics) are ignored or safely
overwritten by old code in both directions. Reverting Phase 0 also removes its
tracked dated audit artifact with the document corrections it evidences.
