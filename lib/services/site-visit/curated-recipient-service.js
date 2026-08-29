/**
 * Admin-curated recipient options for the Site Visit materials composer.
 *
 * Dataverse `wmkf_appsystemsettings` stores only stable identity references:
 * active app profile IDs for staff and Dataverse Contact GUIDs for external
 * recipients. Names and email addresses are resolved live and are never copied
 * into the setting. The existing Site Visit attendee directory remains a
 * separate compatibility surface for attendee refs already saved on Activities.
 */

import { getSettingStrict, setSetting } from '../settings-service.js';
import * as contactAdapter from '../../dataverse/adapters/contact.js';
import { isGuid } from '../../utils/guid.js';
import { ServiceHttpError } from '../service-http-error.js';
import { getActiveStaffRecipientDirectory, normalizeSiteVisitEmail } from './recipient-directory-service.js';

export const CURATED_RECIPIENT_SETTING_KEY = 'site_visit.distribution_recipient_directory';
export const CURATED_RECIPIENT_VERSION = 1;
export const CURATED_RECIPIENT_MAX_ENTRIES = contactAdapter.CONTACT_BATCH_MAX_IDS;

const EXTERNAL_CATEGORIES = new Set(['consultant', 'board']);
const CONFIG_KEYS = new Set(['version', 'entries']);
const STAFF_KEYS = new Set(['kind', 'profileId']);
const CONTACT_KEYS = new Set(['kind', 'contactId', 'category']);

const DEFAULT_DEPENDENCIES = {
  getSettingStrict,
  setSetting,
  getActiveStaff: getActiveStaffRecipientDirectory,
  getContactsByIds: contactAdapter.getByIds,
  searchContactsByName: contactAdapter.searchDirectoryByName,
  findContactsByEmail: contactAdapter.findByEmailCandidates,
};

function serviceError(message, code, httpStatus = 400, body = null) {
  return new ServiceHttpError(message, {
    code,
    httpStatus,
    body: body || { error: message, code },
  });
}

function exactKeys(value, allowed) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every((key) => allowed.has(key));
}

export function validateCuratedRecipientConfig(input, { persisted = false } = {}) {
  const fail = (message) => {
    throw serviceError(
      message,
      persisted ? 'site_visit_recipient_config_invalid' : 'site_visit_recipient_config_rejected',
      persisted ? 503 : 400,
    );
  };
  if (!exactKeys(input, CONFIG_KEYS) || input.version !== CURATED_RECIPIENT_VERSION
    || !Array.isArray(input.entries)) {
    fail(`Recipient configuration must contain version ${CURATED_RECIPIENT_VERSION} and an entries array.`);
  }
  if (input.entries.length > CURATED_RECIPIENT_MAX_ENTRIES) {
    fail(`Recipient configuration supports at most ${CURATED_RECIPIENT_MAX_ENTRIES} entries.`);
  }

  const seen = new Set();
  const entries = input.entries.map((entry) => {
    if (entry?.kind === 'staff') {
      if (!exactKeys(entry, STAFF_KEYS) || !Number.isInteger(entry.profileId) || entry.profileId <= 0) {
        fail('Every staff entry must contain only kind="staff" and a positive integer profileId.');
      }
      const key = `staff:${entry.profileId}`;
      if (seen.has(key)) fail(`Duplicate recipient reference: ${key}.`);
      seen.add(key);
      return { kind: 'staff', profileId: entry.profileId };
    }
    if (entry?.kind === 'contact') {
      const contactId = String(entry.contactId || '').toLowerCase();
      if (!exactKeys(entry, CONTACT_KEYS) || !isGuid(contactId)
        || !EXTERNAL_CATEGORIES.has(entry.category)) {
        fail('Every contact entry must contain a Contact GUID and category "consultant" or "board".');
      }
      const key = `contact:${contactId}`;
      if (seen.has(key)) fail(`Duplicate recipient reference: ${key}.`);
      seen.add(key);
      return { kind: 'contact', contactId, category: entry.category };
    }
    fail('Recipient entry kind must be "staff" or "contact".');
    return null;
  });

  return { version: CURATED_RECIPIENT_VERSION, entries };
}

function parseStoredConfig(result) {
  if (!result?.found) return { version: CURATED_RECIPIENT_VERSION, entries: [] };
  let parsed;
  try {
    parsed = JSON.parse(String(result.value || ''));
  } catch {
    throw serviceError(
      'The saved Site Visit recipient configuration is not valid JSON.',
      'site_visit_recipient_config_invalid',
      503,
    );
  }
  return validateCuratedRecipientConfig(parsed, { persisted: true });
}

export async function readCuratedRecipientConfig(dependencies = DEFAULT_DEPENDENCIES) {
  let result;
  try {
    result = await dependencies.getSettingStrict(CURATED_RECIPIENT_SETTING_KEY);
  } catch (error) {
    throw serviceError(
      'The Site Visit recipient configuration could not be loaded.',
      'site_visit_recipient_config_unavailable',
      503,
      { error: 'The Site Visit recipient configuration could not be loaded.', code: 'site_visit_recipient_config_unavailable' },
    );
  }
  return parseStoredConfig(result);
}

function unavailable(entry, reason, detail) {
  return {
    ...entry,
    key: entry.kind === 'staff' ? `staff:${entry.profileId}` : `contact:${entry.contactId}`,
    available: false,
    reason,
    detail,
  };
}

function contactName(row) {
  return String(row?.fullname || [row?.firstname, row?.lastname].filter(Boolean).join(' ') || '').trim();
}

export async function resolveCuratedRecipientConfig(
  config,
  dependencies = DEFAULT_DEPENDENCIES,
  { staffOverride = null } = {},
) {
  const staffEntries = config.entries.filter((entry) => entry.kind === 'staff');
  const contactEntries = config.entries.filter((entry) => entry.kind === 'contact');
  const [staff, contactRows] = await Promise.all([
    staffEntries.length ? (staffOverride || dependencies.getActiveStaff()) : Promise.resolve([]),
    contactEntries.length
      ? dependencies.getContactsByIds(contactEntries.map((entry) => entry.contactId))
      : Promise.resolve([]),
  ]);
  const staffById = new Map((staff || []).map((row) => [Number(row.profileId), row]));
  const contactById = new Map((contactRows || []).map((row) => [
    String(row?.contactid || '').toLowerCase(),
    row,
  ]));

  const entries = config.entries.map((entry) => {
    if (entry.kind === 'staff') {
      const row = staffById.get(entry.profileId);
      if (!row) {
        return unavailable(entry, 'staff_unavailable', 'The app profile is inactive or is not linked exactly to an enabled Dataverse user.');
      }
      return {
        ...entry,
        key: `staff:${entry.profileId}`,
        category: 'staff',
        name: row.name,
        email: row.email,
        available: true,
      };
    }

    const row = contactById.get(entry.contactId);
    if (!row) return unavailable(entry, 'contact_missing', 'The Dataverse Contact could not be found.');
    if (row.statecode !== undefined && row.statecode !== 0) {
      return unavailable(entry, 'contact_inactive', 'The Dataverse Contact is inactive.');
    }
    const email = normalizeSiteVisitEmail(row.emailaddress1);
    if (!email) return unavailable(entry, 'contact_email_missing', 'The Dataverse Contact has no valid primary email address.');
    const name = contactName(row);
    if (!name) return unavailable(entry, 'contact_name_missing', 'The Dataverse Contact has no display name.');
    return {
      ...entry,
      key: `contact:${entry.contactId}`,
      name,
      email,
      available: true,
    };
  });

  return entries;
}

function sortResolved(rows) {
  const categoryOrder = { staff: 0, consultant: 1, board: 2 };
  return rows.slice().sort((left, right) => (
    (categoryOrder[left.category] ?? 99) - (categoryOrder[right.category] ?? 99)
      || String(left.name || '').localeCompare(String(right.name || ''))
  ));
}

export async function getCuratedRecipientOptions(dependencies = DEFAULT_DEPENDENCIES) {
  const config = await readCuratedRecipientConfig(dependencies);
  const entries = await resolveCuratedRecipientConfig(config, dependencies);
  const seenEmails = new Set();
  const available = sortResolved(entries.filter((entry) => entry.available)).filter((entry) => {
    const email = entry.email.toLowerCase();
    if (seenEmails.has(email)) return false;
    seenEmails.add(email);
    return true;
  });
  return available.map((entry, index) => ({
    key: `recipient-option-${index}`,
    category: entry.category,
    name: entry.name,
    email: entry.email,
  }));
}

export async function getCuratedRecipientAdminState(dependencies = DEFAULT_DEPENDENCIES) {
  const config = await readCuratedRecipientConfig(dependencies);
  const staff = await dependencies.getActiveStaff();
  const entries = await resolveCuratedRecipientConfig(config, dependencies, { staffOverride: staff });
  return {
    config,
    entries: sortResolved(entries),
    maxEntries: CURATED_RECIPIENT_MAX_ENTRIES,
    staff: sortResolved((staff || []).map((row) => ({
      kind: 'staff',
      profileId: row.profileId,
      key: `staff:${row.profileId}`,
      category: 'staff',
      name: row.name,
      email: row.email,
      available: true,
    }))),
  };
}

function contactRowsFromCandidateResult(result) {
  if (!result) return [];
  if (result.one && result.row) return [result.row];
  if (Array.isArray(result.rows)) return result.rows;
  return [];
}

export async function searchCuratedRecipientContacts(query, dependencies = DEFAULT_DEPENDENCIES) {
  const search = String(query || '').trim();
  if (search.length < 2 || search.length > 100) {
    throw serviceError('Contact search must be between 2 and 100 characters.', 'site_visit_contact_search_invalid', 400);
  }
  const rows = search.includes('@')
    ? contactRowsFromCandidateResult(await dependencies.findContactsByEmail(search))
    : await dependencies.searchContactsByName(search, { top: 10 });
  const seen = new Set();
  const contacts = [];
  for (const row of rows || []) {
    const contactId = String(row?.contactid || '').toLowerCase();
    if (!isGuid(contactId) || seen.has(contactId)) continue;
    seen.add(contactId);
    const email = normalizeSiteVisitEmail(row.emailaddress1);
    const name = contactName(row);
    const active = row.statecode === undefined || row.statecode === 0;
    contacts.push({
      contactId,
      name,
      email,
      available: Boolean(active && name && email),
      reason: !active ? 'contact_inactive' : !email ? 'contact_email_missing' : !name ? 'contact_name_missing' : null,
    });
  }
  return contacts;
}

export async function writeCuratedRecipientConfig(input, updatedByProfileId, dependencies = DEFAULT_DEPENDENCIES) {
  const config = validateCuratedRecipientConfig(input);
  const entries = await resolveCuratedRecipientConfig(config, dependencies);
  const unavailableEntries = entries.filter((entry) => !entry.available);
  if (unavailableEntries.length) {
    throw serviceError(
      'Every saved recipient must resolve to an active identity with a valid name and email address.',
      'site_visit_recipient_unresolved',
      409,
      {
        error: 'Every saved recipient must resolve to an active identity with a valid name and email address.',
        code: 'site_visit_recipient_unresolved',
        unavailableEntries,
      },
    );
  }
  const saved = await dependencies.setSetting(
    CURATED_RECIPIENT_SETTING_KEY,
    JSON.stringify(config),
    updatedByProfileId,
  );
  if (!saved) {
    throw serviceError(
      'The Site Visit recipient configuration could not be saved.',
      'site_visit_recipient_config_save_failed',
      502,
    );
  }
  return { config, entries: sortResolved(entries) };
}

export const CURATED_RECIPIENT_DEPENDENCIES = DEFAULT_DEPENDENCIES;
