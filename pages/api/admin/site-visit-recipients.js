/**
 * Superuser editor for the curated Site Visit materials-recipient directory.
 *
 * GET returns current configuration + eligible staff. GET with `search`
 * returns Dataverse Contact candidates. PUT replaces the reference-only config.
 */

import { requireSuperuser } from '../../../lib/utils/auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import {
  getCuratedRecipientAdminState,
  searchCuratedRecipientContacts,
  writeCuratedRecipientConfig,
} from '../../../lib/services/site-visit/curated-recipient-service';

export const config = {
  api: { bodyParser: { sizeLimit: '32kb' } },
};

function sendError(res, error) {
  if (error instanceof ServiceHttpError) {
    return res.status(error.httpStatus).json(error.body ?? { error: error.message, code: error.code });
  }
  console.error('admin Site Visit recipients error:', error);
  return res.status(500).json({ error: 'The Site Visit recipient directory operation failed.' });
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'PUT') {
    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const gate = await requireSuperuser(req, res);
  if (!gate) return;

  return withDalContext('admin-site-visit-recipient-directory', async () => {
    try {
      if (req.method === 'GET') {
        const unsupported = Object.keys(req.query || {}).filter((key) => key !== 'search');
        if (unsupported.length) {
          return res.status(400).json({ error: 'The recipient-directory request contains unsupported query parameters.' });
        }
        if (req.query.search !== undefined) {
          if (Array.isArray(req.query.search)) {
            return res.status(400).json({ error: 'Contact search must be a single value.' });
          }
          const contacts = await searchCuratedRecipientContacts(req.query.search);
          return res.status(200).json({ success: true, contacts });
        }
        const state = await getCuratedRecipientAdminState();
        return res.status(200).json({ success: true, ...state });
      }

      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)
        || Object.keys(req.body).length !== 1 || !Object.hasOwn(req.body, 'config')) {
        return res.status(400).json({ error: 'The request body must contain only config.' });
      }
      const result = await writeCuratedRecipientConfig(req.body.config, gate.profileId);
      return res.status(200).json({ success: true, ...result });
    } catch (error) {
      return sendError(res, error);
    }
  });
}
