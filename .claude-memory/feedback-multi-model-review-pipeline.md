---
name: feedback-multi-model-review-pipeline
description: "Owner's preferred build pipeline (S596, 2026-10-11): Fable orchestrates; Sonnet builds and does reconnaissance; Opus reviews each stage and iterates until satisfied; Fable does the final review and applies fixes; Codex adversarial review last, Fable adjudicates; agents must not chase tails over minor changes."
metadata:
  node_type: memory
  type: feedback
  status: active
  originSessionId: ea1bb779-d116-4911-bc4f-3bcd814b5646
  last_verified: 2026-10-11 via the admin decomposition campaign (PR #473) run end to end this way
---

## Recall Rule

Read when the owner asks for a staged build to be "orchestrated", names model roles, or asks for
Codex to be "satisfied" before merge.

**What the owner asked for (2026-10-11, Session 596):** Fable orchestrates. Sonnet does builds and
reconnaissance. Opus reviews Sonnet's work and iterates until happy. Fable then does a final review and
implements changes itself if needed. Codex performs an adversarial review; Fable adjudicates the
findings and iterates until Codex is satisfied. Agents must not get caught chasing their tails over
minor changes — the orchestrator takes over small fixes directly. Confirmed cadence choices: Codex after
the pilot stage and at the end (not every stage); commits on a branch, draft PR for the owner, no
self-merge unless told; if Codex and the orchestrator disagree after one re-review, the orchestrator
makes the call and notes it before merge.

**Why:** the owner wants cheap models doing mechanical work with strong independent review, without
burning rounds on nits. In the admin decomposition this caught one blocking test flaw (a `Set` dedupe
that hid duplicated fetches) and three stale imports the builder left behind, each fixed in one
orchestrator commit instead of a re-dispatch.

**How to apply:**
- Brief Sonnet with the plan section, exact file lists, gate commands, and "pure move / STOP-AND-ASK"
  rules; require a terse evidence report (hashes, counts, gate exit codes).
- Brief Opus as a fresh-context reviewer against the plan's criteria; ask for severity-tagged findings.
- Apply should-fix/nit findings yourself when they are deterministic one-liners; re-dispatch only for
  real rework. Log every verdict in the plan's Stage Log.
- Launch Codex via the companion script per [[feedback-codex-delegation-review-vs-rescue-routing]] and
  [[feedback-codex-model-gpt56-sol]] (`--model gpt-6-astra`), `--base origin/main`, from the branch worktree.
- This repo's ESLint does not report unused imports: import hygiene must be proven by counting uses.
