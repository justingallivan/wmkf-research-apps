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

**Status: DRAFT — owner greenlit the direction 2026-08-21; nothing here is
built.** This plan exists to be adversarially reviewed before implementation
(owner instruction). It implements recommendation R3 of
`docs/audits/memory-hygiene-best-practices-review-2026-08-21.md` in the
expanded form both adversarial reviews of that document converged on.

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
    — it does not import the checker, unlike the write guard, which does
    at `.claude/hooks/memory-router-guard.js:27-33`];
  - the write-time guard blocks only over-cap worsening
    [`memory-router-guard.js:65-78`] and fails open [`:123-125`];
  - the Stop hook has no router-size awareness at all [VERIFIED via read of
    `session-lifecycle.js` `stop()`, lines 370-458 — gates/staleness/review
    receipts only].
- Observed regrowth spans ~166–500 B/day. At the worst observed rate, a 6 KiB
  post-diet router reaches 11 KiB in ~10 days and the 12 KiB cap in ~12.5 —
  inside a two-week calendar cadence. The 8,192 B routine-audit trigger in
  `docs/MEMORY_HYGIENE_RUNBOOK.md` §5 is currently prose only; it was crossed
  silently on 2026-08-13 (`840d082d`, 8,193 B).

Goal: make the 8 KiB trigger fire mechanically at session start, in CI logs,
and — when the current session caused the crossing — at session stop, so the
size trigger (not the calendar) is the primary cadence driver.

## 2. Design

Four components plus one documentation phase. Threshold single-sourcing is a
hard requirement throughout: **exactly one new constant, exported from the
checker; every consumer imports it.**

### Phase 0 — document corrections (no control changes)

Apply the four accepted Codex findings to the two shipped documents:

1. Sweep ALL restatements of the 8 KiB crossing date to 2026-08-13 (the §1
   executive-conclusion restatement was missed by the first fix pass) and
   widen §1's regrowth figure to the observed 166–500 B/day range.
2. Correct the §4 diet attribution: `813da56a` is the 11,298 B *before* state;
   the diet landed in `0f7fad66`. Cite both commits.
3. Replace the "all 57 registered check:* scripts" claim with the true count:
   56 of 57 (every registered script except the mutating `check:memory-drift`,
   whose `:no-write` variant ran instead), and list the omission explicitly so
   the claim is reproducible without the ephemeral scratchpad log.
4. Runbook §19: before `git checkout -- docs/RECONCILIATION_REPORT.json`,
   require `git diff -- docs/RECONCILIATION_REPORT.json` and restore only when
   the diff is solely the accidental regeneration; otherwise stop and confirm
   with the owner.
5. Update runbook §5/§10 cadence rationale: size trigger primary (now
   mechanical, per this plan), calendar backstop, worst-case math stated.

### Phase 1 — checker notice (`scripts/check-memory-router.js`)

- Add `const NOTICE_BYTES = 8 * 1024;` and export it.
- In `validateStore`, extend the existing byte ladder: over `TARGET_BYTES` →
  error (unchanged); over `WARN_BYTES` → existing warning (unchanged); over
  `NOTICE_BYTES` → new **notice** warning:
  `MEMORY.md is <N> bytes, over the 8192-byte routine-audit trigger — run the
  router diet per docs/MEMORY_HYGIENE_RUNBOOK.md §10 before the 11264-byte
  warn band.`
- Delivery channel: the existing `warnings` array (printed as `warning:`,
  never fails the gate). No new exit codes; CI and `/start` inherit the line
  with zero wiring changes.
- Self-test (`scripts/check-memory-router-self-test.js`): three new fixtures —
  (a) 8,300 B store → exactly one notice-band warning, zero errors;
  (b) 8,191 B store → no byte warning;
  (c) assert `NOTICE_BYTES < WARN_BYTES < TARGET_BYTES` ordering so a future
  threshold edit cannot silently invert the ladder.

### Phase 2 — SessionStart note (`.claude/hooks/session-lifecycle.js`)

- Replace the hardcoded constants in `wikiAndRouterNotes()`
  (`session-lifecycle.js:285-286`) with a guarded import of
  `{ NOTICE_BYTES, WARN_BYTES, TARGET_BYTES }` from
  `../../scripts/check-memory-router.js`, with the same try/catch +
  numeric-fallback pattern the write guard already uses
  (`memory-router-guard.js:26-33`) so the hook stays fail-open if the checker
  moves.
- Emit the pressure note at `>= NOTICE_BYTES` instead of `> WARN`, with two
  tiers: notice text (8 KiB–11 KiB) pointing at the runbook routine audit;
  existing near-cap text above `WARN_BYTES` (unchanged semantics).
- Wording stays procedural (the `check:harness-framing` gate scans emitted
  hook source [VERIFIED via `docs/CI_GATES_REFERENCE.md` scope list]).

### Phase 3 — Stop-time crossing warning (same hook, `stop()`)

The session that pushes the router over the trigger should hear about it, not
a later one (same philosophy as the write-time guard).

- `start()`: record `state.routerBytesAtStart` via `fs.statSync` (try/catch →
  `null` on any error). Additive optional field; no `STATE_VERSION` bump
  (readers treat absence as unknown — `initStateCollections` untouched).
- `stop()`: after the existing checks, compute current router bytes. Warn via
  advisory `additionalContext` **only when all hold**: `.claude-memory/MEMORY.md`
  is in `changedOwnedPaths` (this session actually changed it), current bytes
  `>= NOTICE_BYTES`, and (`routerBytesAtStart == null` or start bytes
  `< NOTICE_BYTES` or current > start). Never `exit 2` — this warning is
  advisory in every mode, independent of `CLAUDE_STOP_GATE_MODE`.
- Loop safety: Stop `additionalContext` re-opens the turn, so dedup exactly
  like the existing gate advisories [pattern at `session-lifecycle.js:453-457`]:
  store `state.routerNoticeAdvisedKey = hash(currentBytes)` and stay silent
  when unchanged. A later edit that changes the size re-arms it; a shrink
  below the trigger clears it.
- Whole hook body remains fail-open (existing outer try/catch in `main()`).

### Phase 4 — skill text

- `.claude/skills/start/SKILL.md`: one line in the gate step — if
  `check:memory-router` prints the routine-audit notice, surface it in the
  Step 4 summary and propose the runbook §6 routine audit as a candidate task.
- `.claude/skills/stop/SKILL.md`: one line — a stop-time router notice means
  this session crossed the trigger; either run the §10 diet now or record the
  debt explicitly in `SESSION_PROMPT.md`.

## 3. Self-trace (lifecycle and provenance)

- **New state field lifecycle:** `routerBytesAtStart` is written once in
  `start()` (fresh sessions only — the resume path at
  `session-lifecycle.js:311-317` returns before state creation and must NOT
  overwrite it), read once in `stop()`, never mutated between; it dies with
  the tmp session state file. `routerNoticeAdvisedKey` is set on advise,
  overwritten on size change, and is meaningless across sessions (tmp state).
  No transition can wedge: every read tolerates `undefined`.
- **Threshold provenance:** one producer (`check-memory-router.js` exports),
  three consumers (gate itself, write guard — already importing, session
  hook — converted by Phase 2). After this plan, zero hardcoded copies remain
  [disconfirming check to run at build time:
  `grep -rn '11 \* 1024\|12 \* 1024\|8 \* 1024' .claude/hooks/ scripts/` must
  return only the checker definitions and the guard/hook fallback literals,
  which are labeled as fallbacks].
- **Failure paths:** checker unreachable from hook → fallback constants (same
  numbers), behavior identical to today; statSync failure → note skipped
  (today's behavior); JSON state unreadable at stop → existing early return.

## 4. Test and verification plan

Sequential, per the fixture-race rule:

1. `npm run check:memory-router && npm run check:memory-router:self-test`
   (new fixtures included).
2. Scoped hook tests: extend `.claude/hooks/hook-enforcement.test.js` (it
   already imports from `session-lifecycle` and spawns `start`/`stop`
   [VERIFIED via `hook-enforcement.test.js:16,593,733`]) with: notice emitted
   at start when fixture router ≥ `NOTICE_BYTES`; stop warning fires only on
   session-caused crossing; stop warning dedups on identical size; stop stays
   advisory (exit 0) in both `CLAUDE_STOP_GATE_MODE` values; resume path
   preserves `routerBytesAtStart`. Run via `npx jest .claude/hooks/hook-enforcement.test.js`.
3. `npm run check:instruction-architecture` (hook wiring/shape).
4. `npm run check:harness-framing && npm run check:harness-framing:self-test`
   (skill + hook wording).
5. `npm run check:docs-catalog` after `npm run generate:docs-catalog` (this
   plan + Phase 0 edits touch top-level docs).
6. `npm run check:fact-consistency && npm run check:fact-consistency:self-test`
   (Phase 0 edits touch counted claims).
7. Live sanity: run `node scripts/check-memory-router.js` in this worktree —
   current router is 8,991 B, so the new notice MUST appear; then
   `node .claude/hooks/session-lifecycle.js start < fixture-stdin` smoke.

## 5. Risks and author's adversarial pass

- **Notice fatigue / normalization:** the router is already over 8 KiB, so the
  notice fires immediately every session until a diet runs. Accepted — that is
  the point; the runbook's first routine audit (adoption plan step 2) clears
  it. Failure mode if ignored: identical to today, no worse.
- **`warnings` channel overload:** the gate prints warnings but still exits 0;
  CI will show the line without failing. Deliberate — promoting 8 KiB to a
  failure would violate the review's R8 (no new blocking memory gates).
- **Hook/checker import cycle:** none — the checker never imports hooks.
  Checked: `check-memory-router.js` requires only `fs`/`path` [VERIFIED via
  `scripts/check-memory-router.js:40-41`].
- **Stop-warning suppression bug class:** if `changedOwnedPaths` misses the
  router (e.g., harness auto-memory write outside Write/Edit tools), the stop
  warning correctly stays silent and the SessionStart notice still covers the
  next session — degraded, not broken. Documented boundary, same as the write
  guard's.
- **Self-test byte fixtures are size-sensitive:** build them by generating
  content to an exact byte length programmatically, not by hand-counting.
- **What this plan deliberately does NOT do:** no elapsed-time trigger (needs
  cross-session persistent state; size is the load-bearing proxy and the
  calendar row in runbook §5 remains a manual backstop); no change to
  `WARN_BYTES`/`TARGET_BYTES` values; no new blocking gate; no router edits.

## 6. Acceptance criteria

- One new exported constant; `grep` proves no new hardcoded threshold copies.
- Notice visible in: gate output (hence `/start` and CI logs) at ≥8,192 B;
  SessionStart context at ≥8,192 B; Stop context only for session-caused
  crossings, deduplicated, always advisory.
- All Phase 4 skill lines present; all §4 checks green sequentially; hook
  tests cover fire/no-fire/dedup/advisory-mode cases.
- Phase 0 document corrections landed with a restatement sweep (grep for the
  old date/count across `docs/**` returns only historical audit quotes).
- Worktree clean; commits separate: Phase 0 (docs) vs Phases 1–4 (controls).

## 7. Rollback

Each phase is one commit; `git revert` restores the prior state cleanly. The
checker change is behaviorally additive (a new warning string); reverting it
returns consumers to fallback constants without breakage. State-file field is
optional, so mixed-version hook/state combinations are safe in both
directions.
