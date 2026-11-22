# Vercel hosting manual checks — implementation and release prerequisites

Status: branch implementation, not published or deployed. Migration 110 is prepared
and tested in scratch Postgres, not applied to production. The dedicated account
credential is not provisioned. Both ordinary Claude Opus OAuth reviews approved; no blocking findings remain.

## Scope and contract

Owner: Codex, branch `codex/vercel-service-checks`, based on merged OpenAI PR #672.
The existing `vercel-hosting` row gains the manual action. Public Pro-plan references
and supported Node.js/retirement guidance work without credentials; optional usage
reads the public FOCUS billing endpoint for the explicitly configured team.

| Invariant | Producer → persistence → consumer | Verification |
|---|---|---|
| Only superusers can run a check; no client target URL or credential | Existing POST auth/closed body → allowlisted claim → fixed GET collectors | Existing route suite and Vercel allowlist test |
| Failed sources never replace successful baselines | Independent collectSource outcomes → fenced latest JSONB → dated unavailable evidence | Collector regression tests, existing orchestrator tests |
| Checks do not change reviews, service versions or provider settings | Existing lease/store only → existing Admin results/draft | Scratch PG and UI tests; no PUT in Vercel UI test |
| Existing snapshots survive allowlist expansion | Migration 110 → five supported IDs → unchanged read/claim/finish contract | Scratch upgrade rejection/preservation and Vercel persistence test |
| Billing totals are not prices, quotas or invoices | Explicit service/unit/category projection → bounded aggregates → labeled FOCUS effective cost | Signed corrections/null subscription quantity tests and live response projection |
| No account identity or raw response retention | Fixed server team/token → aggregate only, team hashed in fingerprint | Tests put identity/tags/secrets in response and prove exclusion |

The existing client generation/abort guards cover late success/failure and selection
changes. The one-minute reuse, 90-second fenced lease, 35-second collector deadline,
12-second HTTP deadline and 200,000-byte stored-snapshot cap remain unchanged.
The billing response alone is capped at 8 MiB; all other sources retain 1 MiB.
Billing also caps 12,000 rows and 200 service/unit/category groups, displaying the
20 highest-cost active groups while retaining the total across all groups. Unknown
currencies/categories, malformed/empty/truncated/oversized data remain unavailable.
Signed quantities/costs are retained as corrections; Purchase rows with explicit
null quantity and unit say “quantity not supplied,” never zero. Runtime checks use
only the process executing the check; they do not verify every deployment/build.

Helper audit: `boundedFetch` gained a caller-supplied cap, with its existing default
preserved; only the fixed Vercel billing collector uses the larger bound. No runtime
source accepts a user-supplied URL or cap. All unknown service IDs still reject.
No new route, table, cron, automatic alert, LLM call, provider write, billing purchase,
or human-review acknowledgment was added. Fresh installs replay the manifest.

## Evidence and limits

- All startup gates passed sequentially, including their self-tests.
- 134 focused tests across seven suites passed, including 24 scratch-Postgres
  tests and 17 UI tests. The UI test covers partial success, saved-result reload,
  unsaved draft creation and exclusion of the separate Blob inventory row.
- Production build and type check passed. Scoped ESLint returned no errors and two
  pre-existing effect-state warnings in the unchanged component effects.
- Migration manifest, Atlas, API-route, documentation currency/symbol, secret and
  fact gates plus available sequential self-tests passed.
- `node scripts/probe-vercel-service-checks.cjs` exercised the actual public
  collectors successfully against live Markdown on 2026-11-21. The default probe makes no account calls, loads no environment files, and never connects to the database or writes a snapshot.
- Vercel CLI read-only project inspection confirmed `wmkf_research_apps` under the
  intended owner with Node.js project setting 22.x. The local collector process ran
  Node.js 26.x; both were in the current public supported list. Neither establishes
  the new feature's hosted runtime behavior.
- The same probe with explicit `--cli-scope=<verified-team-slug>` uses a CLI-authorized GET `/v1/billing/charges` for seven days returned about 4.2 MiB.
  Its live response was passed offline through the actual collector, replacing only
  fetch with that response and using dummy credential/target values. Projection
  passed after adding signed-adjustment and null-quantity subscription handling.
  This proves response compatibility, not app-token authorization. No CLI credential
  was read, exported or copied into the application. Raw billing records and private
  figures are not committed.
- The CLI's current usage command reads a different gross-cost API. This collector
  deliberately labels FOCUS `EffectiveCost` and does not equate it to CLI gross cost,
  a final invoice, remaining quota, or available credits.

## Claude Opus OAuth review

The first ordinary Claude Code Opus review used the verified `claude.ai` subscription
session, read-only tools, and no provider API-key authentication. It approved with
no blocking source findings. It could not run tests or inspect git directly.

Follow-ups implemented: legitimate signed billing corrections and null-quantity
Purchase rows (discovered independently in the live payload); explicit incomplete/
lagging-data wording; a scope-only usage label (“Usage refreshed — no spend
comparison”); a source link to the public FOCUS API announcement; actionable setup
and size/row-limit errors; valid over-limit payload tests, a row-bound test, abort
coverage, and UI assertions that prove a GET reload rather than re-reading POST
content. The separate Blob page assertion now establishes navigation before
checking that the action is absent. Only runtime support/retirement links contribute
to the runtime notice fingerprint; changes to those links can need review.

Remaining limits: a syntactically valid provider stream ending at a row boundary
cannot establish completeness; billing buckets may lag or be partial; unknown
FOCUS categories/currencies remain unavailable; growth beyond the configured
bounds needs a reviewed adjustment. No quota or invoice inference is made.

The focused follow-up also approved with no blocking findings. It traced the new
scope-only label through result serialization, JSONB persistence, GET reload and UI
rendering, and confirmed that the stronger limit/reload tests exercise the intended
failure mechanisms. Neither reviewer independently ran tests. The orchestrator ran
the scratch database, source/UI tests, final production build and gates. Cosmetic
limits remain: signed fractional corrections can display rounded zero; review drafts
include the raw comparison status alongside the explanatory summary. No Ultrareview
or direct model API was used.

## Release prerequisites

1. Review and publish the feature branch through the normal PR process; both Opus reviews are complete.
2. Apply migration `110_vercel_service_checks.sql` through the canonical existing-DB
   runner before deployment, after checking that it is the intended pending migration.
   Preserve current snapshots; no data reset or fresh-install script.
3. Publish/release through the normal PR checks. No production deployment occurred
   in this build. Runtime rollback can leave the expanded constraint in place.
4. Public references can run without account setup. If account usage is desired,
   securely configure the dedicated server-only `VERCEL_SERVICE_CHECK_TOKEN` and
   `VERCEL_SERVICE_CHECK_TEAM_ID` per the Credentials Runbook, then redeploy. A
   team-scoped token may have broader permissions than this read-only consumer.
5. Run the Vercel hosting action in signed-in Admin and reload saved results. Missing
   account setup must remain visibly unavailable while public references succeed.
   A completed human review and changes to hosting settings remain separate actions.

## Scoped documentation reconciliation

Vercel implementation facts are recorded in the Atlas service page, credential
runbook, env example, source headers and this receipt. Historical provider release
receipts remain historical evidence. This is not a whole-repository documentation
freshness claim; the prior OpenAI release-status statements in the large catalog and
Atlas index have not been reconciled by this Vercel build.
