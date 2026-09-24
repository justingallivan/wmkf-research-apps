---
name: feedback-orchestrated-build-review-model
description: "Owner's chosen working model for multi-stage refactor campaigns (2026-09-23): Fable orchestrates, Sonnet builds, Opus reviews to satisfaction (3-round cap), Codex adversarial review on the final diff, orchestrator takes over when findings turn cosmetic; hard stops at owner touchpoints."
metadata:
  node_type: memory
  type: feedback
  status: active
  scope: agent-collaboration
  last_verified: 2026-09-23 via owner instruction in Session 536-PG (Postgres access layer Stage 0)
  originSessionId: 5a83d234-b47d-4c17-a984-2c47cf07ca18
  modified: 2026-09-24T04:34:20.656Z
---

## Recall Rule

Read before orchestrating any staged refactor or multi-file build with delegated agents.

**Owner directive (2026-09-23, Session 536-PG):** "You (Fable) are the orchestrator. Sonnet can handle builds and Opus can review them. They can iterate until Opus is satisfied. You monitor and make sure they are not chasing each other's tails over minor points. If that happens, you take over. Otherwise, you review when Opus is happy. You can use parallel streams of agents if the shape of the tasks allows." Confirmed after Stage 0: "The Sonnet/Opus/Codex model works for me."

**Why:** it produced findings a single agent missed — an Opus P1 (test shim preferred `POSTGRES_URL`, proven with a decoy database), a fifth parity table found by a builder's test, three hand-grep miscounts corrected by an AST probe, and Codex forcing a catalog-level comparison — while keeping the orchestrator's context on decisions, not file dumps.

**How to apply:**
- Builders get self-contained briefs with an exact owned-file list, "no git commands", fixtures under `os.tmpdir()`, and a required report format. Parallel streams only on disjoint files; the orchestrator commits.
- Reviewers are read-only, must re-derive builder claims, and report P1/P2/P3 with file:line and how verified. Cap: three build/review rounds; only P1/P2 justify a round; state the cap in the reviewer's brief.
- When remaining findings are wording-level, the orchestrator fixes them directly rather than spending a round.
- Codex adversarial review (`codex-companion.mjs adversarial-review --wait --scope working-tree --base origin/main "<focus>"`) on each stage's final diff; iterate, but close the loop at three rounds and record anything fixed without Codex re-review. Model comes from `~/.codex/config.toml` (see [[feedback-codex-model-gpt56-sol]]).
- The orchestrator reviews last (run the artefact, read the safety-critical lines), then commits with gates.
- Hard stops at owner touchpoints: production/Preview smoke, releases, merges to `main`, anything the plan marks as owner-run. Stop and report rather than proceed.
- Related: [[feedback-codex-worktree-owner-runs-it]], [[feedback-red-gates-are-p0]].
