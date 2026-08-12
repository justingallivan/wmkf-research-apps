# Session 419 Prompt: reviewer activity history scope decision

## Session 418 Summary

### What Was Completed

1. **Two red CI gates cleared.** `check:docs-catalog` failed because
   `docs/INSTITUTION_PAIR_CONSISTENCY_RESOLUTION_PLAN.md` listed
   `outputs/s400-institution-checker-probe-findings.md` under `related:`, but
   `outputs/` is gitignored (`.gitignore:55`) and that file was never force-added —
   it holds live reviewer PII and is intentionally machine-local, so the frontmatter
   entry could never satisfy the existence check in `scripts/lib/docs-catalog.js:169-173`.
   `check:harness-framing` was a false positive: its `identity insult framing` pattern
   (`scripts/check-harness-framing.js:27`) matches a deferred-loading adjective that is
   also standard web terminology, which appeared in a hyphenated technical term in the
   Session 418 parked list. Reworded the doc rather than loosening the scanner — note
   the gate will trip again on any handoff that quotes that term, as this one initially
   did. [VERIFIED via both gates plus a regression sweep over eight doc gates.]

2. **Reviewer activity history Phase 1 built, and revised through five review rounds.**
   Track Reviewers' Last Action column no longer uses the fixed-precedence fallback
   `thankyouSentAt || reviewReceivedAt || reminderSentAt || materialsSentAt`; it shows
   the chronologically newest event plus a History drawer derived from the reviewer
   DTO. No schema, no route, no backfill. Owner decisions settled 2026-08-12: true
   recency, "Portal first accessed", no actor names (the DTO carries no acting-user
   field), no backfill.

   Each review round found a real defect, four of five high severity. The recurring
   shape: **a lifecycle stamp does not reliably mean the event its name describes** —
   classify by write path, not by the actor the name implies. Full history, evidence,
   and the two still-open findings are in
   `outputs/reviewer-activity-history-phase1-status-brief-2026-08-12.md`.

3. **`next dev` was writing into the canonical instruction file.** Next's agent-rules
   generator upserts a managed block into `AGENTS.md`; because `AGENTS.md` is a tracked
   symlink to `CLAUDE.md` and Node follows symlinks on write, it appended vendor
   instruction text to `CLAUDE.md` while logging "Generated AGENTS.md". Removed from
   history and disabled via `agentRules: false`
   (`config-schema.js:496`, gated at `start-server.js:419`). [VERIFIED empirically:
   `npm run dev` now starts clean and leaves `CLAUDE.md` byte-identical.]

4. **Stale node_modules found and fixed.** A full-suite run reported green while two
   suites had actually failed to run on `Cannot find module '@vercel/functions'` — the
   dep landed 2026-07-29 inside the 457 commits pulled at session start. `npm install`
   fixed it; `package.json`/`package-lock.json` unchanged.

### Commits

- `f525aa98` — fix(gates): clear docs-catalog and harness-framing reds
- `c4ea7d42` — docs(memory): carry S387 Vercel plugin findings and de-duplicate CSV schema
- `ae337125` — feat(workbench): reviewer activity history Phase 1 (derived drawer)
- `bd8d9279` — test(workbench): pin activity-drawer focus, Escape, and evidence copy
- `9eb11496` — fix(workbench): stop asserting close-out-fabricated review receipts
- `7a786c58` — Merge reviewer activity history Phase 1
- `afc18d28` — chore(config): stop next dev from writing to the instruction file
- `7ebadbfe` — fix(workbench): classify response and receipt events by write path
- `058e45f2` — fix(workbench): keep the withdrawal date in Last Action
- `2e7af630` — docs: status brief for reviewer activity history Phase 1

## Next Items

### Owner Decision Needed

1. **Is the activity drawer operational convenience, or evidence?** This is Opus's
   unanswered Phase 0 question and it now blocks the rest. Evidence:
   `outputs/reviewer-activity-history-opus-review-2026-08-11.md`;
   `outputs/reviewer-activity-history-phase1-status-brief-2026-08-12.md`.
   If convenience, imperfect labels are tolerable and the current build is close to
   shippable. If it will ever feed reviewer-reliability or payment decisions, every
   claim must be provable and the scope question below becomes urgent. Answer this
   before writing more code on the feature.

2. **Whether to reduce Phase 1 scope.** Offered as a hypothesis, not a conclusion, in
   the status brief — which argues both sides. Removing non-reset fields as receipt
   proof would leave no engagement-scoped evidence distinguishing a genuine submission
   from a fabricated close-out. Counter-arguments: the failure needs an unmeasured
   operational sequence; six of ten events are not in dispute; the prior session's
   author twice declared this defect class converged and was twice wrong.

3. **`merge-candidates` authorization remains org-open and destructive.** Carried,
   unchanged. Evidence: `.claude-memory/project-merge-candidates-authorization-gap.md`;
   `pages/api/reviewer-finder/merge-candidates.js` takes two GUIDs without a
   `requestId`, while `reviewer-modes.js:86-96` documents the UI gate as cosmetic and
   fail-open.

### Verified Open

1. **Round-5 HIGH: non-reset fields used as receipt evidence.** Evidence:
   `wmkf_reviewfilename`, `wmkf_reviewuploadedbystaff`, `wmkf_reviewsharepointfolder`
   are absent from `ENGAGEMENT_STAMP_RESET_ENTRIES`
   (`lib/dataverse/adapters/reviewer-suggestion.js:793-813`), and `restore` PATCHes
   only `wmkf_selected` plus the reset payload (`:2006-2008`) without deleting answer
   child rows. All three evidence inputs to the receipt classifier can therefore carry
   prior-engagement state. Any fix must also widen
   `tests/unit/reviewer-activity-history.test.js`, which scans
   `EVENT_DESCRIPTORS[].rawField` only and so never covered evidence inputs.
   **Gated on decision #1 — do not fix before the scope question is answered.**

2. **Round-5 MEDIUM: accepted-then-withdrew loses the acceptance date.**
   `applyStaffReviewerWithdrawal` overwrites `wmkf_responsereceivedat`
   (`reviewer-suggestion.js:1832-1842`). Not recoverable in the UI layer; remedy is
   Phase 2 persistence or honest framing. **Gated on decision #1.**

3. **Visual verification of the drawer has never happened.** Every behavior claim rests
   on tests. The Chrome extension would not connect this session and `AUTH_REQUIRED=true`
   needs a real Azure sign-in. This is the largest unmeasured risk and no code review
   covers it.

4. **Board milestone snapshot producer.** Carried, untouched this session. Evidence:
   `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md:791-794`; owner selected copy-the-bytes
   2026-08-10.

5. **Two non-destructive SharePoint checks.** Carried, untouched. Evidence:
   `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md:691-723`. Add "Checked Out To" to the
   request-library view; read the Members Delete Items / Delete Versions settings.

### Verify Before Acting

1. **Connor's SharePoint policy answer was expected 2026-08-12** and was not checked
   this session. Evidence: `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md:783`. Check for the
   real response before treating retention or permission conclusions as settled.

2. **`codex/initial-assessment-pilot` is stale and unmerged.** Branched from `3f56bb7d`
   (2026-07-29), two commits, now ~460 commits behind. Still on origin. Needs a
   disposition decision; do not assume it is abandoned.

3. **`feat/reviewer-activity-history-phase1` is merged into main but not deleted.**
   Local and remote-free. Safe to delete once main is pushed.

### Parked

1. **Invite-tab surfacing of needs-merge alerts.** Unchanged. Re-open only if a new
   alert probes `STILL_BLOCKED`.

2. **Exact activity ledger and deferred-load API.** Park until the Phase 0 decision
   above is made. A future route must bind `suggestionId` to `requestId` server-side
   and be added to `docs/API_ROUTE_SECURITY_MATRIX.md`.

### Do Not Reopen Without New Decision

1. **Launching a merge from a stored alert (`initialMerge`).** Stored alerts are not
   live proof.
2. **Changing the accepted-reviewer 90-day token policy for ordinary extensions.**
3. **Retiring `DEVELOPMENT_LOG.md`.** It is the milestone record.
4. **Materializing derived reviewer-history backfill.** Re-added rows have lost prior
   stamps and several timestamps do not prove sends.
5. **Modifying the reviewer write paths to suit the drawer.** The close-out stamping is
   deliberate and load-bearing for `aggregateReviewHistory`.

## Key Files Reference

| File | Purpose |
|------|---------|
| `outputs/reviewer-activity-history-phase1-status-brief-2026-08-12.md` | **Read first.** Five-round history, open findings, scope hypothesis |
| `outputs/reviewer-activity-history-opus-review-2026-08-11.md` | Original adversarial review and the Phase 0/1/2/3 scoping |
| `shared/components/reviewers/reviewer-activity-history.js` | Pure derivation and evidence classifiers |
| `shared/components/reviewers/ReviewerActivityDrawer.js` | Accessible drawer |
| `shared/components/reviewers/ReviewerManagePanel.js` | Last Action cell and History affordance |
| `lib/dataverse/adapters/reviewer-suggestion.js` | `ENGAGEMENT_STAMP_RESET_ENTRIES`, close-out stamping, staff withdrawal |
| `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md` | Both standing hazards and the Last Action precedence rule |

## Testing

```bash
npx jest tests/unit          # 581 suites / 7,367 tests, exit 0
npm run build                # exit 0

# Do NOT trust a filtered summary line for suite health. A run this session
# reported "PASS (7308) FAIL (0)" while 2 suites had failed to RUN, and a
# `| tail` pipeline masked jest's real exit code. Check the exit code directly.
```
