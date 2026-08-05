---
name: feedback-codex-delegation-review-vs-rescue-routing
description: "Route Codex review requests through /codex:adversarial-review (user-invoked only); rescue delegations whose prompt merely mentions review need the [INTENTIONAL-RESCUE] preface or the trace guard blocks them."
status: active
metadata:
  type: feedback
---

Codex delegation routing has two enforced paths (discovered S401, 2026-08-05):

- **Review-shaped work** (verdicts, adversarial passes, P0/required-changes
  calls) must go through `/codex:review` or `/codex:adversarial-review`. Those
  skills carry `disable-model-invocation` — the model cannot invoke them via
  the Skill tool; ask the user to run the slash command themselves. Do not
  replicate the review workflow by other means.
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

**How to apply:** when the user says "have Codex review X", hand them the
`/codex:adversarial-review --wait <focus>` command instead of delegating; when
the user says "have Codex fix X" and the prompt must reference review findings,
lead with the CODEX RESCUE HANDOFF + INTENTIONAL-RESCUE preface. Rescue tasks
may launch in background regardless of foreground intent — capture the
`task-…` id and poll `codex-companion.mjs status <id>` with a background
until-loop. Related: [[feedback-share-codex-verbatim]],
[[feedback-surface-full-review-findings]].
