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

**S306 — Chunk-4 merge UX hardened + applicant contact-persist (from a PD report: a wrong-namesake "Jun Ye" whose corrected email collided with the applicant-suggested duplicate).** Three shipped fixes: (1) `my-candidates.js handlePatch` now writes the conflict-SAFE person/researcher fields FIRST and isolates the email write LAST, so a duplicate-email 409 no longer discards affiliation/website (returns `partialSuccess`+`savedFields`); `CandidateEditModal` shows a "saved" note + refreshes on cancel. (2) When a merge is blocked SOLELY by `loser_in_applicant_slot`, the modal points staff at **Swap** (an applicant-suggested record can be the KEPT side, just not the discarded one) instead of dead-ending. (3) `promote-applicant-reviewer` now persists the PD's hand-corrections (only client-marked `manualContactFields`) to the suggestion's own person — flip-selected-first, force `emailSource:'manual'`, partial-success on email collision → resolves on the Invite-tab merge. Commits `10c7932a`, `ab9b4274`. Detail: [[../docs/agent-wiki/topics/reviewer-workbench-lifecycle.md]]. **STILL DEFERRED (the real root fix):** *lift* the `loser_in_applicant_slot` v1 block — re-point the applicant slot lookups (`findApplicantSlotRefs`) to the keeper so EITHER merge orientation works. Re-open trigger: real usage shows namesake/wrong-identity applicant merges are frequent (parked pending volume — only 4 users, low usage as of S306).

Probe `scripts/probe-rabinowitz-conflict.js` is UNTRACKED (hardcodes a real email) — keep it local. <!-- doc-symbol-refs:ignore reason=untracked-local-pii-probe -->
 See [[feedback-self-review-before-delegating-review]],
[[feedback-symbol-consumer-fanout]], [[project-workbench-consolidation-rollout]].
