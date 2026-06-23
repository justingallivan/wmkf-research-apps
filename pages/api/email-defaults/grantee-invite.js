/**
 * API Route: /api/email-defaults/grantee-invite
 *
 * Profile-readable endpoint for the grantee invite subject/body defaults.
 * Consumers are wired in Chunk 2; this route is additive storage plumbing.
 */

import { requireAuthWithProfile } from '../../../lib/utils/auth';
import { getSettingStrict } from '../../../lib/services/settings-service';

const SUBJECT_KEY = 'email.grantee_invite.subject';
const BODY_KEY = 'email.grantee_invite.body';

async function readTextSetting(key) {
  try {
    const result = await getSettingStrict(key);
    return {
      value: result?.found ? String(result.value ?? '') : '',
      unavailable: false,
    };
  } catch (error) {
    console.error(`[email-defaults/grantee-invite] strict read failed for ${key}:`, error.message);
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

  const subject = await readTextSetting(SUBJECT_KEY);
  const body = await readTextSetting(BODY_KEY);
  return res.status(200).json({
    subject: subject.value,
    body: body.value,
    configured: subject.value.trim() !== '' && body.value.trim() !== '',
    unavailable: subject.unavailable || body.unavailable,
  });
}
