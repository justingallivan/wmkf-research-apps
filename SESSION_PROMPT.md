# Session 308 Prompt: (open — pick from Next Items)

## Session 307 Summary

Lifted the `loser_in_applicant_slot` v1 merge block — the parked root fix behind
S306's symptom-patches — so a true-duplicate reviewer merge now works in EITHER
orientation when the loser sits in an applicant-suggested slot. Codex ran a
pre-implementation design review (its 4 material revisions were folded before any
code). In parallel, Codex authored a reviewer-workbench "nice-to-haves" planning
doc in a git worktree; that was reviewed read-only, merged, and the worktree parked.
Full `npm test` green except the documented expected-red `bill.test.js` /
`discovery-verification-status.test.js`.

### What Was Completed

1. **Applicant-slot repoint (the merge block is gone).** `executeMerge` Step 5
   (after the suggestion reference work, before the non-retryable email window and
   before deactivate) PATCHes each `akoya_request.wmkf_PotentialReviewer<N>@odata.bind`
   loser→keeper, or CLEARS the slot via the new `DynamicsService.disassociate`
   ($ref delete) when the keeper would otherwise occupy two slots (already in a slot
   on that request, OR the loser holds >1 slot → repoint the first, clear the rest).
   `findApplicantSlotRefs` now paginates (`queryAllRecords`) and fails closed on a
   capped result. Conflict handling: 412/409 → retryable replan; 404/400 → hard fail.
2. **Provenance preserved both ways.** The authoritative slot is repointed; a
   colliding junction row first transplants applicant-recommended intent onto the
   keeper's surviving row (gated on the new `hasApplicantProvenance`; fail-closed
   `merge_applicant_provenance_conflict` 409 if the keeper row is applicant-excluded)
   BEFORE the loser row is deleted. Added `wmkf_sources` to `MERGE_PREDICATE_SELECT`
   for the gate. Removed the now-defunct S306 "use Swap" hint from `CandidateEditModal`.
3. **Nav props verified live** via `scripts/probe-akoya-potentialreviewer-slot-navprops.mjs`
   (read-only; slot N → nav prop `wmkf_PotentialReviewer<N>`, entity set
   `wmkf_potentialreviewerses`). +15 merge tests; merge suites 76/76.
4. **Reviewer nice-to-haves planning doc** (`docs/REVIEWER_WORKBENCH_NICE_TO_HAVES_PLAN.md`,
   Codex-authored, planning-only) — feasibility for the colleague's 6-item wishlist.

### Commits
- `22ec18f9` — read-only slot nav-prop probe (pushed earlier in the session)
- `fa62db30` — lift `loser_in_applicant_slot` block: repoint applicant slots
- `6cf450b2`/`c8b74fd3`/`f85db100`/`eb24e702` — Codex nice-to-haves plan (worktree)
- `937fb7df` — merge the nice-to-haves plan branch

## Next Items

### Owner Decision Needed

1. **Reviewer nice-to-haves direction.** The plan argues a capture-timing thesis:
   candidate stage = contactability only; ACCEPTANCE stage = capture board-writeup
   identity (rank/title, department, institution — proposed as *required* Stage 2a
   fields); post-review = reviewer memory (flag + notes, history). Headline decision:
   force rank/department/institution as required Stage 2a fields? Quick wins flagged:
   Invite-Reviewers export button (reuse `export-candidates`), expertise tags via
   existing `wmkf_keywords`, review-history aggregation from junction timestamps.
   Evidence: `docs/REVIEWER_WORKBENCH_NICE_TO_HAVES_PLAN.md`.
2. **Remit-flag on review-completion** — wire `wmkf_authorizationtoremitpaymentflag`
   on submit? Carried from S304/S305, still not addressed.
   Evidence: `.claude-memory/project-honorarium-payment-landscape.md`.

### Parked

1. Longer carried list (BILL API access, PNI self-report, workbench access
   boundaries, applicant-exclusion, awardee onboarding, Dataverse settings audit,
   GRANTEE_PORTAL title provenance, nomenclature/app-sunset sweep).
   Re-open trigger: owner prioritization. Evidence: `.claude-memory/MEMORY.md` router.

### Do Not Reopen Without New Decision

1. **The `loser_in_applicant_slot` block is LIFTED (S307) — do NOT re-add it.** The
   merge intentionally repoints applicant slots loser→keeper now. Any "applicant-slot
   merges aren't supported" / "block on slot reference" claim is stale.
   Evidence: `lib/services/reviewer-merge.js` Step 5; `docs/REVIEWER_MERGE_DESIGN.md` §5;
   `.claude-memory/project-reviewer-duplicate-merge.md` (S307 note).
2. **Staff-editable-review-questions epic is COMPLETE (A–E).** Ratings live solely in
   `wmkf_appreviewanswer`; the 3 parent rating columns are dropped. Never redeploy a
   bundle older than `cc0bce6b`.
   Evidence: `docs/STAFF_EDITABLE_REVIEW_QUESTIONS_BUILD_PLAN.md` §6d-E2.

### Verify Before Acting

1. Anything claiming the reviewer merge "blocks when the loser is in an applicant
   slot" or "can't merge applicant-suggested rows" — FIXED in S307 (the slot is
   repointed). Treat as stale; check `git log` / `fa62db30`.
2. Parked-but-related root fix from S306 (`findApplicantSlotRefs` → keeper) is now
   DONE — do not carry it forward as open.

## Key Files Reference

| File | Purpose |
|------|---------|
| `lib/services/reviewer-merge.js` | `findApplicantSlotRefs` (paginated, repoint/clear ops); `executeMerge` Step 5 slot repoint; collision-row provenance union; `merge_applicant_provenance_conflict`. |
| `lib/dataverse/adapters/reviewer-suggestion.js` | `hasApplicantProvenance`; `wmkf_sources` in `MERGE_PREDICATE_SELECT`. |
| `lib/services/dynamics-service.js` | `disassociate(entitySet, id, navProp)` — $ref-delete a single-valued lookup (the only supported NULL-a-lookup path). |
| `pages/api/reviewer-finder/merge-candidates.js` | Maps `merge_applicant_provenance_conflict` → 409. |
| `shared/components/reviewers/CandidateEditModal.js` | S306 Swap hint removed (block no longer produced). |
| `scripts/probe-akoya-potentialreviewer-slot-navprops.mjs` | Read-only nav-prop probe (slot N → `wmkf_PotentialReviewer<N>`). |
| `docs/REVIEWER_WORKBENCH_NICE_TO_HAVES_PLAN.md` | Codex feasibility plan for the 6-item wishlist. |

## Testing

```bash
npx jest tests/unit/reviewer-merge-service.test.js \
  tests/unit/reviewer-merge-adapters.test.js \
  tests/unit/reviewer-merge-route.test.js \
  tests/unit/candidate-edit-modal-merge.test.js   # 76 green
npm test   # full suite, green except expected-red bill / discovery-verification-status
```
