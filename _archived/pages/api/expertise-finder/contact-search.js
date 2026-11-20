/** Bounded existing-Contact search/read for the Expertise Finder roster editor. */

import { requireAppAccess } from '../../../lib/utils/auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import { isGuid } from '../../../lib/utils/guid';
import {
  getRosterContactById,
  normalizeRosterContactSearchQuery,
  searchRosterContacts,
} from '../../../lib/services/expertise-finder/roster-contact-link-service';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const access = await requireAppAccess(req, res, 'expertise-finder');
  if (!access) return;

  const keys = Object.keys(req.query || {});
  if (keys.length !== 1 || !['q', 'contactId'].includes(keys[0]) || typeof req.query[keys[0]] !== 'string') {
    return res.status(400).json({
      error: 'Exactly one scalar q or contactId query parameter is required.',
      code: 'expertise_roster_contact_search_invalid',
    });
  }

  if (keys[0] === 'contactId') {
    const contactId = req.query.contactId.trim().toLowerCase();
    if (!isGuid(contactId)) {
      return res.status(400).json({
        error: 'contactId must be a GUID.',
        code: 'expertise_roster_contact_search_invalid',
      });
    }
    return withDalContext('expertise-finder-roster-contact-read', async () => {
      try {
        return res.status(200).json({
          success: true,
          contact: await getRosterContactById(contactId),
        });
      } catch (error) {
        console.error('Expertise Finder contact read error:', error);
        return res.status(500).json({ error: 'Failed to read the linked Dataverse contact.' });
      }
    });
  }

  let query;
  try {
    query = normalizeRosterContactSearchQuery(req.query.q);
  } catch (error) {
    return res.status(error.httpStatus || 400).json(error.body ?? { error: error.message });
  }

  return withDalContext('expertise-finder-roster-contact-search', async () => {
    try {
      return res.status(200).json({ success: true, ...(await searchRosterContacts(query)) });
    } catch (error) {
      if (error instanceof ServiceHttpError) {
        return res.status(error.httpStatus).json(error.body ?? { error: error.message });
      }
      console.error('Expertise Finder contact search error:', error);
      return res.status(500).json({ error: 'Failed to search Dataverse contacts.' });
    }
  });
}
