/**
 * API Route: /api/admin/secrets
 *
 * GET — Secret expiration status for all tracked secrets
 * PUT — Update rotation/expiration date for a secret
 *   Body: { key, rotationDate?, expirationDate? }
 *
 * Superuser only.
 */

import { requireSuperuser } from '../../../lib/utils/auth';
import { listSettingsWithMeta, setSetting } from '../../../lib/services/settings-service';
import { TRACKED_SECRETS } from '../../../lib/utils/tracked-secrets';

export default async function handler(req, res) {
  const gate = await requireSuperuser(req, res);
  if (!gate) return;
  const { profileId } = gate;

  if (req.method === 'GET') {
    try {
      const [expirations, rotations] = await Promise.all([
        listSettingsWithMeta('secret_expiration:'),
        listSettingsWithMeta('secret_rotation:'),
      ]);
      const settingsMap = { ...expirations, ...rotations };

      const now = new Date();
      const secrets = TRACKED_SECRETS.map(secret => {
        const expEntry = settingsMap[`secret_expiration:${secret.key}`];
        const rotEntry = settingsMap[`secret_rotation:${secret.key}`];

        let daysUntilExpiry = null;
        let status = 'not_tracked';
        if (expEntry) {
          const expDate = new Date(expEntry.value);
          daysUntilExpiry = Math.ceil((expDate - now) / (24 * 60 * 60 * 1000));
          if (daysUntilExpiry <= 0) status = 'expired';
          else if (daysUntilExpiry <= 7) status = 'critical';
          else if (daysUntilExpiry <= 14) status = 'warning';
          else if (daysUntilExpiry <= 30) status = 'attention';
          else status = 'ok';
        }

        return {
          key: secret.key,
          name: secret.name,
          expirationDate: expEntry?.value || null,
          lastRotated: rotEntry?.value || null,
          daysUntilExpiry,
          status,
        };
      });

      return res.json({ secrets });
    } catch (error) {
      console.error('Admin secrets GET error:', error);
      return res.status(500).json({ error: 'Failed to fetch secret status' });
    }
  }

  if (req.method === 'PUT') {
    try {
      const { key, rotationDate, expirationDate } = req.body;
      if (!key) {
        return res.status(400).json({ error: 'Missing secret key' });
      }

      // Validate the key is one we track
      if (!TRACKED_SECRETS.find(s => s.key === key)) {
        return res.status(400).json({ error: 'Unknown secret key' });
      }

      if (rotationDate) {
        await setSetting(`secret_rotation:${key}`, rotationDate, profileId);
      }

      if (expirationDate) {
        await setSetting(`secret_expiration:${key}`, expirationDate, profileId);
      }

      return res.json({ ok: true });
    } catch (error) {
      console.error('Admin secrets PUT error:', error);
      return res.status(500).json({ error: 'Failed to update secret dates' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

