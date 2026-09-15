/** Read-only Dataverse Contact search for the Expertise Finder roster editor. */

import * as contactAdapter from '../../dataverse/adapters/contact.js';
import { isGuid } from '../../utils/guid.js';
import { normalizeSiteVisitEmail } from '../../../shared/config/siteVisit.js';
import { ServiceHttpError } from '../service-http-error.js';

export const ROSTER_CONTACT_SEARCH_LIMIT = 50;
const ROSTER_CONTACT_SEARCH_PROBE_LIMIT = ROSTER_CONTACT_SEARCH_LIMIT + 1;

const DEFAULT_DEPENDENCIES = Object.freeze({
  searchContactsByName: contactAdapter.searchDirectoryByName,
  getContactsByIds: contactAdapter.getByIds,
});

function contactName(row) {
  return String(row?.fullname || [row?.firstname, row?.lastname].filter(Boolean).join(' ') || '').trim();
}

export function normalizeRosterContactSearchQuery(query) {
  const search = String(query || '').trim().replace(/\s+/g, ' ');
  if (search.length < 2 || search.length > 100) {
    throw new ServiceHttpError('Contact search must be between 2 and 100 characters.', {
      httpStatus: 400,
      code: 'expertise_roster_contact_search_invalid',
      body: {
        error: 'Contact search must be between 2 and 100 characters.',
        code: 'expertise_roster_contact_search_invalid',
      },
    });
  }
  return search;
}

function mapContact(row, requestedContactId = null) {
  const contactId = String(row?.contactid || requestedContactId || '').trim().toLowerCase();
  const name = contactName(row);
  const active = Boolean(row) && (row.statecode === undefined || row.statecode === 0);
  const email = active ? normalizeSiteVisitEmail(row.emailaddress1) : null;
  return {
    contactId,
    name,
    email,
    active,
    available: Boolean(active && name && email),
    reason: !row
      ? 'contact_missing'
      : !active
        ? 'contact_inactive'
        : !email
          ? 'contact_email_missing'
          : !name
            ? 'contact_name_missing'
            : null,
  };
}

export async function searchRosterContacts(query, dependencies = DEFAULT_DEPENDENCIES) {
  const search = normalizeRosterContactSearchQuery(query);
  const rows = await dependencies.searchContactsByName(search, {
    top: ROSTER_CONTACT_SEARCH_PROBE_LIMIT,
  });
  const seen = new Set();
  const contacts = [];
  for (const row of rows || []) {
    const contactId = String(row?.contactid || '').trim().toLowerCase();
    if (!isGuid(contactId) || seen.has(contactId)) continue;
    seen.add(contactId);
    contacts.push(mapContact(row));
  }
  return {
    contacts: contacts.slice(0, ROSTER_CONTACT_SEARCH_LIMIT),
    truncated: contacts.length > ROSTER_CONTACT_SEARCH_LIMIT,
    limit: ROSTER_CONTACT_SEARCH_LIMIT,
  };
}

export async function getRosterContactById(contactId, dependencies = DEFAULT_DEPENDENCIES) {
  const rows = await dependencies.getContactsByIds([contactId]);
  const match = (rows || []).find((row) => (
    String(row?.contactid || '').trim().toLowerCase() === contactId
  ));
  return mapContact(match || null, contactId);
}

export const ROSTER_CONTACT_LINK_DEPENDENCIES = DEFAULT_DEPENDENCIES;
