# Session 186 Prompt: Battle-readiness review of the backend before user-facing work

## Mandate

**Act as a senior engineer with a clear and critical eye. The
user has been doing behind-the-scenes work for many sessions and
has not been able to exercise the backend directly. Before any
user-facing UI work resumes (the S185 carryover was the applicant
intake form), every load-bearing backend surface should be
audited for "ready for battle" — not just "passes unit tests" or
"the gates are green."**

The S185 audit pass restored documentation/memory/atlas ground
truth. This session's mandate is the next layer down:
**operational/code/database ground truth**. The threat model is
"a real user hits this flow tomorrow morning" — not "the test
suite passes."

## Mode

1. **Investigation first.** Read source, run probes, exercise
   real endpoints where safe. No code edits in the first half of
   the session.
2. **Produce a prioritized findings list.** Group by class
   (correctness / latent bugs / undocumented drift / operational
   gaps / dead code). Tag each finding with confidence
   (CONFIRMED / SUSPECTED / WORTH PROBING).
3. **Get explicit user approval** before executing any
   non-trivial fix. Some findings will need to be triaged to
   future sessions; not all need fixing in S186.
4. **Then execute** the items the user greenlights.

## What "ready for battle" means

A senior engineer looking at this would ask, for each load-bearing
surface:

- Has this been exercised end-to-end **recently**, or has it just
  been "shipped" weeks ago and untouched since? Stale-but-shipped
  is the biggest hazard.
- If a real user hits this flow at 9 AM Monday, does it work? What
  fails and how loud is the failure? What's the recovery path?
- Are the audit/observability hooks actually being read by anyone?
  An alert into a table no one queries is not an alert.
- Is the production env genuinely configured? Are secrets set?
  Have we verified, or just listed them in `CREDENTIALS_RUNBOOK.md`?

## Review buckets

### 1. Load-bearing backend surfaces that haven't been exercised end-to-end recently

These are systems that have shipped but may not have been
touched live in the past 2-4 weeks. Each needs an end-to-end
smoke OR a confidence-justifying read:

- **S184 three-call attach dance** (`pages/api/intake/draft/upload-token.js`,
  `/attach.js`, `MaintenanceService.sweepIntakePending`,
  `/submit` A1 guard). Unit-tested ~200 cases. **No integration
  test against real Blob + real Postgres + real Cloudmersive.**
  Worth a real-environment smoke before any UI work calls it.
  Specifically check: cardinality SQL gate's EvalPlanQual behavior
  in real Postgres, orphan-sweep race against `/attach.promoteToClean`,
  virus-scan timeout handling, idempotency under retry.
- **Drain submission cron** (`pages/api/cron/drain-submissions.js`).
  Handlers built for `queued→scanning→request_created→files_moved
  →dynamics_patched`. `dynamics_patched→status_flipped` and
  `status_flipped→completed` are `BUILD_PENDING_STATES`. **If a
  real submission lands TODAY, it advances four states and parks
  at `dynamics_patched` (pings `system_alerts`).** Is this the
  intended deferral behavior? Will the parked job survive being
  resumed when the next handler ships? `next_attempt_at` push-out
  logic correct?
- **External reviewer flow** (shipped 2026-05-03). Token mint
  via `lib/external/token-lifecycle.js`, magic links, SharePoint
  upload via `lib/services/review-upload.js`, post-submission
  token extension. **No recent exercise; has the auth or storage
  config drifted?**
- **Reviewer Finder Dataverse-native** (W3-W6 cutover complete
  2026-05-12). Last touched ~2 weeks ago. Picker + save-candidates
  + per-user state. Hit it? Confirm it still works against
  `wmkf_appreviewersuggestion` / `wmkf_appresearcher`.
- **Review Manager email flow** — uses `grant-cycles-dataverse.js`
  adapter. Worked at cutover; still works against current Dataverse
  state?
- **Phase I Dynamics writeback** (`/api/phase-i-dynamics/summarize-v2`).
  Live Executor route. Pre-flight overwrite guard. Last manual
  test?
- **Virtual Review Panel** (multi-LLM). 4 provider keys; has the
  allowlist (`VRP_ALLOWED_PROVIDERS`) been verified in prod?

### 2. Database health beyond reconcile-memory-claims

The audit-B work made the reconcile script reflect ground truth.
But its coverage is bounded. A senior engineer would also check:

- **Untracked Postgres state.** `playing_with_neon` was caught by
  the migration audit. Are there other tables / indexes / columns
  that exist in prod but aren't in any declared schema? Run
  `information_schema.tables` ∩ `information_schema.columns` ∩
  `information_schema.indexes` against `setup-database.js` + all
  migrations + `schema.sql`. Anything undeclared deserves a
  decision (drop / declare / allowlist).
- **Migration ordering and gaps.** Migrations are 002-014; no 001
  exists. Is that intentional (renumbered) or a missing migration?
- **Migration idempotency.** Each migration claims to be idempotent
  (`IF NOT EXISTS`, conditional ALTERs). Verify by simulated
  re-run (or `EXPLAIN ANALYZE` of the conditional path).
- **Dataverse undocumented entities.** The audit caught
  `wmkf_appproposalsearchs` (deployed with unconventional plural).
  Run a structural sweep: every entity that exists in Dataverse
  but has no atlas page. Use the entity-set list from the audit
  probe + spot-check `wmkf_*` entities individually.
- **Schema drift between source-of-truth files.** `schema.sql`
  is a stale subset of `setup-database.js`. Decision pending:
  delete `schema.sql` entirely, or sync them, or accept divergence
  as documented?
- **Backup / restore.** Has anyone tested a Postgres restore
  recently? Dataverse backup posture documented anywhere?

### 3. Production environment integrity

Env vars listed in CLAUDE.md as required for production-only
paths. **Listed ≠ verified.**

- `INTAKE_BLOB_RW_TOKEN` — S184 chunks 4/5 endpoints fail-loud
  without it. **Not yet verified in prod** (per S184 carryover).
- `CLOUDMERSIVE_API_KEY` + `VIRUS_SCAN_ENABLED` — DFT email never
  sent, prod env not configured.
- `CRON_SECRET`, `EXTERNAL_LINK_SECRET`, `IRS_VERIFY_SECRET` —
  rotation cadence on each? Have any rotated since deployment?
  `EXTERNAL_LINK_SECRET_PREVIOUS` set during current rotation? If
  not, would a rotation today break in-flight magic links?
- `DYNAMICS_IMPERSONATION_ENABLED` — default off. **Should it be
  on in prod for the impersonation contract to actually work?**
  Per memory entry, S129 smoke PASS, but is the flag on?
- `VRP_ALLOWED_PROVIDERS` — must intersect with configured API
  keys; production fails closed if unset. Verified?
- `AUTH_REQUIRED` kill switch — set correctly? `EMERGENCY_AUTH_BYPASS`
  unset in prod?
- Per-app model overrides — admin-configurable via Dataverse
  `wmkf_appsystemsettings`. **What's the current effective model
  per app?** Any stale ones pointing at retired model IDs?

### 4. Observability — is anyone reading the signals?

- `system_alerts` (149 rows). Who reads it? Email / Slack
  hookup? If the drain parks a real job tomorrow, will anyone
  notice?
- `health_check_history` (2,964 rows). Cron writes to it; is
  failure-alerting wired?
- `maintenance_runs` (1,498 rows). Daily maintenance cron audit
  trail. Recent failure rate?
- `api_usage_log` (1,724 rows). LLM cost ledger. Burning down
  cleanly?
- `model_pricing_audit` (0 rows). Monthly cron writes here on
  `flagged = true`. Has it ever fired? If not, has the canary
  actually been running?
- `intake_audit` (0 rows). Will start accumulating once intake
  goes live. SHA256-hashed; retention policy / rotation?
- `dynamics_query_log`, `dynamics_feedback` — Dynamics Explorer
  feedback loop. Is anyone reviewing thumbs-down rows?

### 5. Auth integrity

- `proxy.js` (Next 16 `proxy` convention) — covers all 93 routes
  correctly? Run a coverage check: every route either has a
  `requireAppAccess` / `requireAuth` / `requireSuperuser` call,
  is in the cron-secret-protected `/api/cron/*` allowlist, or is
  an external-token-protected `/api/external/*`.
- Dual-provider NextAuth (staff `azure-ad` + applicant
  `entra-external`). Cross-provider non-crossing enforced? Test:
  staff session hits `/apply/*` → middleware blocks; applicant
  session hits non-`/apply` → middleware blocks.
- Disabled-user blocking — `is_active=false` blocked before
  superuser bypass per the auth.js contract. Recent test?
- External Entra ID OTP flow — has anyone actually completed
  the round-trip recently? Provider config drift?

### 6. Memory / docs that may be stale

The S185 audit fixed some, but a senior engineer would re-check:

- Memory entries dated 2026-04 or earlier — anything overtaken
  by W3-W6 cutover that we haven't caught?
- Atlas pages with `Last verified` dates >30 days old.
- CLAUDE.md long doc — every entity reference still maps to
  live code? Spot-check 10 random ones.
- `docs/INTAKE_PORTAL_DRAIN_PLAN.md` — kept in sync through
  14 chunks; verify against what actually shipped.
- `docs/EXECUTOR_CONTRACT.md` — match `lib/services/execute-prompt.js`
  current behavior?

### 7. Code smells / dead code

A senior engineer would prune:

- `lib/services/prompt-resolver.js` — declared legacy in CLAUDE.md;
  used by some scripts. Confirm the script callers are still
  needed; if not, full retire.
- Wave 1 dispatcher dead-code Postgres branch in
  `settings-service.js` / `app-access-service.js` / `dataverse-prefs-service.js`.
  Postgres tables dropped 2026-05-12. Is the conditional still
  worth keeping for "loud failure on misconfiguration", or just
  remove the branch?
- `docs/archive/` — accumulating; anything actually useful vs.
  could be deleted entirely?
- Unused npm dependencies — `npm ls` clean? `depcheck` find
  anything?
- Tests that have rotted — `npx jest --listFailingTests`? Any
  silently `describe.skip`'d?

### 8. Operational dry-runs worth doing

Things a senior engineer would actually exercise:

- **Submit a test intake draft via curl, run the cron manually,
  watch state transitions through `intake_audit`.** Even with no
  UI, the backend path is exercisable.
- **Manually invoke `MaintenanceService.sweepIntakePending`** with
  a known pending row; confirm the race-safe ordering holds.
- **Mint an external reviewer token, walk a fake reviewer through
  the full flow** on preview. Confirms storage + auth + form
  submit.
- **Trigger `/api/cron/health-check`** manually; confirm what
  fires when a service is intentionally broken.
- **Send a test `/api/admin/policies` publish** and verify the
  policy_publish_audit row + Dynamics PATCH ordering.

## Out of scope for this session

- **No UI work.** The applicant intake form is the next big
  build (S185 carryover #2), but it's deliberately blocked on
  this readiness pass.
- **No new features.** Bug fixes only, and only ones the user
  greenlights after the findings list.
- **No memory-drift gate silencing.** Field Set D stays red
  until Connor.

## What the user wants out of the session

A document at `docs/READINESS_AUDIT_<DATE>.md` similar in shape
to Codex's audit reports, but written from a senior-engineer
perspective. It should:

1. Cover every bucket above (with explicit "CLEAR" verdicts on
   items that check out — silence is not success).
2. Surface findings the user can decide on individually (small
   numbered list, severity-tagged).
3. Recommend a fix order with effort estimates.

Then the user picks the fixes worth doing this session vs.
deferring.

## Carryover from S185 prompt (still valid; not the focus this session)

- Build the applicant form UI + wire to three-call dance —
  deliberately deferred to a post-readiness session.
- Connor's Q1-Q4 reply unblocks `status_flipped` + persons
  handlers.
- W6 reviewer Postgres DROP — fires ≥ 2026-07-01.
- Archive intake meeting agenda — fires ≥ 2026-05-27 (TOMORROW).
- Field Set D — Connor.

## Session 185 summary (10 commits)

Two consecutive Codex ground-truth audits, two complete response
passes, plus structural reconcile-script fixes that revealed real
drift hidden behind regex misfires and stale source-of-truth.

| Hash | Bucket | What |
|---|---|---|
| `992ea22` | A | drain-submissions current-state docs reconciled |
| `5a3f4e8` | C | audit-doc exclusion prefix-matched in 4 gates |
| `5d560c2` | B1+B2 | 3 reconcile bugs (resolver loop / candidate generator / $count timeout) |
| `f132f12` | B3 | atlas counts refreshed + policy-page regex false-positive |
| `44d8232` | Codex#1 | narrower $count exception handling + dynamics_patched accuracy + injectable-fetch test |
| `ebeb69b` | refactor | POINT_IN_TIME_BASENAMES/PREFIXES extracted to scripts/lib/ |
| `f33711e` | Codex#2 | reconcile structural fixes — capped-probe detection + schema-as-code completeness + bucket_meta + CREATE_TABLE_RE tightening |
| `0e76bd5` | hygiene | archived the two ground-truth audit docs |
| `b000a8c` | cleanup | dropped playing_with_neon from prod via migration 014 |

Final state:

- **All gates green** except the intentional Field Set D
  `doc_label_collision` (awaits Connor).
- **All four reconcile drift buckets at 0** (was 2 hidden + 24
  noise + 1 real before; now 0 everywhere).
- **Reconcile report `bucket_meta` is self-documenting** —
  future auditors don't need to read the gate code to know what
  blocks vs. informs.
- **`probeEntitySetCount` is unit-tested** via injectable fetch
  (10 cases) — covers timeout / cap / error / 404 / annotation
  paths.
- **Schema-as-code source-of-truth set is complete** (schema.sql
  ∪ setup-database.js ∪ migrations) — no more false-positive
  postgres_table_mismatch entries.
- **`wmkf_appproposalsearchs` reclassified** in Atlas (deployed
  empty, unconventional plural — the entity exists, the entity
  set name doesn't follow the English `-ch → -ches` rule).

Working tree clean. 9 commits ahead of `origin/main`. Push when
ready.

## Testing

```bash
# Full gate sweep — all green except memory-drift on Field Set D:
npm run check:atlas                       # 30 PG / 32 DV ✓
npm run check:atlas:self-test             # 12/12 ✓
npm run check:api-routes                  # 93 ✓
npm run check:fact-consistency            # ✓
npm run check:fact-consistency:self-test  # ✓
npm run check:canonical-pointers          # 9 pointers ✓
npm run check:canonical-pointers:self-test # ✓
npm run check:drain-table-mentions        # ✓
npm run check:drain-table-mentions:self-test # ✓
npm run check:prompt-storage-mentions     # ✓
npm run check:prompt-storage-mentions:self-test # ✓
npm run check:prompt-injection-tagging    # 24 ✓
npm run check:doc-currency                # 8 ✓
npm run check:memory-drift:no-write       # FAIL on Field Set D only (intentional)

# Unit tests for the S185 helpers:
npx jest tests/unit/reconcile-probe-entity-set-count.test.js tests/unit/point-in-time-files.test.js
# 19/19 pass
```
