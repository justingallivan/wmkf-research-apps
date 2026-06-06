---
name: agent-coordination
description: Coordinate Claude, Codex, and Justin working in the same WMKF_Apps repo. Use when starting or ending a multi-agent session, assigning ownership, preparing handoffs, reviewing another agent's work, or checking whether agents might step on each other's changes.
allowed-tools: Read, Bash(git status:*, git log:*, git diff:*, git branch:*, git remote:*)
---

# Agent Coordination

Use this skill to keep multi-agent work in the repo explicit and safe. It supplements `/start` and `/stop`; it does not replace them.

## Source Of Truth

Read `docs/AGENT_COLLABORATION_PLAN.md` when you need the full contract. Keep this skill concise and procedural.

## Start-Of-Work Checklist

1. Run or request the normal `/start` flow if this is a new session or new computer.
2. Check:
   ```bash
   git status --short --branch
   git log --oneline -5
   ```
3. Identify:
   - active owner: Justin, Claude, or Codex
   - workstream / branch
   - file surface
   - whether another agent has active WIP
4. Apply the traffic-light rule:
   - Green: different branch or clearly different files.
   - Yellow: same feature, different layers; prefer implementer/reviewer split.
   - Red: same file, migrations, env/prod/deploys, auth/security, data deletion, or live writes; stop and coordinate.

## During Work

- One owner edits a surface at a time.
- Review defaults to read-only unless Justin explicitly asks for fixes.
- Unknown dirty changes belong to Justin or the other agent; do not revert them.
- Run relevant gates for touched surfaces before calling work complete.

## Handoff Checklist

When wrapping up or transferring to another agent, report:

```markdown
Owner:
Branch:
Status:
Changed surfaces:
Commits:
Verification:
Dirty worktree:
Next owner/action:
```

If the session is ending or Justin is changing computers, request or run `/stop` after the work is committed and documented.
