/**
 * Cron: /api/cron/sweep-stale-invites
 *
 * Daily sweep. Closes reviewer-invitation suggestions where the parent
 * request's meeting date is past and no response has been recorded —
 * flips wmkf_responsetype to no_response so the My Candidates UI stops
 * showing them as "pending" indefinitely.
 *
 * Manually triggerable for ad-hoc backfills:
 *   ?graceDays=N   Only sweep requests whose meeting date is at least N days past (default 0).
 *   ?maxBatch=N    Cap writes per run (default 200; safety bound for cron timeouts).
 *   ?dryRun=1      Report what would be swept without writing.
 *
 * Auth: Vercel CRON_SECRET (matches all /api/cron/* routes).
 */

import { verifyCronSecret } from '../../../lib/utils/cron-auth';
import { bypassDynamicsRestrictions } from '../../../lib/services/dynamics-context';
import { sweepStaleInvites } from '../../../lib/services/reviewer-suggestion-sweep';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!verifyCronSecret(req, res)) return;

  const graceDays = clampInt(req.query.graceDays, 0, 365, 0);
  const maxBatch = clampInt(req.query.maxBatch, 1, 1000, 200);
  const dryRun = req.query.dryRun === '1' || req.query.dryRun === 'true';

  try {
    const result = await bypassDynamicsRestrictions('cron-sweep-stale-invites', () =>
      sweepStaleInvites({ graceDays, maxBatch, dryRun }),
    );

    if (result.swept > 0 || result.errors.length > 0) {
      console.log(`[cron:sweep-stale-invites] scanned=${result.scanned} eligible=${result.eligible} swept=${result.swept} skipped=${result.skipped} errors=${result.errors.length} dryRun=${dryRun}`);
    }
    return res.json({ ok: true, graceDays, maxBatch, ...result });
  } catch (error) {
    console.error('[cron:sweep-stale-invites] error:', error);
    return res.status(500).json({ error: 'Sweep failed', message: error.message });
  }
}

function clampInt(raw, lo, hi, fallback) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}
