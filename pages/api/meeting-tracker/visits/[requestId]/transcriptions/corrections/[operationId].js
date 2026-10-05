import { requireAppAccess } from '../../../../../../../lib/utils/auth.js';
import { withDalContext } from '../../../../../../../lib/dataverse/core/context.js';
import { isGuid } from '../../../../../../../lib/utils/guid.js';
import { ServiceHttpError } from '../../../../../../../lib/services/service-http-error.js';
import { getMeetingCorrectionDraft, updateMeetingCorrection } from '../../../../../../../lib/services/meeting-tracker-transcription/service.js';

export const config = { api: { bodyParser: { sizeLimit: '64kb' } }, maxDuration: 60 };
export default async function handler(req, res) {
  if (!['GET','PATCH'].includes(req.method)) { res.setHeader('Allow','GET, PATCH'); return res.status(405).json({ error: 'Method not allowed' }); }
  const requestId = Array.isArray(req.query.requestId) ? '' : String(req.query.requestId || '').trim();
  const operationId = Array.isArray(req.query.operationId) ? '' : String(req.query.operationId || '').trim();
  if (!isGuid(requestId) || !isGuid(operationId)) return res.status(400).json({ error: 'A valid request and correction id are required.' });
  const access = await requireAppAccess(req, res, 'meeting-tracker');
  if (!access) return;
  if (!Number.isSafeInteger(access.profileId) || access.profileId < 1) return res.status(401).json({ error: 'An active linked staff profile is required.' });
  if (req.method === 'PATCH') {
    const body = req.body;
    // The two-key shape leaves the presentation end untouched; the three-key shape sets it or clears it (null).
    const keys = body && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body).sort().join(',') : '';
    if (!['expectedVersion,speakerNames', 'expectedVersion,presentationEndMs,speakerNames'].includes(keys)
      || !Number.isSafeInteger(body.expectedVersion)) return res.status(400).json({ error: 'The correction-label request is invalid.' });
  }
  res.setHeader('Cache-Control','private, no-store');
  return withDalContext('meeting-tracker-transcript-correction', async () => {
    try {
      const value = req.method === 'GET'
        ? await getMeetingCorrectionDraft({ requestId, operationId })
        : await updateMeetingCorrection({ requestId, ownerProfileId: access.profileId, operationId, body: req.body });
      return res.status(200).json(value);
    } catch (error) {
      const status = error instanceof ServiceHttpError ? error.httpStatus : Number(error?.httpStatus) || 500;
      const code = error?.code || 'meeting_transcript_correction_failed';
      if (status >= 500) console.error('[meeting tracker transcript correction] failed:', code);
      return res.status(status).json(error?.body || { error: status >= 500 ? 'The correction could not be processed.' : error.message, code });
    }
  });
}
