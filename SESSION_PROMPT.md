# Session 637 Prompt: Await owner-selected work after the D26 invited-amount correction

## Session 636 Summary — Proposal Ranking uses invited amounts; D26 round corrected in place

### What Was Completed

1. **Proposal Ranking ranks on the invited amount.** [VERIFIED via GitHub check-runs on `4a37f2f9b`: six workflows green]
   - Branch `proposal-ranking-invited-amount`, fast-forward merged by the owner (`4a37f2f9b`).
   - `lib/dataverse/adapters/proposal-ranking-source.js` selects `wmkf_invitedamount` and falls back to `akoya_request` when blank. It emits `amountSource` (`invited` | `requested` | null). Same currency/precision blocks.
   - `preview-service.js` freezes `amountSource`; the v2 `publicSnapshot` allowlist passes it (`workflow-service.js:285`).
   - Cards (V1 `ProposalRankingApp`, V2 `AssessmentWorkflow`) use `amountLabel` (`shared/components/proposal-ranking/model.js`): Invited; Requested + "No invited amount; showing requested amount."; Requested for older snapshots; "Amount Unavailable" when none.
   - Workbook columns are now Amount / Cumulative amount.
   - `/contract-reconcile` pass run; it caught the both-blank label case (`ed88d82cb`). Full Jest 1,440 suites green.
2. **D26 open round corrected in place, without re-ranking.** [VERIFIED via owner-run `--verify`: correction held, D26 active round unchanged, no app activity since the plan]
   - `scripts/probe-ranking-invited-amounts.mjs` (read-only) found 23 ordinary D26 proposals, 2 with invited ≠ requested, and 0 blank. The five ZZTEST requests #1003220–#1003224 are excluded; local `.env.local` has no `TEST_REQUEST_ISOLATION`, so the probe applies the predicate itself.
   - `scripts/correct-ranking-invited-amounts.mjs` + `scripts/lib/ranking-invited-correction.mjs` (13 tests). Plan `7cccbe76` changed #1002821 $1.6M→$1.3M and #1003000 $1.5M→$1.3M, tagged all 23 invited, and appended one `invited-amount-correction` event to `wmkf_administrationlogjson`.
   - Two Codex adversarial-review passes. Pass 1 found that rollback trusted a post-write ETag and that a lost response was unrecoverable; both were fixed in `6c38da155`. Pass 2 approved.
   - Confirmed: the local app identity can PATCH `wmkf_proposalrankingrounds` in production under a same-day write ack and the target interlock.
3. Plan doc, Atlas section and DEVELOPMENT_LOG milestone entry added.

### Commits

- `1553bc0a3`, `ed88d82cb`: invited amount with requested fallback; neutral missing-amount label.
- `c18ae2af5`, `dda2713d4`: read-only invited/requested probe.
- `afed1413f`, `614b05f11`: correction plan.
- `c5a442ac0`, `4a37f2f9b`, `6c38da155`: correction script and review fixes.
- `a7190c848`: applied/verified record.

## Next Items

### Verified Open

- None selected. No owner-chosen next task.

### Optional (owner's call)

1. **Script-level mocked tests for the correction script.** Codex pass 2 suggested them: the current tests cover the decision helpers, not orchestration or `If-Match` wiring.
   Evidence: `tests/unit/ranking-invited-correction.test.js`. Worth doing only if the script is reused for another cycle; its round ID, count and expected changes are D26 constants.
2. **"Amount source" workbook column.** Offered, not requested; the workbook doesn't show which proposals fell back to requested.

### Parked

1. **Confirm-your-details email campaign.** Tabled by the owner 2026-10-24. Evidence: `docs/plans/RESEARCH_INSTITUTION_AT_AWARD_BACKFILL_PLAN_2026-10-20.md` §3.2.
2. **Grant Reporting app sunset** (owner). Any successor that lists investigators should call `fetchCoPIs` (`lib/services/proposal-participants.js`).

### Verify Before Acting

1. **D26 correction rollback** is available only while nobody has written to the round since plan `7cccbe76`: `--rollback --dir="$HOME/Downloads/Ranking D26 invited amounts"` (prod-read flag + same-day ack). It refuses once a PD saves; any reversal then needs a new plan.
   Evidence: plan §4.4.
2. **Owner folders hold sensitive data, keep out of git:**
   - `~/Downloads/Ranking D26 invited amounts/` holds the original snapshot, including reviewer scores.
   - `~/Downloads/Research Co-PI Searches/stage-b-2/` holds names.
3. **Stage B rollback** applies only to writes unchanged since apply. Evidence: `docs/plans/RESEARCH_INSTITUTION_AT_AWARD_BACKFILL_PLAN_2026-10-20.md` §3.4.
4. **Untracked, not session-owned:** `.impeccable/critique/2026-10-19T02-04-42Z__…boardwriteups-js.md` and `output/`. Preserved untouched.

### Do Not Reopen Without New Decision

- D26 amounts: applied and verified. Further changes need a new plan.
- Connor 2024-split confirmation and the §7 note to Connor: retired (owner, 2026-10-23).
- Stage B row decisions: applied and verified.

## Concurrent Workstreams — historical resume index

Prior handoffs: `git show 4105474a1:SESSION_PROMPT.md` (Session 635) and `git show 5ba8efaf2:SESSION_PROMPT.md`. Recorded owner boundaries, not newly verified tasks:

- Personal email defaults: slice 3 shipped (PR #517); slice 2 is plan-first. `docs/plans/PERSONAL_EMAIL_DEFAULTS_INVENTORY_2026-09-24.md`.
- Meeting coordination: owner authorized implementation, bounded rehearsal and controlled production deployment including migrations (2026-10-24). Runtime `d54b8b008` is deployed and migrations 086–089 are applied; all checks including CodeQL passed and owner-authorized ordinary admission is now on. Current activation evidence: `docs/audits/MEETING_ORDINARY_ACTIVATION_2026-10-24.md`; release sequence: `docs/plans/MEETING_COORDINATION_RELEASE_CHECKLIST_2026-10-23.md`.
- J27 / overlapping cycles: proposed; calendar authority and related owner decisions open. `docs/plans/CYCLE_ROLLOVER_MINIMAL_CONFIGURATION_PLAN_2026-10-06.md`.
- Shared roles: PR #516 released; read assignment through config.
- Research Institution at Award backfill: Stages A and B applied and verified. `docs/plans/RESEARCH_INSTITUTION_AT_AWARD_BACKFILL_PLAN_2026-10-20.md`.
- Reviewer panel coverage pilot parked; Expense Reporter as is; Literature Analyzer direction awaits scope.

## Key Files Reference

| File | Purpose |
|------|---------|
| `lib/dataverse/adapters/proposal-ranking-source.js` | Ranking source; invited amount with requested fallback |
| `shared/components/proposal-ranking/model.js` | `amountLabel` for cards |
| `scripts/correct-ranking-invited-amounts.mjs` | D26 frozen-snapshot correction (plan/apply/verify/rollback) |
| `scripts/lib/ranking-invited-correction.mjs` | Pure snapshot rebuild and state-based decisions |
| `scripts/probe-ranking-invited-amounts.mjs` | Read-only invited vs requested comparison per cycle |
| `docs/plans/PROPOSAL_RANKING_D26_INVITED_AMOUNT_CORRECTION_2026-10-23.md` | Plan, safety argument, outcome |

## Testing

```bash
npx jest tests/unit/proposal-ranking tests/unit/ranking-invited-correction.test.js
```

Milestone determination: invited-amount ranking plus the in-place D26 production correction merits a DEVELOPMENT_LOG entry (added). CLAUDE.md requires no change.
