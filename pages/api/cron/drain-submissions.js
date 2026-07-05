/**
 * GET /api/cron/drain-submissions
 *
 * Applicant intake portal — submission-jobs drain. Vercel cron at
 * every 2 minutes (registered in vercel.json — see crons[] entry). One tick claims up to
 * DRAIN_BATCH_SIZE jobs via the two-phase lease, then advances each
 * by exactly one state.
 *
 * State machine (drain plan v7 §6):
 *   queued
 *     → scanning              (attachments shape + scan_result='clean' for all)
 *     → request_created       (Dataverse Create akoya_request; capture akoya_requestnum)
 *     → files_moved           (Blob → SharePoint)
 *     → dynamics_patched      (budget-line POSTs only — persons children +
 *                              parent aggregate PATCH deferred; await Connor Q2)
 *     → status_flipped        (PATCH source picklist — Connor Q1)          [BUILD-PENDING]
 *     → completed             (clear draft; audit)                         [BUILD-PENDING]
 *
 * Terminal: failed, cancelled.
 *
 * Thin route shell (Route→Service Consolidation Plan, Stage 5, final
 * extraction): the shell keeps its STRICT route-local cron secret
 * (verifyDrainCronSecret below — deliberately NOT the shared verifyCronSecret;
 * byte-untouched), the module-scoped pg pool + per-tick client lifecycle, the
 * maintenance_runs telemetry, and the stats/HTTP envelopes. The ENTIRE drain
 * engine — two-phase claim + lease renewal, state handlers, duplicate-PK
 * recovery, transactional advance/audit, classifier failure path, and the
 * per-job dispatcher (which establishes withDalContext('drain-submissions')
 * around each state handler — S331 enforcement fix, 787feb00) — lives in
 * lib/services/cron/drain-submissions-service.js.
 */

import pkg from 'pg';
import MaintenanceService from '../../../lib/services/maintenance-service';
import {
  claimBatch,
  processJob,
  DRAIN_BATCH_SIZE,
} from '../../../lib/services/cron/drain-submissions-service';

const { Pool } = pkg;

// ---------- pg pool (module-scoped — survives across cron ticks) ----------

let _pool = null;
function getPool() {
  if (_pool) return _pool;
  const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!connectionString) throw new Error('POSTGRES_URL not configured');
  _pool = new Pool({ connectionString, max: 5 });
  return _pool;
}

// ---------- handler ----------

/**
 * Strict CRON_SECRET check — no NODE_ENV=development bypass.
 *
 * Codex round-12 Q5: the shared `verifyCronSecret` bypasses auth entirely
 * in dev mode (cron-auth.js:24). For routes that just write monitoring
 * rows (health-check / spend-check / etc.) that's acceptable; this route
 * advances real state machine rows and will, in Phase B, write to
 * Dataverse + SharePoint. A developer pointing .env.local at prod-shaped
 * connection strings could mutate prod data with an unauthenticated GET.
 *
 * For dev testing of this route, set CRON_SECRET in .env.local and call
 * with the matching Bearer header — same shape as production.
 */
function verifyDrainCronSecret(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[drain] CRON_SECRET not configured');
    res.status(500).json({ error: 'CRON_SECRET not configured' });
    return false;
  }
  const got = req.headers.authorization;
  if (got !== `Bearer ${secret}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

export default async function handler(req, res) {
  if (!verifyDrainCronSecret(req, res)) return;

  const pool = getPool();
  const client = await pool.connect();
  const stats = { claimed: 0, processed: 0, errors: 0 };
  const startedAt = Date.now();

  // maintenance_runs telemetry (Codebase eval 2026-05-29 #3 — the drain had no
  // run telemetry, so a silent drain failure was invisible to the cron audit
  // trail). We deliberately diverge from cron/maintenance.js (which always
  // opens a run row): this route ticks every 2 minutes, so logging idle ticks
  // (claimed:0) would add ~720 rows/day to maintenance_runs, which has no
  // retention sweep. Instead we open a row only when there's work to report,
  // and ALWAYS record fatal failures (see the catch) so no failure is silent.
  let runId = null;

  try {
    const claimed = await claimBatch(client, DRAIN_BATCH_SIZE);
    stats.claimed = claimed.length;

    if (stats.claimed > 0) {
      runId = await MaintenanceService.startRun('drain-submissions');
    }

    for (const job of claimed) {
      try {
        await processJob(client, job);
        stats.processed += 1;
      } catch (err) {
        stats.errors += 1;
        console.error('[drain] processJob failed:', err);
      }
    }
  } catch (err) {
    console.error('[drain] fatal:', err);
    // Record the fatal even if claimBatch threw before we opened a run row.
    // startRun/completeRun both fail soft (swallow DB errors), so this can
    // never turn a drain failure into a 200 or mask the original error.
    if (!runId) runId = await MaintenanceService.startRun('drain-submissions');
    await MaintenanceService.completeRun(runId, {
      status: 'failed',
      errorMessage: err.message,
      details: { ...stats, elapsedMs: Date.now() - startedAt, phase: 'fatal' },
    });
    client.release();
    return res.status(500).json({ error: 'drain fatal', message: err.message });
  }

  client.release();
  const elapsedMs = Date.now() - startedAt;

  // Close the audit row for ticks that did work. Per-job failures mark the run
  // 'failed' (mirrors daily-maintenance's subtask-failure convention). Numeric
  // columns: records_processed = jobs claimed this tick, records_deleted =
  // jobs successfully advanced; the unambiguous breakdown lives in details.
  if (runId) {
    await MaintenanceService.completeRun(runId, {
      status: stats.errors > 0 ? 'failed' : 'completed',
      recordsProcessed: stats.claimed,
      recordsDeleted: stats.processed,
      details: { ...stats, elapsedMs },
      errorMessage: stats.errors > 0 ? `${stats.errors} job(s) failed to advance` : undefined,
    });
  }

  return res.status(200).json({ ok: true, ...stats, elapsedMs });
}
