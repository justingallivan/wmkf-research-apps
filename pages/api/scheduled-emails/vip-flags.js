/**
 * API: /api/scheduled-emails/vip-flags
 *
 * Authenticated self-service for the calling PD's own per-contact VIP review
 * flags (docs/SCHEDULED_EMAIL_VIP_DIGEST_PLAN.md Decisions 3-5). Mail whose
 * recipients include a flagged contact waits for this PD's explicit approval.
 * The PD identity always resolves server-side from the session profile; the
 * request supplies only the target contact GUID and the desired flag state.
 */

import { requireAuthWithProfile } from '../../../lib/utils/auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { isGuid } from '../../../lib/utils/guid';
import { resolveProfileToSystemUser } from '../../../lib/services/dataverse-identity-map';
import {
  clearScheduledEmailVipFlag,
  listScheduledEmailVipFlags,
  setScheduledEmailVipFlag,
} from '../../../lib/services/scheduled-email-store';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'PUT') {
    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const profileId = await requireAuthWithProfile(req, res);
  if (profileId === null) return;

  return withDalContext('scheduled-email-vip-flags', async () => {
    const user = await resolveProfileToSystemUser(profileId);
    if (!user?.systemuserid) {
      return res.status(403).json({ error: 'Your profile is not linked to an active Dynamics user.' });
    }

    if (req.method === 'GET') {
      const flags = await listScheduledEmailVipFlags(user.systemuserid);
      return res.status(200).json({
        flags: flags.map((row) => ({ contactId: row.contact_id, createdAt: row.created_at })),
      });
    }

    const { contactId, flagged } = req.body || {};
    if (!isGuid(contactId) || typeof flagged !== 'boolean') {
      return res.status(400).json({ error: 'A contact id and flag state are required.' });
    }

    if (flagged) {
      await setScheduledEmailVipFlag(user.systemuserid, contactId);
    } else {
      await clearScheduledEmailVipFlag(user.systemuserid, contactId);
    }
    return res.status(200).json({ contactId, flagged });
  });
}
