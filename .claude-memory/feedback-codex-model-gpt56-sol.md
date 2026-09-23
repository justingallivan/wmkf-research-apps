---
name: feedback-codex-model-gpt56-sol
description: "Owner directive 2026-09-08: Codex reviews use --model gpt-5.6-sol; never gpt-6-astra (config default); ChatGPT-auth account refuses bare gpt-5.6 and gpt-5.4; catalog lives in ~/.codex/models_cache.json"
status: active
metadata:
  node_type: memory
  type: feedback
  originSessionId: 0c3accb8-eecf-472e-924c-e629a3a49c19
  modified: 2026-09-08T15:42:51.670Z
---

**2026-09-23 (Session 535):** the owner asked for `gpt-6-sol` (high). Codex refused it twice, on CLI 0.153.x and after the owner updated to 0.156.1: "The 'gpt-6-sol' model is not supported when using Codex with a ChatGPT account." Per the owner's instruction the rule stays `--model gpt-5.6-sol`. Review commands accept `--model` but not `--effort` (their effort comes from `~/.codex/config.toml`, which sets `model_reasoning_effort = "high"`); for `task`, pass `--effort high`. `~/.codex/config.toml` currently names `gpt-6-sol` as its default, so never rely on the default — always pass `--model`.

## Recall Rule
Read before composing any Codex companion invocation (`adversarial-review`, `review`, `task`) or writing a brief that names a Codex model.

Do: pass `--model gpt-5.6-sol`; run from the branch worktree (`-C`/`--cwd <worktree> --base origin/main`).
Do not: substitute another catalog model when Sol is refused (stop and show the catalog); edit `~/.codex/config.toml`; pass `--help` or any unrecognized flag to `codex-companion.mjs review`/`adversarial-review` — it treats it as focus text and starts a full review immediately on the config default model (S528, 2026-09-19: cost one adversarial cycle). `--model`/`-m` IS accepted by review and adversarial-review, not only `task`.
Ground truth: `~/.codex/models_cache.json` (catalog), `~/.codex/config.toml` (default), `codex doctor` (auth mode). Not covered: Claude-side model choice.

Owner directive (2026-09-08, Session 496): pass `--model gpt-5.6-sol` on every
Codex companion invocation (`adversarial-review`, `review`, `task`). Do **not**
use `gpt-6-astra`. At the time `~/.codex/config.toml` pinned it as the default (as of 2026-09-17 the file pins `gpt-5.6-sol`, so the flag is belt-and-braces, still pass it);
the owner said "I don't want you to use that model."

**Why:** the account is ChatGPT-token auth (`codex doctor`: stored auth mode
`chatgpt`, no API key). On that auth the CLI (`codex-cli 0.153.4`) refuses
`gpt-5.6` and `gpt-5.4` outright ("not supported when using Codex with a
ChatGPT account"); the two earlier attempts each cost a failed run. The
visible catalog is in `~/.codex/models_cache.json`: `gpt-6-astra`,
`gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5`, `gpt-5.4-mini`,
`gpt-5.3-codex-spark`. Repo precedent (S495 handoff) is "Luna implementation,
Sol review", so the owner picked Sol for review work.

**How to apply:** include `--model gpt-5.6-sol` in the companion arg string; run
each review from inside the branch's own worktree with `--cwd <worktree>
--base origin/main` so Codex never reads a Codex-owned dirty checkout. If
Codex rejects the model, stop and show the owner the catalog rather than
substituting. Never edit `~/.codex/config.toml`. Supersedes
[[feedback-codex-model-gpt55]]. Related: [[reference-codex-detached-exec-protocol]].
