/**
 * API: /api/email-automation-preferences
 *
 * Authenticated self-service read/write for the PD's review-all override
 * ({ reviewAll: boolean }): whether every automated email waits for their
 * approval, or only mail to their VIP-flagged recipients. The generic
 * preference route reserves this key so the bounded contract cannot be
 * bypassed.
 */

import { DatabaseService } from '../../lib/services/database-service';
import { withDalContext } from '../../lib/dataverse/core/context';
import { requireAuthWithProfile } from '../../lib/utils/auth';
import { PREFERENCE_KEYS } from '../../shared/config/reviewerFinderPreferences';
import {
  normalizeEmailAutomationPreference,
  serializeEmailAutomationPreference,
} from '../../shared/config/emailAutomation';

export default async function handler(req, res) {
  const profileId = await requireAuthWithProfile(req, res);
  if (profileId === null) return;

  if (req.method !== 'GET' && req.method !== 'PUT') {
    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  return withDalContext('email-automation-preferences', async () => {
    if (req.method === 'GET') {
      const preferences = await DatabaseService.getUserPreferences(profileId, false);
      const raw = preferences[PREFERENCE_KEYS.EMAIL_AUTOMATION];
      const preference = normalizeEmailAutomationPreference(raw);
      return res.status(200).json({
        configured: preference !== null,
        preference,
      });
    }

    const preference = normalizeEmailAutomationPreference(req.body);
    if (!preference) {
      return res.status(400).json({
        error: 'Choose whether every automated email should wait for your review.',
      });
    }

    const success = await DatabaseService.setUserPreference(
      profileId,
      PREFERENCE_KEYS.EMAIL_AUTOMATION,
      serializeEmailAutomationPreference(preference),
      false,
    );
    if (!success) {
      return res.status(500).json({ error: 'Failed to save email automation preference.' });
    }
    return res.status(200).json({ configured: true, preference });
  });
}
