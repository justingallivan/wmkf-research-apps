---
title: Multi-Agent Collaboration Plan
domain: agent-harness
kind: plan
status: active
summary: "Active operating contract for coordinating Justin, Claude, and Codex across branches, worktrees, reviews, and handoffs."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
related:
  - docs/API_ROUTE_SECURITY_MATRIX.md
---

# Multi-Agent Collaboration Plan

**Status:** Active operating contract; the shared `agent-coordination` skill is implemented.  
**Purpose:** Keep Justin, Claude, and Codex from stepping on each other's work while using the same repo across multiple computers.

## Part 1 - Justin Checklist

> Commentary for Justin: the goal is not to make you run a ceremony every time. The goal is to make the first and last minute of a work session boring and repeatable, especially when you move between computers.

### When You Begin A Session

1. **Pick the lead for the next slice.**
   Say who owns the work and what surface they own.

   Examples:
   - "Codex owns the Reviewer Finder web-suggestions endpoint."
   - "Claude owns read-only review of Codex's diff."
   - "Claude owns session docs only."

2. **Run the existing start flow on the machine you are using.**
   Ask the active agent to use `/start`. This checks git sync, symlinks, session context, and red gates before work starts.

3. **Tell the active agent about any other agent still working.**
   If Claude is mid-task, tell Codex. If Codex is mid-task, tell Claude. Include the branch and file surface if you know them.

4. **Use the traffic-light rule before edits.**
   - **Green:** different branch or clearly different files. Continue.
   - **Yellow:** same feature, different layers. One agent implements, the other reviews.
   - **Red:** same file, migrations, env/prod/deploys, auth/security, data deletion, or live writes. Stop and coordinate first.

5. **Prefer branch-per-workstream.**
   `main` auto-deploys. For feature work, ask for a branch such as `codex/reviewer-web-suggestions`. Only push `main` when you explicitly intend a production deploy.

### While Work Is Happening

1. **One owner edits a surface at a time.**
   The other agent can review, inspect, or advise, but should not patch the same files unless you reassign ownership.

2. **Use read-only review language when you want a review.**
   Say "review only, do not edit files." This is especially important when one agent is reviewing the other.

3. **Let gates arbitrate completion.**
   Relevant red gates block calling the work done. Run the gates for the files touched, not the whole world by default.

4. **Check in before support work expands.**
   If cleanup, docs reconciliation, live probes, or gate repair starts taking over, the active agent should check in before spending more than about 30 minutes or two commits away from the main objective.

### When You End A Session

1. **Ask the active agent to use `/stop`.**
   This commits completed work, updates `SESSION_PROMPT.md`, and pushes so the next computer can start cleanly.

2. **Make the handoff explicit.**
   The final message should say:
   - branch
   - commits
   - files/surfaces changed
   - tests/gates run
   - remaining dirty files, if any
   - who should own the next action

3. **Do not leave unknown dirty changes before switching computers.**
   If a dirty file is intentional WIP, name it in the handoff. If it is unrelated or mysterious, stop and decide before continuing elsewhere.

4. **Start the next computer with `/start`.**
   Treat `/stop` then `/start` as the bridge between computers. Do not rely on memory of what happened on another machine.

## Part 2 - Agent Contract

### Roles

- **Justin** is the product owner and final authority on priorities, production risk, and who owns a workstream.
- **Codex** may own implementation slices, test/gate repair, contract verification, and post-implementation review.
- **Claude** may own implementation slices, session docs, memory/docs reconciliation, and independent review.
- Either agent may review the other, but review defaults to read-only unless Justin explicitly asks for fixes.

### Ownership Rules

1. Before editing, identify the active owner and surface.
2. Do not edit a file that appears to be actively owned by the other agent unless Justin reassigns ownership.
3. Treat unknown dirty changes as user/other-agent work. Read and work around them; do not revert them.
4. If two agents need the same file, switch to a review/handoff pattern:
   - owner finishes and commits or clearly marks WIP
   - reviewer reviews read-only
   - owner applies fixes, or Justin explicitly transfers ownership

### Git Rules

1. Start work by checking:
   ```bash
   git status --short --branch
   git log --oneline -5
   ```
2. Prefer branch-per-workstream for non-trivial work.
3. Commit small working changes with descriptive messages.
4. Do not run destructive git commands unless Justin explicitly requests them.
5. Push before ending a session that will be resumed from another computer.
6. If local and remote diverge, stop and report before merging/rebasing unless the expected resolution is obvious and low-risk.

### File-Surface Rules

- **Durable docs:** `docs/**`, `SESSION_PROMPT.md`, `CLAUDE.md`, `.claude-memory/**`. One owner per fact-level change; run relevant drift/sweep gates before claiming done.
- **API routes:** update `docs/API_ROUTE_SECURITY_MATRIX.md` with new routes and run `npm run check:api-routes`.
- **Data/schema:** read Atlas first, use migrations for existing DBs, and run Atlas/migration gates.
- **Prompt/LLM surfaces:** preserve A7 wrapping and run `npm run check:prompt-injection-tagging`.
- **Instruction/symlink work:** preserve `AGENTS.md -> CLAUDE.md` and `.agents/skills -> .claude/skills`; run `npm run check:agent-invariants`.

### Live-System Rules

1. Only one agent runs live writes, migrations, deploys, or destructive probes at a time.
2. Production env values stay in Vercel; agents check presence, not values.
3. Live Dataverse/Postgres/Blob/BILL/Graph writes require explicit task context and, for high-risk work, explicit approval.
4. Failed live probes must be reported with exact command, target, and whether they changed state.

### Handoff Format

Agents should end substantial work with this shape:

```markdown
Owner: Codex or Claude
Branch: <branch>
Status: complete | WIP | blocked
Changed surfaces: <files/modules/docs>
Commits: <hash - message>
Verification: <tests/gates run, or not run + why>
Dirty worktree: clean | listed files and ownership
Next owner/action: <who should do what next>
```

### Implemented Skill Support

The lightweight `agent-coordination` skill is shared through `.claude/skills` and `.agents/skills`, so either agent can be asked:

- "use agent-coordination before starting"
- "prepare a multi-agent handoff"
- "who should own this next?"
- "check whether Claude and Codex are stepping on each other"

The skill should not replace `/start` or `/stop`; it should wrap the collaboration contract around them.
