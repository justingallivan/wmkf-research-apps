---
name: feedback-rename-code-not-just-docs
description: When legacy nomenclature causes recurring stale-claim cost, the durable fix is renaming the CODE (the ground truth), not sweeping docs/memory — stale claims re-anchor to surviving legacy names in code.
metadata:
  type: feedback
  status: active
  scope: global
  last_verified: 2026-06-23 (S280) — owner stated directly re: reviewer-finder / review-manager nomenclature debt
---

## Recall Rule

Read this when: deciding how to retire/consolidate a renamed-or-merged capability,
or when a `/sweep` keeps finding the same stale claim resurface session after session.

## The fact (owner, S280)

Parts of the **Reviewer Finder** and **Reviewer Manager** apps were repurposed into a
single **Workbench** (`appRegistry` key `reviewers`). The leftover legacy names
(`reviewer-finder`, `review-manager`) still live in code — route paths
(`pages/api/{reviewer-finder,review-manager}/*`), authz guard keys, the
`reviewer-finder` model/prompt namespace — and that overloaded nomenclature is the
recurring cost: stale memories/claims keep cropping up because they can be
"verified" against the surviving legacy code names.

**Why:** sweeping docs/memory does NOT help while the code still carries the old
names — a future agent re-derives the stale claim from the live code and the sweep
unwinds. The code is the ground truth; until it is renamed, the doc fix is temporary.

**How to apply:** when the goal is "one thing that covers both functions," treat the
**code rename/consolidation as the actual deliverable**, not a cosmetic add-on. Do not
recommend "keep the legacy string, just document it" when the owner's pain IS the
recurring stale-claim cost — that perpetuates the exact problem. Rename the ground
truth (paths, keys, namespaces), migrate any stored data keyed on the old name
(e.g. `model_override:<oldkey>:*` settings), THEN reconcile docs/memory once — and it
sticks. Related: [[feedback-reconcile-dont-append-docs]],
[[feedback-apply-reconcile-to-fix-work]], [[project-workbench-consolidation-rollout]].
