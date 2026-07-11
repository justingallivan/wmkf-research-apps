---
name: feedback-codex-model-gpt55
description: "All Codex calls (review, adversarial-review, rescue, exec) use --model gpt-5.5 unless the owner says otherwise"
metadata: 
  node_type: memory
  status: active
  type: feedback
  originSessionId: 29a6b837-b641-4706-996e-0d56eb5d5029
---

Owner directive (S355, 2026-07-11): every Codex invocation — `/codex:review`,
`/codex:adversarial-review`, `codex:rescue`, direct `codex exec` — passes
`--model gpt-5.5`, unless the owner explicitly requests a different model for
that call.

**Why:** the account's `~/.codex/config.toml` pins `gpt-5.6-sol`, which the
installed CLI rejects ("requires a newer version of Codex"), so an explicit
per-call override is required anyway; the owner chose gpt-5.5 as the standing
override (upgraded from the gpt-5.4 used earlier in S355). `gpt-5.5` verified
working on the account via `codex exec -m gpt-5.5` probe, S355.

**How to apply:** add `--model gpt-5.5` to the companion-script arg string /
`codex exec -m gpt-5.5`. If Codex ever rejects gpt-5.5 (account/CLI change),
STOP and surface the error to the owner — do not silently downgrade to
another model. Do not edit `~/.codex/config.toml`; it is the owner's file.
Related: [[reference-codex-detached-exec-protocol]].
