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

- Inventory `[INFERRED from Scout 1 enumeration; commands recorded in scout report]`: 157 API route <!-- fact-consistency:ignore fact=api-route-file-count as-of=2026-08-14 -->
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

## Production probe ledger — owner hand-off (Phase 2)

Standing rule `feedback-never-self-authorize-prod-dataverse-reads` applies: Fable does NOT run these
against production. Each is read-only and inspected; **Justin runs them** (or approves + hands the
signed-in run). The architecture verdict does NOT depend on these — they confirm current-state facts
and answer the residual unknowns, they do not change the plan.

| # | Question | Command / method | Read-only proof | Who runs |
|---|---|---|---|---|
| 1 | Live Dataverse schema/counts vs Atlas; target classification | `node scripts/audit-dataverse-state.js` | `[VERIFIED — only POST is the OAuth token request (`:31-33`); all entity access is GET/query; Atlas documents it read-only]` | Justin |
| 2 | Applied migrations + live table/queue distributions | `node scripts/audit-postgres-state.js` | `[VERIFIED — no INSERT/UPDATE/DELETE; 9 read/SELECT sites, 0 write-shaped ops]` | Justin |
| 3 | Deployed production commit + per-env app ownership | Vercel dashboard / `vercel inspect` | read-only dashboard | Justin |
| 4 | Presence (not values) of `DATAVERSE_TARGET_INTERLOCK`, `DATAVERSE_DAL_ENFORCEMENT`, `UPLOADS_BLOB_RW_TOKEN`, `VERCEL_API_TOKEN` | Vercel env UI (presence only) | read-only; never print values | Justin |
| 5 | Recurring route/runtime errors + durations in prod | Vercel logs (aggregate) | read-only | Justin |
| 6 | Branch-protection required checks on `main` (does the e2e path-filter leave a permanently-pending required check?) | GitHub repo settings / API | read-only | Justin |
| 7 | Is alert-recipient config in `wmkf_appsystemsettings` populated? | included in probe #1 output or a scoped `$select` | read | Justin |
| 8 | **T2 exposure sizing:** do any live requests have `wmkf_respondreminderenabled` / `wmkf_reviewduereminderenabled` = true (the only remaining gate on the armed reminder cron)? | scoped `$select` count on `akoya_request` | read | Justin |

Resolved from source (no probe needed): drain lease protection PRESENT; 8 new routes all in the
security matrix; multi-llm egress via safeFetch; migration runner has no checksum; DAL context has no
memoization.

## Data ownership matrix deltas

_Pending; Atlas (`docs/APPLICATION_STATE_ATLAS.md`, last_verified 2026-08-01) is the starting claim set._

## Drift/conflict matrix

Scout 4 (tests/gates/operability) returned 2026-08-14; Fable-verified structural finding below.

- `docs/CI_GATES_REFERENCE.md` is materially accurate on gate→CI mapping, with omissions: the
  session-stop hook has three blocking behaviors independent of `CLAUDE_STOP_GATE_MODE`
  (agent-invariant regression, unresolved doc-staleness, missing review receipts); `check:memory-router`
  and `check:scaffolding-tokens` also run as PreToolUse(Write/Edit) blockers.
- **[VERIFIED via grep test.yml + empty .git/hooks]** `check:status-enum-parity` and
  `check:trust-boundary-guid` are absent from all GitHub workflows and there are no local git hooks —
  they run only inside Claude Code sessions. Recorded as a security finding in the security-audit doc.
- `docs/SECURITY_OPERATING_PLAN.md` (last substantive update 2026-05-05) is materially drifted: it
  omits ~12 security controls shipped since (DAL LAW gate + enforcement flip, target/write interlock,
  trust-boundary-guid, route-service/odata/context/route-lifecycle LAW gates, secret-scan + gitleaks/
  trivy/semgrep workflows, branded-domain CSRF pinning, rate-limit alerting, private-blob migration,
  A7 tagging, model-registry gates, send-time token minting, campaign release strategy). It still says
  "hardening tranche complete" and its frontmatter summary is corrupted. Queue for `/sweep`.
- Test posture: 591 unit / 31 integration / 4 e2e; Jest coverage thresholds commented out;
  `collectCoverageFrom` excludes `lib/**` (where DAL/interlock/token/drain logic lives). All 4
  Playwright specs route-mock at the browser. No integrated rehearsal path for any external-user
  journey; sandbox lacks reviewer schema (404s) so non-prod reviewer rehearsal is campaign-gated.
- False-confidence risks (Scout 4): e2e is path-filtered so `lib/services/**` changes ship without the
  suite on the PR; Semgrep broad SAST is `|| true` advisory; Trivy has no `exit-code` (reporting, not
  gate); gitleaks skips dependabot PRs; commit guards only bind inside Claude Code and fail open.

## Unknowns (production-answerable — Phase 1 exit list)

Questions source alone cannot settle, carried to the Phase 2 probe question list (all read-only,
owner-executed for production Dataverse):

1. Deployed production commit and per-environment app ownership (Vercel).
2. Live values/presence of `DATAVERSE_TARGET_INTERLOCK`, `DATAVERSE_DAL_ENFORCEMENT`,
   `UPLOADS_BLOB_RW_TOKEN`, `VERCEL_API_TOKEN` (presence only, never values).
3. Whether the `*/2` drains have overlapping-invocation lease protection (read migrations
   009/011/024/028 + drain claim logic — source-answerable, do first).
4. Whether the 8 routes added since the docs baseline are all in the security matrix and covered by
   `check:api-routes` (source-answerable).
5. Recurring route/runtime errors and durations in production logs (aggregate only).
6. Branch-protection required-checks on `main` (GitHub settings — owner/API).
7. Whether alert-recipient config in `wmkf_appsystemsettings` is populated (Dataverse read).

## Unknowns

- Current campaign window / release posture: `[NEEDS OWNER]` (restrictive posture assumed).
