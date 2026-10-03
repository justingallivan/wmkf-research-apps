import { sql } from '@vercel/postgres';
import { requireAuth } from '../../../lib/utils/auth';
import { isMeetingTranscriptionRehearsalReady } from '../../../lib/services/meeting-tracker-transcription/test-deployment-policy';
import { validateMeetingTranscriptionRehearsalResources } from '../../../lib/services/meeting-tracker-transcription/rehearsal-resources';
import rehearsalFixture from '../../../lib/services/meeting-tracker-transcription/rehearsal-fixture';
import {
  getMeetingTranscriptionRehearsalCollection,
  getMeetingTranscriptionRehearsalJob,
  saveMeetingTranscriptionRehearsalSpeakers,
  downloadMeetingTranscriptionRehearsal,
} from '../../../lib/services/meeting-tracker-transcription/rehearsal-service';

const EXPECTED_AZURE_OID = '893369cc-1925-40ec-bbc6-6f12b0684a31';
const JOB_ID = rehearsalFixture.REHEARSAL_JOB_ID;

function fail(res, status, error) {
  return res.status(status).json({ error });
}

function cleanQuery(req) {
  const keys = Object.keys(req.query || {}).filter((key) => key !== 'path');
  return keys;
}

async function authenticatePinnedStaff(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return null;
  if (session.authBypassed || session.user?.userType === 'applicant'
    || String(session.user?.azureId || '').toLowerCase() !== EXPECTED_AZURE_OID
    || Number(session.user?.profileId) !== rehearsalFixture.REHEARSAL_OWNER_PROFILE_ID) {
    fail(res, 403, 'rehearsal_identity_denied');
    return null;
  }
  const result = await sql`
    SELECT id, azure_id, is_active, needs_linking
      FROM user_profiles
     WHERE id = ${rehearsalFixture.REHEARSAL_OWNER_PROFILE_ID}
     LIMIT 1
  `;
  const profile = result.rows[0];
  if (!profile || String(profile.azure_id || '').toLowerCase() !== EXPECTED_AZURE_OID
    || profile.is_active !== true || profile.needs_linking !== false) {
    fail(res, 403, 'rehearsal_identity_denied');
    return null;
  }
  return rehearsalFixture.REHEARSAL_OWNER_PROFILE_ID;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  // All deployment/resource controls run before auth (which reads Postgres),
  // fixture lookups, projections, or Blob access.
  if (!isMeetingTranscriptionRehearsalReady()) return fail(res, 404, 'not_found');
  const resources = validateMeetingTranscriptionRehearsalResources();
  if (!resources.ready) return fail(res, 503, 'rehearsal_resources_unavailable');

  if (req.query?.path !== undefined && (!Array.isArray(req.query.path)
      || req.query.path.some((segment) => typeof segment !== 'string'))) return fail(res, 404, 'not_found');
  const path = Array.isArray(req.query?.path) ? req.query.path : [];
  const format = req.query?.format;
  let action;
  if (path.length === 0 && req.method === 'GET' && cleanQuery(req).length === 0) action = 'collection';
  else if (path.length === 1 && path[0] === JOB_ID && req.method === 'GET' && cleanQuery(req).length === 0) action = 'job';
  else if (path.length === 2 && path[0] === JOB_ID && path[1] === 'download' && req.method === 'GET'
    && cleanQuery(req).length === 1 && Array.isArray(format) === false
    && ['txt', 'vtt'].includes(format)) action = 'download';
  else if (path.length === 2 && path[0] === JOB_ID && path[1] === 'speakers'
    && req.method === 'PATCH' && cleanQuery(req).length === 0) action = 'speakers';
  else return fail(res, 404, 'not_found');

  try {
    const profileId = await authenticatePinnedStaff(req, res);
    if (profileId === null) return;
    if (action === 'collection') return res.status(200).json(await getMeetingTranscriptionRehearsalCollection());
    if (action === 'job') return res.status(200).json(await getMeetingTranscriptionRehearsalJob(JOB_ID));
    if (action === 'speakers') {
      const keys = Object.keys(req.body || {}).sort();
      if (keys.join(',') !== 'expectedVersion,speakerNames'
        || !Number.isSafeInteger(req.body.expectedVersion) || req.body.expectedVersion < 1
        || !req.body.speakerNames || typeof req.body.speakerNames !== 'object'
        || Array.isArray(req.body.speakerNames)) return fail(res, 400, 'invalid_rehearsal_request');
      const result = await saveMeetingTranscriptionRehearsalSpeakers({
        jobId: JOB_ID,
        actorProfileId: profileId,
        expectedVersion: req.body.expectedVersion,
        speakerNames: req.body.speakerNames,
      });
      return res.status(200).json(result);
    }
    const download = await downloadMeetingTranscriptionRehearsal({ jobId: JOB_ID, format });
    res.setHeader('Content-Type', download.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${download.filename}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).send(download.bytes);
  } catch (error) {
    const status = Number.isInteger(error?.httpStatus) ? error.httpStatus
      : Number.isInteger(error?.status) ? error.status : 503;
    return fail(res, status, /^[a-z0-9_]+$/.test(error?.code || '') ? error.code : 'rehearsal_unavailable');
  }
}
