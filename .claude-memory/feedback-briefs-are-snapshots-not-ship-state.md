---
name: feedback-briefs-are-snapshots-not-ship-state
description: "A document's status claim — a dated brief's open risk, or a plan's 'implementation has not started' — states what was true when written, not what is true now. Before repeating one, check DEVELOPMENT_LOG.md and git log; when the claim is about another agent's work, enumerate branches rather than worktrees."
metadata:
  type: feedback
  status: active
  scope: global
  last_verified: 2026-08-13 (S425) — second instance, a plan's Status line and an unenumerated branch
---

## Recall Rule

Read this before restating any "not verified", "still open", "unpushed", "NOT
merged", or "not started" claim that came from a document rather than from source
or a probe. Especially when the claim is about to be reported to the user as a
risk, a blocker, or the reason something cannot ship — or as an assurance that two
agents' work does not overlap.

## The rule

A brief in `outputs/` is a **snapshot with a date in its filename**. It is accurate
as of that date and carries no mechanism for noticing it was overtaken. `/start`
gates catch drift between docs and *code*; nothing catches a brief that was simply
passed by events.

`DEVELOPMENT_LOG.md` is the ship-state record. `git log` on the cited paths is the
other. Check one of them before repeating a brief's open item.

## What happened (S422, 2026-08-12)

`outputs/reviewer-activity-history-phase1-status-brief-2026-08-12.md` said "Not
verified: the rendered layout" and listed two open review findings. Both were true
when written in S418. By S422 the feature was production-live: S419 shipped it via
PR #120 with an authenticated Production smoke on Request `1002959`, recorded plainly
at `DEVELOPMENT_LOG.md:32-46`, and commit `19bd000a` had closed both findings.

The claim was repeated twice — once escalated to "the largest remaining risk on this
feature" — and corrected only when the owner said they had smoke-tested it. A single
read of the dev log would have prevented both. The bare four-word entry "Reviewer
drawer visual coverage" in `SESSION_PROMPT.md` carried no definition, so the stale
brief was the only thing left to interpret it against.

**Why:** repeating a stale risk is not a harmless conservatism. It reprioritizes the
session around work that is already done, and it tells the owner their shipped work
is unverified.

## Second instance — a plan's status line, and a branch never enumerated (2026-08-13, S425)

Same root cause, opposite direction: in S422 a stale doc claimed shipped work was
open; here `docs/GRANTEE_ABSTRACT_RICH_TEXT_EDITOR_PLAN.md` said "Implementation has
not started" and it had — on `codex/grantee-abstract-rich-text`, three commits deep,
in the same two files the session had just edited.

The multi-agent overlap assessment was reported to the owner as "zero file overlap,
clean merge, no brief needed" — backed by a real `git merge-tree` run, but against
**one** Codex branch, the one that happened to appear in `git worktree list`. The
implementing branch had no worktree, so it was never enumerated. The owner supplied
it. True state: six shared files and two conflicts.

**Why:** a merge result is only as good as the branch set it was computed over.
Verifying hard against the wrong denominator reads as *more* trustworthy than not
checking, because the evidence is genuine — it just answers a question nobody asked.
This is the [[feedback-vacuous-clean-results-print-the-denominator]] failure applied
to branches.

## How to apply

- Before repeating a document's open risk: read `DEVELOPMENT_LOG.md`, then
  `git log --oneline -- <the cited paths>`.
- Before any claim about what another agent has or has not built: enumerate branches
  (`git branch --list 'codex/*'`), not worktrees. `git worktree list` shows only
  branches someone happens to have checked out, which is a subset. A plan doc's
  Status line is never the answer.
- When a carryover item is a bare phrase with no definition, treat that as a signal
  to go find ground truth, not a licence to fill it in from the nearest document.
- When you find a brief was overtaken, add a supersession header (§0) to it in the
  same pass — do not rewrite its body, which is legitimate history.
- The corollary for durable docs: a section header claiming a branch or ship state
  (`built S388, branch …, NOT merged`) rots silently. Prefer citing the commit.

Related: [[feedback-cite-ground-truth]] (citation discipline for external and
toolchain facts — a different failure shape) and
[[feedback-verify-additive-carryover-not-just-destructive]], of which this is the
documentation twin: there the stale carryover was a task, here it is a risk.
