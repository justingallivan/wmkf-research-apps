# PR #369 — Claude Opus OAuth review, 2026-09-30

**Historical verdict at `e17b93685`: CHANGES REQUIRED — one P2; no P0/P1 findings.** Subsequently fixed at `40ab24f3e` and re-reviewed via OAuth with no P0–P2: [current fix report](b4-inactive-slot-fix-2026-09-30.md). PR #369 subsequently merged/deployed by explicit owner decision; [promotion receipt](b4-production-promotion-2026-09-30.md). Remaining operational checks are tracked separately. This report and its verbatim review preserve the earlier source/reproduction as history. The independent reviewer was Claude Opus 5.5 (`claude-opus-5-5`) through the owner's `claude.ai` Max OAuth session. The owner explicitly approved subscription/metered usage after the automatic approval notice. The CLI ran outside the Codex sandbox for Keychain access, with API-key/alternate-provider env vars removed, no fallback model, and only Read/Grep/Glob tools. No application/provider API key authenticated the review. No source was changed or GitHub comment posted.

Reviewed head: `e17b93685b2a367d5da3a7016c366baec3b30d4d`; PR base: `570f53086325e7988ebf95f4e6f4a1f86cfe7676`. Exact diff SHA-256: `0066e8f20869ab53531e278f7b734968fa6c4c0c088f9952e04344f6f00e647b`. Runtime/probe/client remain unchanged from candidate `92ccbd0bd`. Opus completed 94 read operations in 539 seconds, with zero permission denials and successful exit. See [provenance](b4-claude-opus-review-provenance-2026-09-30.json).

## Codex confirmation after the independent review

[VERIFIED via source and isolated Jest reproduction] The statecode rejection in `synthetic-reviewer-capability.js:62-64` occurs before the ordinary marker branch. Slot ingestion at `applicant-reviewers-service.js:119-129` rejects that capability result; hydration runs only for successful `recommended` entries (`:164-176`). The existing inactive fallback in `applicant-known-reviewer-service.js:21-30` and repair card at `CandidateCard.js:379-390` cannot be reached for this failed slot. No runtime policy was changed.

The [reproduction source](b4-inactive-slot-reproduction-2026-09-30.txt) uses fixture IDs from the existing applicant-reviewers unit suite. It exercises the real capability and ingestion service with mocked Dataverse, exclusion parsing and hydration seams. One suite / two tests passed: the inactive ordinary slot yields `recommended=[]`, one `recommendedFailed`, and no materialization/hydration on both initial call and retry; an active ordinary control reaches both seams. No network/database operation was run. To reproduce, copy the text to the ignored `tmp/b4-opus-review/inactive-slot-repro.test.js` path and run:

```bash
npm test -- --runInBand --silent   --testMatch '**/tmp/b4-opus-review/*.test.js'   --runTestsByPath tmp/b4-opus-review/inactive-slot-repro.test.js
```

This confirms the historical failure at the reviewed head, before the fix. The recommendation was then NOT TESTED / ASSUMED and unapplied. The subsequent fix report records permanent regression coverage, strict defaults and preserved isolation/active-synthetic guards. This old failure reproduction is expected to fail on the repaired source. The operational ledger/schema/automation/promotion blockers remain separate.

## Independent Opus report — verbatim

I found one actionable defect, a P2. No P0 or P1 issues. Runtime promotion is still blocked on the owner. I didn't run tests, so nothing below is verified by execution. I also couldn't recompute the diff's SHA-256 with Read/Grep/Glob; I reviewed `tmp/b4-opus-review/pr369.diff` as provided, plus the source files at head `e17b93685b2a367d5da3a7016c366baec3b30d4d`.

## 1. Defects introduced by this PR

### P2 — Inactive ordinary slot reviewers now show as "failed to ingest" instead of the inactive-repair card

**Evidence**
- `lib/services/workbench/applicant-reviewers-service.js:119-129` now calls `resolveReviewerBindCapability` before `ensureApplicantRecommended`.
- `lib/services/test-requests/synthetic-reviewer-capability.js:62-64` throws `reviewer_person_inactive` for any person with `statecode !== 0`. This check runs before the ordinary/synthetic split at `:65-71`, so it hits ordinary people too.
- `statecode` is always read: it's part of the shared FIELD_SELECT that `getById` uses (`lib/dataverse/adapters/potential-reviewer.js:116-120`, `:575-578`).
- The adapter repeats the same refusal: `lib/dataverse/adapters/reviewer-suggestion.js:784` → `assertPersonBindable` → capability.
- A refused slot goes to `recommendedFailed` (`applicant-reviewers-service.js:144-150`), and hydration only runs for successful slots (`:164-176`).

**Why this is a regression**
- Before this PR, `assertPersonBindable` only checked the marker (diff lines 3679-3697). An inactive slot person got a suggestion row, then hydrated as `status: 'inactive'` (`lib/utils/applicant-known-reviewer.js:141-142`).
- The UI has a specific path for that: `shared/components/reviewers/reviewer-search-logic.js:153-154` and `shared/components/reviewers/search/CandidateCard.js:379-380`.
- The PR clearly meant to keep this: it added an inactive fallback at `lib/services/workbench/applicant-known-reviewer-service.js:21-30`, tested in `tests/unit/applicant-known-reviewer.test.js` ("scoped hydration preserves inactive repair status…"). But slot ingestion never reaches that fallback.

**Triggering scenario:** Both switches are on and a Request's Potential Reviewer slot points at an inactive ordinary person — for example, a merge loser (merge deactivates losers at `lib/services/reviewer-merge.js:571`).

**Impact**
- The Find panel shows "N of M applicant-recommended reviewers failed to ingest" (`shared/components/reviewers/search/ApplicantReviewerStatus.js:48-53`) with a generic binding message.
- Retrying can never succeed.
- The inactive-repair guidance and the row's engagement projection disappear from `recommended`.
- No data is harmed; it fails closed.
- Same root cause, smaller effect: My Candidates identity edits for an inactive linked person now return 409 `reviewer_identity_edit_blocked` (`lib/services/reviewer-finder/my-candidates-service.js:666-677`).

**Smallest change (NOT TESTED)**
- Add an opt-in option to `resolveReviewerBindCapability`, e.g. `allowInactiveOrdinary`.
- When set and the marker was read as exactly `false` or `null`, return `{ kind: 'ordinary', person, inactive: true }` instead of throwing.
- Pass it only from `ingestApplicantReviewers` (`applicant-reviewers-service.js:120`) and from `ensureApplicantRecommended`'s `assertPersonBindable` call (`reviewer-suggestion.js:784`).
- Keep the active-person requirement for synthetic people and every other caller.
- This doesn't touch the owner policies: the switch check (`:54`) and synthetic handling stay first and unchanged.

**Prerequisite at the execution point:** the marker must be positively read before the inactive exemption. That read already happens at `synthetic-reviewer-capability.js:57-61`.

**Evidence:** NOT TESTED. No test covers this path: `tests/unit/workbench-applicant-reviewers-service.test.js` and `tests/unit/applicant-reviewers-endpoint.test.js` both mock the capability to return `ordinary`.

**Disconfirming check:** Use the real capability in the applicant-reviewers service test, with a slot person `{statecode: 1, wmkf_issyntheticreviewer: false}`. If the owner actually wants inactive ordinary slots refused at ingestion, the current behavior is correct and the fallback at `applicant-known-reviewer-service.js:21-30` is dead code for this caller. The plan (§1 and §3) only requires active state for the synthetic exact path.

No other P0, P1 or P2 defects found.

## 2. Contract audit

**Scope:** PR #369 runtime plus migration 058 / setup V57, with callers and consumers.

**Whole-flow**
- **Hydration and binding.** Slot ingestion, enrichment, promotion, save-candidates, manual add, merge and the reconciler all check the reviewer switch before their first person write:
  - `save-candidates-service.js:1262` is before the first person read or write, and `:1468` is the person upsert.
  - `manual-reviewer-service.js:132`; `reviewer-merge.js:355`; `reviewer-email-reconciler.js:137,223,261`.
  - Per-slot, enrichment and promotion checks: `applicant-reviewers-service.js:120`, `enrich-recommended-service.js:845-860`, `promote-applicant-reviewer-service.js:532-545`.
- **Cast-person identity stays immutable.** Enrichment writes are guarded at `enrich-recommended-service.js:1067,1147,1181`; save-candidates at the `!castPerson` guards.
- **All four suggestion-adapter bind operations are covered.** I grepped every caller; scripts go through the adapter guard.
- **Person-edit entry points.** I grepped every `potentialReviewerAdapter`/`researcherAdapter` write and each one is gated:
  - address-trust: `:436,457,600,776,828,948`
  - My Candidates, before lifecycle: `:653-687`
  - contact enrichment: `persistence.js:53,85-86`
  - decline ORCID capture: `respond-service.js:303-317`
  - The BILL `setContactLink` path is reachable only from the acceptance drain.

**Acceptance jobs**
- Claiming is skipped when either switch isn't on (`reviewer-acceptance-drain.js:877-881`).
- There's a per-job pre-check and a check after processing (`:903-921`), plus process-level pauses (`:564,575`).
- Lease release only happens with the matching token and doesn't touch attempts (`reviewer-acceptance-job-service.js:227-240`). The claim step doesn't increment attempts either (`:203-225`).
- The cron records a visible failure while paused.
- The cron is the only caller.

**Slot journal (CLI)**
- Preview is read-only.
- Confirmation requires the exact Request GUID (`cast-slot-binding-runner.js:106-113`).
- One fenced PATCH, restricted to the Potential Reviewer 1 bind body with a concrete If-Match (`production-write-fence.js:203-232`).
- The snapshot is recorded before dispatch.
- After dispatch it never resends; a 412 or lost response is resolved by re-reading.
- The owner's hand-set slot is recorded as `observed_preexisting`, not as a Factory write.
- The client returns 412 rather than throwing (`lib/dataverse/client.js:341`), so provenance and failure codes classify correctly.

**Partial success**
- Save stays per-candidate, including compensating a newly created person.
- Withdraw and release keep the state change and report a definite email failure.
- Due-extension and manual reminders refuse before writes; the reminder send re-checks after the claim.
- A refusal from `assertReviewerDirectedEmailBound` is tagged `dispatched=false`, which `classifyEmailDispatchError` (`email-send-outcome.js:52`) and send-emails (`:1019`) treat as a definite non-send.

**Async and retry state**
- Journal transitions are guarded by conditional `WHERE status IN (...)` updates (`run-ledger.js:1437-1498`).
- Concurrent CLI runs can't both dispatch, because `markCastSlotDispatched` only moves a row out of `planned`.
- Residual risk, not new: a pre-transport throw (for example, the interlock ack date rolling over at midnight UTC) is recorded as `ambiguous_dispatch` and needs manual inspection. That's conservative and matches the existing `status-change-runner.js:96-100` pattern.

**Migration and receipt parity**
- The receipt function in 058 matches 054 (`:29-78`) and V55 (`setup-database.js:1243-1292`), and the cast tables match V55 `:1514-1544`, as far as I can see by reading them.
- 058's shape checks and constraint checks raise an error on an incompatible or incomplete shape.
- V57 mirrors the slot table and runs after V55/V56.
- `ON CONFLICT DO NOTHING` now returns a 409 destination conflict instead of an opaque 500.

**Symbol fan-out**
- `getById` now also selects the marker. I found no consumer that returns the raw row to a client.
- `processAnnotations` keeps null values (`annotations.js:15-43`), so the null-marker "ordinary" case holds.
- The new alert reason `synthetic_email_owner` flows through the existing alert type.

**Docs**
- The plan (§4–6, checklist), Atlas and evidence agree with the source on journal semantics and the blocked status.

**Limitations**
- No tests were run.
- I couldn't view earlier installed 054 function versions (no git access).
- Scheduled-email code, 059/V58 and the other checkout were out of scope and not reviewed.

## 3. Known release blockers (not code findings)

- `ledger_prod` is absent from this Mac, and `ledger` has an early, incomplete 054 shape.
- The 058 preflight/apply/record steps haven't been run on either ledger, and the cast address-digest ownership match can't be done.
- The Production 054 query and any 058 apply are owner-run.
- Six owner automation dispositions, plus the indirect-chain review, are still open.
- Deployment-captured switch values couldn't be read back.
- Tier 2 promotion and post-deploy job-resumption checks are pending.
- No migration, slot PATCH, email or live job drain has run.
- The other Mac is unavailable for about nine hours.
- The PR must stay draft.

## 4. Verdict

**Changes required:** one P2, the inactive-slot ingestion regression. It is not a safety or fail-open defect. Runtime promotion remains owner-blocked by the items in section 3. Reviewed head: `e17b93685b2a367d5da3a7016c366baec3b30d4d`.

### Recommendation Evidence
| Recommendation | Current prerequisite | Available at execution point | Evidence actually tested | Disconfirming check | Status |
|---|---|---|---|---|---|
| Opt-in ordinary-inactive exemption in `resolveReviewerBindCapability`, used only by slot ingestion and `ensureApplicantRecommended` | Marker read positively as `false`/`null` (`synthetic-reviewer-capability.js:57-61,65-70`) | Yes: the marker read precedes the statecode check at `:62` | NOT TESTED | Real-capability test with an inactive ordinary slot person; the owner stating that ordinary inactive slots should be refused | ASSUMED |
