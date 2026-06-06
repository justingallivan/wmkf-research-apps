---
name: project-claude-instruction-architecture
description: Instruction architecture re-routed: reduced root, scoped rules, authority registry, source-level DB guard, and advisory session-owned gate hooks implemented.
metadata:
  node_type: memory
  type: project
  status: active
  scope: meta
  last_verified: 2026-06-05
---

## Recall Rule
Read when: working on `CLAUDE.md` structure, `.claude/rules/`, `.claude/hooks/`, `.claude/settings.json` hook wiring, or any "why didn't Claude follow the rule" / instruction-adherence question. Also read before editing the root `CLAUDE.md` size/structure.

## State (S225 implementation)
Justin flagged this session's behavior as unacceptable — Claude repeatedly violated rules **already in** `CLAUDE.md`/memory (probe-before-plan, time-box meta-work, falsify-don't-confirm, don't-assert-unverified-state-as-built) across a long design churn. Root-cause framing: the 308-line root file (over Anthropic's documented ~200-line adherence threshold) dilutes must-follow rules into skimmed-past noise.

Two committed docs (commit `1c40a13`):
- `docs/CLAUDE_INSTRUCTION_ARCHITECTURE_CLEANUP_PLAN.md` — **Justin-authored** plan: route the root file's 4 jobs (guardrails / arch reference / live-state catalogue / doc router) to the right mechanism (root rules / path-scoped `.claude/rules/` / skills / hooks+gates / memory); reduce to ~80-120 lines; **enforce before deleting prose** (Phase 2 before Phase 3).
- `docs/CLAUDE_INSTRUCTION_ARCHITECTURE_REVIEW_RESPONSE.md` — **Claude's** Phase-1 review (AGREE/MODIFY/OBJECT + evidence). Verdict: accept direction, revise before implementing.

## Load-bearing facts (verified vs Claude Code docs, S225 — DON'T re-derive wrong)
- `.claude/rules/` with `paths:` frontmatter IS real; loads **when a matching file is READ** (not at startup, not on edit). Weak for "before you create a NEW file" + planning-time rules → those stay in root or become hooks/skills.
- Hook exit-code-2 blocking: **CAN block** = `PreToolUse`, `UserPromptSubmit`, `Stop` (auto-override after 8 consecutive blocks), `PreCompact`. **CANNOT block** = `PostToolUse` (advisory) and **`SessionStart`** (non-blocking, "shows stderr to user only"). ⚠ A symlink/setup guard CANNOT be a SessionStart block — use `PreToolUse` deny or an external launcher check.
- Project hooks (S226): 4 reminder-only + fail-open via `additionalContext` (`scope-claim`, `doc-edit-reconcile`, `contract-surface` = PreToolUse; `codex-verbatim` = PostToolUse), PLUS two added this session — `protected-path-guard` (PreToolUse **deny**, blocks Write/Edit to `AGENTS.md`/`.agents/skills`) and `session-lifecycle` (SessionStart baseline + PostToolUse record + **Stop** changed-surface gate). (The pre-S226 baseline was "4 hooks, none blocking, no Stop/SessionStart" — now superseded.)
- Instruction model: there is **no runtime precedence ladder** (unscoped rules load at same priority as `CLAUDE.md`). Use an **ownership policy — one rule, one authoritative home** — not a precedence order. Hooks/gates *enforce*; they are not higher-priority *instructions*.
- `setup-database.js` contradiction is **resolved**: its header and runtime now define a fresh-install-only contract, and a source-level guard refuses populated databases unless the deliberate recovery override is set.
- ⚠ **`additionalContext` on a `Stop` hook RE-OPENS the turn** ("conversation continues so Claude can act on the feedback"). So any advisory message emitted from the Stop hook on a *normal* stop loops forever unless it's exactly-once or silent. Two such loops were found+fixed S226 (`605593e`+`8786664`): the no-ledger path now exits silently; the advisory gate-failure path de-dups on (failing gates + changed-surface fingerprint) → surfaces each distinct state once. A block (`exit 2`) is the only non-looping way to make Stop *act* every time. Still latent: the `main()` error-catch emits additionalContext on a `stop()` exception (loops only if the hook itself is persistently broken).

## Implemented
- Root `CLAUDE.md` now contains session-wide/planning-time rules and canonical pointers rather than mutable catalogues.
- `.claude/rules/` owns file-scoped conventions.
- `docs/CLAUDE_INSTRUCTION_AUTHORITY.md` defines authoritative instruction ownership and the hook safety contract.
- `scripts/setup-database.js` is explicitly fresh-install-only and refuses populated databases unless a deliberate recovery override is set.
- `check:agent-invariants` verifies the tracked `AGENTS.md` symlink; the lifecycle diagnostic also checks `.agents/skills` and the machine memory link.
- `.claude/hooks/session-lifecycle.js` captures a session baseline, records successful Write/Edit paths, and runs relevant gates against session-owned changed surfaces at Stop. Gate failures are advisory by default; `CLAUDE_STOP_GATE_MODE=block` remains an explicit rollout switch.
- `/contract-reconcile` remains unified pending measured activation evidence.

## Follow-up
Observe several real Claude sessions before enabling blocking changed-surface gates. Record false positives, missed Bash-authored changes, and Stop runtime. Decide split-vs-unified `/contract-reconcile` from repeated evaluation results, not intuition. Related: [[feedback-timebox-metawork]], [[feedback-falsify-not-confirm]], [[feedback-reconcile-dont-append-docs]].
