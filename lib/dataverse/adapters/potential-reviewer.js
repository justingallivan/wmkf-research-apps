/**
 * Adapter: wmkf_potentialreviewers (Connor's lead/person record).
 *
 * One row per real person. Promoted to a CRM contact when staff first reaches
 * out (wmkf_contact lookup). Email is the de-dupe key.
 */

import { DynamicsService } from '../../services/dynamics-service.js';

const ENTITY_SET = 'wmkf_potentialreviewerses';

const FIELD_SELECT = [
  'wmkf_potentialreviewersid',
  'wmkf_name',
  'wmkf_firstname',
  'wmkf_lastname',
  'wmkf_emailaddress',
  'wmkf_organizationname',
  'wmkf_primaryaffiliation',
  'wmkf_areaofexpertise',
  'wmkf_whyreviewerwaschosen',
  '_wmkf_contact_value',
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
  await DynamicsService.updateRecord(ENTITY_SET, potentialReviewerId, {
    'wmkf_Contact@odata.bind': `/contacts(${contactId})`,
  }, { actingUserSystemId });
}

export const ENTITY_SET_NAME = ENTITY_SET;
