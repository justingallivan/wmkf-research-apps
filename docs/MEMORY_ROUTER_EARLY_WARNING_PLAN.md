---
title: Memory Router Early-Warning Plan
domain: docs-governance
kind: plan
status: draft
summary: "Owner-approved design for an 8 KiB router early-warning notice across the checker, SessionStart/Stop hooks, and start/stop skills; pre-build review pending."
canonical: false
cataloged: 2026-08-21
last_verified: 2026-08-21
owner: product-engineering
related:
  - docs/MEMORY_HYGIENE_RUNBOOK.md
  - docs/audits/memory-hygiene-best-practices-review-2026-08-21.md
  - scripts/check-memory-router.js
  - .claude/hooks/session-lifecycle.js
  - .claude/hooks/memory-router-guard.js
---

# Memory Router Early-Warning Plan

**Status: DRAFT v2 — owner greenlit the direction 2026-08-21; nothing here is
built.** v1 received a Codex adversarial review (verdict: needs-attention,
five findings, all accepted). v2 incorporates them:

1. Stop-hook advisory redesigned as a single-emission aggregation path (v1's
   placement was suppressed on the no-gate/green-gate early returns, or risked
   emitting two adjacent JSON objects).
2. Crossing predicate replaced with three explicit tiers (true crossing /
   growth-above / missing-baseline-suppressed) and ownership-honest wording.
3. Thresholds moved to one dependency-free constants module; consumers carry
   zero fallback literals and skip their advisory on import failure.
4. Test procedure corrected (`node`, not `npx jest` — the hook test file is a
   standalone runner outside `jest.config.js` `testMatch`); exact-boundary and
   lifecycle fixtures added; comparator pinned to `>=`.
5. Phase 0 expanded to a semantic sweep of the predecessor audit's R3/Q4/Q14/
   open-decision/adoption text, not just the date/count corrections.

This plan awaits a second pre-build adversarial review of the v2 diff.

## 1. Problem and evidence

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
    truthiness-fallback literals, `memory-router-guard.js:31-33`, which v2 now
    treats as part of the same duplication defect];
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
  `docs/MEMORY_HYGIENE_RUNBOOK.md` §5 is currently prose only; it was crossed
  silently on 2026-08-13 (`840d082d`, 8,193 B).

Goal: make the 8 KiB trigger fire mechanically at session start, in CI logs,
and — when the current session's edits are implicated — at session stop, so
the size trigger (not the calendar) is the primary cadence driver.

**Boundary semantics (single definition, used everywhere):** the notice fires
at `bytes >= NOTICE_BYTES` (8,192 B). The existing `> WARN_BYTES` and
`> TARGET_BYTES` comparisons are unchanged.

## 2. Design

### Phase 0 — document corrections and semantic sweep (no control changes)

Apply to the two shipped documents, then re-grep for every restatement:

1. Sweep ALL restatements of the 8 KiB crossing date to 2026-08-13 (the §1
   executive-conclusion restatement was missed by the first fix pass) and
   widen §1's regrowth figure to the observed 166–500 B/day range.
2. Correct the §4 diet attribution: `813da56a` is the 11,298 B *before* state;
   the diet landed in `0f7fad66`. Cite both commits.
3. Replace the "all 57 registered check:* scripts" claim with the true count of
   56 of 57 [DERIVED-FROM: package.json check:* census + session gate log; independent of TBD count]
   — every registered script except the mutating `check:memory-drift`, whose
   `:no-write` variant ran instead — listing the omission explicitly so the
   claim is reproducible without the ephemeral scratchpad log.
4. Runbook §19: before `git checkout -- docs/RECONCILIATION_REPORT.json`,
   require `git diff -- docs/RECONCILIATION_REPORT.json` and restore only when
   the diff is solely the accidental regeneration; otherwise stop and confirm
   with the owner.
5. Runbook §5/§10 cadence rationale: size trigger primary (mechanical, per
   this plan), calendar backstop, worst-case math stated.
6. **Owner-decision reconciliation (Codex v1 finding 5):** the owner approved
   this plan's mechanism on 2026-08-21. Rewrite every live restatement in the
   review doc that still presents the warn-band decision as pending or frames
   R3 as a bare `WARN_BYTES` lowering: R3 itself, Q4's proposal sentence,
   Q14(a), §13 "Owner decisions pending", and §14 adoption step 3. New
   framing: R3 is superseded by this plan (8 KiB notice + threshold
   consolidation); a separate 9,216 B warn-band lowering is NOT adopted —
   record it as considered-and-superseded, not rejected-on-merits.
7. Fix the review doc's `session-lifecycle.js:286-287` line references to
   `:285-286` (off-by-one carried from both v1 reviews; grep-verified).

Acceptance greps for Phase 0 (all must return only historical/quoted
contexts): `2026-08-15` (crossing date), `all 57`, `9,216|9216`,
`286-287`, `WARN_BYTES to`, `owner decision` within the review doc's live
sections.

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
- Acceptance grep (Codex v1 finding 3): after Phases 1–2,
  `rg -n "1024" scripts/check-memory-router.js .claude/hooks/memory-router-guard.js .claude/hooks/session-lifecycle.js`
  returns **zero** threshold definitions — the only hits allowed anywhere are
  in `scripts/lib/memory-router-thresholds.js`.

### Phase 3 — Stop-hook single-emission aggregation + crossing tiers

**Structural change first (Codex v1 finding 1):** refactor `stop()` so that
every advisory producer appends to a `stopAdvisories` array and the function
has exactly ONE `additionalContext('Stop', …)` call site at the end, emitting
only when the array is non-empty. Blocking paths (`exit 2` for symlink
invariants, strict doc staleness, review receipts, and `block`-mode gate
failures) are untouched and still return before any advisory emission. The
existing gate advisory's message text is unchanged; only its emission point
moves. Dedup becomes composite: `state.lastAdvisedKey =
hash(sorted advisory texts + changed-surface fingerprint)` — a repeat Stop
with identical state stays silent; any new/changed advisory re-arms.

**Router-size producer, three tiers (Codex v1 finding 2):**

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
- **`lastAdvisedKey` lifecycle (changed):** now keyed over the full advisory
  set + fingerprint. Set on emission; compared on every Stop; re-armed by any
  state change (new gate failure, router size change, new edit fingerprint);
  a shrink below the trigger removes the router advisory from the set, which
  changes the key, and the resulting empty set emits nothing.
- **Stop output contract:** exactly zero or one JSON object on stdout per
  Stop invocation, in every path combination (none / gate-only / router-only /
  both). This is the invariant Codex v1 finding 1 demanded; it is test case
  T1 below.

## 4. Test and verification plan

Sequential, per the fixture-race rule. The hook test file is a **standalone
Node script** (own local runner; outside `jest.config.js:49-53` `testMatch` —
[VERIFIED, and the `npx jest` invocation empirically failed in the v1
review]), so it runs via `node`:

1. `npm run check:memory-router && npm run check:memory-router:self-test`
   (new fixtures a–e).
2. `node .claude/hooks/hook-enforcement.test.js` — extended with:
   - T1 single-emission: no-gate, green-gate, failing-gate+router,
     router-only, and both-advisories paths each produce ≤1 JSON object,
     parsed cleanly;
   - T2 tiers: crossing fires; growth-above fires with distinct wording;
     missing baseline suppresses; untouched router suppresses;
   - T3 lifecycle: below→cross→dedup(repeat Stop silent)→shrink(silent)→
     re-cross(re-arms);
   - T4 advisory-mode: router advisory never exits 2 under either
     `CLAUDE_STOP_GATE_MODE` value; blocking paths still exit 2 untouched;
   - T5 resume: existing-state `start` preserves `routerBytesAtStart`;
   - T6 thresholds module unreadable → hooks skip advisories, exit 0.
3. `npm run check:instruction-architecture` (hook wiring/shape).
4. `npm run check:harness-framing && npm run check:harness-framing:self-test`
   (skill + hook wording).
5. `npm run generate:docs-catalog` then `npm run check:docs-catalog`.
6. `npm run check:fact-consistency && npm run check:fact-consistency:self-test`.
7. `npm run check:doc-symbol-refs && npm run check:doc-symbol-refs:self-test`
   (new module path referenced from docs).
8. Live sanity: `node scripts/check-memory-router.js` in this worktree —
   current router is 8,991 B, so the notice MUST appear; Phase 0 grep list
   returns clean.

If the hook test script must gate shipping, its `node` invocation is added to
the verification list of this plan only — registering it as a package
`check:*` script is out of scope (new-gate decisions belong to the owner).

## 5. Risks and author's adversarial pass (v2)

- **Stop refactor regression risk (new, accepted):** moving the existing gate
  advisory's emission point touches reviewed behavior; T1's five path cases
  are the mitigation, and the blocking paths are deliberately untouched.
- **Notice fatigue:** the router is already ≥8 KiB, so the notice fires every
  session until a diet runs — intended; the runbook's first routine audit
  clears it. If ignored, posture equals today's, no worse.
- **Skip-on-failure trade (replaces v1's fallback literals):** if the
  thresholds module path breaks, hooks go silent instead of using stale
  numbers. Accepted because the CI/start gate fails loudly at require time in
  the same breakage, making the regression visible the same day (T6 covers
  the hook side).
- **Guard surface widening:** v2 touches `memory-router-guard.js` (v1 did
  not). Bounded: import + validation swap only; block/allow logic untouched;
  the guard's own failure mode remains fail-open.
- **`warnings` channel overload:** unchanged from v1 — notice never fails the
  gate; promoting 8 KiB to a failure would violate review R8 (no new blocking
  memory gates).
- **Import cycle check:** thresholds module requires nothing; checker and
  hooks require it; nothing requires the hooks. No cycle possible.
- **Deliberately out of scope:** elapsed-time trigger (cross-session state);
  changes to `WARN_BYTES`/`TARGET_BYTES` values; new blocking gates; router
  content edits; registering the hook test as a package script.

## 6. Acceptance criteria

- Threshold literals exist in exactly one file (grep in Phase 2 proves it).
- Notice visible at ≥8,192 B in: gate output (hence `/start` and CI logs);
  SessionStart context; Stop context per the three-tier rules only, always
  advisory, single JSON object per Stop.
- Self-test fixtures a–e and hook tests T1–T6 green; all §4 checks green
  sequentially.
- Phase 0 landed with its acceptance greps clean, including the R3/Q4/Q14/
  §13/§14 owner-decision reconciliation and the `285-286` line-ref fix.
- Commits separate: Phase 0 (docs) / Phases 1–2 (thresholds + consumers) /
  Phase 3 (Stop refactor) / Phase 4 (skills); worktree clean after each.

## 7. Rollback

Each phase is one commit; `git revert` restores cleanly. The thresholds
module is additive; reverting Phase 2 alone returns consumers to their prior
copies (guard literals, hook constants) without breaking the checker, because
the checker re-exports the same names either way. Reverting Phase 3 restores
the current `stop()` verbatim; the optional state field is ignored by old
code in both directions.
