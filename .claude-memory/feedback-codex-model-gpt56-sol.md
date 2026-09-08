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

Owner directive (2026-09-08, Session 496): pass `--model gpt-5.6-sol` on every
Codex companion invocation (`adversarial-review`, `review`, `task`). Do **not**
use `gpt-6-astra`, even though `~/.codex/config.toml` pins it as the default;
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
