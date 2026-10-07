/**
 * Cron: /api/cron/final-writeup-handoff-emails
 *
 * Retries pending group-review handoff emails (Final Writeup Stage 4) every
 * 15 minutes, so a send that failed after the handoff committed still goes
 * out without anyone pressing a button. Uses the same lease, token fence,
 * recipient re-check and correlation recovery as the route
 * (lib/services/final-writeup/handoff-email-service.js). An owed email that
 * cannot be delivered raises an ops alert from the service.
 */
import { verifyCronSecret } from '../../../lib/utils/cron-auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { recoverPendingHandoffEmails } from '../../../lib/services/final-writeup/handoff-email-service';

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed.' });
  }
  if (!verifyCronSecret(req, res)) return;
  try {
    const results = await withDalContext('cron-final-writeup-handoff-emails', () => (
      recoverPendingHandoffEmails({ limit: 25 })
    ));
    const counts = results.reduce((totals, result) => {
      totals[result.status] = (totals[result.status] || 0) + 1;
      return totals;
    }, {});
    return res.status(200).json({ ok: true, attempted: results.length, counts });
  } catch (error) {
    console.error('[cron:final-writeup-handoff-emails] failed:', error?.code || error?.message || 'unknown');
    return res.status(500).json({
      ok: false,
      error: 'Group review email retry pass failed.',
      code: 'final_writeup_handoff_email_retry_failed',
    });
  }
}
