/** Authenticated, closed-shape staff telemetry for direct Blob upload failures. */

import { requireAppAccess } from '../../../../lib/utils/auth';
import { isGuid } from '../../../../lib/utils/guid';
import {
  parsePortalUploadFailure,
  recordPortalUploadClientFailure,
} from '../../../../lib/services/portal-upload-client-failure';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false });
  }
  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;

  const requestId = typeof req.body?.requestId === 'string' ? req.body.requestId.trim() : '';
  const report = parsePortalUploadFailure(req.body);
  if (!isGuid(requestId) || !report) return res.status(400).json({ ok: false });
  await recordPortalUploadClientFailure({
    surface: 'staff_grantee_replacement',
    resourceId: requestId,
    report,
  });
  return res.status(200).json({ ok: true });
}

export const config = { api: { bodyParser: { sizeLimit: '4kb' } } };
