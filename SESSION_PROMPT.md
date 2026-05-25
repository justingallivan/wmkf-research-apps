# Session 188 Prompt: Intake portal UI build (or back to backend backlog)

## ⏰ S186 Phase 0 verification — check these crons before other work

Quick query of `maintenance_runs` for the first post-deploy fire of each (deploy landed ~2026-05-25 18:00 UTC):

- **`daily-maintenance`** — fires 03:00 UTC daily. Want: `status='completed'` with no `cleanupExpiredCache` error in the message, OR if it failed, severity=`error` (not the old masked `info`). First post-deploy fire should be visible by 2026-05-26 03:00 UTC.
- **`sweep-stale-invites`** — fires 09:00 UTC daily. Want: a `maintenance_runs` row exists. First post-deploy fire 2026-05-26 09:00 UTC.
- **`pricing-canary`** — fires Mondays 10:00 UTC. Want: row exists; `records_processed` = distinct-model count, not `unknownCount`. First post-deploy fire 2026-06-01 10:00 UTC.
- **`drain-submissions`** — every 2 min, doesn't write `maintenance_runs`. Tail Vercel logs for the function to confirm no column-doesn't-exist errors. Optional unless intake traffic appears in `submission_jobs`.

`spend-check` already confirmed wiring works in S187.

## Session 187 Summary

S187 closed the Phase B backend-hardening backlog from S186's readiness audit (four chunks shipped through full Codex pre-impl + post-impl cadence) AND unblocked the DR8 applicant-auth flow that smoke-testing surfaced as silently broken in deployed environments.

### What was completed

1. **Drain recordFailure rewrite — items #5+#6+#30** (`0865bbc`)
   - Real exponential backoff: `60 * 2^priorAttempts` capped at 3600s (was always 60s)
   - Per-category `maxAttempts` from `drain-error-classifier.js` `CAPS` now consumed; dead `DRAIN_MAX_ATTEMPTS_DEFAULT` env-var escape hatch removed
   - Retryable failures hitting their category cap emit a post-COMMIT `intake_drain_retry_exhausted` alert (severity=error, autoResolveKey dedup by category)
   - All 16 call sites updated; `recordFailure({job, ...retryable, maxAttempts})` signature; fail-loud guard throws on retryable+missing maxAttempts; `processJob` safety net special-cases the misuse throw shape so a Patch-B regression terminal-fails instead of misclassifying as transient
   - 11 deterministic tests in `tests/unit/drain-record-failure.test.js`

2. **Intake portal rate limiting — item #4** (`415a54d`)
   - New `lib/intake/rate-limit.js` mirrors `lib/external/rate-limit.js` (A6) for OAuth-session-keyed buckets
   - Three buckets per request, ALL must pass: per-applicant per-route, per-applicant aggregate (`...:all`), per-IP
   - Caps: `upload-token`/`attach` @ 20/min; `submit` @ 5/min; aggregate 100/min; per-IP 120/min
   - `draft` autosave gets a DEDICATED per-IP bucket (`intake:ip:<addr>:draft`) so keystroke-debounce can't starve other endpoints
   - Single round-trip multi-row VALUES upsert with composite-PK ON CONFLICT (race-free); opportunistic 2% pruning; fail-open with degraded-alert at 5 consecutive PG failures (autoResolveKey `intake-rate-limit-db-degraded`)
   - Wired into all 4 handler files AFTER session+contactOid extraction, BEFORE any body validation / draft fetch / Blob mint / virus scan / transaction
   - 17 deterministic tests in `tests/unit/intake-rate-limit.test.js` including SQL-shape regression assertion for the multi-bucket upsert

3. **Intake private-Blob GC — item #7** (`dc6057a`)
   - New `MaintenanceService.cleanupIntakePrivateBlobs({retentionHours=72})` sweeps orphan bytes in the `intake-applicant-private` store left after successful drains
   - Active-pathname sources (union of 3 via UNION ALL + JS Set):
     - `intake_drafts.attachments[].pathname WHERE request_id IS NULL` (pre-submit only — Codex pre-impl Q2 catch; otherwise post-submit drafts would keep bytes "active" forever)
     - `intake_drafts.pending_attachments[].pathname`
     - `submission_jobs.payload->'attachments'->>'pathname' WHERE status NOT IN ('completed','failed','cancelled') AND jsonb_typeof = 'array'`
   - Defensive paths: missing token soft-fail, invalid `uploadedAt` skipped, `isBlobNotFound` swallowed as skipped, non-404 errors counted; `{token, prefix:'drafts/'}` on both list/del
   - Wired into daily maintenance cron as step 7.5
   - 12 deterministic tests in `tests/unit/maintenance-cleanup-intake-private-blobs.test.js`

4. **intake_audit retention + retention-override hardening — item #11** (`38343de`)
   - New `MaintenanceService.cleanupIntakeAudit(retentionDays=730)` — forensic-grade 2y retention, Dataverse-overridable via `retention:intake_audit_days`
   - Wired as step 4.5 in maintenance cron (grouped with the other PG time-series DELETEs)
   - **Bonus hardening (Codex post-impl)**: `getRetentionConfig` override parser now rejects 0/negative/NaN values across ALL six retention keys. Before this, a misconfigured `retention:foo_days=0` would translate to "delete everything older than 0 days" = whole-table immediate wipe.
   - 10 deterministic tests in `tests/unit/maintenance-cleanup-intake-audit.test.js`

5. **#10 closed as already-shipped** (`47f4211`)
   - S186 audit item #10 (Dynamics feedback admin surface) had a stale premise. Verified `DynamicsFeedbackSection` in `pages/admin.js:1645` + the `/api/dynamics-explorer/feedback` GET/PATCH endpoint already exists end-to-end. Memory entry written so future audits don't relist.

6. **DR8 surfaced + unblocked** (operator-side, no code changes)
   - Smoke test against preview discovered that **production AND preview were both missing the `entra-external` provider** because the three `EXTERNAL_AZURE_AD_*` env vars had never been deployed (S129 worked locally; never propagated)
   - Tenant verified: WM Keck Foundation Grant Application Portal (`04a1406b-...`), External tier, free 50k MAU well above our pilot scale, "Premium required" and "subscription state" warnings are non-blocking (analytics-dashboard gate + SLA-support-only)
   - App registration `WMKF Grant Application Portal` confirmed in External tenant; Client ID `0677b40a-f9d9-44cd-9d6d-e95921711b7c`; redirect URIs `https://wmkfresearch.vercel.app/api/auth/callback/entra-external` + localhost already configured
   - User provisioned the 3 env vars in Vercel production + fresh client secret; production now returns both `azure-ad` AND `entra-external` from `/api/auth/providers`
   - Justin completed a real OTP round-trip end-to-end: signed in as `nick_sludge.78@icloud.com` (OID `3bba39e3-2712-4c06-ae2a-9646afd3d6ce`), `/apply` welcome page rendered correctly with claims populated
   - **Two UI bugs surfaced during the round-trip, logged for a future UI session** (`.claude-memory/project-intake-portal-ui-todo.md`): sign-out silently re-authenticates via Entra (NextAuth `signOut` only clears the local cookie, not the IdP session); Entra sign-up flow collects irrelevant City/State/DisplayName

7. **Cloudmersive verified** (operator-side)
   - User added `CLOUDMERSIVE_API_KEY` to Vercel production as a sensitive var (correctly — that's why `vercel env pull` shows it empty; sensitive vars are masked from out-of-band retrieval but the runtime value is intact)
   - Local key pulled into `.env.local`; `scripts/smoke-virus-scan.mjs` round-trip green: 7/7 assertions pass including EICAR detection

8. **Repo hygiene closeout** (`01bf89e`)
   - `git mv docs/INTAKE_PORTAL_MEETING_AGENDA_2026-05-13.md docs/archive/` (2 days early; meeting decisions landed in design/schema-changes docs)
   - Updated active references in atlas + IRS memory; left the historical S154 audit doc reference intact
   - Removed the done carryover memory; UI-TODO memory file landed alongside

### Commits

- `0865bbc` — S187 #5+#6+#30: real exponential backoff + per-category cap + retry-exhausted alerts
- `415a54d` — S187 #4: intake portal rate limiting
- `dc6057a` — S187 #7: intake private Blob GC
- `38343de` — S187 #11: intake_audit retention + retention-override hardening
- `47f4211` — S187 session bookkeeping: #10 stale-premise closeout + cron verification reminder
- `01bf89e` — Archive 2026-05-13 intake portal meeting agenda + log UI TODOs

## Open user-action items from S187

None active. Both Cloudmersive (sensitive in prod) and the External ID env vars (3 vars in prod) are wired and verified.

## Potential next steps for S188

S188 has two natural shapes; the choice depends on how Justin wants to spend the session.

### Path A — Start S185 intake portal UI (the big remaining piece)

This is the original deliverable that S186/S187 cleared the path for. With auth shipped (DR8 ✓), all four backend endpoints hardened (rate-limit ✓, drain ✓, virus scan ✓, GC ✓, audit retention ✓), and the form-schema/draft/submit primitives long-shipped (S178/S184), the UI build is fully unblocked.

Justin mentioned wanting to dedicate dedicated sessions to design + UI work. This is that. Naturally folds in the two UI bugs in `.claude-memory/project-intake-portal-ui-todo.md`:

1. **Sign-out doesn't actually sign user out** — UX layer (`/apply/signed-out` no-auto-redirect page) + federated sign-out layer (hit Entra's logout endpoint with `post_logout_redirect_uri`).
2. **Entra "Add details" page collects irrelevant City/State/DisplayName** — portal config fix only (External Identities → User flows → User attributes), no code.

Sub-shapes within Path A:
- **A1** — Design / wireframe / state-machine session for the applicant flow (institution selection, draft staging, attachment upload UX, submit confirmation). Pure design, no code.
- **A2** — Build the institution-selection step (fuzzy-match against existing accounts per memory `project-intake-portal-institution-match.md`; reuse the primitive that's also needed for reviewer affiliation match).
- **A3** — Build the form renderer over the existing form-schema primitive (`shared/forms/phase-ii-research-2026-06/`).
- **A4** — The sign-out fix as a tiny standalone chunk (mostly de-risks the OAuth scaffolding before bigger UI work lands on top).

### Path B — Continue picking off the backend backlog

If S188 doesn't want to be a UI session, there's plenty of non-UI work:

5. **Backend automation vision** — design and build the PowerAutomate-triggered surfaces (interim report auto-eval; staged review pipeline). Multi-session.
6. **Proposal Context Extraction** — pre-extract structured fields so downstream calls use ~1.5K-token curated extracts instead of ~7K-token full proposals. Design doc at `docs/PROPOSAL_CONTEXT_EXTRACTION_PLAN.md`.
7. **Dataverse Power Tools Track B Phase 2** — API + builder UI + Blob on top of the S160 deterministic spine.

### Carryover dates to track in S188

- **W6 reviewer Postgres DROP** — fires ≥ 2026-07-01 (5 weeks out). Drain-only tables `researchers`, `researcher_keywords`, `publications`, `proposal_searches`. Per CLAUDE.md carryover hygiene, will need a pre-flight grep before any DROP.
- **`EXTERNAL_AZURE_AD_*` provisioning for preview deploys** — out-of-scope for pilot but worth noting: Vercel preview URLs are per-deployment, so DR8 testing on preview would 400 on Microsoft's redirect-URI check. For pilot scope, test against prod only.

## Key files reference

| File | Purpose |
|------|---------|
| `lib/intake/rate-limit.js` | NEW — applicant-portal rate limiting (mirrors lib/external/rate-limit.js) |
| `lib/services/maintenance-service.js` | NEW METHODS: cleanupIntakeAudit + cleanupIntakePrivateBlobs; HARDENING: getRetentionConfig override-value guard |
| `pages/api/cron/drain-submissions.js` | recordFailure rewritten; processJob misuse-guard branch |
| `pages/api/cron/maintenance.js` | Steps 4.5 + 7.5 wiring |
| `pages/api/intake/{draft,submit}.js`, `pages/api/intake/draft/{upload-token,attach}.js` | Rate-limit insertion points (after contactOid extraction) |
| `.claude-memory/project-intake-portal-ui-todo.md` | The two /apply UI bugs to fold into a future UI session |
| `.claude-memory/project-dynamics-feedback-admin-shipped.md` | S186 #10 closeout: surface already shipped, don't relist |
| `pages/apply/index.js` | Current applicant landing page (smoke-test only; needs design work) |

## Testing

```bash
# Session-start sanity gates
npm run check:atlas                       # 30 PG / 32 DV ✓
npm run check:api-routes                  # 93 ✓
npm run check:fact-consistency            # registered scalars current ✓
npm run check:migrations-manifest         # 13 files ✓

# S187 new test suites
npx jest tests/unit/drain-record-failure.test.js                      # 11 pass
npx jest tests/unit/intake-rate-limit.test.js                         # 17 pass
npx jest tests/unit/maintenance-cleanup-intake-private-blobs.test.js  # 12 pass
npx jest tests/unit/maintenance-cleanup-intake-audit.test.js          # 10 pass

# All unit tests
npx jest tests/unit                       # 1155 pass, 1 skipped, 63 suites

# Operational verification (preview/prod)
vercel curl https://wmkfresearch.vercel.app/api/auth/providers
# Expect: {"azure-ad":{...}, "entra-external":{...}}

node scripts/smoke-virus-scan.mjs         # Cloudmersive round-trip, EICAR + clean
node scripts/smoke-intake-draft.js        # DB-layer intake primitives
```
