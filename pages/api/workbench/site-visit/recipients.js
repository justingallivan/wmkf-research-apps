/** Read-only WMKF staff + Board/Consultant directory for Site Visit attendees. */

import { requireAppAccess } from '../../../../lib/utils/auth';
import { withDalContext } from '../../../../lib/dataverse/core/context';
import { getSiteVisitRecipientDirectory } from '../../../../lib/services/site-visit/recipient-directory-service';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;
  return withDalContext('workbench-site-visit-recipient-directory', async () => {
    try {
      const directory = await getSiteVisitRecipientDirectory();
      return res.status(200).json({
        success: true,
        staff: directory.staff.map(({ systemUserId: _systemUserId, ...row }) => row),
        external: directory.external,
      });
    } catch (error) {
      console.error('workbench Site Visit recipient directory error:', error);
      return res.status(500).json({ error: 'The Site Visit recipient directory could not be loaded.' });
    }
  });
}
