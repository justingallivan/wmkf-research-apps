---
name: stop
description: End session by updating SESSION_PROMPT.md and relevant project documentation
allowed-tools: Read, Edit, Write, Bash(git log:*, git status, git diff:*, git add:*, git commit:*, git push:*)
---

# Session End

Wrap up the current session by updating documentation and syncing to remote.

## Step 1: Review the Session

Check git log and status to see what was accomplished:
```bash
git log --oneline -10  # Find commits made this session
git status             # Check for uncommitted changes
git diff --stat        # If there are staged/unstaged changes
```

## Step 2: Commit Any Remaining Changes

If there are uncommitted changes:
1. Review what's changed with `git diff`
2. Stage relevant files with `git add <files>`
3. Commit with a descriptive message
4. Do NOT leave uncommitted changes - they may cause issues on another machine

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

## Step 4: Commit Documentation Updates

After updating documentation files:
```bash
git add SESSION_PROMPT.md CLAUDE.md DEVELOPMENT_LOG.md .claude-memory/
git commit -m "Document Session N and create Session N+1 prompt"
```

Including `.claude-memory/` ensures any memory writes from this session are committed and available on the other Mac after push.

## Step 5: Push to Remote (Critical for Multi-Mac Workflow)

Always push before ending the session:
```bash
git push origin main
```

Verify the push succeeded. If it fails:
- Check for network issues
- Check if remote has changes (may need to pull first)
- Alert the user - do NOT end session with unpushed commits

## Step 6: Show Summary

Display:
- List of commits made this session
- Documentation files that were updated
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
