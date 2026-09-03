/**
 * Dedicated automatic/repair sweep for retained individual-review DOCX files.
 * Inert unless REVIEW_DOCX_SHAREPOINT_WRITE is literal `on` and an exact cycle
 * is configured. Submission and thank-you paths remain independent.
 */

import { verifyCronSecret } from '../../../lib/utils/cron-auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { sweepMissingIndividualReviewFiles } from '../../../lib/services/review-documents/individual-file-service';
import MaintenanceService from '../../../lib/services/maintenance-service';

function clampInt(raw, lo, hi, fallback) {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!verifyCronSecret(req, res)) return;

  const scanCap = clampInt(req.query.scanCap, 1, 100, 50);
  const attemptCap = clampInt(req.query.attemptCap, 1, 20, 5);
  const runId = await MaintenanceService.startRun('file-review-docx');

  try {
    const result = await withDalContext('cron-file-review-docx', () =>
      sweepMissingIndividualReviewFiles({ scanCap, attemptCap }),
    );
    const failed = Object.entries(result.counts || {})
      .filter(([status]) => [
        'invalid_cycle',
        'partial_pointer',
        'invalid_snapshot',
        'read_failed',
        'generation_failed',
        'content_conflict',
        'pointer_conflict',
        'sharepoint_failed',
        'pointer_write_failed',
        'verification_failed',
        'cleanup_failed',
        'target_guard_failed',
      ].includes(status))
      .reduce((sum, [, count]) => sum + count, 0);
    await MaintenanceService.completeRun(runId, {
      status: failed > 0 || result.status === 'target_guard_failed' ? 'failed' : 'completed',
      recordsProcessed: result.scanned || 0,
      recordsDeleted: result.counts?.created || 0,
      details: { scanCap, attemptCap, ...result },
      errorMessage: failed > 0 ? `${failed} review DOCX filing result(s) require attention` : undefined,
    });
    return res.json({ ok: true, scanCap, attemptCap, ...result });
  } catch (error) {
    console.error('[cron:file-review-docx] error:', error);
    await MaintenanceService.completeRun(runId, { status: 'failed', errorMessage: error.message });
    return res.status(500).json({ error: 'Review DOCX filing sweep failed', message: 'Internal error' });
  }
}
