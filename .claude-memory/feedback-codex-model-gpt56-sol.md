---
name: feedback-codex-model-gpt56-sol
description: "For Codex companion work, follow the owner's latest explicit model preference and pass the model explicitly; check current availability before use."
status: active
metadata:
  node_type: memory
  type: feedback
  originSessionId: 0c3accb8-eecf-472e-924c-e629a3a49c19
  modified: 2026-09-08T15:42:51.670Z
---

## Recall Rule
Read before composing a Codex companion invocation or brief that names a model.

The owner directed `gpt-5.6-sol` for companion invocations on 2026-09-08
(S496) and said not to use Astra; on 2026-10-07 (S581), the owner accepted
`gpt-6-astra` at low effort. Keep both as dated evidence and honor the latest
explicit request. Neither proves current availability or the default. Check the current catalog/config, pass an available model explicitly,
and stop if the requested model is refused; do not silently substitute.

Keep invocation syntax separate from the owner preference. Check the installed
companion/runtime's documented argument handling before using model, effort,
worktree or diff-base options; a remembered command is not current capability
evidence. Earlier companion observations recorded `--model` support and effort
coming from Codex configuration rather than `--effort`; those observations need
rechecking before use. Never pass `--help` or unknown flags to companion commands
as discovery because they may start work. Do not edit `~/.codex/config.toml` as
part of an invocation. Use the intended branch's own worktree and a base that
scopes the requested review, rather than assuming `origin/main` is always right.

Ground truth: current `~/.codex/models_cache.json` and `~/.codex/config.toml`.
Related: [[feedback-codex-delegation-review-vs-rescue-routing]],
[[reference-codex-detached-exec-protocol]].
