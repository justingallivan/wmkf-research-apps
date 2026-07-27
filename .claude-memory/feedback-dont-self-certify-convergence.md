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

**Why:** My judgment that an iterative correctness/security loop has "converged" is unreliable — I both introduce and miss real issues. Treating my own "it's fine now" as a stopping signal risks shipping bugs, and it also quietly pressures the user toward under-reviewing.

**How to apply:**
- On security/correctness surfaces worked in a review→fix loop, treat "no more issues" as something a CLEAN review returns (zero findings), not something I declare. Merge only after that.
- Re-review after EVERY fix, including fixes I make myself (self-review-before-delegating still applies, but does not replace the independent pass — see [[feedback-self-review-before-delegating-review]]).
- Present the review result and let the user decide; do NOT lead with "diminishing returns / probably done / we could skip" framing to steer toward stopping. Report cost neutrally if asked. Relates to [[feedback-drive-to-completion]] and [[feedback-falsify-not-confirm]].
