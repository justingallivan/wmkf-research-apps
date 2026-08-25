/** Authenticated list of the current PD's scheduled personalized emails. */

import { requireAuthWithProfile } from '../../../lib/utils/auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { resolveProfileToSystemUser } from '../../../lib/services/dataverse-identity-map';
import { listScheduledEmailsForPd } from '../../../lib/services/scheduled-email-store';
import { projectScheduledEmail } from '../../../lib/services/scheduled-email-service';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const profileId = await requireAuthWithProfile(req, res);
  if (profileId === null) return;

  return withDalContext('scheduled-emails-list', async () => {
    const user = await resolveProfileToSystemUser(profileId);
    if (!user?.systemuserid) {
      return res.status(403).json({ error: 'Your profile is not linked to an active Dynamics user.' });
    }
    const rows = await listScheduledEmailsForPd(user.systemuserid);
    return res.status(200).json({ messages: rows.map(projectScheduledEmail) });
  });
}
