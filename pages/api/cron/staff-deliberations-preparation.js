import { verifyCronSecret } from '../../../lib/utils/cron-auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { drainStaffDeliberationsPreparations } from '../../../lib/services/pre-site-visit/preparation-worker';

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed.' });
  }
  if (!verifyCronSecret(req, res)) return;
  try {
    const result = await withDalContext('cron-staff-deliberations-preparation', () => (
      drainStaffDeliberationsPreparations()
    ));
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    console.error('[cron:staff-deliberations-preparation] failed:', error?.code || error?.message || 'unknown');
    return res.status(500).json({
      ok: false,
      error: 'Staff Deliberations preparation pass failed.',
      code: 'staff_deliberations_preparation_failed',
    });
  }
}
