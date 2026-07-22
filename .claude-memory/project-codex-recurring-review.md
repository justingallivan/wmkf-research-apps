---
name: Independent agent review as a recurring verification surface
description: Use independent agent reviews to challenge implementation claims, while source evidence, owner priorities, and current coordination rules remain authoritative.
type: project
originSessionId: 87c3bedf-c936-4b4d-bdb8-69e4062e9249
status: active
scope: global
last_verified: 2026-07-22 via docs/AGENT_COLLABORATION_PLAN.md and the active agent-coordination skill
---

## Recall Rule

Read this when: an independent Claude/Codex review lands, or when deciding how
to commission and apply an adversarial review.

Do:
- Follow `docs/AGENT_COLLABORATION_PLAN.md`: one editing owner per surface;
  review is read-only unless Justin transfers ownership.
- Independently verify every finding against current source, Atlas, tests, or a
  probe. Push back when the reviewer missed context.
- Use the active runtime's supported model/default unless Justin explicitly
  requests another model.
- Treat overlap with an existing plan as evidence, not automatic priority.

Do not:
- Let a review become the to-do list; prioritize it against the user's actual goal.
- Resume a read-only review as an editing task without an explicit ownership
  transfer and a write-capable fresh run where the runtime requires one.
- Hard-code a retired model or shell/plugin transport as the universal default.

Ground truth: `docs/AGENT_COLLABORATION_PLAN.md`, the active
`agent-coordination` skill, and the relevant source/Atlas/gates for the reviewed
surface. Related: [[project-codex-design-pre-impl-iteration]],
[[feedback-share-codex-verbatim]]. `[VERIFIED via current collaboration contract]`

## Historical note

The 2026-04-30 review and response remain useful examples at
`docs/archive/CODE_REVIEW_FRAGILITY_FINDINGS_2026-04-30.md` and
`docs/archive/CODE_REVIEW_RESPONSE_2026-04-30.md`. Their transport and model
instructions are historical; their verify-before-accepting discipline remains.
