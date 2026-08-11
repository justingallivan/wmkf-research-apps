---
name: feedback-weigh-the-risks-you-name
description: "Writing a 'known weaknesses' section does not discharge the risk — if the list would change the recommendation, change the recommendation. And settle whether the approach is sound before asking the owner polish questions about it."
metadata:
  type: feedback
  status: active
---

## Recall Rule

Read this before presenting a plan, a scope doc, or an "open questions" list —
especially one containing a self-authored risks/weaknesses section.

## The rule

1. **A named risk is not a discharged risk.** If your own weaknesses list
   contains an item that should change the recommendation, change the
   recommendation before shipping the document. Listing it and then recommending
   the build anyway converts honesty into decoration.
2. **Ask the upstream question first.** Before asking the owner to arbitrate
   placement/timing/copy, settle whether the approach is sound at all. Polish
   questions presented as *the* open questions imply the approach is already
   decided.
3. **Never offer an unread guard as evidence of safety.** If you cite an auth
   check, a validation, or a gate as the reason something is safe, read it first.
   Citing it unread can turn a gap into a reassurance.

## Why

S414. A scope doc proposed launching a destructive reviewer merge from a stored
alert. Its own §5 listed "the destructive `executeMerge` behind a newly-easier
button" and "no live instances to build or smoke against" — then recommended
building, and asked the owner three questions about button placement, blocked-state
display, and when to resolve the alert. An adversarial Codex review returned
no-ship on four high findings, all verified correct. The decisive one was
reachable from evidence already gathered *in the same session*: a probe had shown
these alerts go stale, and the existing entry point's live re-derivation was the
actual safety mechanism the plan proposed to bypass. Separately the doc cited the
merge route's `requireAppAccess` as evidence of safe authorization; reading it
showed no request-membership check at all
([[project-merge-candidates-authorization-gap]]).

## How to apply

- After writing a weaknesses section, re-read it as if someone else wrote it and
  ask "does this change my recommendation?" — then act on the answer.
- Put the soundness question in the owner's question list, not just the details.
- Prefer "build nothing" as an explicitly offered option when instances are zero,
  test data is absent, and the surface is destructive.

Related: [[feedback-author-adversarial-pass-first]],
[[feedback-dont-self-certify-convergence]], [[feedback-cite-ground-truth]],
[[feedback-vacuous-clean-results-print-the-denominator]].
