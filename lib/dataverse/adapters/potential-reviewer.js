/**
 * Adapter: wmkf_potentialreviewers (Connor's lead/person record).
 *
 * One row per real person. Promoted to a CRM contact when staff first reaches
 * out (wmkf_contact lookup). Email is the de-dupe key.
 */

import { DynamicsService } from '../../services/dynamics-service.js';
import { normalizeOrcid } from '../../utils/orcid-normalize.js';
import { ContactParser } from '../../utils/contact-parser.js';

const ENTITY_SET = 'wmkf_potentialreviewerses';

const FIELD_SELECT = [
  'wmkf_potentialreviewersid',
  'wmkf_name',
  'wmkf_firstname',
  'wmkf_lastname',
  'wmkf_emailaddress',
  'wmkf_orcid',
  'wmkf_organizationname',
  'wmkf_primaryaffiliation',
  'wmkf_areaofexpertise',
  'wmkf_whyreviewerwaschosen',
  '_wmkf_contact_value',
  'statecode',
];

function splitName(fullName) {
  const trimmed = (fullName || '').trim();
  if (!trimmed) return { firstName: '', lastName: '' };
  const cleaned = trimmed.replace(/^(dr\.?|prof\.?|professor)\s+/i, '');
  const parts = cleaned.split(/\s+/);
  if (parts.length === 1) return { firstName: '', lastName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

function pruneEmpty(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    out[k] = v;
  }
  return out;
}

// Dynamics field caps we've hit empirically. Add to this map as new ones
// surface; speculative caps would silently truncate legitimate values.
const FIELD_MAX = {
  wmkf_organizationname: 100,
  wmkf_areaofexpertise: 100,
};

function clamp(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && FIELD_MAX[k] && v.length > FIELD_MAX[k]) {
      out[k] = v.slice(0, FIELD_MAX[k] - 1).trimEnd() + '…';
    } else {
      out[k] = v;
    }
  }
  return out;
}

function escapeOdataString(s) {
  return String(s).replace(/'/g, "''");
}

function normalizeEmail(email) {
  if (email === null || email === undefined) return '';
  return String(email).trim().toLowerCase();
}

function candidateResult(records, idField) {
  if (records.length === 0) return { none: true };
  if (records.length > 1) return { ambiguous: true, count: records.length, rows: records };
  return { one: true, id: records[0][idField], row: records[0] };
}

export async function getByEmail(email) {
  if (!email) return null;
  const { records } = await DynamicsService.queryRecords(ENTITY_SET, {
    select: FIELD_SELECT.join(','),
    filter: `wmkf_emailaddress eq '${escapeOdataString(email)}'`,
    top: 1,
  });
  return records[0] || null;
}

export async function getById(id) {
  return DynamicsService.getRecord(ENTITY_SET, id, { select: FIELD_SELECT.join(',') });
}

export async function findByEmailCandidates(email) {
  const norm = normalizeEmail(email);
  if (!norm) return { none: true };
  const { records } = await DynamicsService.queryRecords(ENTITY_SET, {
    select: FIELD_SELECT.join(','),
    filter: `wmkf_emailaddress eq '${escapeOdataString(norm)}'`,
    top: 2,
  });
  const matches = (records || []).filter((r) => normalizeEmail(r.wmkf_emailaddress) === norm);
  return candidateResult(matches, 'wmkf_potentialreviewersid');
}

export async function findByOrcidCandidates(orcid) {
  const norm = normalizeOrcid(orcid);
  if (norm.state !== 'valid') return { none: true };
  const { records } = await DynamicsService.queryRecords(ENTITY_SET, {
    select: FIELD_SELECT.join(','),
    filter: `wmkf_orcid eq '${escapeOdataString(norm.id)}'`,
    top: 2,
  });
  const matches = (records || []).filter((r) => normalizeOrcid(r.wmkf_orcid).id === norm.id);
  return candidateResult(matches, 'wmkf_potentialreviewersid');
}

export async function findByContactId(contactId) {
  if (!contactId) return null;
  const escapedContactId = String(contactId).replace(/'/g, "''");
  const { records } = await DynamicsService.queryRecords(ENTITY_SET, {
    select: FIELD_SELECT.join(','),
    filter: `_wmkf_contact_value eq ${escapedContactId}`,
    top: 2,
  });
  return (records || [])[0] || null;
}

export async function create({ name, email, affiliation, expertise, whyChosen }, { actingUserSystemId } = {}) {
  const { firstName, lastName } = splitName(name);
  const incoming = clamp(pruneEmpty({
    wmkf_name: name,
    wmkf_firstname: firstName,
    wmkf_lastname: lastName,
    wmkf_emailaddress: email,
    wmkf_primaryaffiliation: affiliation,
    wmkf_organizationname: affiliation,
    wmkf_areaofexpertise: expertise,
    wmkf_whyreviewerwaschosen: whyChosen,
  }));
  const created = await DynamicsService.createRecord(ENTITY_SET, incoming, { actingUserSystemId });
  return { id: created.wmkf_potentialreviewersid, created: true };
}

function displayName(row) {
  return row?.wmkf_name || [row?.wmkf_firstname, row?.wmkf_lastname].filter(Boolean).join(' ');
}

function rankNameRows(rows, name, top) {
  const target = ContactParser.normalizeNameForMatch(ContactParser.stripHonorifics(name || ''));
  const ranked = (rows || [])
    .map((row, index) => {
      const candidate = ContactParser.normalizeNameForMatch(ContactParser.stripHonorifics(displayName(row)));
      const matches = ContactParser.namesMatch(target, candidate);
      return { row, index, matches, active: row.statecode === undefined || row.statecode === 0 };
    })
    .filter((x) => x.matches)
    .sort((a, b) => Number(b.active) - Number(a.active) || a.index - b.index)
    .slice(0, top)
    .map((x) => x.row);
  return ranked;
}

export async function searchByName(name, { top = 5 } = {}) {
  const { firstName, lastName } = splitName(name);
  if (!lastName && !firstName) return [];
  const cap = Math.min(Math.max(Number(top) || 5, 1), 10);
  const select = FIELD_SELECT.join(',');
  const escapedFirst = escapeOdataString(firstName);
  const escapedLast = escapeOdataString(lastName || firstName);
  const filters = [];
  if (lastName && firstName) {
    filters.push(`(wmkf_lastname eq '${escapedLast}' and startswith(wmkf_firstname,'${escapedFirst}'))`);
    filters.push(`(startswith(wmkf_lastname,'${escapedLast}') and startswith(wmkf_firstname,'${escapedFirst}'))`);
  } else {
    filters.push(`startswith(wmkf_lastname,'${escapedLast}')`);
  }

  const seen = new Set();
  const rows = [];
  for (const filter of filters) {
    const { records } = await DynamicsService.queryRecords(ENTITY_SET, { select, filter, top: cap });
    for (const row of records || []) {
      if (!seen.has(row.wmkf_potentialreviewersid)) {
        seen.add(row.wmkf_potentialreviewersid);
        rows.push(row);
      }
    }
    const ranked = rankNameRows(rows, name, cap);
    if (ranked.length >= cap) return ranked;
  }
  let ranked = rankNameRows(rows, name, cap);
  if (ranked.length > 0) return ranked;

  const escapedName = escapeOdataString(ContactParser.stripHonorifics(name || '').trim());
  const fallback = await DynamicsService.queryRecords(ENTITY_SET, {
    select,
    filter: `contains(wmkf_name,'${escapedName}')`,
    top: cap,
  });
  ranked = rankNameRows(fallback.records || [], name, cap);
  return ranked;
}

/**
 * Upsert a potential reviewer keyed by email (when present).
 *
 * On match: only fills fields currently empty in CRM (preserves staff edits).
 * On miss / no email: creates a new row.
 *
 * Returns { id, created }.
 */
export async function upsertByEmail({ name, email, affiliation, expertise, whyChosen }, { actingUserSystemId } = {}) {
  const { firstName, lastName } = splitName(name);

  // Affiliation (D-AFF, S213): the canonical home is wmkf_primaryaffiliation (500,
  // unclamped); wmkf_organizationname is kept as a clamped (100) compat shadow so
  // readers not yet migrated off it don't regress. clamp() only touches the shadow.
  const incoming = clamp(pruneEmpty({
    wmkf_name: name,
    wmkf_firstname: firstName,
    wmkf_lastname: lastName,
    wmkf_emailaddress: email,
    wmkf_primaryaffiliation: affiliation,
    wmkf_organizationname: affiliation,
    wmkf_areaofexpertise: expertise,
    wmkf_whyreviewerwaschosen: whyChosen,
  }));

  if (email) {
    const existing = await getByEmail(email);
    if (existing) {
      const merge = {};
      for (const [k, v] of Object.entries(incoming)) {
        const current = existing[k];
        const isEmpty = current === null || current === undefined ||
          (typeof current === 'string' && current.trim() === '');
        if (isEmpty) merge[k] = v;
      }
      if (Object.keys(merge).length > 0) {
        await DynamicsService.updateRecord(ENTITY_SET, existing.wmkf_potentialreviewersid, merge, { actingUserSystemId });
      }
      return { id: existing.wmkf_potentialreviewersid, created: false };
    }
  }

  const created = await DynamicsService.createRecord(ENTITY_SET, incoming, { actingUserSystemId });
  return { id: created.wmkf_potentialreviewersid, created: true };
}

/**
 * Edit person-identity fields. Pass any subset of { name, email, affiliation,
 * expertise, whyChosen }; only present keys are written. Affiliation writes the
 * full string to the canonical wmkf_primaryaffiliation (500) AND a clamped copy
 * to the legacy wmkf_organizationname (100) compat shadow (S213 D-AFF).
 */
export async function update(id, updates, { actingUserSystemId } = {}) {
  if (!id) throw new Error('potential-reviewer.update: id required');
  const { name, email, affiliation, expertise, whyChosen } = updates || {};

  const payload = {};
  if (name !== undefined) {
    payload.wmkf_name = name;
    const { firstName, lastName } = splitName(name);
    if (firstName) payload.wmkf_firstname = firstName;
    if (lastName) payload.wmkf_lastname = lastName;
  }
  if (email !== undefined) payload.wmkf_emailaddress = email;
  if (affiliation !== undefined) {
    payload.wmkf_primaryaffiliation = affiliation;   // canonical (500, unclamped)
    payload.wmkf_organizationname = affiliation;     // compat shadow (clamped to 100 below)
  }
  if (expertise !== undefined) payload.wmkf_areaofexpertise = expertise;
  if (whyChosen !== undefined) payload.wmkf_whyreviewerwaschosen = whyChosen;

  if (Object.keys(payload).length === 0) return;

  // No-op guard. Cross-field-mapped fields (wmkf_name → first/last) make a
  // single-field "did this change?" awkward, so re-read the row once and drop
  // any payload field whose normalized value already equals what's in CRM.
  // Avoids issuing PATCHes that re-trigger Dataverse alternate-key validation
  // on unchanged values (the 412 on wmkf_emailaddress is the motivating bug).
  const existing = await getById(id);
  const clamped = clamp(payload);
  const diff = {};
  for (const [k, v] of Object.entries(clamped)) {
    if (!fieldsEqual(existing?.[k], v)) diff[k] = v;
  }
  if (Object.keys(diff).length === 0) return;

  await DynamicsService.updateRecord(ENTITY_SET, id, diff, { actingUserSystemId });
}

// Treat null/undefined/'' as equivalent; compare strings case-insensitively
// after trim (matches Dataverse alternate-key normalization closely enough
// for our purposes — email keys are case-insensitive).
function fieldsEqual(a, b) {
  const norm = (x) => {
    if (x === null || x === undefined) return '';
    if (typeof x === 'string') return x.trim().toLowerCase();
    return String(x);
  };
  return norm(a) === norm(b);
}

export async function setContactLink(potentialReviewerId, contactId, { actingUserSystemId } = {}) {
  if (!potentialReviewerId) throw new Error('potential-reviewer.setContactLink: potentialReviewerId required');
  if (!contactId) throw new Error('potential-reviewer.setContactLink: contactId required');
  const current = await getById(potentialReviewerId);
  if (current?._wmkf_contact_value) {
    if (String(current._wmkf_contact_value).toLowerCase() === String(contactId).toLowerCase()) {
      return { action: 'noop', contactId };
    }
    const err = new Error('Potential reviewer is already linked to a different contact');
    err.code = 'reviewer_linked_elsewhere';
    err.status = 409;
    err.details = { potentialReviewerId, existingContactId: current._wmkf_contact_value, contactId };
    throw err;
  }
  const linked = await findByContactId(contactId);
  if (linked && String(linked.wmkf_potentialreviewersid).toLowerCase() !== String(potentialReviewerId).toLowerCase()) {
    const err = new Error('Contact is already linked to a different potential reviewer');
    err.code = 'contact_linked_elsewhere';
    err.status = 409;
    err.details = { contactId, existingReviewerId: linked.wmkf_potentialreviewersid, potentialReviewerId };
    throw err;
  }
  await DynamicsService.updateRecord(ENTITY_SET, potentialReviewerId, {
    'wmkf_Contact@odata.bind': `/contacts(${contactId})`,
  }, { actingUserSystemId });
  return { action: 'link', contactId };
}

export const ENTITY_SET_NAME = ENTITY_SET;
