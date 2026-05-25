# Phase 0 Emergency Closeout Plan — S186 (v6, post-Codex pass-5 reconciliation)

**Status:** Tightened after Codex pass 5
**Date:** 2026-05-25
**Companion docs:** `READINESS_AUDIT_2026-05-25.md`, `READINESS_AUDIT_2026-05-25_CODEX_REPORT.md`. v1–v4 superseded.

---

## Reconciliation summary (v5 → v6)

| Codex pass-5 finding | v5 had | v6 fix |
|---|---|---|
| Q1 / Q3 (BLOCKING): CI gate placement under-specified | "wired into existing pre-commit / CI sweep" | **Step 4 now names the exact file edit:** `.github/workflows/test.yml` gains `- run: npm run check:migrations-manifest` and `- run: git diff --exit-code lib/db/migrations-manifest.json` (after a build step that re-runs prebuild). `package.json` gains `prebuild` + `check:migrations-manifest` scripts. No reliance on phantom pre-commit hooks. |
| Q6a (BLOCKING minor): `detectMigrationDrift` swallows missing-tracker error | `console.warn` only | Function now distinguishes "tracker missing" from "drift detected" — missing-tracker raises a separate `migration_tracker_missing` alert. Drift detection retained for the populated-tracker case. |
| Q6b (BLOCKING minor): "diff against committed = 0" validation not wired in CI | informal validation note | Same `.github/workflows/test.yml` edit above; explicit `git diff --exit-code` step in the workflow definition. |
| Q2 (NON-BLOCKING): regex safety confirmed across all 13 files | line-anchored regex | unchanged; documented as verified across 002-014 |
| Q4 (NON-BLOCKING): cron placement structurally valid, no run-lifecycle conflicts | "after auth guards" | unchanged; `AlertService.autoResolve` calls inside pricing-canary body are alert-lifecycle, independent of `MaintenanceService` run lifecycle |
| Q5 (NON-BLOCKING): `RAISE EXCEPTION` from DO block propagates cleanly | guard block | unchanged |

(Pass-1 through pass-4 reconciliations remain valid; see v5 history in git for those mappings.)

---

## Scope (v5 — locked)

Phase 0 = migration emergency closeout + maintenance cron correctness + maintenance-observability completion.

**In:**
- Migrations 011 + 013 applied with same-transaction locking + tracker writes (body-only DDL, stripped outer BEGIN/COMMIT).
- `schema_migrations` tracker bootstrapped before the emergencies; probe-derived backfill for 002-010, 012, 014.
- `scripts/apply-migrations.js` (canonical forward apply path).
- Committed `lib/db/migrations-manifest.json` + `prebuild` regenerator + `check:migrations-manifest` script + explicit `.github/workflows/test.yml` gate (named below) + startup-time drift check via `instrumentation.js` (tracker-missing vs drift-detected distinction).
- CommonJS import bug fix (`lib/services/maintenance-service.js:13`).
- Daily maintenance cron `status='failed'` + severity `error` on subtask failures.
- `MaintenanceService.startRun`/`completeRun` adds to `pricing-canary` / `spend-check` / `sweep-stale-invites` (after auth guards).

**Out (closeout list — separate follow-ups after Phase 0):**
- Env-var probes (INTAKE_BLOB_RW_TOKEN, VRP_ALLOWED_PROVIDERS, model overrides).
- Virus scanning posture decision.
- `jose` direct dep declaration.
- CLAUDE.md schema-source-of-truth correction.

---

## Step 0 — Pre-flight

### 0.1 Verify Postgres target
- `.env.local` `POSTGRES_URL` resolves to the prod Neon branch the audit + Codex's independent probe queried.
- Sanity-check: `SELECT id, title FROM system_alerts ORDER BY created_at DESC LIMIT 1` returns alert id 151 with today's daily-maintenance text.

### 0.2 Per-migration preconditions for 011

All must pass:

1. **Active-row count = 0**: `SELECT COUNT(*) FROM submission_jobs WHERE status NOT IN ('completed','failed','cancelled');` → 0
2. **No existing wrong-definition indexes**: `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='submission_jobs' AND indexname IN ('idx_submission_jobs_unlocked','idx_submission_jobs_one_active_per_contact_form');` → 0 rows OR existing rows whose `indexdef` matches 011's body exactly.
3. **`gen_random_uuid()` works**: `SELECT gen_random_uuid();` returns a UUID.
4. **All existing status values are in the new CHECK set**: `SELECT DISTINCT status FROM submission_jobs;` — every value in `{queued, scanning, request_created, files_moved, dynamics_patched, status_flipped, completed, failed, cancelled}`. (0 rows in prod = no values to check; fine.)

### 0.3 Per-migration preconditions for 013

1. `pending_attachments` does NOT exist on `intake_drafts`.
2. `SELECT COUNT(*) FROM intake_drafts` = 0 immediately before apply.

---

## Step 1 — Bootstrap `schema_migrations` tracker (light)

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  name         TEXT PRIMARY KEY,
  applied_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_by   TEXT
);

-- 002: researchers.email_source
INSERT INTO schema_migrations (name, applied_by)
SELECT '002_contact_enrichment.sql', 'probe-backfill'
WHERE EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='researchers' AND column_name='email_source')
ON CONFLICT DO NOTHING;

-- 003: panel_reviews
INSERT INTO schema_migrations (name, applied_by)
SELECT '003_virtual_review_panel.sql', 'probe-backfill'
WHERE EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema='public' AND table_name='panel_reviews')
ON CONFLICT DO NOTHING;

-- 004: expertise_roster
INSERT INTO schema_migrations (name, applied_by)
SELECT '004_expertise_finder.sql', 'probe-backfill'
WHERE EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema='public' AND table_name='expertise_roster')
ON CONFLICT DO NOTHING;

-- 005: intake_drafts
INSERT INTO schema_migrations (name, applied_by)
SELECT '005_intake_portal.sql', 'probe-backfill'
WHERE EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema='public' AND table_name='intake_drafts')
ON CONFLICT DO NOTHING;

-- 006: policy_publish_audit
INSERT INTO schema_migrations (name, applied_by)
SELECT '006_policy_publish_audit.sql', 'probe-backfill'
WHERE EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema='public' AND table_name='policy_publish_audit')
ON CONFLICT DO NOTHING;

-- 007: ALL THREE Wave 1 tables absent
INSERT INTO schema_migrations (name, applied_by)
SELECT '007_drop_wave1_tables.sql', 'probe-backfill'
WHERE NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name IN
                  ('system_settings','user_preferences','user_app_access'))
ON CONFLICT DO NOTHING;

-- 008: irs_exempt_orgs
INSERT INTO schema_migrations (name, applied_by)
SELECT '008_irs_exempt_orgs.sql', 'probe-backfill'
WHERE EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema='public' AND table_name='irs_exempt_orgs')
ON CONFLICT DO NOTHING;

-- 009: submission_jobs
INSERT INTO schema_migrations (name, applied_by)
SELECT '009_submission_jobs.sql', 'probe-backfill'
WHERE EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema='public' AND table_name='submission_jobs')
ON CONFLICT DO NOTHING;

-- 010: external_rate_limit
INSERT INTO schema_migrations (name, applied_by)
SELECT '010_external_rate_limit.sql', 'probe-backfill'
WHERE EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema='public' AND table_name='external_rate_limit')
ON CONFLICT DO NOTHING;

-- 012: idx_intake_drafts_unique_no_request — UNIQUE + column tuple + predicate
-- (Codex pass-4 §1: 005 creates a same-named non-unique index; UNIQUE check disambiguates.)
-- IMPORTANT: pg_indexes.indexdef output formats the predicate as `WHERE (request_id IS NULL)`
-- with parens — match without the `WHERE` keyword so the LIKE pattern works regardless.
INSERT INTO schema_migrations (name, applied_by)
SELECT '012_intake_drafts_uniqueness.sql', 'probe-backfill'
WHERE EXISTS (
  SELECT 1 FROM pg_indexes
  WHERE schemaname='public'
    AND tablename='intake_drafts'
    AND indexname='idx_intake_drafts_unique_no_request'
    AND indexdef LIKE 'CREATE UNIQUE INDEX%'
    AND indexdef LIKE '%(contact_oid, account_id, form_key)%'
    AND indexdef LIKE '%request_id IS NULL%'
)
ON CONFLICT DO NOTHING;

-- 014: playing_with_neon absent (WEAK indicator — applied_by marker reflects this)
INSERT INTO schema_migrations (name, applied_by)
SELECT '014_drop_playing_with_neon.sql', 'probe-backfill-weak'
WHERE NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='playing_with_neon')
ON CONFLICT DO NOTHING;

COMMIT;
```

**Validation:** `SELECT name, applied_by FROM schema_migrations ORDER BY name;` returns exactly 11 rows (002, 003, 004, 005, 006, 007, 008, 009, 010, 012, 014). 011 + 013 absent — applied in Steps 2/3.

---

## Step 2 — Apply migration 011 with same-tx lock + tracker write

DDL is the body of `011_submission_jobs_states.sql` lines 19-62, i.e. everything between the file's outer `BEGIN;` (line 17) and `COMMIT;` (line 63). Inlined here so the outer transaction is the only transactional scope:

```sql
BEGIN;
LOCK TABLE submission_jobs IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF (SELECT COUNT(*) FROM submission_jobs WHERE status NOT IN ('completed','failed','cancelled')) <> 0 THEN
    RAISE EXCEPTION 'active-row precondition violated; aborting 011 apply';
  END IF;
END $$;

-- Body of 011 (file lines 19-62, BEGIN/COMMIT stripped):

ALTER TABLE submission_jobs DROP CONSTRAINT IF EXISTS submission_jobs_status_check;
ALTER TABLE submission_jobs ADD CONSTRAINT submission_jobs_status_check CHECK (status IN (
  'queued',
  'scanning',
  'request_created',
  'files_moved',
  'dynamics_patched',
  'status_flipped',
  'completed',
  'failed',
  'cancelled'
));

ALTER TABLE submission_jobs ADD COLUMN IF NOT EXISTS akoya_requestnum TEXT;
ALTER TABLE submission_jobs ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
ALTER TABLE submission_jobs ADD COLUMN IF NOT EXISTS lease_token  UUID;

DROP INDEX IF EXISTS idx_submission_jobs_active_ready;
CREATE INDEX IF NOT EXISTS idx_submission_jobs_unlocked
  ON submission_jobs (next_attempt_at, locked_until, created_at)
  WHERE status NOT IN ('completed', 'failed', 'cancelled');

DROP INDEX IF EXISTS idx_submission_jobs_one_active_per_request;
CREATE UNIQUE INDEX IF NOT EXISTS idx_submission_jobs_one_active_per_contact_form
  ON submission_jobs (contact_oid, account_id, form_key)
  WHERE status NOT IN ('completed', 'failed', 'cancelled');

INSERT INTO schema_migrations (name, applied_by) VALUES
  ('011_submission_jobs_states.sql', 'phase0')
ON CONFLICT DO NOTHING;

COMMIT;
```

**Validation (definition-level, not name-only):**

```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='submission_jobs'
  AND column_name IN ('locked_until','lease_token','akoya_requestnum');
-- expect: 3 rows

SELECT pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid='submission_jobs'::regclass AND conname='submission_jobs_status_check';
-- expect: output containing 'request_created'

SELECT indexdef FROM pg_indexes
WHERE schemaname='public' AND tablename='submission_jobs'
  AND indexname='idx_submission_jobs_one_active_per_contact_form';
-- expect: ON ... (contact_oid, account_id, form_key) WHERE status NOT IN (...)

SELECT indexdef FROM pg_indexes
WHERE schemaname='public' AND tablename='submission_jobs'
  AND indexname='idx_submission_jobs_unlocked';
-- expect: ON ... (next_attempt_at, locked_until, created_at) WHERE status NOT IN (...)

SELECT applied_by FROM schema_migrations WHERE name='011_submission_jobs_states.sql';
-- expect: 'phase0'
```

---

## Step 3 — Apply migration 013 with same-tx lock + tracker write

Body of `013_intake_drafts_pending_attachments.sql` between its file-level `BEGIN`/`COMMIT`:

```sql
BEGIN;
LOCK TABLE intake_drafts IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='intake_drafts'
               AND column_name='pending_attachments') THEN
    RAISE EXCEPTION 'pending_attachments precondition violated; aborting 013 apply';
  END IF;
END $$;

ALTER TABLE intake_drafts
  ADD COLUMN IF NOT EXISTS pending_attachments JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN intake_drafts.pending_attachments IS
  'In-flight attachment uploads (three-call dance). Server-managed; never overwritten by autosave. See docs/INTAKE_ATTACH_BUILD_SCOPING.md § Q1 + A5 + A6.';

INSERT INTO schema_migrations (name, applied_by) VALUES
  ('013_intake_drafts_pending_attachments.sql', 'phase0')
ON CONFLICT DO NOTHING;

COMMIT;
```

**Validation:**

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public' AND table_name='intake_drafts' AND column_name='pending_attachments';
-- expect: jsonb / NO / '[]'::jsonb

SELECT applied_by FROM schema_migrations WHERE name='013_intake_drafts_pending_attachments.sql';
-- expect: 'phase0'
```

**Endpoint smoke:** POST `/api/intake/draft/upload-token` against preview env with a fixture body. Expect 200, not the `column "pending_attachments" does not exist` 500.

---

## Step 4 — `scripts/apply-migrations.js` + committed manifest + drift check

### 4a. `scripts/apply-migrations.js`

Contract:
- Connects via `POSTGRES_URL` / `DATABASE_URL`.
- First action: `CREATE TABLE IF NOT EXISTS schema_migrations(...)`. Defensive.
- Lists `lib/db/migrations/*.sql` sorted lexicographically.
- For each file:
  - `SELECT 1 FROM schema_migrations WHERE name=$1`. If present → `[skip]`.
  - Otherwise:
    - Read file body.
    - Strip **only line-anchored outer transaction markers** with `body.replace(/^\s*(BEGIN|COMMIT);\s*$/gim, '')`. This leaves PL/pgSQL `BEGIN` (no semicolon) and comment-text `-- commit` untouched.
    - Wrap: `BEGIN; <stripped body>; INSERT INTO schema_migrations (...) VALUES ($name, now(), 'apply-migrations.js'); COMMIT;`
- Stdout: `[skip]` / `[apply ok]` / `[apply failed: …]`. Non-zero exit on failure.

Unit test `tests/unit/apply-migrations.test.js`:
- Bootstrap when table doesn't exist
- Skip when name in tracker
- Apply when not in tracker
- BEGIN/COMMIT strip leaves PL/pgSQL `BEGIN` untouched (007 fixture)
- BEGIN/COMMIT strip leaves comment-text `-- commit` untouched (012 fixture)
- Failing migration aborts + rolls back + leaves tracker untouched

### 4b. Committed `lib/db/migrations-manifest.json` + explicit CI wiring

Codex pass-4 §4 + pass-5 Q1/Q3: ship the manifest as a checked-in file AND name the CI gate concretely.

**New files / scripts:**
- `scripts/build-migrations-manifest.js` writes:
  ```json
  { "generatedAt": "<ISO>", "files": ["002_contact_enrichment.sql", ..., "014_drop_playing_with_neon.sql"] }
  ```
- `scripts/check-migrations-manifest.js`: reads `lib/db/migrations-manifest.json#files`, compares to `lib/db/migrations/*.sql` directory contents (sorted). Exits non-zero on drift, with the diff in stderr.

**`package.json` script edits:**
```json
{
  "scripts": {
    "prebuild": "node scripts/build-migrations-manifest.js",
    "check:migrations-manifest": "node scripts/check-migrations-manifest.js"
  }
}
```

**`.github/workflows/test.yml` edits** (Codex pass-5 Q1/Q3 — named workflow step, not phantom hook):

Add the following two steps alongside the existing `check:atlas` / `check:api-routes` / `check:doc-currency` runs (current workflow lines 18-24 per Codex):

```yaml
      - run: npm run check:migrations-manifest
      - run: npm run build
      - run: git diff --exit-code lib/db/migrations-manifest.json
```

The `npm run build` step re-triggers `prebuild`, regenerating the manifest in CI. The `git diff --exit-code` step then fails CI if the committed manifest doesn't match what `prebuild` would have written — closing Codex Q6b.

- File is committed to git. Stale committed manifest = CI failure.
- A developer who adds migration 016 in a branch without running `prebuild` will hit the CI failure when their PR runs, not at runtime.

### 4c. Startup-time drift check

`lib/utils/migration-drift.js`:
```js
import manifest from '../db/migrations-manifest.json';

const TRACKER_TABLE_MISSING_CODE = '42P01'; // undefined_table

export async function detectMigrationDrift() {
  const { sql } = await import('@vercel/postgres');
  const { default: AlertService } = await import('../services/alert-service');

  let rows;
  try {
    const result = await sql`SELECT name FROM schema_migrations`;
    rows = result.rows;
  } catch (err) {
    // Codex pass-5 Q6a: explicitly surface "tracker table missing" as a
    // distinct alert, not a silent console.warn. This is the "fresh env
    // / Phase 0 hasn't run yet" signal, and operators need to see it.
    if (err.code === TRACKER_TABLE_MISSING_CODE) {
      await AlertService.createAlert({
        type: 'migration_tracker_missing',
        severity: 'error',
        title: 'schema_migrations table does not exist',
        message: `Cold-start drift check could not read the migration tracker. ` +
                 `Either Phase 0 Step 1 has not run on this environment, or the tracker was dropped. ` +
                 `Run scripts/apply-migrations.js to bootstrap.`,
        source: 'instrumentation/migration-drift',
        autoResolveKey: 'migration-tracker-missing',
      });
      return;
    }
    // Other errors: console-log + don't block startup (existing contract)
    console.warn('[migration-drift] tracker query failed:', err.message);
    return;
  }

  const tracked = new Set(rows.map(r => r.name));
  const missing = manifest.files.filter(f => !tracked.has(f));
  if (missing.length === 0) return;

  await AlertService.createAlert({
    type: 'migration_drift',
    severity: 'warning',
    title: `${missing.length} migration(s) declared but not applied`,
    message: `Tracked: ${tracked.size}. Manifest: ${manifest.files.length}. Missing: ${missing.join(', ')}`,
    metadata: { missing, trackedCount: tracked.size, manifestCount: manifest.files.length },
    source: 'instrumentation/migration-drift',
    autoResolveKey: 'migration-drift',
  });
}
```

Wired into `instrumentation.js` `register()` matching the existing dynamic-import pattern at lines 19-22:

```js
try {
  const { detectMigrationDrift } = await import('./lib/utils/migration-drift');
  await detectMigrationDrift();
} catch (err) {
  console.warn('[instrumentation] migration-drift check failed:', err.message);
}
```

Best-effort; never throws.

Unit test `tests/unit/migration-drift.test.js`: covers all-applied (no alert), one-missing (`migration_drift` warning alert raised), tracker missing — error code 42P01 (`migration_tracker_missing` error alert raised), other tracker query failure (logged warning, no alert, no throw).

### 4d. Validation
- `npm run build` regenerates `lib/db/migrations-manifest.json`; diff against committed = 0 (or CI fails).
- `npm run check:migrations-manifest` exits 0 against the canonical state.
- `node scripts/apply-migrations.js` is a no-op against a fully-tracked DB.
- Cold-start `detectMigrationDrift` produces no `migration_drift` alert after Phase 0 lands.

---

## Step 5 — Maintenance: fix import bug + status reporting

### 5a. `lib/services/maintenance-service.js:13`

Change:
```js
const DatabaseService = require('./database-service');
```
to:
```js
const { DatabaseService } = require('./database-service');
```

Unit test `tests/unit/maintenance-service-cleanup-cache.test.js`: mocks the destructured `DatabaseService.cleanupExpiredCache`, asserts `MaintenanceService.cleanupExpiredCache()` resolves to a number.

### 5b. `pages/api/cron/maintenance.js`

After collecting `results`, scan each subtask. If any has an `error` field:
- `MaintenanceService.completeRun(runId, { status: 'failed', errorMessage: '<failing subtask names>', ... })`
- `NotificationService.notify(..., severity: 'error', ...)`

Otherwise: existing `completed` / `info` path.

Unit test `tests/unit/maintenance-cron-status.test.js`: forced subtask throw → `status='failed'` + severity `error`.

---

## Step 6 — `startRun`/`completeRun` adds to silent crons

**Placement (Codex pass-4 §5):** start the maintenance run **after** method + cron-secret guards. Rejected requests don't write spurious rows.

Files: `pages/api/cron/pricing-canary.js`, `spend-check.js`, `sweep-stale-invites.js`.

```js
export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!verifyCronSecret(req, res)) return;

  // ── NEW: maintenance run starts AFTER auth ──
  const runId = await MaintenanceService.startRun('pricing-canary');
  try {
    // existing handler body
    await MaintenanceService.completeRun(runId, {
      status: 'completed',
      recordsProcessed: N,
      details: { /* job-specific */ },
    });
    return res.json({ ok: true, ... });
  } catch (error) {
    await MaintenanceService.completeRun(runId, { status: 'failed', errorMessage: error.message });
    return res.status(500).json({ ok: false, message: error.message });
  }
}
```

Per cron:
- `pricing-canary.js`: existing guards at lines 32 + 35 stay first; startRun goes after them.
- `spend-check.js`: existing guards at lines 32 + 36 stay first; startRun goes after them.
- `sweep-stale-invites.js`: existing guards at lines 22 + 25 stay first; startRun goes after them.

After deploy, `maintenance_runs` gains new entries at each cron's scheduled cadence. If still missing → confirmed Vercel-side cron config issue, not handler issue.

---

## Final order of operations

1. **Step 0** — pre-flight (target verification + per-migration preconditions).
2. **Step 1** — bootstrap `schema_migrations` tracker (single tx, light, probe-backfill 11 rows).
3. **Step 2** — apply migration 011 (LOCK + body-only DDL + tracker write, single tx).
4. **Step 3** — apply migration 013 (LOCK + body-only DDL + tracker write, single tx).
5. **Step 4** — `scripts/apply-migrations.js` + committed manifest + drift check.
6. **Step 5** — import bug fix + maintenance cron status reporting.
7. **Step 6** — startRun adds (after auth guards) to three crons.

Steps 1-3 are DB-side. Steps 4-6 are code commits + redeploy.

---

## Validation gates

Per step: `npm run check:atlas`, `:atlas:self-test`, `:api-routes` stay green; no new ≥error `system_alerts` rows attributable to the change.

After full Phase 0:
- `SELECT name FROM schema_migrations ORDER BY name;` returns **13 rows** matching the 13 files in `lib/db/migrations/`.
- `lib/db/migrations-manifest.json` (committed) lists all 13.
- `npm run check:migrations-manifest` exits 0.
- `node scripts/apply-migrations.js` is a no-op (all skipped).
- Cold-start `detectMigrationDrift` produces no alert.
- Tomorrow's daily-maintenance cron is `status='completed'` with zero subtask errors.
- Forced subtask throw in dev produces `status='failed'` + `severity='error'`.
- `pricing-canary` / `spend-check` / `sweep-stale-invites` have fresh `maintenance_runs` rows at scheduled cadences (or proof-positive Vercel isn't invoking them).

---

## Rollback posture

`LOCK TABLE ACCESS EXCLUSIVE` inside the migration tx eliminates the race window. Concurrent drains / submits block, then succeed against the new schema.

- **Step 1** (tracker): `DROP TABLE schema_migrations;`. Pure additive.
- **Step 2** (mig 011): revert is viable only before the next drain tick touches the new columns. Fix forward otherwise.
- **Step 3** (mig 013): revert viable only before the next `/upload-token` call. Fix forward otherwise.
- **Steps 4-6** (code): `git revert <commit>`.

The intake portal isn't on a public URL. Drain runs every 2 min — choose an apply window with 2-4 min monitoring.

---

## Phase 0 closeout list (separate follow-ups after Phase 0)

1. **Env-var verification (P0)**: `vercel env ls production | grep -E 'INTAKE_BLOB_RW_TOKEN|VRP_ALLOWED_PROVIDERS'` + read `wmkf_appsystemsettings` for `model_for_app:*` keys.
2. **Virus scanning posture (P0 user decision)**: A (off, document); B (Cloudmersive); C (in-house, deferred).
3. **`jose` direct dep (P1)**: `npm install jose@<resolved>` + commit `package.json` + lockfile.
4. **CLAUDE.md schema-source-of-truth correction (P2)**: rewrite §"Database Schema" to point at `setup-database.js` (fresh) + `apply-migrations.js` (canonical apply) + `schema_migrations` (per-env source of truth).

---

## Success criteria (Phase 0 alone)

- ✅ `pending_attachments`, `locked_until`, `lease_token`, `akoya_requestnum` exist in prod.
- ✅ `schema_migrations` has 13 rows = the full migrations file list.
- ✅ `scripts/apply-migrations.js` exists, idempotent, BEGIN/COMMIT-strip is line-anchored and PL/pgSQL-safe.
- ✅ `lib/db/migrations-manifest.json` is committed; CI gate enforces freshness.
- ✅ Cold-start drift check surfaces future drift via `system_alerts`.
- ✅ Daily `cleanupExpiredCache` succeeds.
- ✅ Daily maintenance cron reports `status='failed'` + severity `error` on subtask failures.
- ✅ `pricing-canary` / `spend-check` / `sweep-stale-invites` have visible `maintenance_runs` heartbeats (or Vercel-side cron problem proven).

**Phase 0 complete.** Closeout list bridges to Phase A.
