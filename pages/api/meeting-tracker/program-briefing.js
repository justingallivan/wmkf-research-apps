import { requireAppAccess } from '../../../lib/utils/auth.js';
import { withDalContext } from '../../../lib/dataverse/core/context.js';
import { loadProgramBriefing } from '../../../lib/services/meeting-tracker/program-briefing-service.js';

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Method not allowed' }); }
  const access = await requireAppAccess(req, res, 'meeting-tracker');
  if (!access) return;
  if (!Number.isSafeInteger(access.profileId) || access.profileId < 1) return res.status(401).json({ error: 'An active staff profile is required.' });
  if (Object.keys(req.query).some((key) => key !== 'cycleCode') || (req.query.cycleCode !== undefined && typeof req.query.cycleCode !== 'string')) {
    return res.status(400).json({ error: 'Choose a single grant cycle.' });
  }
  return withDalContext('meeting-tracker-program-briefing', async () => {
    try {
      return res.status(200).json(await loadProgramBriefing({ cycleCode: req.query.cycleCode, profileId: access.profileId }));
    } catch (error) {
      const status = error.httpStatus || 500;
      if (status >= 500) console.error('[meeting tracker program briefing] read failed');
      return res.status(status).json({ error: status >= 500 ? 'The briefing could not be loaded. Please try again.' : error.message });
    }
  });
}
