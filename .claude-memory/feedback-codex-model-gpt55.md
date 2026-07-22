---
name: feedback-codex-model-gpt55
description: "Superseded S355 model override; current Codex runtimes choose their supported default unless the user explicitly requests a model."
metadata: 
  node_type: memory
  status: superseded
  type: feedback
  originSessionId: 29a6b837-b641-4706-996e-0d56eb5d5029
---

> **Superseded 2026-07-22:** The installed Codex companion runtime now explicitly
> says to leave the model unset unless the user requests one, and the Codex app
> exposes its own current model list. Use the active runtime contract and
> `docs/AGENT_COLLABORATION_PLAN.md`; do not force `gpt-5.5`.

Historical owner directive (S355, 2026-07-11): every Codex invocation — `/codex:review`,
`/codex:adversarial-review`, `codex:rescue`, direct `codex exec` — passes
`--model gpt-5.5`, unless the owner explicitly requests a different model for
that call.

**Why:** the account's `~/.codex/config.toml` pins `gpt-5.6-sol`, which the
installed CLI rejects ("requires a newer version of Codex"), so an explicit
per-call override is required anyway; the owner chose gpt-5.5 as the standing
override (upgraded from the gpt-5.4 used earlier in S355). `gpt-5.5` verified
working on the account via `codex exec -m gpt-5.5` probe, S355.

**Historical application:** add `--model gpt-5.5` to the companion-script arg string /
`codex exec -m gpt-5.5`. If Codex ever rejects gpt-5.5 (account/CLI change),
STOP and surface the error to the owner — do not silently downgrade to
another model. Do not edit `~/.codex/config.toml`; it is the owner's file.
Related: [[reference-codex-detached-exec-protocol]].
