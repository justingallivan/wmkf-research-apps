/**
 * Cron: /api/cron/final-writeup-leadership-digest
 *
 * Sends the leadership daily digest (Final Writeup Stage 5) at 07:00 UTC,
 * midnight Pacific daylight time: each Leadership-persona staff member gets
 * one email listing the Research writeups newly sent to leadership review.
 * A rerun on the same day sends nothing twice (per-recipient, per-day lease
 * and correlation key in lib/services/final-writeup/leadership-digest-service.js).
 * A recipient that cannot be emailed raises an ops alert from the service.
 */
import { verifyCronSecret } from '../../../lib/utils/cron-auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { runLeadershipDigests } from '../../../lib/services/final-writeup/leadership-digest-service';

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed.' });
  }
  if (!verifyCronSecret(req, res)) return;
  try {
    const run = await withDalContext('cron-final-writeup-leadership-digest', () => runLeadershipDigests());
    const counts = run.results.reduce((totals, result) => {
      totals[result.status] = (totals[result.status] || 0) + 1;
      return totals;
    }, {});
    return res.status(200).json({ ok: true, status: run.status, digestDay: run.digestDay, counts });
  } catch (error) {
    console.error('[cron:final-writeup-leadership-digest] failed:', error?.code || error?.message || 'unknown');
    return res.status(500).json({
      ok: false,
      error: 'Leadership digest run failed.',
      code: 'final_writeup_leadership_digest_failed',
    });
  }
}
