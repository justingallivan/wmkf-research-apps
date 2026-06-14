---
name: feedback-truncation-is-breakage-not-completion
description: "Truncated/short/cut-off tool output is a BREAKAGE signal, not a stop signal — recover (re-run, narrow, paginate) before concluding. A 'not built / doesn't exist' claim needs a COMPLETE search of every plausible location, not the one dir that happened to return. Read documents to the end."
metadata:
  node_type: memory
  type: feedback
  status: active
  scope: global
  last_verified: 2026-06-13 (S253, live instance)
---

## Recall Rule

Read this when: a Bash/grep/Read result looks cut off, shorter than expected, or a
command exits oddly mid-run; OR I'm about to conclude "X isn't built / doesn't exist /
there's no caller"; OR I'm reading a document/file and tempted to infer the rest from
the first chunk.

Do:
- Treat truncation/partial output as a FAILURE to recover from, not a result to use.
  Re-run the command — narrower scope, one target per call, smaller output — until I get
  the complete result.
- For any NEGATIVE claim ("not built", "no home", "no caller", "absent"), search EVERY
  plausible location before asserting: all route dirs (`pages/api/**`, not just the
  feature-named one), all of `lib/`, `scripts/`, `shared/`. A negative needs a complete
  search; a partial search proves nothing.
- Read files/documents to the END. If a Read is paginated or a section is long, fetch the
  next chunk — don't stop at the first screen and reconstruct the rest from memory.

Do not:
- Substitute a narrower fallback query's result for the answer the broken query would have
  given.
- Let "the grep truncated so I scanned just the obvious dir" stand as a conclusion.
- Stop at the top of a document and treat the banner/first paragraph as the whole.

## The corrective reminder (Justin, S253, verbatim intent)

> "You have a persistent habit of stopping before the end of a document. Truncation is not
> a sign to stop. It's a sign that something broke."

This is a RECURRING habit, not a one-off. When something cuts off, the reflex must be
"what broke, how do I get the full thing" — never "good enough, move on."

**Why:** S253 — verifying which reviewer design-doc banners were stale, my dedup probe
`grep -rl ... lib pages` truncated in the harness. Instead of recognizing the break and
re-running narrowed, I fell back to scanning only `pages/api/reviewer-finder/` and
concluded `REVIEWER_MANUAL_ADD_DEDUP_DESIGN.md` was "Not built." It was SHIPPED — the
feature lives in `pages/api/workbench/manual-reviewer.js` + `lib/services/reviewer-identity-lookup.js`.
I marked a built feature unbuilt. Codex's cross-directory trace caught the false negative.
The root error was not the grep failing — it was treating the partial scan as a complete
answer.

**How to apply:**
1. Output looks cut off / command errored mid-run → re-run it (constrain paths, one target
   per call, `| head` only when I expect length) until I have the whole thing. Never reason
   from the fragment.
2. About to say "doesn't exist / isn't built / no caller" → that's a falsifiable negative.
   Grep the COMPLETE set of plausible homes first (esp. sibling route dirs like
   `workbench/`, `external/`, `review-manager/`, not just the one named after the feature).
   See [[feedback-falsify-not-confirm]].
3. Reading a doc whose state I'm about to claim → read to the end; pair any top-banner read
   with the body. See [[thoroughness-is-default-not-optional]].
4. If I genuinely cannot get the full result this turn, SAY so ("probe truncated; scope
   incomplete") — never present a partial scan as settled.

Related: [[feedback-falsify-not-confirm]], [[thoroughness-is-default-not-optional]],
[[feedback-grep-general-codebase-terms]], [[project-rtk-grep-output-corruption]] (the
tool-output-unreliability cousin: when output looks fabricated/corrupted, also distrust and
re-verify).
