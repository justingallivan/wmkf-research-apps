/** Authenticated review/actions for one scheduled personalized email. */

import { requireAuthWithProfile } from '../../../lib/utils/auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { isGuid } from '../../../lib/utils/guid';
import { resolveProfileToSystemUser } from '../../../lib/services/dataverse-identity-map';
import {
  approveScheduledEmail,
  getScheduledEmailForPd,
  stopScheduledEmail,
  updateScheduledEmailDraft,
} from '../../../lib/services/scheduled-email-store';
import {
  deliverScheduledEmail,
  projectScheduledEmail,
} from '../../../lib/services/scheduled-email-service';

const MAX_SUBJECT = 300;
const MAX_BODY = 20000;

function validVersion(value) {
  return Number.isInteger(value) && value >= 1;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'PATCH') {
    res.setHeader('Allow', 'GET, PATCH');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const id = req.query?.id;
  if (!isGuid(id)) return res.status(400).json({ error: 'Invalid scheduled email id.' });

  const profileId = await requireAuthWithProfile(req, res);
  if (profileId === null) return;

  return withDalContext('scheduled-email-action', async () => {
    const user = await resolveProfileToSystemUser(profileId);
    if (!user?.systemuserid) {
      return res.status(403).json({ error: 'Your profile is not linked to an active Dynamics user.' });
    }

    const existing = await getScheduledEmailForPd(id, user.systemuserid);
    if (!existing) return res.status(404).json({ error: 'Scheduled email not found.' });
    if (req.method === 'GET') {
      return res.status(200).json({ message: projectScheduledEmail(existing) });
    }

    const { action, version } = req.body || {};
    if (!validVersion(version)) {
      return res.status(400).json({ error: 'A valid message version is required.' });
    }

    let updated = null;
    if (action === 'edit') {
      const subject = typeof req.body.subject === 'string' ? req.body.subject.trim() : '';
      const bodyText = typeof req.body.bodyText === 'string' ? req.body.bodyText.trim() : '';
      if (!subject || subject.length > MAX_SUBJECT || bodyText.length < 10 || bodyText.length > MAX_BODY) {
        return res.status(400).json({ error: 'Subject and message body are required and must fit the allowed length.' });
      }
      updated = await updateScheduledEmailDraft({
        id,
        pdSystemUserId: user.systemuserid,
        profileId,
        expectedVersion: version,
        subject,
        bodyText,
      });
    } else if (action === 'approve') {
      updated = await approveScheduledEmail({
        id,
        pdSystemUserId: user.systemuserid,
        profileId,
        expectedVersion: version,
      });
    } else if (action === 'stop') {
      updated = await stopScheduledEmail({
        id,
        pdSystemUserId: user.systemuserid,
        profileId,
        expectedVersion: version,
      });
    } else if (action === 'send_now') {
      try {
        const outcome = await deliverScheduledEmail(id, {
          force: true,
          pdSystemUserId: user.systemuserid,
          expectedVersion: version,
        });
        if (!outcome.message) {
          return res.status(409).json({ error: 'The message changed or is already being processed. Reload and try again.' });
        }
        return res.status(200).json({ message: outcome.message });
      } catch (error) {
        console.error('[scheduled-email/send-now] failed:', error.message);
        return res.status(502).json({ error: 'The message could not be sent. It remains available for retry.' });
      }
    } else {
      return res.status(400).json({ error: 'Unknown scheduled email action.' });
    }

    if (!updated) {
      return res.status(409).json({ error: 'The message changed or is already being processed. Reload and try again.' });
    }
    return res.status(200).json({ message: projectScheduledEmail(updated) });
  });
}
