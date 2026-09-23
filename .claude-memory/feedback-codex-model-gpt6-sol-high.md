---
name: feedback-codex-model-gpt6-sol-high
description: "Owner directive 2026-09-23: Codex runs use gpt-6-sol at high reasoning effort; pass --model gpt-6-sol on every companion call; review commands take effort only from ~/.codex/config.toml"
status: active
metadata:
  type: feedback
---

## Recall Rule
Read before composing any Codex companion invocation (`adversarial-review`, `review`, `task`) or writing a brief that names a Codex model.

Do: pass `--model gpt-6-sol` on every companion call. For `task`, also pass `--effort high`. Run from the branch worktree (`-C <worktree>`) with a `--base <ref>` that scopes the diff.
Do not: pass `--effort` to `review` or `adversarial-review` — they accept only `--base`, `--scope`, `--model` and `--cwd` (`codex-companion.mjs` `handleReviewCommand`), and an unrecognized flag becomes focus text. Do not substitute another model if `gpt-6-sol` is refused; stop and show the owner the catalog.
Ground truth: `~/.codex/models_cache.json` (catalog; slug `gpt-6-sol`, display "GPT-6-Sol", supports high), `~/.codex/config.toml` (`model = "gpt-6-sol"`, `model_reasoning_effort = "high"` as of 2026-09-23), `codex-companion.mjs` option parsing.

Owner directive (2026-09-23, Session 535): use GPT-6 Sol at high effort for Codex work. Review commands have no effort flag, so their high effort comes from the config default; the explicit `--model` is kept so a later config change cannot silently switch the review model.

**Why:** the owner chose the model; the flag makes the choice explicit per run rather than dependent on local config.

**How to apply:** include `--model gpt-6-sol` in the companion argument string; for `task`, add `--effort high`. Supersedes [[feedback-codex-model-gpt56-sol]]. Related: [[feedback-codex-delegation-review-vs-rescue-routing]].
