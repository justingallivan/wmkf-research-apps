# Reviewer activity history Phase 1 — status brief for the next session

**Date:** 2026-08-12 (Session 388)
**Audience:** Codex, or whoever picks this up next
**State:** built, unpushed, two open findings from the fifth review round
**Branch:** `main` (local), 9 commits ahead of `origin/main`. Nothing deployed.

---

## What exists

Track Reviewers' **Last Action** column previously showed a fixed-precedence
fallback — `thankyouSentAt || reviewReceivedAt || reminderSentAt || materialsSentAt`
— which returned the highest-*ranked* stamp rather than the newest, so a months-old
thank-you masked a reminder sent yesterday.

Phase 1 replaces it with a true-recency summary plus a read-only **History** drawer.
Everything is derived at read time from lifecycle stamps already on the reviewer DTO.
No Dataverse schema change, no new API route, no backfill.

| File | Role |
|---|---|
| `shared/components/reviewers/reviewer-activity-history.js` | Pure derivation: `buildActivityHistory`, `latestActivitySummary`, evidence classifiers |
| `shared/components/reviewers/ReviewerActivityDrawer.js` | Accessible drawer (focus trap, Escape, focus restoration) |
| `shared/components/reviewers/ReviewerManagePanel.js` | Last Action cell + History affordance |
| `lib/services/review-manager/reviewers-service.js` | DTO widened by five stamps already in `FIELD_SELECT` |
| `tests/unit/reviewer-activity-history.test.js` | Derivation + invariant tests |
| `tests/unit/reviewer-activity-drawer.test.js` | DOM behavior tests |

Owner decisions already settled (2026-08-12): true recency over fixed precedence;
"Portal first accessed" as the label for `wmkf_proposalfirstaccessed`; no actor names
(the DTO carries no acting-user field); no materialized backfill.

Commits: `ae337125` → `bd8d9279` → `9eb11496` → `7a786c58` (merge) → `7ebadbfe` →
`058e45f2`. Base for review diffs is `c4ea7d42`.

---

## Why this brief exists: five review rounds

Each round found a real defect. Four of five were high severity. Listing them
because the *pattern* matters more than any single fix.

1. **Opus, pre-build** (`outputs/reviewer-activity-history-opus-review-2026-08-11.md`).
   Scoped Phase 1 as a derived drawer and pushed the exact ledger to Phase 2. Flagged
   that several "sent" stamps mean claim-before-send.
2. **Author pass, during build.** `wmkf_heldat` has no writer anywhere (only ever
   nulled at `reviewer-suggestion.js:1957`); `wmkf_coiackedat` / `wmkf_aiuseackedat`
   are **not** in `ENGAGEMENT_STAMP_RESET_ENTRIES` so they survive a re-add. All three
   excluded.
3. **Codex round 1 — HIGH.** `updateLifecycle` stamps `wmkf_reviewreceivedat` with the
   same `now` as `wmkf_completedat` on any transition to `complete` where it is empty
   (`reviewer-suggestion.js:1662-1670`). A close-out fabricates a review receipt.
   Fixed by demoting same-instant receipts.
4. **Codex round 2 — HIGH.** `wmkf_responsereceivedat` has three writers, two of them
   not the reviewer: `applyStaffReviewerWithdrawal` (`reviewer-suggestion.js:1832-1842`)
   and a **cron** in `reviewer-suggestion-sweep.js` that stamps a "responded" timestamp
   precisely to record that the reviewer never responded. Also: `released` writes no
   timestamp at all (`terminal-transition-service.js:106-118`). Fixed by deriving from
   `responseType` + `reviewStatus` and adding an undated terminal header.
5. **Codex round 3 — MEDIUM.** The undated header then masked the withdrawal date,
   which `withdrew` genuinely has. Fixed with `TERMINAL_STATUS_HAS_DATED_EVENT`.
6. **Codex round 4 — HIGH + MEDIUM. OPEN, see below.**

**The recurring shape:** a lifecycle stamp does not reliably mean the event its name
describes. The correct rule is to classify each event by its actual *write paths*, not
by the actor its name implies. That rule was derived early and then repeatedly applied
to too narrow a surface.

---

## Open findings (round 5, unfixed)

### HIGH — non-reset fields used as receipt evidence

`isSyntheticReceipt` (`reviewer-activity-history.js`) treats `reviewFilename` as proof
that a `reviewReceivedAt` stamp is a genuine submission.

[VERIFIED] `wmkf_reviewfilename`, `wmkf_reviewuploadedbystaff`, and
`wmkf_reviewsharepointfolder` are **absent** from `ENGAGEMENT_STAMP_RESET_ENTRIES`
(`reviewer-suggestion.js:793-813`). The `restore` path PATCHes only
`wmkf_selected: true` plus `ENGAGEMENT_STAMP_RESET` (`reviewer-suggestion.js:2006-2008`)
and does not delete answer child rows.

So **all three** evidence inputs the classifier uses — `reviewFilename`,
`reviewUploadedByStaff`, and `answers` — can carry state from a *prior* engagement.
Codex flagged the first; the same reasoning covers the set. Failure path: a reviewer
with an old uploaded file is removed and re-added, then closed out without submitting;
the stale filename defeats the synthetic-receipt guard and the drawer reports
"Review submitted through portal."

**Note on why the existing test did not catch this.** The engagement-scope invariant
test re-derives the reset set from adapter source and asserts every event field is a
member — but it only scans `EVENT_DESCRIPTORS[].rawField`. Evidence *inputs* to
classification were never in its scope. Any fix should widen that test, not just patch
the classifier.

### MEDIUM — mutable response fields erase earlier history

`applyStaffReviewerWithdrawal` overwrites `wmkf_responsereceivedat` with the withdrawal
time and `wmkf_responsetype` to `declined`. An accepted-then-withdrawn reviewer's
original acceptance date is destroyed in the row. This is not recoverable in the UI
layer — the data is gone. Any remedy is either Phase 2 persistence or honest framing.

---

## A hypothesis, offered not asserted

Removing non-reset fields as proof would leave **no engagement-scoped evidence** that
distinguishes a genuine portal submission from a fabricated close-out receipt. The
classifier would collapse to "same instant as close-out ⇒ synthetic," with no way to
affirmatively confirm a real receipt. Combined with the medium finding, one reading is
that mutable row state cannot support what the label "Activity history" promises, and
that the feature should either shrink to the events whose writers are unambiguous, or
wait for the Phase 2 ledger.

**This is a hypothesis, not a conclusion.** Arguments against it:

- The stale-artifact failure needs a specific sequence — upload, remove, re-add to the
  same request, close out without a new submission. Nobody has checked how often that
  actually happens. If it is rare or absent operationally, the severity is theoretical.
- An adversarial reviewer will generally find *something*; five rounds finding
  something is not by itself proof of a structural problem.
- Six of the ten events (the staff sends, plus portal first access) have single,
  reset-scoped writers and are not in question. The disputed surface is narrow.
- The previous session's author twice declared this defect class "converged" and was
  twice wrong, so that author's judgment that it should now shrink deserves the same
  skepticism.

**The real blocker is a product question, not a code question** — the one Opus called
Phase 0 and nobody has answered: *is this drawer operational convenience, or evidence
that could feed reviewer-reliability or payment decisions?* If convenience, imperfect
labels are tolerable and the current build is close to shippable. If evidence, every
claim must be provable and the scope question becomes urgent. Answering that should
probably precede any further code.

---

## Verification state

- `npx jest tests/unit` → **581 suites / 7367 tests, exit 0**
- `npm run build` → exit 0
- Gates green: types, agent-wiki (+self-test), doc-symbol-refs, fact-consistency,
  doc-currency, build-claim-freshness, harness-framing, status-enum-parity, atlas,
  api-routes, route-service-boundary, secret-scan, scaffolding-tokens, memory-router,
  instruction-architecture, agent-invariants
- Mutation checks pass on the focus trap, the synthetic-receipt demotion, the
  engagement-scope invariant, and both wrong Last Action precedence designs.

**Not verified: the rendered layout.** No browser session was available — the Chrome
extension never connected, and `AUTH_REQUIRED=true` needs a real Azure sign-in. Every
behavior claim rests on tests, not on looking at the table. For a UI change staff meet
immediately, this is the largest unmeasured risk and no amount of code review covers it.

---

## Constraints that still hold

- No Dataverse schema change, no new API route, no backfill.
- Do not modify the write paths. The close-out stamping is deliberate and load-bearing
  for `aggregateReviewHistory`.
- Every event field must remain a member of `ENGAGEMENT_STAMP_RESET_ENTRIES`.
- Terminal `released` has no timestamp anywhere; it must not become a dated event.
- Related durable record: `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md`
  (both standing hazards and the Last Action precedence rule).
