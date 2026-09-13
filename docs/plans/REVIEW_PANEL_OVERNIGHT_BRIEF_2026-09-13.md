---
title: Review Panel Phase A — Overnight Build Brief (2026-09-13)
domain: virtual-review-panel
kind: brief
status: in-progress
summary: "Running log of the autonomous overnight Phase A build (Sonnet builds, Opus reviews, Codex adversarial review, Fable orchestrates). Per-slice status, unresolved findings, decisions made on the owner's behalf, and the owner-side commands needed before a smoke run."
cataloged: 2026-09-13
owner: product-engineering
last_verified: 2026-09-13
related:
  - docs/plans/VIRTUAL_REVIEW_PANEL_PHASE_A_BUILD_PLAN_2026-09-12.md
  - docs/plans/EXECUTOR_PROVIDER_SEAM_CODEX_BRIEF_2026-09-12.md
---

# Review Panel Phase A — Overnight Build Brief

> Snapshot log, not ship state. Branch: `feature/review-panel-foundation` (worktree
> `../WMKF_Apps-codex`), cut from `main` at 262f3322 after A0 (PR #280) merged. Nothing here is
> merged to `main`; no Vercel env var, cron entry, migration, or Dataverse seed has been applied.

## 1. Orchestration rules in force

- Sonnet builds one slice at a time in the worktree; Opus reviews each slice against the plan's
  §5 contracts; only **blocking** findings (fail-open, data leak past the input DTO, cost recorded
  as known when unknown, lease/CAS race, decorative test) re-enter the loop. Max two Opus rounds per
  slice, max two Codex rounds total. A finding that recurs after one fix, or that relitigates a
  `[DECIDED]` row in plan §1, is logged in §3 below and not chased.
- Prohibited for every agent: any live Postgres or Dataverse connection (`.env.local` points at
  production), `apply-migrations.js`, seed scripts with `--execute`, rehearsal scripts, `vercel env`,
  `vercel.json` cron edits, merges to `main`.

## 2. Slice status

| Slice | Scope (plan §5) | Status | Commits |
|---|---|---|---|
| 1 | A.5 migration 047 / block v49, store + seat-attempt ledger with both fences, A.4 input DTO, A.2 rollout gates, executor budgets | built (2b714ebf); Opus round 1 = FIX (3 blocking: `known` cost with NULL cents counted as $0, finaliser state unallowlisted, decorative token test); all fixed and spot-checked in source | 2b714ebf, c7c48238 |
| 2 | A.3 prompt seeds + question-set projection (D7), generation service + snapshot builder, A.6 worker + drain route | built; Opus round 1 = FIX (1 blocking: chair `seat_reviews` cap 40k chars below two seats' output, payload boundary truncates silently); fixed: cap derived from 5 seats × 16k tokens × 4 chars × 1.25 = 400k chars and `runChair` refuses before dispatch when exceeded | a0a4a750, 3f6433c4, 78943885, fb5646d4 |
| 3 | A.1 registry/routes/matrix + service layer, A.7 editions in the D11 store + download route, A.8 page, operator retry hand-off, spend-check/admin-stats ledger queries, A.9 docs | built (8 commits, 34 files; all 18 gates green, full unit suite 12,235 green); Opus round 1 = FIX (6 blocking: unknown-cost predicate inconsistent across spend-check/admin-stats/ledger, per-entry report used run-wide cost, two decorative cost tests, no service-level actor-assertion test, retry stuck after partial Blob write); all fixed; Opus recheck round 2 = PASS, no new blocking | 03f96d25 … d46f252e |
| Gates + PR | full gate set sequentially, PR opened, CI watched | all gates green in the worktree; PR #281 open, CI running | — |
| Codex adversarial review | after Opus is satisfied with the whole | running (`gpt-5.6-sol`, `--base 262f3322`, from the worktree) | — |

## 3. Unresolved findings for the owner

Accepted as designed, not fixed (Opus slice 2 review):
- The finaliser's late path stores `late_usage_json` but no `cost_cents`/`cost_state`, so a run with an `unknown_outcome` attempt keeps its total withheld permanently. Conservative; the real spend for those calls is only recoverable from the vendor console.
- The ledger fence tests assert the SQL text the mock receives (`clock_timestamp()`, `dispatch_token=$2`), not database behaviour. A live rehearsal against a scratch database would be the behavioural proof.
- Spend-check window: the panel ledger sums on attempt `created_at` (pre-dispatch) while `api_usage_log` stamps post-response, so a call straddling midnight can land on the prior day in one half of the daily total. Cosmetic for an hourly threshold alert.
- `readReviewPanelEntry` is not owner-scoped while run listing is. Consistent with the dossier's "shared across active superusers" posture; flagged only for consistency.
- Migration 047 was edited in place during the build (`retry_requested_at` added to the CREATE TABLE). Safe only because 047 has never been applied anywhere. Do not apply an older copy.
- Ledger edge: if a seat attempt is stuck `pending` (crash between create and dispatch) while a sibling seat fails, a retry mints a second `pending` row and the first stays `pending` forever. Harmless (no token, no cost), just dead weight.

## 4. Decisions made on the owner's behalf

- **Smoke-mode cohort cap = at most four requests** (the dossier's smoke mode requires exactly one). Sonnet inferred it from D6 "two to four"; kept because the owner asked for a small subset, not a single request.
- **No `cycle` column on `review_panels`** (the dossier pins `cycle='D26'`). The plan does not tie the panel to a cycle. Revisit if cycle scoping is wanted.
- **Per-seat winners stored as `winners_json` (JSONB map) on the entry**, not a `winner_attempt_id` column (a single column cannot hold one winner per seat). Atlas page to record it.
- **Executor budgets `review-panel.seat` / `review-panel.chair` use `kind: 'timeout'`** with envelopes cloned from `cycle-dossier.entry` (60–220s, default 200s), because a prompt-bound kind would block budget publication before the prompt rows are seeded. Re-derive once the worker lease length is fixed.
- **Entry inputs (the narrative DTO) live in Postgres JSONB (`review_panel_entries.data.input`)**, not in the D11 Blob store; the dedicated store holds the DOCX/PDF editions only. Narrative is bounded at 100k chars so the row stays small.
- **Operator retry is a durable hand-off**: the route marks failed entries `retry_requested_at` and re-queues the run; the worker performs the retry under its lease. The route never touches the ledger.
- **Seat answers to picklist/multiselect questions are validated as string enums** because the Executor's output-schema validator only supports enums on string types.
- **Chair input cap = 400,000 chars** (5-seat ceiling × 16,000 output tokens × 4 chars/token × 1.25 headroom), with a hard refusal in `runChair` rather than the payload boundary's silent truncation. Larger than needed today; the guard is what matters.
- **Report editions are rendered by the worker at entry completion** (not lazily on download), because entry mutations need the run lease that a route request never holds.
- **Two stop affordances**: `action: 'stop'` cancels one run; the global operator stop pauses the worker. Names were not specified in the plan.
- **Run status is finalised once every entry settles** (`completed`/`failed`/`partial`) so the retry fence can open.
- **Ledger cost columns are `cost_cents` + `usage_json`**, not the plan's `input_tokens`/`output_tokens`/`cost_usd`; spend-check and admin-stats queries are written against the real shape.

## 5. Owner-side steps before a smoke run

Filled in at the end of the build: migration command, prompt seed command, Blob store provisioning,
`! vercel env add` lines, `vercel.json` cron line, `VRP_ALLOWED_PROVIDERS` update.
