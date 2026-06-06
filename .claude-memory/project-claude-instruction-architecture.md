---
name: project-claude-instruction-architecture
description: Initiative to re-route CLAUDE.md's 4 jobs (reduce 308→~80-120 lines) + enforce must-follow rules with hooks not prose. Plan + Phase-1 review done S225; Codex authoring the enforcement harnesses next.
metadata:
  node_type: memory
  type: project
  status: active
  scope: meta
  last_verified: 2026-06-05
---

## Recall Rule
Read when: working on `CLAUDE.md` structure, `.claude/rules/`, `.claude/hooks/`, `.claude/settings.json` hook wiring, or any "why didn't Claude follow the rule" / instruction-adherence question. Also read before editing the root `CLAUDE.md` size/structure.

## State (S225)
Justin flagged this session's behavior as unacceptable — Claude repeatedly violated rules **already in** `CLAUDE.md`/memory (probe-before-plan, time-box meta-work, falsify-don't-confirm, don't-assert-unverified-state-as-built) across a long design churn. Root-cause framing: the 308-line root file (over Anthropic's documented ~200-line adherence threshold) dilutes must-follow rules into skimmed-past noise.

Two committed docs (commit `1c40a13`):
- `docs/CLAUDE_INSTRUCTION_ARCHITECTURE_CLEANUP_PLAN.md` — **Justin-authored** plan: route the root file's 4 jobs (guardrails / arch reference / live-state catalogue / doc router) to the right mechanism (root rules / path-scoped `.claude/rules/` / skills / hooks+gates / memory); reduce to ~80-120 lines; **enforce before deleting prose** (Phase 2 before Phase 3).
- `docs/CLAUDE_INSTRUCTION_ARCHITECTURE_REVIEW_RESPONSE.md` — **Claude's** Phase-1 review (AGREE/MODIFY/OBJECT + evidence). Verdict: accept direction, revise before implementing.

## Load-bearing facts (verified vs Claude Code docs, S225 — DON'T re-derive wrong)
- `.claude/rules/` with `paths:` frontmatter IS real; loads **when a matching file is READ** (not at startup, not on edit). Weak for "before you create a NEW file" + planning-time rules → those stay in root or become hooks/skills.
- Hook exit-code-2 blocking: **CAN block** = `PreToolUse`, `UserPromptSubmit`, `Stop` (auto-override after 8 consecutive blocks), `PreCompact`. **CANNOT block** = `PostToolUse` (advisory) and **`SessionStart`** (non-blocking, "shows stderr to user only"). ⚠ A symlink/setup guard CANNOT be a SessionStart block — use `PreToolUse` deny or an external launcher check.
- Current project hooks (4) are all reminder-only + fail-open (`additionalContext`). No project `Stop`/`SessionStart` hook.
- Instruction model: there is **no runtime precedence ladder** (unscoped rules load at same priority as `CLAUDE.md`). Use an **ownership policy — one rule, one authoritative home** — not a precedence order. Hooks/gates *enforce*; they are not higher-priority *instructions*.
- `setup-database.js` **self-contradicts**: header (`:12`) says backwards-compatible-on-existing-DBs, inline block (`~:600`) says fresh-install-only. Reconcile in-source before any enforcement; real guard belongs IN the script (protects humans/CI/other agents, not just Claude).

## Handoff
**Codex is authoring the enforcement harnesses next** (the §4 re-scoped set: deterministic `Stop` changed-surface gate check; advisory completion checklist; `PreToolUse`/external symlink guard; in-script `setup-database` guard). Next session will likely START with new Codex-written hooks present — review them against the corrected review response, don't assume the first-draft (wrong SessionStart) recommendations. Split-vs-unified `/contract-reconcile` to be decided by regression eval, not intuition. Related: [[feedback-timebox-metawork]], [[feedback-falsify-not-confirm]], [[feedback-reconcile-dont-append-docs]].
