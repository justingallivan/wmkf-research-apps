/**
 * API Route: /api/admin/alert-recipients
 *
 * GET — Returns the per-category recipient config plus a preview of the
 *   recipients that would be used if no category override is set
 *   (the active superuser roster — the legacy fallback).
 *
 * PUT — Body: { config: { [category]: string[] } }
 *   Replaces the full config. Validates every email; rejects with 400 + the
 *   list of errors. Empty categories are dropped before writing.
 *
 * Superuser only. Writes go through DataverseSettingsService → key
 * `alertRecipientsByCategory` in `wmkf_appsystemsettings`.
 */

import { requireSuperuser } from '../../../lib/utils/auth';
import AlertRecipients from '../../../lib/services/alert-recipients';

export default async function handler(req, res) {
  const gate = await requireSuperuser(req, res);
  if (!gate) return;
  const { profileId } = gate;

  if (req.method === 'GET') {
    try {
      const config = await AlertRecipients.readConfig();
      const roster = await AlertRecipients.getSuperuserRoster();
      return res.json({
        config,
        seedCategories: AlertRecipients.SEED_CATEGORIES,
        fallbackRoster: roster,
      });
    } catch (error) {
      console.error('Admin alert-recipients GET error:', error);
      return res.status(500).json({ error: 'Failed to load alert recipients' });
    }
  }

  if (req.method === 'PUT') {
    try {
      const { config } = req.body || {};
      const result = await AlertRecipients.writeConfig(config, profileId);
      if (!result.ok) {
        return res.status(400).json({ error: 'Invalid config', details: result.errors });
      }
      return res.json({ ok: true });
    } catch (error) {
      console.error('Admin alert-recipients PUT error:', error);
      return res.status(500).json({ error: 'Failed to save alert recipients' });
    }
  }

  res.setHeader('Allow', 'GET, PUT');
  return res.status(405).json({ error: 'Method not allowed' });
}
