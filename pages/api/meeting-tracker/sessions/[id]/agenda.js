/** Prepare, send, and read the latest frozen agenda email for one session. */
import { requireAppAccess } from '../../../../../lib/utils/auth';
import { actorRefFromSession } from '../../../../../lib/utils/actor-ref';
import { isGuid } from '../../../../../lib/utils/guid';
import { withDalContext } from '../../../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../../../lib/services/service-http-error';
import {
  getAgendaStatus,
  prepareAgendaEmail,
  sendAgendaEmail,
} from '../../../../../lib/services/meeting-tracker/agenda-service';
import { isMeetingTrackerSchemaReady } from '../../../../../shared/config/meetingTracker';

export const config = {
  api: { bodyParser: { sizeLimit: '64kb' } },
  maxDuration: 300,
};

const PREPARE_FIELDS = new Set(['operationId', 'to', 'cc', 'subject', 'bodyText']);
const SEND_FIELDS = new Set(['operationId']);

function exactBody(body, allowed) {
  return body && typeof body === 'object' && !Array.isArray(body)
    && Object.keys(body).every((key) => allowed.has(key));
}

function sendError(res, error, operation) {
  if (error instanceof ServiceHttpError) {
    return res.status(error.httpStatus).json(error.body ?? { error: error.message, code: error.code });
  }
  console.error(`meeting tracker agenda ${operation} error:`, error);
  const message = operation === 'send'
    ? 'The agenda send could not be completed. Check the last agenda before trying again. If the problem continues, contact an administrator.'
    : 'The agenda could not be loaded or prepared. Please try again. If the problem continues, contact an administrator.';
  return res.status(500).json({ error: message });
}

export default async function handler(req, res) {
  if (!['GET', 'POST', 'PATCH'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST, PATCH');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const sessionId = Array.isArray(req.query.id) ? '' : req.query.id;
  if (!isGuid(sessionId || '')) {
    return res.status(400).json({ error: 'A valid session id is required.' });
  }
  const access = await requireAppAccess(req, res, 'meeting-tracker');
  if (!access) return;
  if (!isMeetingTrackerSchemaReady()) {
    return res.status(503).json({
      error: 'Meeting Tracker is not enabled for this environment.',
      code: 'meeting_tracker_schema_not_ready',
    });
  }
  if (req.method === 'POST' && !exactBody(req.body, PREPARE_FIELDS)) {
    return res.status(400).json({ error: 'The agenda preview request contains unsupported fields.' });
  }
  if (req.method === 'PATCH' && !exactBody(req.body, SEND_FIELDS)) {
    return res.status(400).json({ error: 'The agenda send request contains unsupported fields.' });
  }

  const fromEmail = String(access.session?.user?.azureEmail || '').trim().toLowerCase();
  if (req.method !== 'GET' && !fromEmail) {
    return res.status(400).json({ error: 'Your account has no sending email address.' });
  }
  const actingUserSystemId = actorRefFromSession(access.session);

  return withDalContext('meeting-tracker-session-agenda', async () => {
    try {
      if (req.method === 'GET') {
        return res.status(200).json(await getAgendaStatus({ sessionId }));
      }
      if (req.method === 'POST') {
        const result = await prepareAgendaEmail({
          sessionId,
          ...req.body,
          fromEmail,
          actingUserSystemId,
        });
        return res.status(200).json({ success: true, ...result });
      }
      const result = await sendAgendaEmail({
        sessionId,
        operationId: req.body.operationId,
        fromEmail,
        actingUserSystemId,
      });
      return res.status(200).json({ success: true, ...result });
    } catch (error) {
      return sendError(res, error, req.method === 'PATCH' ? 'send' : 'prepare');
    }
  });
}
