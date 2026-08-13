---
name: feedback-briefs-are-snapshots-not-ship-state
description: "A dated brief in outputs/ states what was true on its date, not what is true now. Before repeating one of its open risks or unverified claims, check DEVELOPMENT_LOG.md and git log for a later session that overtook it."
metadata:
  type: feedback
  status: active
  scope: global
  last_verified: 2026-08-12 (S422) — the same brief misled twice in one session
---

## Recall Rule

Read this before restating any "not verified", "still open", "unpushed", or "NOT
merged" claim that came from a document rather than from source or a probe.
Especially when the claim is about to be reported to the user as a risk, a
blocker, or the reason something cannot ship.

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

## How to apply

- Before repeating a document's open risk: read `DEVELOPMENT_LOG.md`, then
  `git log --oneline -- <the cited paths>`.
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
