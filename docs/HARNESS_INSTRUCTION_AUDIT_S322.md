---
title: Harness Instruction Audit — hooks, skills, guardrails (S322)
domain: agent-harness
kind: audit
status: historical
summary: Historical S322 harness audit; approved hook and skill changes shipped, while the remaining removal was explicitly rejected.
canonical: false
last_verified: 2026-07-26
---

# Harness Instruction Audit — Session 322 (2026-07-03)

> **Historical snapshot.** The approved changes in the Outcome section shipped on
> 2026-07-03, and the remaining removal was explicitly rejected. Inventory counts,
> line numbers, ranked removals, and the closing application protocol describe S322
> only. Use the live hooks, skills, settings, and instruction gates for current truth.

Audit-only; nothing was deleted or modified. Companion to `docs/AGENT_INSTRUCTION_AUDIT_S322.md` (which covers `CLAUDE.md`, `AGENTS.md`, and `.claude/rules/` — not re-audited here). Every claim is grounded in an S322 tool result.

**Evidence labels:** [OBSERVED] = the hook fired (or failed to fire) on this session's own tool calls — first-hand behavioral evidence; [VERIFIED scan] = confirmed by this session's read-only audit agents (files opened, settings parsed); [VERIFIED session] = checked directly in the main session (grep/run).

## Scope and inventory [VERIFIED scan]

- **Hooks:** 16 scripts in `.claude/hooks/` + `lib/git-commit-detect.js`; all 16 wired in `.claude/settings.json` (12 PreToolUse, 2 PostToolUse, 1 SessionStart, 1 Stop). No dead wiring in either direction.
- **Skills:** 6 in `.claude/skills/` (agent-coordination 55, contract-reconcile 103, parallel-agent-worktree 167, start 152, stop 158, sweep 96 lines).
- **Per-tool instructions:** none — `settings.json` carries no embedded instruction text; all reminder text lives in the hook scripts. `settings.local.json` is a ~563-entry permissions allowlist only, no hook wiring.
- **Out of repo scope:** the user-level operating charter and plugin-injected session context (e.g. the Vercel knowledge dump at SessionStart) are not repo-owned and are not classified here.

## Headline

The harness carries **no stale prior-model workarounds**: every guardrail encodes a *process* incident (S219, S221, S258, S259, S271, S272, S282, S291, S318), not a model quirk. Hook↔CI-gate duplication is deliberate layering (fail-fast at write/commit time; CI as backstop) per the enforcement-hierarchy design, and is not counted as redundancy. The real findings are three advisory hooks that duplicate other live layers, one mis-scoped matcher, one **defective blocking guard**, and generic git narration inside skills.

## Classification — hooks

| Hook | Class | Grounding |
|---|---|---|
| `protected-path-guard.js` | **Still needed** — blocking; protects AGENTS.md/.agents symlink invariant at write time (CI gate is post-hoc) | [VERIFIED scan] |
| `block-scaffolding-tokens.js` | **Still needed** — blocking; S291 incident; string class recurs | [VERIFIED scan] |
| `memory-router-guard.js` | **Still needed** — blocking; enforces MEMORY.md budget at edit time | [VERIFIED scan] |
| `memory-placement-reminder.js` | **Redundant** — advisory shadow of the blocking `memory-router-guard` + `check:memory-router` on the same file | [VERIFIED scan] |
| `scope-claim-reminder.js` | **Still needed** — fired ~7× on this session's doc writes and materially changed output (a scope claim was narrowed in direct response) | [OBSERVED] |
| `doc-edit-reconcile-reminder.js` | **Redundant** — third copy of guidance already delivered by `.claude/rules/durable-docs.md` (same trigger paths: docs/**, .claude-memory/**, CLAUDE.md, SESSION_PROMPT.md) and `feedback-reconcile-dont-append-docs` memory; both the rule and the hook fired on the same Edit this session | [OBSERVED + VERIFIED session] |
| `docs-catalog-format-guard.js` | **Still needed** — blocked two malformed doc writes this session (missing frontmatter; summary >160 chars); demonstrably load-bearing | [OBSERVED] |
| `design-doc-assertion-guard.js` | **Still needed** — S271 incident; fired on every durable-doc write this session and drove [VERIFIED]/[ASSUMED] labeling | [OBSERVED] |
| `contract-surface-reminder.js` | **Still needed** — advisory map of migration/route/table edits to their contract obligations; cheap, path-triggered | [VERIFIED scan] |
| `agent-wiki-reminder.js` | **Still needed** — wiki watch-path freshness nudge; no other layer does this at edit time | [VERIFIED scan] |
| `enum-parity-commit-guard.js` | **Still needed** — blocking, S259; commit-time enforcement of producer↔consumer parity | [VERIFIED scan] |
| `trust-boundary-guid-commit-guard.js` | **Still needed** — blocking, S259, security-relevant (client id → Dataverse selector) | [VERIFIED scan] |
| `docs-catalog-commit-guard.js` | **Still needed but DEFECTIVE (timing gap)** — two S322 commits (`16185334`, `e6d109ce`) landed while `docs/DOCS_CATALOG.md` was stale and the guard did not block; `check:docs-catalog` was red immediately after. Verified cause: the guard filters on `git diff --cached` at PreToolUse time [VERIFIED via .claude/hooks/docs-catalog-commit-guard.js:15-21,49-50], so a single-command `git add X && git commit` evades it — staging happens *after* the hook runs, `stagedPaths()` returns empty, and the guard exits before running the gate. The path regex itself is fine (`:25` matches any top-level `docs/*.md`). Fix, don't remove | [OBSERVED + VERIFIED via source read this session] |
| `pre-commit-self-review.js` | **Uncertain** — see risk note 3 | [VERIFIED scan] |
| `pre-review-delegation-trace-guard.js` | **Still needed (lean)** — S272; regex-scoped to review-flavored delegations, advisory, low noise | [VERIFIED scan] |
| `session-lifecycle.js` | **Still needed** — maps changed paths to gates at Stop; only blocking on newly-broken protected paths | [VERIFIED scan] |
| `codex-verbatim-reminder.js` | **Mildly harmful as originally written** — correction to this audit's first published claim: the script already scoped to Codex via `subagent_type`; the false positive came from its *fallback* substring scan of the whole tool_input (`/codex/i.test(JSON.stringify(ti))`), which tripped on any delegation whose prompt merely mentioned Codex [VERIFIED via source read; original "fires on every subagent" wording was wrong]. Observed firing on a plain inventory agent this session stands. The instruction encodes owner feedback (`feedback-share-codex-verbatim`) and survives | [OBSERVED + VERIFIED source] |

## Classification — skills

All six skills are **still needed** as workflows: each encodes repo-specific mechanisms (memory-store symlink slug formula, `.agents/skills` symlink + S221, `migrate-to-codex` ban, DEVELOPMENT_LOG format, SESSION_PROMPT template, traffic-light ownership, 7-audit contract tracing, 4-bucket sweep triage) that a fresh model cannot derive [VERIFIED scan]. Within them:

- **Redundant blocks (trim, not delete):** generic git narration a competent agent does unprompted — start L21-35 (fetch/pull/status), stop L15-26 (log/status/diff + commit flow) [VERIFIED scan]. The scan also flagged parallel-agent-worktree's command blocks (L49-65/99-125/140-154), but on direct read they are NOT generic — they embed the bootstrap-script call, the S318 unpushed-branch guard, the `--force`/.codex rationale, and the parked-branch pattern — so they were kept [VERIFIED via full file read this session; corrects the scan's classification].
- **Stale state found:** start's gate list (self-dated "as of 2026-06-26", L122) is **missing `check:docs-catalog`** (exists at package.json:55 [VERIFIED session]). Its own "grep package.json first" self-check mitigates this only if followed. contract-reconcile L55 hardcodes a gate list with no such freshness caveat — same drift class.
- **Over-prescription noted, keep as-is:** start's "any red gate is P0 regardless of cause" and stop's unconditional push-to-main match explicit owner policy (`feedback-red-gates-are-p0`, `project-commit-directly-to-main` memories) — not harmful in this repo. contract-reconcile's "codex adversarial pass is the norm" (L99) could over-apply to low-stakes changes; judgment call, not a removal.

## Ranked removal list (safest first)

1. **`doc-edit-reconcile-reminder.js`** — safe to cut. The identical guidance is delivered by a path-scoped rule on the same paths plus a feedback memory; this session both layers fired on one Edit. Keep the rule (it also loads on Read, which the hook cannot). Wiring: remove the script + its settings.json entry.
2. **`memory-placement-reminder.js`** — safe to cut. Advisory shadow of a blocking guard (`memory-router-guard`) plus a CI gate on the same single file; the blocking layer already carries the enforcement.
3. **Generic git-procedure text inside start/stop/parallel-agent-worktree** (lines above) — safe to trim ~60-80 lines total; pure restatement of default-competent behavior. Keep every repo-specific line (symlink checks, incident notes, templates).
4. **`codex-verbatim-reminder.js` as originally scoped** — not a deletion but a re-scope: make `subagent_type` authoritative when present, keeping the substring fallback only for the missing-field case it was built for. Cutting the hook outright touches an owner-feedback contract — needs owner sign-off.
5. **`pre-commit-self-review.js`** — plausible cut, lowest confidence. See risk note 3.

Explicitly **not** on the list: every blocking guard, both claim-verification hooks (observed working), all six skills as units, and the hook↔CI-gate layering.

## Risk notes (uncertain items)

1. **`codex-verbatim-reminder.js`:** the underlying instruction exists because relayed Codex findings were previously paraphrased into wrongness (S221 lineage, `feedback-share-codex-verbatim`). The over-fire is provable (substring fallback over the whole tool_input); the fix direction (narrow vs remove) is an owner call because the memory expresses durable owner feedback. Any narrowing must still catch `codex:codex-rescue` delegations and the renamed/missing-field case the fallback existed for.
2. **`docs-catalog-commit-guard.js` (fix, not removal — but risk if ignored):** the verified timing gap (staged-index read at PreToolUse; see classification row) means the repo's only commit-time catalog enforcement silently passes the exact case it was built for whenever `git add` and `git commit` share one Bash command — the dominant agent commit pattern. Until fixed, `check:docs-catalog` runs only when invoked manually or in CI; anyone trusting the hook's silence gets false assurance — worse than no guard, because it changes behavior (the manual check gets skipped). The same `--cached`-before-staging read exists in `pre-commit-self-review.js` [VERIFIED via .claude/hooks/pre-commit-self-review.js:38], so its surface-tailored checklist also sees an empty stage on compound commands; the enum-parity and trust-boundary commit guards do not read the index [VERIFIED via grep this session — no `--cached` in either] and are unaffected. Fix direction: when `isGitCommit(cmd)` is true, either run the gate unconditionally or derive candidate paths from the `git add` segment of the same command string instead of the index.
3. **`pre-commit-self-review.js`:** born from S258; advisory checklist tailored to the staged surface, fires on every non-amend commit. For a strong model the checklist largely restates default self-review, and `/code-review` plus the blocking commit guards cover the enforcement. But it is the only layer that prompts surface-*specific* review questions at commit time, and its removal would be invisible until a regression it would have caught ships. Cheap to keep; cut only if commit-time noise is actually hurting. Owner call.

## Outcome — applied 2026-07-03 (owner-approved, same session)

- **Applied:** removal 1 (`doc-edit-reconcile-reminder.js` deleted, settings entry removed); removal 2 (`memory-placement-reminder.js` deleted, settings entry removed); removal 3 for start/stop only (generic git blocks condensed; parallel-agent-worktree kept per corrected classification above); re-scope 4 (`subagent_type` now authoritative — verified silent on a non-codex agent mentioning Codex, firing on `codex:codex-rescue`, and firing via fallback when the field is absent); the commit-guard timing fix in both `docs-catalog-commit-guard.js` and `pre-commit-self-review.js` (command-token fallback; the docs-catalog guard was functionally re-tested and now blocks a compound `git add && git commit` against a stale catalog, exit 2); `check:docs-catalog` added to start's gate list (list re-dated 2026-07-03); freshness caveat added to contract-reconcile's audit-5 gate list.
- **Deliberately not applied:** removal 5 (`pre-commit-self-review.js` kept per risk note 3 — its timing gap was fixed instead). In the companion doc, F1 was owner-approved and applied; F2 was reviewed, rejected as unsafe to remove, and deprecated (`docs/AGENT_INSTRUCTION_AUDIT_S322.md`).

## Application protocol

1. Nothing here is green-lit; items 1-2 are safe on the evidence, 3 is mechanical trimming, 4-5 need owner decisions (risk notes above).
2. Any hook removal: delete the script AND its `settings.json` entry in the same commit; then run `npm run check:instruction-architecture` and `npm run check:harness-framing && npm run check:harness-framing:self-test` sequentially.
3. Skill edits: re-verify quoted line numbers first (snapshots at commit `92c9111b`); after editing, run `npm run check:agent-invariants` (skills are shared with Codex via the `.agents/skills` symlink).
4. Fix the `docs-catalog-commit-guard` gap and add `check:docs-catalog` to start's gate list regardless of what else is adopted.
