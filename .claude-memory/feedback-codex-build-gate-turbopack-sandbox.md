---
name: feedback-codex-build-gate-turbopack-sandbox
description: S272 observed a sandbox-specific Turbopack "Operation not permitted" build failure; match the signature and re-verify the current environment before classifying a new failure.
metadata:
  type: feedback
  status: active
  scope: global
  last_verified: S272 (2026-06-20) — Codex's npm run build hung/failed on exactly this Turbopack sandbox panic while fixing AwardeeTab
---

## Recall Rule

Read before delegating a task whose acceptance includes `npm run build`.

[VERIFIED historically via the S272 build output.] In that run, the canonical
build failed inside the then-current sandbox with a Turbopack panic containing
`Operation not permitted` while creating a process or binding a worker port. A
Webpack build outside that sandbox passed. This establishes one recognizable
historical environment signature; it does not establish that every current Codex
sandbox has the same limitation.

## Build-gate instruction to include (paste into the Codex delegation)

> Run the canonical build first. If it fails with the S272 signature — a Turbopack
> panic containing `Operation not permitted` while creating a process or binding a
> worker port — classify the first result as environment-suspect, not automatically
> as an application defect.
>
> Re-run the same command through the current approved mechanism outside the failing
> environment. If that is unavailable, a Webpack build is only a fallback signal,
> not proof that the canonical build passes.
>
> If Next reports "Another next build process is already running" after an interrupted
> attempt, check for a live `next build` / `npm run build` process FIRST. Do not delete
> `.next`, kill broad process patterns, or clean build artifacts unless the live-process
> check proves the warning is stale AND the operator approves cleanup.

## How to apply

- Use the current tool's documented escalation/approval mechanism; the exact S272
  invocation syntax is not retained as current guidance.
- Match the full failure signature before applying this fallback. A different
  Turbopack failure remains an application/build finding until investigated.
- Verify process state before any stale-lock cleanup and obtain approval before
  deleting build artifacts or terminating processes.

Related: [[project-codex-design-pre-impl-iteration]], [[project-codex-recurring-review]],
[[feedback-commit-before-delegating-to-worktree-agent]], [[feedback-share-codex-verbatim]].
Dev-environment build details: ../docs/agent-wiki/topics/dev-environment.md.
