/**
 * Adapter: contacts (CRM core).
 *
 * Promotion target for reviewers we've actually engaged with. When staff first
 * sends materials (or any direct outreach) to a `wmkf_potentialreviewers` row,
 * we find-or-create a CRM `contact` and link it via `wmkf_contact`. That puts
 * the reviewer into standard CRM workflows (relationship history, future
 * communications) without polluting the contacts table with everyone we ever
 * considered.
 *
 * NOTE on `wmkf_portaloid` (deployed S179, drain plan v7 P2):
 * The `contact.wmkf_portaloid` column + alternate key are reserved for the
 * applicant-portal auth bridge (lib/services/contact-bridge-service.js,
 * forthcoming). Reviewer promotion paths through this adapter MUST NOT set
 * `wmkf_portaloid`: doing so would either claim the OID slot for a contact
 * that isn't actually a portal applicant or trip the alt-key uniqueness once
 * its index reaches Active. If a reviewer is ALSO a portal applicant, the
 * auth bridge will link them on their first portal login; this adapter stays
 * out of that lane.
 */

import { DynamicsService } from '../../services/dynamics-service.js';
import { normalizeOrcid } from '../../utils/orcid-normalize.js';
import { ContactParser } from '../../utils/contact-parser.js';

const ENTITY_SET = 'contacts';

const FIELD_SELECT = [
  'contactid',
  'firstname',
  'lastname',
  'fullname',
  'emailaddress1',
  'wmkf_orcid',
  'statecode',
];

function escapeOdataString(s) {
  return String(s).replace(/'/g, "''");
}

function splitName(fullName) {
  const trimmed = ContactParser.stripHonorifics(fullName || '').trim();
  if (!trimmed) return { firstName: '', lastName: '' };
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { firstName: '', lastName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

function candidateResult(records, idField) {
  if (records.length === 0) return { none: true };
  if (records.length > 1) return { ambiguous: true, count: records.length, rows: records };
  return { one: true, id: records[0][idField], row: records[0] };
}

export async function findByEmail(email) {
  if (!email) return null;
  const { records } = await DynamicsService.queryRecords(ENTITY_SET, {
    select: FIELD_SELECT.join(','),
    filter: `emailaddress1 eq '${escapeOdataString(email)}'`,
    top: 1,
  });
  return records[0] || null;
}

export async function getById(id) {
  if (!id) return null;
  return DynamicsService.getRecord(ENTITY_SET, id, { select: FIELD_SELECT.join(',') });
}

/**
 * Find by email, or create a minimal contact with first/last/email. Returns
 * { id, created }.
 */
export async function findOrCreateByEmail({ firstName, lastName, email }, { actingUserSystemId } = {}) {
  if (!email) throw new Error('contact.findOrCreateByEmail: email required');
  const existing = await findByEmail(email);
  if (existing) return { id: existing.contactid, created: false };

  const payload = { emailaddress1: email };
  if (firstName) payload.firstname = firstName;
  if (lastName) payload.lastname = lastName;
  const created = await DynamicsService.createRecord(ENTITY_SET, payload, { actingUserSystemId });
  return { id: created.contactid, created: true };
}

function assignNonBlank(payload, key, value) {
  if (value === undefined || value === null) return;
  const trimmed = String(value).trim();
  if (!trimmed) return;
  payload[key] = trimmed;
}

export async function updateIdentityFields(contactId, { firstName, lastName, nickname, jobTitle } = {}, { actingUserSystemId } = {}) {
  if (!contactId) throw new Error('contact.updateIdentityFields: contactId required');
  const payload = {};
  assignNonBlank(payload, 'firstname', firstName);
  assignNonBlank(payload, 'lastname', lastName);
  assignNonBlank(payload, 'nickname', nickname);
  assignNonBlank(payload, 'jobtitle', jobTitle);
  if (Object.keys(payload).length === 0) return { updated: [] };

  await DynamicsService.updateRecord(ENTITY_SET, contactId, payload, { actingUserSystemId });
  return { updated: Object.keys(payload) };
}

// Trim + lowercase. The OData filter uses this normalized value AND the in-code
// compare below re-checks it, so collation differences can't smuggle in a
// near-match (design §3, Codex #2).
function normalizeEmail(email) {
  if (email === null || email === undefined) return '';
  return String(email).trim().toLowerCase();
}

export async function findByEmailCandidates(email) {
  const norm = normalizeEmail(email);
  if (!norm) return { none: true };
  const { records } = await DynamicsService.queryRecords(ENTITY_SET, {
    select: FIELD_SELECT.join(','),
    filter: `emailaddress1 eq '${escapeOdataString(norm)}'`,
    top: 2,
  });
  const matches = (records || []).filter((r) => normalizeEmail(r.emailaddress1) === norm);
  return candidateResult(matches, 'contactid');
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
  return candidateResult(matches, 'contactid');
}

function contactName(row) {
  return row?.fullname || [row?.firstname, row?.lastname].filter(Boolean).join(' ');
}

function rankNameRows(rows, name, top) {
  const target = ContactParser.normalizeNameForMatch(ContactParser.stripHonorifics(name || ''));
  return (rows || [])
    .map((row, index) => {
      const candidate = ContactParser.normalizeNameForMatch(ContactParser.stripHonorifics(contactName(row)));
      return {
        row,
        index,
        matches: ContactParser.namesMatch(target, candidate),
        active: row.statecode === undefined || row.statecode === 0,
      };
    })
    .filter((x) => x.matches)
    .sort((a, b) => Number(b.active) - Number(a.active) || a.index - b.index)
    .slice(0, top)
    .map((x) => x.row);
}

export async function searchByName(name, { top = 5 } = {}) {
  const { firstName, lastName } = splitName(name);
  if (!firstName && !lastName) return [];
  const cap = Math.min(Math.max(Number(top) || 5, 1), 10);
  const select = FIELD_SELECT.join(',');
  const escapedFirst = escapeOdataString(firstName);
  const escapedLast = escapeOdataString(lastName || firstName);
  const filters = [];
  if (lastName && firstName) {
    filters.push(`(lastname eq '${escapedLast}' and startswith(firstname,'${escapedFirst}'))`);
    filters.push(`(startswith(lastname,'${escapedLast}') and startswith(firstname,'${escapedFirst}'))`);
    filters.push(`(fullname eq '${escapeOdataString(ContactParser.stripHonorifics(name || '').trim())}')`);
  } else {
    filters.push(`startswith(lastname,'${escapedLast}')`);
  }

  const seen = new Set();
  const rows = [];
  for (const filter of filters) {
    const { records } = await DynamicsService.queryRecords(ENTITY_SET, { select, filter, top: cap });
    for (const row of records || []) {
      if (!seen.has(row.contactid)) {
        seen.add(row.contactid);
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
    filter: `contains(fullname,'${escapedName}')`,
    top: cap,
  });
  ranked = rankNameRows(fallback.records || [], name, cap);
  return ranked;
}

/**
 * Ambiguity-aware contact resolution for ORCID back-propagation (design §3).
 *
 * Deliberately SEPARATE from findByEmail (top:1, record|null) — that contract is
 * load-bearing for findOrCreateByEmail's create-on-miss path and must not gain
 * ambiguity semantics. This selects top:2 so a duplicated email is *detectable*;
 * the back-prop policy is to skip ambiguous matches, never guess which contact
 * an email belongs to (the 7 measured ambiguous cases prove email isn't 1:1).
 *
 * @returns {Promise<{contactId:string}|{ambiguous:true, count:number}|{none:true}>}
 */
export async function resolveForBackprop(email) {
  const norm = normalizeEmail(email);
  if (!norm) return { none: true };
  const { records } = await DynamicsService.queryRecords(ENTITY_SET, {
    select: 'contactid,emailaddress1',
    filter: `emailaddress1 eq '${escapeOdataString(norm)}'`,
    top: 2,
  });
  // In-code normalized compare is the authority over Dataverse collation.
  const matches = (records || []).filter((r) => normalizeEmail(r.emailaddress1) === norm);
  if (matches.length === 0) return { none: true };
  if (matches.length > 1) return { ambiguous: true, count: matches.length };
  return { contactId: matches[0].contactid };
}

/**
 * Fill-only ORCID write onto a contact (design §4, correctness-critical).
 *
 * Re-reads the contact's CURRENT wmkf_orcid by contactid, normalizes it, and:
 *   - empty/null     → WRITE the reviewer's iD (happy path), conditional on the
 *                      contact's ETag so a concurrent fill of a *different* iD
 *                      onto the same empty contact is caught (412 → re-evaluate).
 *   - same iD        → noop
 *   - different valid → conflict (NEVER overwrite — two authoritative iDs for one
 *                      email is a real identity problem; GOapply stays authoritative)
 *   - malformed      → malformed (log for manual cleanup; never auto-overwrite)
 *
 * Data-state classifications RETURN a status; operational errors (transport,
 * 403, Dataverse validation) THROW so callers/backfill can't report "safe" while
 * silently not writing (design §4 error posture, Codex #14).
 *
 * @returns {Promise<{action:'write'|'noop'|'conflict'|'malformed', ...}>}
 */
export async function setOrcidIfAbsent(contactId, orcid, { actingUserSystemId, _attempt = 0 } = {}) {
  if (!contactId) throw new Error('contact.setOrcidIfAbsent: contactId required');
  const incoming = normalizeOrcid(orcid);
  if (incoming.state !== 'valid') {
    // The caller is responsible for passing a gated, canonical reviewer iD; a
    // non-valid source here is a programming/operational error, not a data state.
    throw new Error(`contact.setOrcidIfAbsent: incoming ORCID is not valid (${incoming.state})`);
  }

  const current = await DynamicsService.getRecord(ENTITY_SET, contactId, {
    select: 'contactid,wmkf_orcid',
  });
  const existing = normalizeOrcid(current?.wmkf_orcid);

  if (existing.state === 'valid') {
    if (existing.id === incoming.id) return { action: 'noop', orcid: incoming.id };
    return { action: 'conflict', existing: existing.id, incoming: incoming.id };
  }
  if (existing.state === 'malformed') {
    return { action: 'malformed', existing: current?.wmkf_orcid ?? null, incoming: incoming.id };
  }

  // empty → WRITE (conditional on the contact ETag when available). A missing
  // _etag falls back to an unconditional PATCH — the same posture as the
  // canonical fill-only primitive DynamicsService.updateIfEmpty (it too only
  // sends If-Match when an etag is present) and the design's accepted
  // "last-writer-wins on an empty field" fallback (§5 atomicity). Dataverse
  // returns @odata.etag on every single-entity GET, so in practice the
  // conditional path always applies.
  const opts = { actingUserSystemId };
  if (current?._etag) opts.ifMatch = current._etag;
  try {
    await DynamicsService.updateRecord(ENTITY_SET, contactId, { wmkf_orcid: incoming.id }, opts);
  } catch (err) {
    // updateRecord surfaces a 412 via err.status (buildServiceError) — use that
    // alone, like updateIfEmpty. No message-substring fallback: a `\b412\b`
    // match could misfire on an unrelated error that merely mentions "412",
    // turning a hard failure into a spurious re-read/retry.
    if (err?.status === 412 && _attempt < 2) {
      // A concurrent writer changed the row since our read — re-read and
      // re-evaluate (it may now be noop/conflict, or still empty to retry).
      return setOrcidIfAbsent(contactId, orcid, { actingUserSystemId, _attempt: _attempt + 1 });
    }
    throw err;
  }
  return { action: 'write', orcid: incoming.id };
}

export const ENTITY_SET_NAME = ENTITY_SET;
