/**
 * API Route: /api/admin/email-defaults
 *
 * Superuser editor endpoint for admin-editable email/text defaults stored in
 * Dataverse `wmkf_appsystemsettings`.
 */

import { requireSuperuser } from '../../../lib/utils/auth';
import { getSettingStrict, setSetting } from '../../../lib/services/settings-service';
import {
  EDITABLE_TEXT_DEFAULTS,
  EDITABLE_TEXT_DEFAULTS_BY_KEY,
} from '../../../shared/config/editableTextDefaults';

async function readDefault(entry) {
  try {
    const result = await getSettingStrict(entry.key);
    return {
      ...entry,
      value: result?.found ? String(result.value ?? '') : '',
      unavailable: false,
    };
  } catch (error) {
    console.error(`[admin/email-defaults] strict read failed for ${entry.key}:`, error.message);
    return {
      ...entry,
      value: '',
      unavailable: true,
    };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'PUT') {
    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const gate = await requireSuperuser(req, res);
  if (!gate) return;

  if (req.method === 'GET') {
    const defaults = [];
    for (const entry of EDITABLE_TEXT_DEFAULTS) {
      defaults.push(await readDefault(entry));
    }
    return res.status(200).json({ defaults });
  }

  const { key, value } = req.body || {};
  if (!EDITABLE_TEXT_DEFAULTS_BY_KEY[key]) {
    return res.status(400).json({ error: 'Unknown email default key' });
  }
  if (typeof value !== 'string') {
    return res.status(400).json({ error: 'value must be a string' });
  }
  const entry = EDITABLE_TEXT_DEFAULTS_BY_KEY[key];
  const missingPlaceholders = (entry.requiredPlaceholders || []).filter((token) => !value.includes(token));
  if (missingPlaceholders.length > 0) {
    return res.status(400).json({
      error: `Required placeholders missing: ${missingPlaceholders.join(', ')}`,
    });
  }

  const ok = await setSetting(key, value, gate.profileId);
  if (!ok) {
    return res.status(500).json({ error: 'Failed to save email default' });
  }
  return res.status(200).json({ key, value });
}
