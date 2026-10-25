---
title: Reviewer Search Follow-ups After Decomposition
domain: reviewers
kind: plan
status: active
summary: Deferred functional limitations and separately tracked Impeccable typography exceptions after the reviewer search refactor.
canonical: false
owner: product-engineering
related:
  - docs/plans/REVIEWER_SEARCH_WORKSPACE_DECOMPOSITION_PLAN_2026-09-18.md
  - docs/plans/REVIEWER_SEARCH_WORKSPACE_EXECUTION_2026-09-18.md
---

# Reviewer Search Follow-ups

Recorded 2026-09-18 PT after independent Claude review and production release.
This is a future-session queue, not authorization to change behavior or run live
writes. The refactor is complete. Reproduce each issue against current code before
implementing a separately scoped fix. Priorities below are proposed triage order.

## Functional follow-ups

### F1 — Uncertain save outcomes and incomplete reconciliation (first)

[VERIFIED via source and existing P7 tests] Ordinary save reloads the roster when
fetch rejects before a response arrives. Unreadable/malformed response JSON and
applicant-promotion failures do not take the same recovery path. In addition, an
ordinary saved row whose key does not match its suggestion anchor can leave the
active roster without appearing in savedKeys; the UI may not confirm success or
call onSaved, and an empty roster can hide the action-local notice.

Evidence: `shared/components/reviewers/search/useReviewerPromotion.js`,
`lib/services/reviewer-roster-store.js`, and the execution receipt's P7 acceptance.

Next step: define one explicit unknown-outcome contract for ordinary and applicant
saves; trace real producer/store projections before changing UI recovery. Preserve
partial successes and prevent blind resubmission of a possibly committed write.
Prerequisite tests: response lost before receipt; JSON parse failure after a
committed save; applicant transport failure; mixed partial success; non-suggestion
saved key; empty-roster notice visibility; exact onSaved counts; safe retry.

### F2 — Same-context exclusion rollback — fixed in isolated worktree

[VERIFIED via source and regression tests, 2026-10-25; not released.]
`shared/components/reviewers/search/useReviewerRosterActions.js` tracks overlapping
name additions per request generation and roster revision. An added name is removed
only after every overlapping attempt for it fails; a pre-existing name or a
successful sibling attempt retains it. Both ordinary and unverified exclusion use
this accounting. A newer roster-name update invalidates the older rollback,
including its active/excluded bucket and selection changes, so a same-request
refresh is not overwritten by a late failure. Same-generation failures after a
refresh show a neutral note to check Excluded before retrying; cross-request
failures remain silent. This does not claim whether the server committed.

`useReviewerSearchController.js` supplies revision-tracked normal setters and
separate exclusion-only setters. Optimistic selection removal uses a pure functional
update, so multiple exclusions before a render compose. Failed selected cards are
reselected independently unless a non-exclusion selection mutation occurred since
their attempt began. These mutations include checkbox/toggle-all edits, search resets,
promotion/save updates and saved-conflict handling, even when their Set contents
happen to be unchanged. Excluding an unselected card and sibling exclusion recovery
do not invalidate reselection. No Set identity or content equality is used as an
ownership test. The existing generation guard still prevents cross-request rollback.
The unverified path unmasks its row without adding it to the active roster.

Regression evidence: `tests/unit/use-reviewer-roster-actions.test.js` covers HTTP
and transport failures, existing/new names, selected/unselected cards, newer selection
edits, context switches, saved conflicts, ordinary/unverified rollback, same-render
and overlapping exclusions under StrictMode, same-name siblings and newer roster
snapshots. The seven concurrency regressions failed against the first fix.
`tests/unit/reviewer-search-context-lifecycle.test.js` additionally exercises real
controller toggle mutations and overlapping recovery through a hook integration test.
This is a client recovery fix; persisted exclusion semantics and the existing
handling of transport failures remain unchanged. A rejected transport still does
not prove whether the server committed; unknown-outcome reconciliation is separate
work, not established by these tests. No live writes or Production smoke performed.

### F3 — Streams are invalidated but not cancelled (third)

[VERIFIED via source] Discovery and applicant enrichment use generation guards but
have no fetch AbortSignal. Context changes/unmount suppress stale UI writes while
already-started streams may continue reading. Owners:
`shared/components/reviewers/search/useReviewerDiscovery.js` and
`shared/components/reviewers/search/useApplicantReviewerEnrichment.js`.

Next step: determine whether client abort and reader cancellation are useful and
how each server endpoint handles disconnects. Client cancellation alone does not
prove provider work, billing or already-issued writes stop. Keep generation guards.
Prerequisite tests: A-to-B switch, unmount, StrictMode cleanup, independent search/
applicant lanes, terminal event before transport failure, intentional abort without
user-facing error, and an old finally block not clearing a new operation's lock.

### F4 — Proposal-key-only changes do not reset workspace (decision first)

[VERIFIED via source and characterization tests] The reset effect in
`shared/components/reviewers/search/useReviewerSearchController.js` depends on
requestId, blobUrl and reloadRoster, not proposalKey. This is preserved behavior,
not a newly established defect. The characterization suite locks it in.

Next step: inspect current parent document identity and cache contracts; decide
whether proposalKey can change independently and should represent a new workspace.
Prerequisite tests: proposalKey-only change, same request/new blob, request change,
late previous-roster response, applicant cache invalidation, and exclusion prefill
versus user edits. Change expectations only after choosing the intended contract.

## Impeccable notes — separate visual/design work

### D1 — Five legacy 11px secondary notes (accepted scoped exception)

[VERIFIED via baseline cc119614, extracted source and detector] These notes were
copied unchanged from the original component. DESIGN.md's compact label range is
12–14px; 11px is outside that range. This is an intentional preservation exception
for the refactor, not a claim that 11px is the preferred accessible reading size.

- `shared/components/reviewers/search/CandidateCard.js`: suggested-expertise note,
  identity note, emeritus evidence note, and unconfirmed-person evidence disclaimer
  (lines 490, 516, 523 and 602 at e332ad84).
- `shared/components/reviewers/search/IdentityComparisonPanel.js`: diagnostic/
  telemetry footnote (line 101 at e332ad84).

Disposition: `hook-admin.mjs ignore-value design-system-font-size 11px` was persisted
in `.impeccable/config.json`, scoped to exactly these two files, with baseline and
preservation rationale. Commit `59184b39`; the scoped typography detector passed.
It does not disable other rules or allow 11px project-wide. The exception is
file/value-scoped, so future 11px additions in those files also need human review.

Future design work: coordinate with
`.claude-memory/project-reviewer-card-simplification-direction.md` rather than
starting a parallel card redesign. Evaluate these notes at 12px or a documented
semantic text style, including narrow layouts and zoom. Preserve the identity and
evidence warnings' meaning and visibility. If the notes are updated, remove the
corresponding exception and rerun typography checks. No redesign or font-size
change was performed in this refactor.

## Operational observation — separate from either backlog

The release smoke initially encountered 30-second Dataverse timeouts in the
dashboard and unrelated cron routes. The dashboard recovered on retry on the same
deployment. Cause is unproven; the relevant server paths were unchanged. The
execution receipt records evidence. Investigate if repeated; do not label this a
confirmed reviewer-refactor regression or claim the dependency issue was fixed.

## Future-session starting point

Read the execution receipt, this queue, and current source. Pick one functional
item with the owner; add its discriminating tests before implementation. D1 is an
accepted visual exception, not a functional blocker. Do not silently combine
functional fixes, typography work and performance optimization in one change.
