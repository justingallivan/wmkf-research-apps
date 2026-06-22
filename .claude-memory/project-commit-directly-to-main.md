---
name: project-commit-directly-to-main
description: "This repo commits straight to main — no branch-first / PR flow; the harness \"branch off the default branch\" default does NOT apply here"
type: project
status: active
scope: git-workflow
last_verified: S278 (2026-06-22)
metadata: 
  node_type: memory
  type: project
  originSessionId: 6abd9b3c-dcfa-4228-b8f3-e277128aaeae
---

This repo's git convention is **commit directly to `main` and push**. There is no
branch-first or PR-based flow: every recent commit lands on `main`, and `/stop`
pushes `main`.

**Why:** The harness has a generic built-in instruction — "Commit or push only when
the user asks. If on the default branch, branch first." — that does NOT match this
project. Echoing it ("let me create a branch first per the workflow") is a
misstatement; on 2026-06-22 (S278) I narrated that line, then correctly committed to
`main` anyway, and the contradiction confused the user.

**How to apply:** When the user asks to commit/push, commit to `main` and push to
`origin/main` directly. Do not create a branch and do not call this "the workflow"
as if branching were the norm. Only branch if the user explicitly asks for a
branch/PR flow. Still: commit/push only when the user asks.
