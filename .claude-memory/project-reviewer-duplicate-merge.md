---
name: project-reviewer-duplicate-merge
description: "Reviewer duplicate merge — the email alt-key dead-end, v1 scope, and the THREE distinct duplicate problems (don't conflate them)"
metadata: 
  node_type: memory
  type: project
  status: active
  originSessionId: ed5870c4-4bd6-482a-bda7-d3e82dd98db5
---

Read this before touching reviewer "duplicate" / "merge" / email-conflict work, or
when staff hit a 412 on `wmkf_emailaddress_unique` editing a candidate's email.

**Three DISTINCT duplicate problems — keep them separate:**
1. `wmkf_potentialreviewers` ↔ `wmkf_potentialreviewers` (duplicate reviewer person
   rows — the misspelled-email bug). v1 BACKEND BUILT S289. `docs/REVIEWER_MERGE_DESIGN.md`.
2. `wmkf_potentialreviewers` ↔ `contacts` (link a reviewer to its CRM payment
   identity, keep consistent). DESIGNED, not built. `docs/REVIEWER_CONTACT_LINKER_DESIGN.md`.
3. `contacts` ↔ `contacts` (duplicate CRM contacts). CONNOR owns it (native Dynamics
   merge). `docs/CONNOR_CONTACT_MERGE_AND_REVIEWER_LINKING.md`.

**v1 merge (problem #1):** `lib/services/reviewer-merge.js` (`planMerge`/`executeMerge`),
route `pages/api/reviewer-finder/merge-candidates.js` (POST-only: plan vs `confirm:true`).
Scoped to a **PRE-ENGAGEMENT, non-contact-promoted loser** — a **fail-closed block
predicate** (positive whitelist: an unknown lifecycle field defaults to *blocking*),
re-evaluated at execute time from live source, is the load-bearing safety rule, NOT a
permission gate. That's why auth is the same as my-candidates: the predicate, not the
role, restricts merge to the low-risk case so the colleague who hit the bug can fix it.

**Hazards that already bit (Codex post-impl S289):** picking a field from the loser
must `isSet()`-guard so an empty loser value can't null the keeper (and `emailMoves`
likewise); `executeMerge` must refuse an already-inactive loser (`statecode`) or a
double-submit corrupts the keeper; the block predicate must include `wmkf_completedat`,
COI/AI acks, selective-decline, revoked token, and stage-2a reviewer-supplied fields;
a `confirmed` (human-attested) loser identity over a non-confirmed keeper BLOCKS rather
than transplanting. NOT built yet: Chunk 4 UI (`CandidateEditModal` merge mode) and
Chunk 5 live alt-key ordering probe.

Probe `scripts/probe-rabinowitz-conflict.js` is UNTRACKED (hardcodes a real email) —
keep it local. See [[feedback-self-review-before-delegating-review]],
[[feedback-symbol-consumer-fanout]], [[project-workbench-consolidation-rollout]].
