---
name: feedback-dont-self-certify-convergence
description: "In a review→fix loop, \"done\" is proven by a clean review, not asserted by me — re-review every fix (incl. my own) before merge; don't editorialize \"diminishing returns\" to steer toward stopping"
metadata: 
  node_type: memory
  type: feedback
  status: active
  originSessionId: 0a631ca0-29ca-4f6c-913a-f551fb1ced7d
---

## Recall Rule

In a correctness or security review loop, re-review every fix and treat only a
clean independent review as evidence of convergence. Report review cost neutrally;
do not declare diminishing returns as a substitute for evidence.

On the reviewer-finder save-COI work (S339), across five adversarial Codex rounds I repeatedly framed real findings as "getting narrower / diminishing returns" and, after the TOCTOU fix, **recommended merging without another review**. The user ran the review anyway and Codex found a HIGH-severity COI bypass (email-less confident ORCID/name match) — a regression **I had introduced** in my own exact-reuse refactor the pass before. My self-assessment of "converged / good enough to skip review" was wrong twice: the finding wasn't narrow, and skipping would have shipped a bypass to prod.

**RECURRED S418 (2026-08-12), reviewer activity history Phase 1.** Same shape, five
rounds again: after round 4 I told the user "the write-path defect class appears
closed," citing that the round had found no new mislabeled writer. Round 5 returned a
HIGH. Two sessions now with the identical error, so treat any convergence claim I make
as unsupported by default.

The new wrinkle worth carrying: **a guard's scope is itself a claim that needs
verifying.** I had machine-enforced the engagement-scope invariant with a test that
re-derives the reset set from adapter source — and leaned on it as proof. But it
scanned `EVENT_DESCRIPTORS[].rawField` only, so the *evidence inputs* used to classify
those events (`reviewFilename`, `reviewUploadedByStaff`, `answers` — none of them
reset-scoped) were never covered. The guard I trusted most produced false assurance
exactly where I trusted it. When citing an automated check as evidence, state what it
does NOT cover before treating it as closure.

**Why:** My judgment that an iterative correctness/security loop has "converged" is unreliable — I both introduce and miss real issues. Treating my own "it's fine now" as a stopping signal risks shipping bugs, and it also quietly pressures the user toward under-reviewing.

**How to apply:**
- On security/correctness surfaces worked in a review→fix loop, treat "no more issues" as something a CLEAN review returns (zero findings), not something I declare. Merge only after that.
- Re-review after EVERY fix, including fixes I make myself (self-review-before-delegating still applies, but does not replace the independent pass — see [[feedback-self-review-before-delegating-review]]).
- Present the review result and let the user decide; do NOT lead with "diminishing returns / probably done / we could skip" framing to steer toward stopping. Report cost neutrally if asked. Relates to [[feedback-drive-to-completion]] and [[feedback-falsify-not-confirm]].
