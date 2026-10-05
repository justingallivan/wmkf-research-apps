---
name: feedback-cap-subagent-load-in-reproduction-briefs
description: A subagent brief that says "reproduce under load / CPU pressure" must cap concurrency and forbid coverage runs; an uncapped brief put ~38 Jest processes on the owner's laptop (load average ~160) and overheated it (S566, 2026-10-02). Prefer CI logs over local load reproduction.
metadata:
  type: feedback
  status: active
  originSessionId: 5cb971f8-2f5c-4dbf-8f6c-9cad24da8541
  modified: 2026-10-03T00:05:29.134Z
---

## Recall Rule
Read before writing a subagent brief that reproduces a flaky or load-dependent test, or before running tests in parallel on the owner's laptop.

Do: pull CI failure logs first (`gh run view <id> --log-failed`); write a hard ceiling into the brief (at most 2 concurrent Jest processes, one test by name, `--maxWorkers=1`, never `--coverage`).
Do not: ask for "CPU pressure" or "several copies concurrently" without a number; run full-file coverage in parallel.
Ground truth: `docs/AGENT_COLLABORATION_PLAN.md` (delegation briefs); the incident is this file's body (S566).

**Rule:** when delegating a flaky-test reproduction, state an explicit ceiling in the brief
("at most 2 concurrent Jest processes, one test by name, `--maxWorkers=1`, never `--coverage`,
never the whole file in parallel") and say that the machine is a laptop the owner is using.
Pull the CI failure logs first (`gh run view <id> --log-failed`); they usually establish the
cause without any local load at all, as they did for the `awardee-tab` flake.

**Why:** on 2026-10-02 (Session 566) a brief that said "also try under CPU pressure (run 3–4
copies concurrently)" was escalated by the agent to ~38 concurrent Jest processes including
full-file coverage runs. The owner's machine hit a load average of ~160 and overheated; the
owner asked "What are you running? My machine is overheating?" The agent had to be killed
mid-run. Meanwhile the separate CI-log agent had already found the real cause (a disabled Send
button, not a timeout), so the local load test bought nothing.

**How to apply:** write the ceiling into the brief, not as a suggestion; prefer a single
sequential loop over parallelism; if parallelism is genuinely needed, run it yourself with a
fixed `for` loop so the count is visible. Related: [[feedback-orchestrator-checks-builds-before-review]],
[[feedback-mutation-test-with-the-discriminating-fixture]].
