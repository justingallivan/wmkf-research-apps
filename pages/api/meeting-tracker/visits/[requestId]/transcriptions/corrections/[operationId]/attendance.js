import { requireAppAccess } from '../../../../../../../../lib/utils/auth.js';
import { withDalContext } from '../../../../../../../../lib/dataverse/core/context.js';
import { isGuid } from '../../../../../../../../lib/utils/guid.js';
import { ServiceHttpError } from '../../../../../../../../lib/services/service-http-error.js';
import { prepareMeetingAttendance } from '../../../../../../../../lib/services/meeting-tracker-transcription/service.js';

export const config = { api: { bodyParser: { sizeLimit: '4kb' } }, maxDuration: 300 };
export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow','POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  const requestId = Array.isArray(req.query.requestId) ? '' : String(req.query.requestId || '').trim();
  const operationId = Array.isArray(req.query.operationId) ? '' : String(req.query.operationId || '').trim();
  if (!isGuid(requestId) || !isGuid(operationId)) return res.status(400).json({ error: 'A valid request and correction id are required.' });
  const access = await requireAppAccess(req, res, 'meeting-tracker');
  if (!access) return;
  if (!Number.isSafeInteger(access.profileId) || access.profileId < 1) return res.status(401).json({ error: 'An active linked staff profile is required.' });
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1
    || Object.keys(body)[0] !== 'expectedVersion' || !Number.isSafeInteger(body.expectedVersion)) return res.status(400).json({ error: 'The attendance request is invalid.' });
  res.setHeader('Cache-Control','private, no-store');
  return withDalContext('meeting-tracker-transcript-attendance', async () => {
    try { return res.status(200).json(await prepareMeetingAttendance({ requestId, ownerProfileId: access.profileId,
      operationId, expectedVersion: body.expectedVersion })); }
    catch (error) {
      const status = error instanceof ServiceHttpError ? error.httpStatus : Number(error?.httpStatus || error?.status) || 500;
      const code = error?.code || 'meeting_attendance_failed';
      if (status >= 500) console.error('[meeting tracker transcript attendance] failed:', code);
      return res.status(status).json(error?.body || { error: status >= 500 ? 'Attendance could not be loaded.' : error.message, code });
    }
  });
}
