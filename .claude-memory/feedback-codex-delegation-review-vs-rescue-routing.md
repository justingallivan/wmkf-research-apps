---
name: feedback-codex-delegation-review-vs-rescue-routing
description: "Codex reviews stay on the review path (/codex:review, /codex:adversarial-review); since 2026-09-23 the owner authorizes Claude to launch them itself by running the same codex-companion command via Bash. Rescue delegations whose prompt merely mentions review need the [INTENTIONAL-RESCUE] preface or the trace guard blocks them."
status: active
metadata:
  type: feedback
---

## Recall Rule

Read before routing any Claude-to-Codex review, adversarial verdict, or rescue
implementation request. `[VERIFIED via
.claude/hooks/pre-review-delegation-trace-guard.js and
.claude/hooks/hook-enforcement.test.js, 2026-08-15]`

Codex delegation routing has two enforced paths (discovered S401, 2026-08-05):

- **Review-shaped work** (verdicts, adversarial passes, P0/required-changes
  calls) must go through `/codex:review` or `/codex:adversarial-review`. Those
  skills carry `disable-model-invocation`, so the model cannot invoke them via
  the Skill tool. **Owner authorization (2026-09-23, Session 535, standing):**
  Claude may launch these reviews itself by running the same command the slash
  command runs — `node <plugin>/scripts/codex-companion.mjs adversarial-review
  "<args>"` (or `review`) — through Bash, so long runs do not wait on the
  owner. Resolve the versioned plugin path under
  `~/.claude/plugins/cache/openai-codex/codex/` at run time. Pass `--model
  gpt-6-sol` ([[feedback-codex-model-gpt6-sol-high]]), `-C <worktree>` and a
  `--base <ref>` that scopes the diff; run larger reviews with
  `run_in_background` and wait for completion; show the output verbatim
  ([[feedback-share-codex-verbatim]]). The owner may still run the slash
  command directly. This is still the review path: never route review
  verdicts through rescue.
- **Implementation work** (fix requests, builds) goes through `codex:rescue` →
  the `codex:codex-rescue` agent. A pre-delegation hook
  (`.claude/hooks/pre-review-delegation-trace-guard.js`, regexes at :61/:95)
  BLOCKS rescue prompts matching its review-shaped patterns (adversarial,
  code/design review, confirm-or-refute, critique, verify-this, etc.) — even
  when those words only describe a prior finding being fixed. Re-run with a
  first line `CODEX RESCUE HANDOFF` plus `[INTENTIONAL-RESCUE: <reason>]` to
  pass.

**Why:** the guard keeps review verdicts on the dedicated review path (with its
own framing and verbatim-output contract) and stops review work from being
smuggled through rescue where those contracts don't apply.

**How to apply:** when a Codex review is due (the owner asks, or a workstream
requires an adversarial review per stage), run the companion review command
yourself as above; when
the user says "have Codex fix X" and the prompt must reference review findings,
lead with the CODEX RESCUE HANDOFF + INTENTIONAL-RESCUE preface. Rescue tasks
may launch in background regardless of foreground intent — capture the
`task-…` id and poll `codex-companion.mjs status <id>` with a background
until-loop. Related: [[feedback-share-codex-verbatim]],
[[feedback-surface-full-review-findings]].
