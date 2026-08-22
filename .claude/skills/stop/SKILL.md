---
name: stop
description: End session by updating SESSION_PROMPT.md and relevant project documentation
allowed-tools: Read, Edit, Write, Bash(git log:*, git status, git diff:*, git add:*, git commit:*, git push:*, git rev-parse:*), Bash(rtk npm run report\:claim-evidence-pilot*)
---

# Session End

Wrap up the current session by updating documentation and syncing to remote.

## Step 1: Verify the Branch, Then Review the Session

Run `git rev-parse --abbrev-ref HEAD` FIRST. The shared checkout's HEAD drifts when
a concurrent Codex/subagent session does branch work (S355: a docs commit landed on
a feature branch and needed a cherry-pick rescue; see
`feedback-verify-branch-before-git-action`).

- On `main` → normal flow.
- On any other branch → STOP and ask the user where the session docs
  (SESSION_PROMPT.md etc.) should land — usually `main`, but a deliberate Tier 1–3
  feature branch session may want them on the branch. Never assume.

Then check `git log --oneline -10` and `git status` to see what this session produced.

If the `report:claim-evidence-pilot` package script exists, run
`rtk npm run report:claim-evidence-pilot -- --current`. SessionStart exports a
hashed current-session key, so this report cannot select another concurrent
session. The report reads local,
metadata-only advisory observations; it does not read the Claude transcript. If
the current eligible session key is not already represented in the canonical
pilot directive's observation table, classify the advisories you actually
received and add one bounded row during Step 3, including a zero-advisory row.
If the report says no eligible plan/design documentation edit was recorded, do
not add a row. Never copy claim text, command output, transcript content,
environment values, secrets, or live-record data into the observation table.

## Step 2: Commit Any Remaining Changes

Review and commit any uncommitted changes with a descriptive message. Do NOT leave
uncommitted changes — they may cause issues on another machine.

**Stop-time router advisory:** if the Stop hook emits a memory-router crossing
or growth advisory, edits in this session moved `.claude-memory/MEMORY.md`
to/past (or grew it above) the routine-audit trigger — the advisory says which,
and claims participation, not sole causation. Either run the router diet now
(`docs/MEMORY_HYGIENE_RUNBOOK.md` §10) or record the debt explicitly in
`SESSION_PROMPT.md`.

## Step 3: Update Documentation

1. **Read current files** - Review SESSION_PROMPT.md and CLAUDE.md to understand existing structure

2. **Update SESSION_PROMPT.md** - Rewrite with:
   - New session number (increment from current)
   - Summary of what was completed this session (with commit hashes if applicable)
   - Key files that were added or modified
   - Status-labeled next items for the next session
   - Any relevant context or gotchas for continuity

   **Verify every "next step" against ground truth before writing it as actionable.**
   Each next-step is a carryover *claim*, not a confirmed worklist — the same skepticism
   `/start` Step 5 applies to destructive carryover (drop/remove/retire) extends to
   additive "do X" items. Before listing an item as open, check it against memory
   (`.claude-memory/`), source/Atlas, or a probe: if it's already shipped, owner-blocked,
   or parked, mark it **DONE / blocked / parked** with the evidence — do NOT carry a stale
   todo forward as if it's live. (S282: "#4 migrate reviewer invitations to reviews.wmkeck.org"
   rode forward as an open task for a session though `project-branded-domains.md` already
   recorded it live — a phantom todo that cost a verification round-trip.) Carrying a
   verified-stale next-step forward is the additive twin of the destructive-carryover trap.

3. **Update CLAUDE.md** if needed - Only update if:
   - New apps or features were added
   - API endpoints changed
   - Database schema changed
   - New scripts were added
   - Configuration or conventions changed

4. **Update DEVELOPMENT_LOG.md** ONLY at a milestone — not every session. The dev log is a milestone log, not a session log. Add an entry only if this session shipped something a future Justin would search for: a production cutover, a new architecture, a strategic pivot, an incident, a deprecated capability removed. Most sessions are prep/exploration/refactor and DO NOT get an entry — those live in commit messages and SESSION_PROMPT.md.

   When you do add an entry, follow the format already at the top of DEVELOPMENT_LOG.md:
   - Header: `## <Month Year> — <Headline> (Session N)`
   - Body sections: **Milestone:**, **Sessions:**, **Ship state:** (3-5 bullets), **Why it matters:**, **Pointers:** (docs + commit hashes)
   - Target ~8-12 lines total. Tight.
   - New entries go at the TOP (chronologically newest first), above the "Legacy chronological session log" divider.

   If unsure whether something is milestone-worthy, default to NOT writing an entry. Skipping is the right answer most weeks.

   **Handoff requirement:** Before completing the handoff, make an explicit
   milestone determination. If the session shipped a new production capability,
   production cutover, new architecture, strategic pivot, incident outcome, or
   removal of a deprecated capability, the handoff is incomplete until the
   corresponding DEVELOPMENT_LOG.md entry exists. Otherwise report that no
   milestone entry was required. This is based on what shipped, not on session
   cadence.

## Step 4: Commit Documentation Updates

After updating documentation files — re-verify the branch immediately before the
commit (`git rev-parse --abbrev-ref HEAD`); the Step 1 check is point-in-time and
HEAD can drift mid-session. If it is not the branch confirmed in Step 1, stop and
resolve before committing:
```bash
git rev-parse --abbrev-ref HEAD   # must print the intended branch
git add SESSION_PROMPT.md CLAUDE.md DEVELOPMENT_LOG.md .claude-memory/
git commit -m "Document Session N and create Session N+1 prompt"
```

Including `.claude-memory/` ensures any memory writes from this session are committed and available on the other Mac after push.

## Step 5: Push to Remote (Critical for Multi-Mac Workflow)

Always push before ending the session. Push the branch you are actually on — never
hard-code `main`:
```bash
BRANCH=$(git rev-parse --abbrev-ref HEAD)
git push origin "$BRANCH"
```
If `$BRANCH` is not the branch confirmed in Step 1, stop and resolve the drift
before pushing. Never push a feature branch's commits to `main` by ref-spec.

Verify the push succeeded. If it fails:
- Check for network issues
- Check if remote has changes (may need to pull first)
- Alert the user - do NOT end session with unpushed commits

## Step 6: Show Summary

Display:
- List of commits made this session
- Documentation files that were updated
- Milestone-log determination: entry added (with headline), or no entry required
- Confirmation that changes are pushed to remote
- Reminder of next steps for the next session

## SESSION_PROMPT.md Format

```markdown
# Session [N+1] Prompt: [Brief Description]

## Session [N] Summary

[What was accomplished]

### What Was Completed

1. **Feature/Fix Name**
   - Details
   - Details

### Commits
- `hash` - Message
- `hash` - Message

## Next Items

### Verified Open

1. [Next task]
   Evidence: [file/command/memory].
   Description of what could be done next.

### Owner Decision Needed

1. [Decision]
   Evidence: [file/command/memory].
   Decision needed.

### Parked

1. [Parked item]
   Evidence: [file/command/memory].
   Re-open trigger.

### Verify Before Acting

1. [Stale carryover / destructive or additive claim]
   Evidence currently available: [file/command/memory].
   Required preflight before acting.

### Do Not Reopen Without New Decision

1. [Closed or owner-decided item]
   Evidence: [file/command/memory].

## Key Files Reference

| File | Purpose |
|------|---------|
| `path/to/file.js` | What it does |

## Testing

```bash
# How to test
```
```
