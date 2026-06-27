/**
 * API Route: /api/email-defaults/reviewer-templates
 *
 * Profile-readable endpoint for the four PD-composed reviewer email templates
 * (invitation, materials, follow-up, thank-you) admin org defaults, stored in
 * Dataverse `wmkf_appsystemsetting`. These are the org-wide defaults edited in
 * the admin "Email Defaults" panel; a per-PD override is layered on top
 * client-side by shared/components/reviewers/email-template-store.js.
 *
 * Strict reads so an outage returns unavailable:true instead of silently blank.
 */

import { requireAuthWithProfile } from '../../../lib/utils/auth';
import { getSettingStrict } from '../../../lib/services/settings-service';

const TYPES = ['invitation', 'materials', 'followup', 'thankyou'];

async function readTextSetting(key) {
  try {
    const result = await getSettingStrict(key);
    return { value: result?.found ? String(result.value ?? '') : '', unavailable: false };
  } catch (error) {
    console.error(`[email-defaults/reviewer-templates] strict read failed for ${key}:`, error.message);
    return { value: '', unavailable: true };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const profileId = await requireAuthWithProfile(req, res);
  if (profileId === null) return;

  const templates = {};
  let unavailable = false;
  let configured = true;
  for (const type of TYPES) {
    const subject = await readTextSetting(`email.reviewer_${type}.subject`);
    const body = await readTextSetting(`email.reviewer_${type}.body`);
    templates[type] = { subject: subject.value, body: body.value };
    unavailable = unavailable || subject.unavailable || body.unavailable;
    if (subject.value.trim() === '' || body.value.trim() === '') configured = false;
  }

  return res.status(200).json({ templates, configured, unavailable });
}
