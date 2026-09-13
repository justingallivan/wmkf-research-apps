---
title: Review Panel Phase A — Overnight Build Brief (2026-09-13)
domain: virtual-review-panel
kind: brief
status: complete
summary: "Running log of the autonomous overnight Phase A build (Sonnet builds, Opus reviews, Codex adversarial review, Fable orchestrates). Per-slice status, unresolved findings, decisions made on the owner's behalf, and the owner-side commands needed before a smoke run."
cataloged: 2026-09-13
owner: product-engineering
last_verified: 2026-09-13
related:
  - docs/plans/VIRTUAL_REVIEW_PANEL_PHASE_A_BUILD_PLAN_2026-09-12.md
  - docs/plans/EXECUTOR_PROVIDER_SEAM_CODEX_BRIEF_2026-09-12.md
---

# Review Panel Phase A — Overnight Build Brief

> **Morning status (2026-09-13): PR #281 is open, reviewed, and ready for the owner's merge decision; nothing is deployed or configured.** Snapshot log, not ship state. Branch: `feature/review-panel-foundation` (worktree
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
| Gates + PR | full gate set sequentially, PR opened, CI watched | all gates green in the worktree; PR #281 open, every CI check green (Jest, Semgrep, Trivy, Vercel preview, claude-review) | — |
| Codex adversarial review | after Opus is satisfied with the whole | round 1 = needs-attention: 4 blocking (per-click idempotency key can double-launch; worker never re-asserts run owner before paid calls; Blob store readiness checked only after paid work and store id never enforced; spend alert ignores unknown attempts) + 1 decorative SUM test. All fixed in 5353a314 (CI green). Opus recheck: fixes confirmed, but the fix introduced two regressions (owner-revocation 403 mid-pool strands sibling entries in a failed run; unknown-cost alert shares the dedupe key with the threshold alert) plus one decorative test. Final Sonnet round 05e14957 fixed all three; Opus recheck PASS on substance, sole leftover (stale six-writers comment + one test assertion) fixed by Fable directly in 72dd40dd. **Loop closed.** Post-loop guard: ledger reads tolerate a missing table (`42P01` → "not migrated"), 94d9ada0. Branch = 28 commits; PR #281 CI green on every commit through 94d9ada0; main CI green on the brief/handoff commits | 5353a314, 05e14957, 72dd40dd, 94d9ada0 |

## 3. Unresolved findings for the owner

Review chain: 3 Opus slice reviews (FIX → fixed → rechecked), 1 Codex adversarial round (4 blocking, all fixed), 2 Opus rechecks of the fix commits (one regression pair found and fixed). No finding was rejected as relitigating a decision. Items below are logged, not fixed:

- **D11 store identity is presence-checked, not proven.** Launch and every paid dispatch now require both `REVIEW_PANEL_BLOB_READ_WRITE_TOKEN` and `REVIEW_PANEL_BLOB_STORE_ID` and refuse a token shared with any other store, but no code derives the store id from the token. The dossier proves identity with an authenticated read-only probe in `scripts/check-cycle-dossier-rollout.js`; a `check-review-panel-rollout.js` clone is the natural follow-up before the smoke run.
- **Rollout mode default is `pilot` when unset** (dossier precedent). Set `REVIEW_PANEL_ROLLOUT_MODE=smoke` explicitly.
- **Cost `known` on the success path relies on `usageComplete` only**; `paidCall` is not on the Executor's success return. Error path requires both. Safe by construction today; noted as a coupling to the Executor.
- **A worker-side D11 misconfiguration pauses the drain with an error log rather than a cron 503**, so it is visible in logs, not in the cron response.

- **Post-loop advisor finding:** the ledger reads in `spend-check.js` and `admin/stats.js` were unguarded against the table not existing yet (merge-before-migrate window). Fixed in 94d9ada0: both tolerate `42P01` (undefined table) with a "not migrated" state and the unknown-cost alert cannot fire on it; other errors still propagate. §5 also now orders the migration before the merge.
- **Process slip:** one Codex companion invocation with `--help` was parsed as review text and ran an empty adversarial review against `main` without `--model gpt-5.6-sol`. Harmless (no diff), one wasted Codex turn.

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

Nothing below has been done. Order matters; each step is the owner's call. PR: https://github.com/justingallivan/wmkf-research-apps/pull/281

1. **Apply migration 047 to the production database FIRST** (existing-DB path, never `setup-database.js`). It is additive (five new tables), so it is safe ahead of the code, exactly as 046 was:
   ```bash
   node scripts/apply-migrations.js
   ```
   Reason for the order: the spend-check cron and the admin stats endpoint on the branch read `review_panel_seat_attempts`. A late fix on the branch makes both tolerate a missing table (see §2), but applying 047 first removes the question entirely.
2. **Merge PR #281** once CI is green and the findings in §3 are acceptable. `main` auto-deploys; the panel stays dark until `REVIEW_PANEL_ENABLED=true`, and the drain cron is not scheduled.
3. **Provision the dedicated private Blob store (D11)**, following the runbook's dedicated-store procedure (decline the auto-link prompt, which would overwrite `BLOB_READ_WRITE_TOKEN`):
   ```bash
   vercel blob create-store wmkf-review-panel-private --access private
   ```
   Then copy the RW token from the dashboard and set it, plus the store id the dashboard shows, per environment:
   ```bash
   ! vercel env add REVIEW_PANEL_BLOB_READ_WRITE_TOKEN production
   ! vercel env add REVIEW_PANEL_BLOB_STORE_ID production
   ```
   Record the store id in `docs/CREDENTIALS_RUNBOOK.md` rows 102-103 and 308 (currently "NOT yet provisioned").
4. **Provider key and allowlist.** `OPENAI_API_KEY` must exist in production (runbook row 83 lists it as open). `VRP_ALLOWED_PROVIDERS` must contain both `claude` and `openai` (comma-separated; the panel maps `claude` to the Anthropic transport). The chair is Claude, so `claude` is mandatory.
   ```bash
   ! vercel env add OPENAI_API_KEY production
   ! vercel env add VRP_ALLOWED_PROVIDERS production      # value: claude,openai
   ```
5. **Rollout flags** (readable config, not secrets):
   ```bash
   ! vercel env add REVIEW_PANEL_ENABLED production            # true
   ! vercel env add REVIEW_PANEL_ROLLOUT_MODE production       # smoke
   ! vercel env add REVIEW_PANEL_REQUEST_ALLOWLIST production  # comma-separated request ids or numbers for the subset
   ```
   Smoke mode admits at most four allowlisted requests and requires exactly one selection per launch.
6. **Seed the two governed prompts** to Dataverse (writes; the target interlock must be enforcing):
   ```bash
   node --import ./scripts/lib/use-extensionless.mjs scripts/seed-review-panel-prompts.js --dry-run
   node --import ./scripts/lib/use-extensionless.mjs scripts/seed-review-panel-prompts.js --execute
   ```
   Then confirm the seat and chair model slots in the admin model panel (defaults `claude-fable-5-1`, `gpt-5.6-sol`, chair `claude-opus-5`; D10 said the OpenAI id will probably change).
7. **Schedule the drain cron** (a tracked commit to `vercel.json`, Tier 2, mirroring the dossier entries):
   ```json
   "pages/api/cron/drain-review-panels.js": { "maxDuration": 300 },
   { "path": "/api/cron/drain-review-panels", "schedule": "* * * * *" }
   ```
   Without this the panel accepts launches but never runs them.
8. **Smoke run** on one allowlisted request from `/review-panel`; read the per-request cost line in the report and the `review_panel_seat_attempts` rows for the D6 actuals. Old `panel_reviews` and the `virtual-review-panel` page are untouched (D5).
