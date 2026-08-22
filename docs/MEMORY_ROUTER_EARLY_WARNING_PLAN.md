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

**Status: DRAFT v3 — owner greenlit the direction 2026-08-21; nothing here is
built.**

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

This plan awaits a third pre-build adversarial review of the v3 diff.

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
  `docs/MEMORY_HYGIENE_RUNBOOK.md` §5 is currently prose only; it was crossed
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

Apply to the two shipped documents, then run the acceptance sweep below:

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
- Pending-decision framing: review `:571` ("Owner decisions pending: R3–R5…"
  — R3 leaves the pending list; R4/R5 remain pending), `:465` and `:556-557`
  stay pending (R4/R5 unaffected).
- Off-by-one line refs: review `:117`, `:451`, `:555`.

**Acceptance sweep (case-insensitive, semantic — then manually classify each
hit live vs historical/quoted):**

```bash
rg -n -i "57-gate|all 57" docs/ | rg -v "56 of 57"
rg -n -i "warn band|warn threshold|9 KiB|9,?216" docs/audits/memory-hygiene-best-practices-review-2026-08-21.md
rg -n -i "owner decisions?" docs/audits/memory-hygiene-best-practices-review-2026-08-21.md
rg -n "286-287" docs/
rg -n "2026-08-15" docs/MEMORY_HYGIENE_RUNBOOK.md docs/audits/memory-hygiene-best-practices-review-2026-08-21.md
```

Completion requires every remaining hit to be classified in the Phase 0
commit message or audit note as historical/quoted/correct-current-state —
zero unclassified live hits, not zero hits.

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
`additionalContext('Stop', …)` call site at the end. Blocking paths (`exit 2`
for symlink invariants, strict doc staleness, review receipts, and
`block`-mode gate failures) are untouched and still return before any
advisory evaluation. The existing gate advisory's message text is unchanged;
only its emission point moves.

**Dedup contract (v3, replaces v2's set-on-emission rule):**

- On EVERY `stop()` evaluation that reaches the advisory stage, compute
  `advisedKey = hash(sorted advisory texts + changed-surface fingerprint)` —
  including for the empty set (hash of empty + fingerprint) — and STORE it in
  `state.lastAdvisedKey` unconditionally.
- EMIT only when the advisory set is non-empty AND `advisedKey` differs from
  the previously stored value.
- Consequences (these are the T3 assertions): a repeat Stop in an identical
  failing state stays silent; a shrink below the trigger stores the
  empty-state key and emits nothing; a subsequent byte-identical re-cross
  produces the old key K ≠ empty-state key and EMITS again. Reintroduced
  router debt cannot hide behind a stale key.

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
- **`lastAdvisedKey` lifecycle (v3 contract):** written on every advisory
  evaluation — non-empty key on emission or suppressed-duplicate, empty-state
  key when the set is empty. There is no reachable stop() advisory path that
  leaves a stale key behind, which is what closes the v2
  shrink-then-identical-re-cross hole. Old state files carrying a v2-era key
  are safe in both directions: any first v3 evaluation overwrites the key.
- **Stop output contract:** exactly zero or one JSON object on stdout per
  Stop invocation, in every path combination (none / gate-only / router-only /
  both), with content preservation asserted by exact-fragment tests (T1).

## 4. Test and verification plan

Sequential, per the fixture-race rule. The hook test file is a **standalone
Node script** (own local runner; outside `jest.config.js:49-53` `testMatch` —
[VERIFIED, and the `npx jest` invocation empirically failed in the v1
review]), so it runs via `node`:

1. `npm run check:memory-router && npm run check:memory-router:self-test`
   (new fixtures a–e).
2. `node .claude/hooks/hook-enforcement.test.js` — extended with:
   - **T1 exact emission-and-content, five paths:**
     no-advisory (no-gate and green-gate variants) → exactly ZERO JSON
     objects on stdout;
     gate-only failure (advisory mode, router untouched) → exactly ONE JSON
     object whose `additionalContext` contains the gate-failure text;
     router-only → exactly ONE object containing the router-tier text and no
     gate text;
     combined gate-failure + router → exactly ONE object containing BOTH the
     gate fragment and the router fragment. Objects parsed, not
     pattern-counted, so a dropped gate advisory fails the combined case;
   - **T2 tiers:** crossing fires; growth-above fires with distinct wording;
     missing baseline suppresses; untouched router suppresses;
   - **T3 dedup lifecycle with exact replay:** cross(state K) → emits;
     repeat Stop at K → silent; shrink below trigger → silent AND stored key
     becomes the empty-state key; restore the exact prior bytes and edit
     fingerprint (byte-identical K) → EMITS again;
   - **T4 modes and blocking:** router advisory never exits 2 under either
     `CLAUDE_STOP_GATE_MODE` value; blocking paths still exit 2 untouched;
     combined router + block-mode gate failure → exit 2 with ZERO advisory
     JSON on stdout;
   - **T5 resume:** existing-state `start` preserves `routerBytesAtStart`;
   - **T6 thresholds module unreadable → hooks skip advisories, exit 0.**
3. `npm run check:instruction-architecture` (hook wiring/shape).
4. `npm run check:harness-framing && npm run check:harness-framing:self-test`
   (skill + hook wording).
5. `npm run generate:docs-catalog` then `npm run check:docs-catalog`.
6. `npm run check:fact-consistency && npm run check:fact-consistency:self-test`.
7. `npm run check:doc-symbol-refs && npm run check:doc-symbol-refs:self-test`
   (new module path referenced from docs).
8. Live sanity: `node scripts/check-memory-router.js` in this worktree —
   current router is 9,040 B, so the notice MUST appear; Phase 0 acceptance
   sweep run with every remaining hit classified.

If the hook test script must gate shipping, its `node` invocation is added to
the verification list of this plan only — registering it as a package
`check:*` script is out of scope (new-gate decisions belong to the owner).

## 5. Risks and author's adversarial pass (v3)

- **Stop refactor regression risk (accepted):** moving the existing gate
  advisory's emission point touches reviewed behavior; T1's exact-content
  assertions (not counts) are the mitigation, and the blocking paths are
  deliberately untouched.
- **Notice fatigue:** the router is already ≥8 KiB, so the notice fires every
  session until a diet runs — intended; the runbook's first routine audit
  clears it. If ignored, posture equals today's, no worse.
- **Skip-on-failure trade:** if the thresholds module path breaks, hooks go
  silent instead of using stale numbers. Accepted because the CI/start gate
  fails loudly at require time in the same breakage (T6 covers the hook
  side).
- **Unconditional key store (new in v3):** `lastAdvisedKey` is now written on
  every advisory evaluation, adding one `saveState` on paths that previously
  wrote nothing. Bounded: the state file is already rewritten by `record()`
  on every tool use; one more small write at Stop is immaterial, and a write
  failure falls into the hook's existing fail-open catch.
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
- Self-test fixtures a–e and hook tests T1–T6 green; all §4 checks green
  sequentially.
- Phase 0 landed with the case-insensitive acceptance sweep run and EVERY
  remaining hit explicitly classified (live-fixed / historical / quoted /
  correct-current-state); zero unclassified live hits.
- Commits separate: Phase 0 (docs) / Phases 1–2 (thresholds + consumers) /
  Phase 3 (Stop refactor) / Phase 4 (skills); worktree clean after each.

## 7. Rollback

Each phase is one commit; `git revert` restores cleanly. The thresholds
module is additive; reverting Phase 2 alone returns consumers to their prior
copies (guard literals, hook constants) without breaking the checker, because
the checker re-exports the same names either way. Reverting Phase 3 restores
the current `stop()` verbatim; the optional state fields (`routerBytesAtStart`,
the v3 `lastAdvisedKey` semantics) are ignored or safely overwritten by old
code in both directions.
