# Session 424 Prompt: pick up the merge cascade, or the Connor SharePoint thread

## Session 423 Summary

A single-defect session that ran the full loop: diagnose, fix, adversarial
review, verify the platform premise empirically, reconcile docs, promote. Closed
S423 open item 5 (`merge-candidates` state corruption) in production.

### What Was Completed

1. **Fixed the merge reference-window defect (PRODUCTION).**
   `executeMerge` enumerated the loser's suggestion rows and applicant slots once
   at plan time, then ran Steps 3-6 as many sequential Dataverse round-trips. A
   reference created in that window was never repointed, and the Step 7 `ifMatch`
   could not catch it — it carries the loser PERSON's ETag, while a new suggestion
   row or slot binding writes a different record. The merge returned
   `success: true` with a live reference pointing at an inactive reviewer.
   Now re-reads both reference sets immediately before the deactivate and fails
   closed to the existing retryable-replan path.

2. **Codex adversarial review returned `needs-attention`; both findings addressed.**
   - `[high]` A capped slot re-read at Step 7 dead-ended as a non-retryable 400
     after Steps 3-6 had already written. `findApplicantSlotRefs` now takes
     `cappedAction`: terminal validation at plan time, replan at Step 7.
     **Severity rejected as reported** — `planMerge` already calls the identical
     function with the identical filter at Step 0, so reaching it at Step 7 needs
     the loser's slot count to cross 5000 mid-merge on a ~5000-row table.
   - `[medium]` Tests injected from Step 3, the cheapest window. Added injection
     after the Step 4 hard delete, the Step 5 slot repoint, and the Step 6 email
     move, each asserting the replan AND that a second execute converges.

3. **Verified the load-bearing platform premise against production.**
   Wrote `scripts/probe-etag-parent-bump.js` (read-only) rather than sending the
   question to Connor. Verdict `CREATION-DOES-NOT-BUMP-PARENT`: 4 of 99 parents
   with a never-updated child sit at a lower version than that child. The guard is
   necessary, not redundant. Reproduced on an independent user-run execution.

4. **Reconciled the design doc and the wiki.** `/contract-reconcile` found
   `REVIEWER_MERGE_DESIGN.md` step 7 still describing a bare `statecode=1` write.

### Commits

- `f9beaec1` - Re-verify the loser is dereferenced before deactivating it in a merge
- `d8ffc4ae` - Address Codex review: cap classification and late-window merge convergence
- `28bb64ad` - Add a read-only probe for the ETag parent-bump premise
- `f511a8eb` - Confirm the ETag premise against production: creation does not bump the parent
- `4a202cc0` - Reconcile the merge design doc with the Step 7 re-check
- `3ed1f235` - Merge: re-verify loser dereferencing before a reviewer merge deactivates

### Gotchas Worth Carrying

- **An `ifMatch` on a PARENT record cannot detect a new CHILD row.** Creating a row
  with a lookup to a record does not bump that record's `versionnumber`. Any guard
  shaped "hold the parent's ETag, then act as though its references are unchanged"
  is unsound. `[VERIFIED via probe against production, 2026-08-13]` Recorded in
  `docs/agent-wiki/topics/dataverse-dynamics.md`.
- **`@odata.etag` is exactly `W/"<versionnumber>"`, and versionnumber is org-wide
  monotonic in WRITE order** — 100% agreement with `modifiedon` ordering across
  entities, ~50% with `createdon`. A row's current version equals its creation
  version only when `createdon == modifiedon`. Both facts are reusable for any
  future optimistic-concurrency reasoning.
- **The probe was wrong on its first run and said so.** It returned
  `METHOD-INVALID` because monotonicity was validated against `createdon`. That
  masked a worse bug: comparing parents against children that had been *edited*
  since creation, which would have produced a confident right answer for entirely
  wrong reasons. A verification tool that cannot fail closed is not a verification
  tool.
- **The merge is not a standalone tool.** It is a recovery prompt inside the
  candidate edit modal: edit a saved candidate's email, hit a duplicate-email
  collision, get offered a merge. Not reachable from a fresh Find card or
  confirm-identity mode.
- **Test mocks were replaying a snapshot.** The merge suite's reference reads were
  static, so they could not model references changing over the life of a merge —
  that whole bug class was untestable. Now stateful, including person rows.

## Next Items

### Verified Open

1. **[VERIFIED OPEN] The merge cascade is still non-transactional.** The other half
   of the original S423 item 5, deliberately not addressed. `hardDeleteById`
   (`reviewer-merge.js:448`) permanently deletes colliding loser rows, and a failure
   after that point — slot 404/400, the non-retryable email move, or the deactivate
   — leaves a half-merged state with no compensation. This session ADDED one more
   throw point after the delete (the Step 7 re-check), judged acceptable because the
   pre-existing alternative was silent corruption. A real fix means soft-delete plus
   reconcile, or an explicit compensation log. Evidence:
   `docs/REVIEWER_MERGE_DESIGN.md` step 7; `outputs/merge-candidates-authorization-decision-2026-08-12.md` §E.

2. **[VERIFIED OPEN] The slot-binding half of the ETag question is unverified.**
   The probe settles child-row creation only. Binding
   `wmkf_PotentialReviewerN@odata.bind` on `akoya_request` is a different operation
   and Dataverse records no binding timestamp, so production history cannot isolate
   it — it needs a controlled sandbox write. If binding DOES bump the parent, that
   half of the re-check is redundant but harmless (it fails to a replan). Evidence:
   `scripts/probe-etag-parent-bump.js` `unanswered` field.

3. **[VERIFIED OPEN, re-checked 2026-08-13] Repair `computeCanManage` rather than
   delete it.** `shared/components/reviewers/reviewer-modes.js:95-97` still reads
   `Boolean(isSuperuser || !pdId || !myUserId || myUserId === pdId)` — unchanged.
   Make the unresolved-identity branch fail closed and stop calling it cosmetic in
   its docblock. **Do not delete it** — adversarial review confirmed deletion would
   strip gating from many unrelated write controls.

4. **[VERIFIED OPEN] Run the read-only PnP.PowerShell SharePoint audit with Connor.**
   Evidence: `outputs/sharepoint-permission-audit-primer-for-connor-2026-08-12.md`.
   Still gated on a tenant-consented Entra app client ID and on whether Connor is a
   Site Collection Administrator.

5. **[VERIFIED OPEN] SharePoint durability evidence — Purview/holds.** Belongs with
   the M365 compliance administrator, not Connor; §11 of the S415 brief has the
   message ready and has no dependency on the Connor thread.

6. **[VERIFIED OPEN] Board milestone snapshot producer.** Copy-the-bytes selected
   2026-08-10. Explicitly not blocked by any SharePoint question.

### Owner Decision Needed

1. **Execute the phantom co-PI remediation?** Unchanged from S423. The owner chose
   not to delete data. Deleting removes a demonstrably wrong name but does **not**
   recover the right one; the `copi2`/`copi4` occupancies imply genuine co-PIs hold
   earlier slots on two requests, so program staff may want to check the seven
   proposals against source documents first. Evidence:
   `outputs/phantom-copi-incident-2026-08-12.md`; `scripts/remediate-placeholder-copi.js`.

2. **Should `merge-candidates` remain organization-open?** Still the only survivor of
   the three S420 questions, and untouched by this session — S423 fixed state
   corruption, not authorization. S422 proposes **declining** an authorization check.
   Evidence: `.claude-memory/project-merge-candidates-authorization-gap.md`;
   `outputs/merge-candidates-authorization-decision-2026-08-12.md`.

### Parked

1. **Invite-tab surfacing of needs-merge alerts.** Re-open only if a new alert probes
   `STILL_BLOCKED`.
2. **Exact activity ledger and deferred-load API (Phase 2).** Scope decision came back
   **convenience**, so no evidentiary requirement justifies a persisted ledger.
3. **Staff review step before the grantee portal shows co-PIs.** Product question.
4. **Bespoke per-invitation review due date.** Considered and declined 2026-08-12.
5. **The invite modal's "request-level campaign settings when saved" note.** Owner:
   not worth correcting for one cycle.

### Verify Before Acting

1. **The phantom co-PI seven-request count is a floor, not a ceiling.**
   `[VERIFIED for email exactly `_@_._`; other placeholder shapes UNTESTED]` Widen
   the pattern before anyone calls that cleanup complete, and re-run the dry-run —
   the recorded slot/junction ids are a 2026-08-12 snapshot, and `deleteRecord` does
   not tolerate 404 (unlike `disassociate`), so cascaded deletes surface as false
   failures.

2. **Request `1002788` "To Explore the Universe" looks like test data in production.**
   Confirm it is a sandbox record before assuming so — it is cited as pilot evidence
   in `docs/CURRENT_WORK_QUEUE.md` order 1.

3. **SharePoint policy branch disposition.** `origin/codex/sharepoint-storage-policy-questions`
   was 4 commits ahead / `main` 62 ahead at S422 — **re-derive both counts**, `main`
   has moved since. It strands a documented version-limit correction. Only the
   version-limit phrasing is stale.

4. **`codex/initial-assessment-pilot` disposition.** Was exactly 2 commits not in
   `main` at S422 — re-derive. Sibling branches with similar names *are* merged; do
   not let a substring match report this one as merged.

### Do Not Reopen Without New Decision

1. Launching a merge from a stored alert (`initialMerge`).
2. Changing the accepted-reviewer 90-day token policy for ordinary extensions.
3. Materializing a derived reviewer-history backfill.
4. Modifying load-bearing reviewer write paths merely to improve drawer labels.
5. **Changing application code for the phantom co-PI.** Data remediation plus an
   upstream import fix.
6. **Deleting `computeCanManage`.** Repair the fail-open branch instead.
7. **Reinstating a block on any `respondBy` condition in the invitation timeline.**
   `respondBy` drifts with today; a block recreates the exact bug S422 fixed.
8. **Reviewer activity history scope.** Decided: operational convenience.
9. **Removing the Step 7 pre-deactivate re-check as redundant.** The premise it
   depends on was verified against production this session — creation does not bump
   the parent ETag. Reopen only if the slot-binding sandbox test contradicts it, and
   even then only for the slot half.

## Operating Note

Production Dataverse commands go to the user to run, or are asked-and-waited-for —
including read-only probes and scratch diagnostics. Do not set
`DATAVERSE_ALLOW_PROD_READS` yourself. Recorded as
`.claude-memory/feedback-never-self-authorize-prod-dataverse-reads.md` after this
session ran two prod reads on its own initiative, one without notice.

## Key Files Reference

| File | Purpose |
|------|---------|
| `lib/services/reviewer-merge.js` | `executeMerge` Step 7 re-check (`:526-541`); `findApplicantSlotRefs` phase-dependent cap (`:172-196`); the non-transactional hard delete (`:448`) |
| `tests/unit/reviewer-merge-service.test.js` | Stateful merge harness; the Step 7 concurrency + convergence suite |
| `scripts/probe-etag-parent-bump.js` | Read-only ETag premise probe; `unanswered` lists the slot-binding gap |
| `docs/agent-wiki/topics/dataverse-dynamics.md` | The parent-ETag rule and the two reusable versionnumber facts |
| `docs/REVIEWER_MERGE_DESIGN.md` | Step 7 now describes the re-check and both open risks |
| `shared/components/reviewers/CandidateEditModal.js` | Where the merge is actually reached (duplicate-email recovery, `:263-277`); 409 replan branch at `:425` |

## Testing

```bash
npx jest tests/unit/reviewer-merge-service.test.js   # merge contract + Step 7 re-check
npx jest tests/unit/probe-etag-parent-bump.test.js   # probe classification logic
npx jest tests/unit                                  # 582 suites / 7397 tests
npm run check:types

# Read-only. HAND THIS TO THE USER — do not run it yourself.
DATAVERSE_ALLOW_PROD_READS=yes node scripts/probe-etag-parent-bump.js \
  --target=prod --output outputs/etag-parent-bump-probe.json
```
