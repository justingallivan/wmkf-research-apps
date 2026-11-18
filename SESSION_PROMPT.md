# Session 682 Prompt: Recommendation to Chairs in Production (Stage 1), plus carried prompt items

## Session 681 Summary — 2026-11-18 (Claude)

Owner worked through admin-panel System Alerts, then the Factory and J27 status flow.
Everything below is on `main` and pushed (Production deploys on push).

### What Was Completed

1. **Fable 5.2 reviewed into the model registries** (canary alert "1 newer Claude
   model id need review"). Capability entry mirrors 5.1; pricing $8/$40, cache reads
   0.025x. Fable 5.1 cache-read price corrected to 0.025x (Fable 5 stays 0.1x, per the
   pricing page). The `fable` tier now resolves to 5.2 from the live list; fallback ids,
   the global discovery cutoff and the review-panel seat (pinned 5.1) unchanged.
   New `scripts/draft-model-registry-entry.js --model=<id>` drafts entries (never edits
   source; `reviewedAt: 'UNREVIEWED'` fails `check:model-registry`); runbook
   `docs/MODEL_CHANGE_STRATEGY.md` §5. The alert should auto-resolve at the 2:00 AM canary.
2. **Board-notice false alerts fixed** (alert "D26: board_calendar_unavailable"). The
   alerted notice had been sent Oct 31; sent president notices stay listed hourly and
   `deliverNotice` read the calendar before checking `acceptedAt`. Now it returns first;
   the worker auto-resolves calendar and notice alerts on success. Read-only probe
   `scripts/probe-board-notice-state.mjs [--cycle=D26]` (owner-run, app Postgres).
   Atlas `docs/atlas/postgres-board-writeup-runs.md` updated.
3. **Factory auto-prepare (D72).** When the admin page finishes a production run, Prepare
   for review starts on its own; the Start line warns beforehand (Invited may create a
   draft email and GoApply tracking row; readiness can't be undone). Older or begun runs
   still wait for the button; a Stop during the last step withholds it (Codex P2 fix).
   Codex review run (`/codex:review`, branch vs main). Owner: Connor doesn't need
   unprepared test requests for his flow testing. Runbook
   `docs/TEST_REQUEST_FACTORY_FORM_RUNBOOK.md` step 5.
4. **Keywords list source recorded** (Connor via owner): the Keywords table
   `wmkf_programlevel3`, not seeded yet, with grouping columns for reporting. Field map,
   PA handoff and the decision list below.
5. **Plan written** `docs/plans/J27_CHAIRS_RECOMMENDATION_PRODUCTION_PLAN_2026-11-18.md`:
   move the sandbox-only Recommendation to Chairs step, a test-request shortcut to Invited,
   and the automatic Integrity Screen to Production. Owner decisions recorded in it.

### Commits
- `da9eb5492`, `272c3e866`, `6d46ee32b` Fable 5.2 registry review, draft script, pricing fix
- `cb18f4570` keyword list source
- `5e37d9284` board-notice alert fix and probe
- `c843fe0ea`, `cb336d9fa`, `54296ee43`, `1b4519319` Factory auto-prepare (D72), Codex fix
- `281ef706b` Recommendation to Chairs Production plan
- Session close commit (this handoff, pilot observation row)

No DEVELOPMENT_LOG entry: maintenance fixes and a small Factory feature, no milestone.

## Next Items

### Verified Open

1. **Recommendation to Chairs in Production, Stage 1** (owner wants it; PDs record
   recommendations Dec 9 to Feb 3). Start from the plan above: run `/contract-reconcile`
   on it, then build Stage 1 on a branch. Key facts in the plan: the step is gated by the
   sandbox-only `initialAssessmentRationaleEnabled()`; the save accepts only sandbox Factory
   requests; Production Factory runs live in the separate ledger (`TEST_REQUEST_LEDGER_URL`).
   Stage 2's shortcut must run as a background workflow (status steps wait up to 10 min).
2. **Migration 096 on the Production app database** (needed for Stage 3, the automatic
   screen): owner-run read-only check of `schema_migrations`. Unknown today.
3. **Note to Connor (owner to send):** prompts are v2 (8192 tokens); the flow should skip
   `intake.personnel` or stop intake when there is no PI row. Evidence:
   `docs/plans/INTAKE_PROMPT_ADMIN_ENTRIES_2026-11-17.md` decision 4. Not confirmed sent.
4. **Review Connor's first real-proposal run** (owner-run):
   `DATAVERSE_ALLOW_PROD_READS=yes node scripts/probe-intake-prompt-outputs.cjs --target=prod --request=<n>`.
   Check Personnel quality and the Methodology sentence count.
5. **Trial cleanup batch 2** after 2026-11-23 18:31:58 UTC: refresh the Preview OIDC token,
   run the parked runner's `expire` mode once; expect `disabled`. Commands:
   `docs/plans/PA_PROMPT_DELIVERY_HANDOFF_2026-11-16.md` (batch 2). Receipts stay.
6. **Test request 1003528** is at Phase I Invited / Phase II Pending Committee Review (Peer
   Review). To test Initial Assessment, the owner can set Phase I back to Pending Committee
   Review under More options on Admin → Test Requests; untried whether Dynamics accepts it
   with Phase II set. Factory runs are in `managed-ledger/ledger_prod` [ASSUMED from the
   Production form's ledger; not re-read this session].

### Owner Decision Needed

1. Intake prompts (Beth meeting 2026-11-17): rationale versions (field map decision 1);
   flags JSON vs child table (decision 2); open-questions list. Keywords now come from
   `wmkf_programlevel3` (not seeded; columns unread). Then draft Rationale, Flags,
   Keywords and Open questions prompts.
2. Stage 3 go: the automatic Integrity Screen makes paid search and model calls per
   recommended request; owner authorizes before `AUTOMATIC_INTEGRITY_SCREENING=on`.
3. Open with Connor/Sarah: on Feb 24 does the Grants Manager set Phase II Status or only
   Request Status (D39 vs `lib/services/workbench/j27-read-model.js:239-241`).

### Parked

1. Backend prompt adoption/scheduling (parked branch
   `codex/executive-summary-generation-2026-11-16`). Re-open only on owner decision.

### Verify Before Acting

1. Local branches `claude/fable-5-2-registry-review`, `claude/board-notice-alert-hygiene`,
   `claude/factory-auto-prepare` are merged into `main`; deleting them needs the owner's
   go (list and confirm first).
2. Current prompt versions/consumers before any new intake prompt version.

### Do Not Reopen Without New Decision

1. Replacing Connor's runner, requiring staff-edit flags, merging the backend branch.
2. Factory auto-prepare target pair (Invited + Phase II Pending Committee Review) stays;
   the owner chose the Workbench shortcut route over changing it (2026-11-18).

## Preservation and other streams

Prior handoffs: `git show 281ef706b:SESSION_PROMPT.md` (Session 681),
`git show b8b2cb7a1:SESSION_PROMPT.md` (679), `git show 57eb7c40f:SESSION_PROMPT.md`
(multi-stream). Historical observations are not fresh permission or live state.

| Stream | Owner / resume source | Boundary |
|---|---|---|
| J27 Workbench | This handoff + `docs/plans/J27_CHAIRS_RECOMMENDATION_PRODUCTION_PLAN_2026-11-18.md`; `docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md` | Each Production stage needs owner go; intake checks ~Dec 5 and post-intake cleanup need current verification |
| Intake prompts (Connor PA) | `docs/plans/PA_PROMPT_DELIVERY_HANDOFF_2026-11-16.md` | Owner publishes prompts; backend stays parked |
| Expertise roster | Codex; branch's own latest notes | Production release not authorized |
| J27 Factory / reports | Prior multi-stream handoff | Preserve worktrees, fixtures, exports and branches |

Never set `DATAVERSE_ALLOW_PROD_READS` yourself; hand Production reads to the owner.
Never read main `.env.local`. `/private/tmp` paths are volatile.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/plans/J27_CHAIRS_RECOMMENDATION_PRODUCTION_PLAN_2026-11-18.md` | Next build: Recommendation to Chairs, shortcut, screen |
| `lib/services/workbench/scoring-service.js` | Chairs recommendation save (sandbox gate) |
| `lib/services/workbench/j27-integrity-jobs.js` | Automatic screen queue (sandbox gate) |
| `docs/TEST_REQUEST_FACTORY_FORM_RUNBOOK.md` | Factory form, auto-prepare (step 5) |
| `scripts/draft-model-registry-entry.js` | Draft registry entries for a new Claude model |
| `scripts/probe-board-notice-state.mjs` | Read-only board notice/alert probe |
| `docs/plans/J27_WORKBOOK_FIELD_MAP_2026-11-16.md` | Workbook → Dynamics fields, keywords source |

## Testing

```bash
npx jest --testPathPatterns "(board|test-request|model|pricing)"
npm run check:model-registry && npm run check:model-registry:self-test
```
