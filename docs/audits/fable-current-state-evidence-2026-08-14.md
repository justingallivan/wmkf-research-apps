# Fable Current-State Evidence — 2026-08-14

**Point-in-time audit artifact** (skeleton; populated during Phases 1–2). Evidence labels per the
legend in `docs/audits/fable-task-ledger-2026-08-14.md`.

## Git/deployment baseline

- Repo HEAD at audit start: `f8a606e6` (`origin/main`); audit branch
  `fable/audit-refactor-planning-2026-08-14`.
- Security-audit baseline commit: `04979f28` (2026-05-21 audit). Docs-truth baseline: `c2b57d07`
  (2026-07-26 audit).
- Deployed production commit: `[UNKNOWN — Phase 2 probe]`.

## Verified system map

Scout 1 (change/system inventory) returned 2026-08-14; Fable sampled/verified the claims below.

- Inventory `[INFERRED from Scout 1 enumeration; commands recorded in scout report]`: 157 API route
  files across 19 subdirs + top level; 20 Dataverse adapters; 29 Postgres migrations (002–029, four
  `drop_*`); 19 vercel.json crons (fastest `*/2`: drain-submissions, drain-reviewer-acceptances);
  ~120 service files; 92 distinct `process.env` reads; 9 behavior flags.
- Change volume: 2,878 commits / 2,525 files since security baseline `04979f28` (2026-05-21);
  653 commits / 944 files since docs baseline `c2b57d07` (2026-07-26). Since the security baseline:
  73 route files were newly added (a delta, not the live total of 157), <!-- fact-consistency:ignore fact=api-route-file-count as-of=2026-08-14 -->
  `lib/utils/auth.js` rewritten by ~half its body, 4 external-token routes
  added + 4 modified, BILL webhook added, cloudmersive virus scanner added, 19 migrations added,
  10 crons added.
- Fable spot-verifications of Scout 1's highest-risk claims:
  - `[VERIFIED via pages/api/webhooks/bill.js:45-73]` signature verification is skipped only when
    `NODE_ENV==='development'` AND no secret; non-dev fails closed on missing secret. Not reachable
    in deployed Vercel environments (NODE_ENV=production/preview builds); low residual.
  - `[VERIFIED via lib/services/multi-llm-service.js:9,276-402]` all four providers (anthropic,
    openai, gemini URL, perplexity) egress through `safeFetch` — Scout 1's unknown #1 resolved: no
    unguarded egress path there.
  - `[VERIFIED via grep of scripts/apply-migrations.js]` the migration runner has no checksum logic,
    so the in-place edits to `005_intake_portal.sql` / `010_external_rate_limit.sql` do not break
    re-runs; residual risk is fresh-install vs historically-applied shape divergence, not runtime.
- Stale-doc deltas surfaced (queue for reconciliation, not yet fixed):
  `docs/DATA_ACCESS_LAYER_MIGRATION_PLAN.md` says 19 adapters, tree has 20 (`request-document.js`
  added post-verification); `docs/CANONICAL_COUNTS.md` scalars need re-derivation against
  157/20/29/19.
- Parallel/mid-flight patterns (Scout 1 §E, sampled): Q9 prefs/app-access DAL migration `active`
  with app-access as the unfinished tail; two AI execution stacks (`llm-client.js` Anthropic-only
  vs `multi-llm-service.js` 4-provider) plus the Executor; 4 sunset-candidate apps removed from nav
  but still routable; 7 flag-gated dual behaviors; vendored `brace-expansion` compat shim.
- Scout 1 top-5 risk surfaces (Fable concurrence pending full fan-in): external token surface;
  `lib/utils/auth.js` churn + `EMERGENCY_AUTH_BYPASS` (24h detection cron); upload/virus-scan chain
  (`VIRUS_SCAN_ENABLED` env-toggleable control, replace-in-place routes); review-synthesis +
  `*/2`–`*/5` drain crons (unattended LLM + Dataverse + email); app-access authorization data
  mid-migration.

## Production probe ledger results

_Pending Phase 2; approvals tracked in the task ledger._

## Data ownership matrix deltas

_Pending; Atlas (`docs/APPLICATION_STATE_ATLAS.md`, last_verified 2026-08-01) is the starting claim set._

## Drift/conflict matrix

_Pending._

## Unknowns

- Current campaign window / release posture: `[NEEDS OWNER]` (restrictive posture assumed).
