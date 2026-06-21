---
name: feedback-codex-build-gate-turbopack-sandbox
description: When delegating build verification to Codex in WMKF_Apps, include the Turbopack-sandbox build-gate instruction — a Next 16/Turbopack panic with "Operation not permitted" (process/port bind) is an execution-environment failure, NOT an app build failure; escalate outside the sandbox, never delete .next/kill broad processes on a stale lock.
metadata:
  type: feedback
  status: active
  scope: global
  last_verified: S272 (2026-06-20) — Codex's npm run build hung/failed on exactly this Turbopack sandbox panic while fixing AwardeeTab
---

## Recall Rule

Read before delegating any task to Codex (codex:codex-rescue / `codex exec`) whose
acceptance includes `npm run build`, or when composing the Codex invocation. Paste the
build-gate block below into the delegation prompt.

**Why:** WMKF_Apps uses **Next 16 / Turbopack**. Codex's sandbox cannot bind a local
worker port, so `npm run build` panics with `Operation not permitted` while creating a
process or binding a port. This is an environment failure, not a real build break — but
left unguided, Codex (a) treats it as an app failure, (b) hangs polling the wedged
build, and worst (c) reaches for destructive cleanup (delete `.next`, kill broad
process patterns) on a stale "Another next build process is already running" lock.
Observed S272: Codex's build hung for minutes and it never emitted its final report; I
had to run the build myself to verify. Verified clean via Webpack/outside the sandbox.

## Build-gate instruction to include (paste into the Codex delegation)

> For verification, run scoped tests/lint in the Codex sandbox first. For `npm run
> build`, be aware this repo uses Next 16/Turbopack and Codex sandboxing can fail with
> a Turbopack panic containing `Operation not permitted` while creating a process or
> binding a local worker port. Treat that as an execution-environment failure, not an
> app build failure.
>
> If `npm run build` fails with that sandbox/port-binding signature, immediately retry
> the same command through your escalation/approval mechanism so it runs outside the
> sandbox. If escalation is unavailable, you may run `npx next build --webpack`, but
> report it as a fallback build signal, not the canonical Turbopack build.
>
> If Next reports "Another next build process is already running" after an interrupted
> attempt, check for a live `next build` / `npm run build` process FIRST. Do not delete
> `.next`, kill broad process patterns, or clean build artifacts unless the live-process
> check proves the warning is stale AND the operator approves cleanup.

## How to apply

- **If I control the Codex invocation**, prefer:
  `codex exec --ask-for-approval on-request --sandbox workspace-write ...`
  (lets Codex escalate the build out of the sandbox on request).
- **Either way**, paste the build-gate block above into the task prompt.
- **As the reviewer:** if Codex reports a build failure, check the signature before
  trusting it — a Turbopack `Operation not permitted` / port-bind panic is the sandbox,
  not the app. Run `npm run build` myself (I am not under the same sandbox) to get the
  canonical signal, as I did in S272.

Related: [[project-codex-design-pre-impl-iteration]], [[project-codex-recurring-review]],
[[feedback-commit-before-delegating-to-worktree-agent]], [[feedback-share-codex-verbatim]].
Dev-environment build details: ../docs/agent-wiki/topics/dev-environment.md.
