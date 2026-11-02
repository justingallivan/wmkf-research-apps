/** Monthly reference refresh worker; no schedule is registered until the first
 * approved production refresh succeeds. Fail closed in Preview/dev and while
 * RETRACTION_REFRESH_ENABLED is unset. Never accepts source/database URLs.
 */
import { constantTimeEqual } from '../../../lib/utils/cron-auth';
import { refreshRetractions } from '../../../lib/services/retraction-refresh-service';
export const config = { maxDuration: 300, api: { bodyParser: false } };

// Strict local guard intentionally has no NODE_ENV development bypass.
function verifyCronSecret(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret) { res.status(503).json({ error: 'Cron secret not configured' }); return false; }
  if (!constantTimeEqual(req.headers.authorization, `Bearer ${secret}`)) {
    res.status(401).json({ error: 'Unauthorized' }); return false;
  }
  return true;
}
export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  if (!verifyCronSecret(req, res)) return;
  if (process.env.NODE_ENV !== 'production' || process.env.VERCEL_ENV !== 'production' || process.env.RETRACTION_REFRESH_ENABLED !== 'on') {
    return res.status(503).json({ error: 'Retraction refresh is disabled' });
  }
  const value = req.query?.dryRun;
  if (value !== undefined && !['0', '1'].includes(value)) return res.status(400).json({ error: 'dryRun must be 0 or 1' });
  try {
    const result = await refreshRetractions({ dryRun: value === '1' });
    return res.status(result.status === 'busy' ? 202 : 200).json({ success: result.status !== 'busy', ...result });
  } catch (error) {
    return res.status(500).json({ error: error.code || 'retraction_refresh_failed', ...(error.details ? { details: error.details } : {}) });
  }
}
