---
name: feedback-read-the-implementation-not-the-callers-docblock
description: "A caller's docblock summarizing what a helper writes is a summary, not the contract — read the helper before building a claim on it"
status: active
metadata:
  node_type: memory
  type: feedback
  originSessionId: 903cc0fc-2784-4941-830c-948d06873017
  last_verified: 2026-08-13 via lib/dataverse/adapters/reviewer-suggestion.js:1951-1959
---

## Recall Rule

Before asserting what a write does — especially in a plan, review finding, or
`[VERIFIED]` claim — open the function that performs it. A comment at the CALL
SITE describing the write is a summary written for a different purpose and may
be incomplete in exactly the way that breaks your claim.

**What happened (S424).** `lib/services/reviewer-finder/my-candidates-service.js:867-880`
documents candidate removal as an "atomic PATCH (wmkf_selected=false +
wmkf_externaltokenrevoked=true)". That is true but partial. `softDelete`
(`lib/dataverse/adapters/reviewer-suggestion.js:1951-1959`) writes SIX fields:
`wmkf_selected:false`, `wmkf_accepted:false`, `wmkf_declined:false`,
`wmkf_responsetype:null`, `wmkf_reviewstatus:null`, `wmkf_heldat:null`, plus the
revoke.

I built a `[high]`-severity plan claim on the two-field summary: that a removed
reviewer still satisfies the shipped review-due nudge because `accepted` and
`reviewstatus` are untouched. Wrong in both directions — that sender requires
`accepted === true` plus materials-sent, so it is NOT vulnerable; while the
respond sweep is MORE exposed than described, because the removal shape
(`accepted=false, declined=false, responsetype=null`) is precisely what its
filter selects. Codex adversarial review caught it.

**Why the docblock was not lying:** it described the two fields relevant to ITS
caller's concern (unselect + revoke link). Summaries are scoped to their author's
question, not yours.

**How to apply:**

- A field-level claim needs the writing function's own source, cited at
  `file:line`. Citing the caller's comment is citing hearsay.
- This is sharpest for multi-field writes, soft deletes, and state machines,
  where "what else does this set?" is the whole question.
- The tell: you are about to write "X leaves Y untouched." You cannot know that
  from a comment that only mentions X.

Related: [[feedback-cite-ground-truth]], [[feedback-author-adversarial-pass-first]],
[[feedback-self-review-before-delegating-review]].
