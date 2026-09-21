import { requireAppAccess } from '../../../lib/utils/auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import {
  MATERIALS_EMAIL_KINDS,
  loadPersonalMaterialsTemplate,
  savePersonalMaterialsTemplate,
  clearPersonalMaterialsTemplate,
  sharedMaterialsEmailDefaults,
  validateMaterialsEmailTemplate,
  MATERIALS_EMAIL_PREFERENCE_KEYS,
  mergeMaterialsEmailTemplate,
  materialsEmailOverrides,
} from '../../../lib/services/site-visit-materials/email-personalization';

function kindOf(value) {
  return Object.values(MATERIALS_EMAIL_KINDS).includes(String(value || '').trim())
    ? String(value).trim() : null;
}

export default async function handler(req, res) {
  if (!['GET', 'PUT', 'DELETE'].includes(req.method)) {
    res.setHeader('Allow', 'GET, PUT, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const access = await requireAppAccess(req, res, 'meeting-tracker');
  if (!access) return;
  const kind = kindOf(req.method === 'GET' ? req.query.kind : req.body?.kind);
  if (!kind) return res.status(400).json({ error: 'A valid email kind is required.' });
  if (req.method === 'PUT' && Object.keys(req.body || {}).some((key) => !['kind', 'template'].includes(key))) {
    return res.status(400).json({ error: 'The preference request contains unsupported fields.' });
  }
  if (req.method === 'DELETE' && Object.keys(req.body || {}).some((key) => key !== 'kind')) {
    return res.status(400).json({ error: 'The preference request contains unsupported fields.' });
  }

  try {
    return await withDalContext('meeting-tracker-materials-email-preferences', async () => {
      const shared = await sharedMaterialsEmailDefaults(kind);
      if (!shared.ok) return res.status(503).json({ error: 'The shared email default is unavailable.' });
      if (req.method === 'GET') {
        const override = await loadPersonalMaterialsTemplate(access.profileId, kind);
        return res.status(200).json({ kind, configured: Boolean(override), override, shared: shared.template, template: mergeMaterialsEmailTemplate(shared.template, override) });
      }
      if (req.method === 'DELETE') {
        const ok = await clearPersonalMaterialsTemplate(access.profileId, kind);
        return res.status(ok ? 200 : 500).json({ ok, kind });
      }
      const candidate = req.body?.template;
      const checked = validateMaterialsEmailTemplate(kind, candidate);
      if (!checked.valid) return res.status(400).json({ error: 'The email template is invalid.', issues: checked.errors });
      const overrides = materialsEmailOverrides(checked.value, shared.template);
      if (Object.keys(overrides).length === 0) {
        const cleared = await clearPersonalMaterialsTemplate(access.profileId, kind);
        if (!cleared) return res.status(500).json({ error: 'Failed to save the email template.' });
        return res.status(200).json({ ok: true, kind, template: {} });
      }
      const result = await savePersonalMaterialsTemplate(access.profileId, kind, overrides);
      if (!result.ok) return res.status(result.errors?.includes('persistence') ? 500 : 400).json({ error: 'The email template is invalid.', issues: result.errors });
      return res.status(200).json({ ok: true, kind, template: result.value });
    });
  } catch (error) {
    console.error('Materials email preference error:', error);
    return res.status(500).json({ error: 'Materials email preferences are unavailable.' });
  }
}
