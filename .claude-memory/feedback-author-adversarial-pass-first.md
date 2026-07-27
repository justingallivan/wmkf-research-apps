---
name: feedback-author-adversarial-pass-first
description: "Before delegating any review of enforcement/parsing/policy code, run a named author-side adversarial pass — enumerate real input grammar from repo producers, attack exceptions, fan guards to siblings"
metadata: 
  node_type: memory
  status: active
  type: feedback
  originSessionId: 29a6b837-b641-4706-996e-0d56eb5d5029
  last_verified: 2026-07-27 as historical owner feedback from S355
---

## Recall Rule

Before delegating review of enforcement, parsing, policy, or guard code, run an
author-side adversarial pass over the real producer grammar, exception paths,
sibling guards, and fall-through cases; give the reviewer the resulting evidence.

Owner feedback (S355, 2026-07-11), after four Codex adversarial rounds on the
Dataverse interlock found eight fail-open-by-omission defects — several of
which the author (Claude) had already *hypothesized* in its own delegation
prompts but never checked itself (round-1 prompt named the exact bound-action
/`$ref` URL shapes that became the high finding).

**Why:** the owner should not have to rely on external review to catch flaws
the author already suspected. Spec-conformance review ("does the diff match my
ruling?") and confirmation tests share the author's simplified model of the
input space; when the model is wrong, checking harder inside it finds nothing.
The author's misses clustered where fresh input enumeration was needed; the
author's catches were all re-applications of patterns already seen once.

**How to apply — for enforcement, parsing, policy, or guard code, BEFORE
delegating any review:**
1. Enumerate the REAL input grammar from the repo's actual producers (grep the
   URL/value constructions — e.g. the S355 alt-key upsert producers — never
   imagine the input space).
2. Attack every exception path with "what can the structure NOT express?"
   (S355: BATCH grants couldn't express per-op scoping; alt-key predicates
   were secretly upsert authorizations).
3. Fan every guard to its structural siblings (the round-4 miss: denial
   identity guarded at http.js but not at requestWithBackoff two files away).
4. If you write an attack hypothesis into a delegation prompt, CHECK IT
   YOURSELF FIRST when the check is cheap — shipping your own suspicion to a
   reviewer unverified is the failure mode.
5. Attach the pass's results to the review delegation so the reviewer starts
   where the author stopped.

External adversarial review stays (defense in depth for write-boundary code) —
it becomes layer two, not layer one. Related:
[[feedback-self-review-before-delegating-review]];
[[feedback-symbol-consumer-fanout]]; [[feedback-falsify-not-confirm]].
