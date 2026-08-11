---
name: project-reviewer-duplicate-merge
description: "Reviewer duplicate merge — the email alt-key dead-end, v1 scope, and the THREE distinct duplicate problems (don't conflate them)"
metadata: 
  node_type: memory
  type: project
  status: active
  last_verified: 2026-07-22 via reviewer-merge.js, CandidateEditModal.js, my-candidates-service.js, and focused tests
  originSessionId: ed5870c4-4bd6-482a-bda7-d3e82dd98db5
---

## Recall Rule

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
This records the S289 design rationale, not a proof of caller authorization. The
route still receives no `requestId` and performs no request-membership or pair
authorization; whether app-level access is sufficient for this destructive
primitive remains an owner decision. Read
[[project-merge-candidates-authorization-gap]] before changing merge discovery.

**Hazards that already bit (Codex post-impl S289):** picking a field from the loser
must `isSet()`-guard so an empty loser value can't null the keeper (and `emailMoves`
likewise); `executeMerge` must refuse an already-inactive loser (`statecode`) or a
double-submit corrupts the keeper; the block predicate must include `wmkf_completedat`,
COI/AI acks, selective-decline, revoked token, and stage-2a reviewer-supplied fields;
a `confirmed` (human-attested) loser identity over a non-confirmed keeper BLOCKS rather
than transplanting. **Historical S289 boundary:** at that point Chunk 4 UI and the
live alt-key ordering probe were not built; both subsequently shipped, as recorded below.

**S306 — Chunk-4 merge UX hardened + applicant contact-persist (from a PD report: a wrong-namesake "Jun Ye" whose corrected email collided with the applicant-suggested duplicate).** Three shipped fixes: (1) `my-candidates.js handlePatch` now writes the conflict-SAFE person/researcher fields FIRST and isolates the email write LAST, so a duplicate-email 409 no longer discards affiliation/website (returns `partialSuccess`+`savedFields`); `CandidateEditModal` shows a "saved" note + refreshes on cancel. (2) [SUPERSEDED by S307 — see below] When a merge was blocked SOLELY by `loser_in_applicant_slot`, the modal pointed staff at **Swap**. (3) `promote-applicant-reviewer` now persists the PD's hand-corrections (only client-marked `manualContactFields`) to the suggestion's own person — flip-selected-first, force `emailSource:'manual'`, partial-success on email collision → resolves on the Invite-tab merge. Commits `10c7932a`, `ab9b4274`. Detail: [[../docs/agent-wiki/topics/reviewer-workbench-lifecycle.md]].

**S307 — the `loser_in_applicant_slot` BLOCK was LIFTED (the real root fix; Codex pre-impl review folded).** `executeMerge` Step 5 now repoints each loser `akoya_request.wmkf_potentialreviewer1..5` slot to the keeper (`wmkf_PotentialReviewer<N>@odata.bind`), or CLEARS it via `DynamicsService.disassociate` ($ref delete) when the keeper would otherwise occupy two slots (already in a slot, or loser holds >1 slot → repoint first, clear rest). Ordered after the suggestion reference work, before the email move/deactivate (412/409→retryable-replan; 404/400→hard-fail). `findApplicantSlotRefs` paginates (`queryAllRecords`) + fails closed on a capped result. Provenance preserved both ways: the authoritative slot is repointed, and a colliding junction row first transplants applicant-recommended intent onto the keeper's surviving row (gated on `sug.hasApplicantProvenance`; fail-closed `merge_applicant_provenance_conflict` if the keeper row is applicant-excluded) BEFORE the loser row is deleted. The S306 "use Swap" UI hint was removed (reason code no longer produced). Nav props verified live via `scripts/probe-akoya-potentialreviewer-slot-navprops.mjs`; slot-clear mirrors `scripts/reset-request-reviewers.mjs --include-slots`. So merge now works in EITHER orientation for applicant-suggested rows.

Probe `scripts/probe-rabinowitz-conflict.js` is untracked because it contains a real email. <!-- doc-symbol-refs:ignore reason=untracked-local-pii-probe -->
 See [[feedback-self-review-before-delegating-review]],
[[feedback-symbol-consumer-fanout]], [[project-workbench-consolidation-rollout]].
