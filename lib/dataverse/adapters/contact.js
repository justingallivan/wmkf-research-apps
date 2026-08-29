/**
 * Adapter: contacts (CRM core).
 *
 * Promotion target for reviewers we've actually engaged with. An
 * identity-bearing acceptance—not a sent invitation—promotes a
 * `wmkf_potentialreviewers` row into a CRM `contact` and links it via
 * `wmkf_contact`. That puts accepted reviewers into standard CRM workflows
 * without polluting the contacts table with everyone we contacted or
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
import { isGuid } from '../../utils/guid.js';
import { normalizeOrcid } from '../../utils/orcid-normalize.js';
import { ContactParser } from '../../utils/contact-parser.js';
import * as odata from '../core/odata.js';
import { entitySet, selectFields } from '../core/entity-registry.js';

const ENTITY_SET = entitySet('contacts');

const FIELD_SELECT = selectFields('contacts');
export const CONTACT_BATCH_MAX_IDS = 50;

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

function activeCandidateResult(records, idField) {
  const active = records.filter((row) => row.statecode === undefined || row.statecode === 0);
  const inactiveRows = records.filter((row) => row.statecode !== undefined && row.statecode !== 0);
  if (active.length > 0) {
    return { ...candidateResult(active, idField), inactiveRows };
  }
  if (inactiveRows.length > 0) {
    // An inactive-only exact key is evidence for staff, never an auto-link.
    return {
      ambiguous: true,
      inactiveOnly: true,
      count: inactiveRows.length,
      rows: inactiveRows,
    };
  }
  return { none: true };
}

export async function findByEmail(email) {
  if (!email) return null;
  const { records } = await DynamicsService.queryRecords(ENTITY_SET, {
    select: odata.select(FIELD_SELECT),
    filter: odata.eq('emailaddress1', email),
    top: 1,
  });
  return records[0] || null;
}

export async function getById(id) {
  if (!id) return null;
  return DynamicsService.getRecord(ENTITY_SET, id, { select: odata.select(FIELD_SELECT) });
}

/**
 * Resolve a bounded set of Contact IDs in one Dataverse collection query.
 * Missing records are represented by omission from the returned array; callers
 * retain responsibility for reconciling requested IDs against returned rows.
 */
export async function getByIds(ids) {
  if (!Array.isArray(ids)) throw new Error('contact.getByIds: ids must be an array');
  const uniqueIds = [...new Set(ids.map((id) => String(id || '').toLowerCase()))];
  if (uniqueIds.length === 0) return [];
  if (uniqueIds.length > CONTACT_BATCH_MAX_IDS) {
    throw new Error(`contact.getByIds: at most ${CONTACT_BATCH_MAX_IDS} IDs are supported`);
  }
  if (uniqueIds.some((id) => !isGuid(id))) {
    throw new Error('contact.getByIds: every ID must be a GUID');
  }
  const { records } = await DynamicsService.queryRecords(ENTITY_SET, {
    select: odata.select(FIELD_SELECT),
    filter: `(${odata.or(uniqueIds.map((id) => odata.eqGuid('contactid', id)))})`,
    top: uniqueIds.length,
  });
  return records || [];
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

export function acceptedReviewerContactPayload({ contactId, firstName, lastName, email }) {
  if (!contactId) throw new Error('contact.acceptedReviewerContactPayload: contactId required');
  if (!email) throw new Error('contact.acceptedReviewerContactPayload: email required');
  if (!lastName) throw new Error('contact.acceptedReviewerContactPayload: lastName required');
  return {
    contactid: contactId,
    emailaddress1: email,
    ...(firstName ? { firstname: firstName } : {}),
    lastname: lastName,
  };
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
export function normalizeEmail(email) {
  if (email === null || email === undefined) return '';
  return String(email).trim().toLowerCase();
}

export async function findByEmailCandidates(email) {
  const norm = normalizeEmail(email);
  if (!norm) return { none: true };
  const exactFilter = odata.eq('emailaddress1', norm);
  const { records: activeRecords } = await DynamicsService.queryRecords(ENTITY_SET, {
    select: odata.select(FIELD_SELECT),
    filter: odata.and([exactFilter, odata.eqRaw('statecode', 0)]),
    top: 2,
  });
  const activeMatches = (activeRecords || []).filter(
    (row) => (row.statecode === undefined || row.statecode === 0)
      && normalizeEmail(row.emailaddress1) === norm,
  );
  if (activeMatches.length > 0) return candidateResult(activeMatches, 'contactid');

  const { records: historicalRecords } = await DynamicsService.queryRecords(ENTITY_SET, {
    select: odata.select(FIELD_SELECT),
    filter: exactFilter,
    top: 2,
  });
  const historicalMatches = (historicalRecords || []).filter(
    (row) => normalizeEmail(row.emailaddress1) === norm,
  );
  return activeCandidateResult(historicalMatches, 'contactid');
}

export async function findByOrcidCandidates(orcid) {
  const norm = normalizeOrcid(orcid);
  if (norm.state !== 'valid') return { none: true };
  const exactFilter = odata.eq('wmkf_orcid', norm.id);
  const { records: activeRecords } = await DynamicsService.queryRecords(ENTITY_SET, {
    select: odata.select(FIELD_SELECT),
    filter: odata.and([exactFilter, odata.eqRaw('statecode', 0)]),
    top: 2,
  });
  const activeMatches = (activeRecords || []).filter(
    (row) => (row.statecode === undefined || row.statecode === 0)
      && normalizeOrcid(row.wmkf_orcid).id === norm.id,
  );
  if (activeMatches.length > 0) return candidateResult(activeMatches, 'contactid');

  const { records: historicalRecords } = await DynamicsService.queryRecords(ENTITY_SET, {
    select: odata.select(FIELD_SELECT),
    filter: exactFilter,
    top: 2,
  });
  const historicalMatches = (historicalRecords || []).filter(
    (row) => normalizeOrcid(row.wmkf_orcid).id === norm.id,
  );
  return activeCandidateResult(historicalMatches, 'contactid');
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
  const select = odata.select(FIELD_SELECT);
  const escapedFirst = odata.escape(firstName);
  const escapedLast = odata.escape(lastName || firstName);
  const filters = [];
  if (lastName && firstName) {
    filters.push(`(lastname eq '${escapedLast}' and startswith(firstname,'${escapedFirst}'))`);
    filters.push(`(startswith(lastname,'${escapedLast}') and startswith(firstname,'${escapedFirst}'))`);
    filters.push(`(fullname eq '${odata.escape(ContactParser.stripHonorifics(name || '').trim())}')`);
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

  const fallback = await DynamicsService.queryRecords(ENTITY_SET, {
    select,
    filter: odata.contains('fullname', ContactParser.stripHonorifics(name || '').trim()),
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
    filter: odata.eq('emailaddress1', norm),
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

// ────── Institution lookup + fill-only parent Account write ───────────────
// Deliberately narrower select than FIELD_SELECT — institution reconciliation
// needs only the free-text organization, parent lookup, and GET-provided ETag.
const INSTITUTION_SELECT = 'contactid,adx_organizationname,_parentcustomerid_value';

/**
 * Byte-mirror of the caller's former inline `defaultContactsAdapter.getInstitutionById`
 * (lib/services/alert-reviewer-affiliation-mismatch.js). Returns null for a
 * falsy contactId instead of issuing a GET.
 */
export async function getInstitutionById(contactId) {
  if (!contactId) return null;
  return DynamicsService.getRecord(ENTITY_SET, contactId, {
    select: INSTITUTION_SELECT,
  });
}

function sameDataverseId(left, right) {
  return Boolean(left) && Boolean(right)
    && String(left).toLowerCase() === String(right).toLowerCase();
}

/**
 * Attach an Account only while Contact.parentcustomerid is empty.
 *
 * The fresh Contact ETag closes the read→PATCH race. A 412 re-reads and
 * re-evaluates twice: a concurrent fill of this Account becomes a noop, a
 * different parent becomes a conflict, and repeated unrelated row churn
 * remains an operational error for the acceptance job to retry. Existing
 * parents are never overwritten.
 */
export async function setParentAccountIfEmpty(
  contactId,
  accountId,
  { actingUserSystemId, _attempt = 0 } = {},
) {
  if (!contactId) throw new Error('contact.setParentAccountIfEmpty: contactId required');
  if (!accountId) throw new Error('contact.setParentAccountIfEmpty: accountId required');

  const current = await getInstitutionById(contactId);
  const existingParentId = current?._parentcustomerid_value || null;
  if (existingParentId) {
    if (sameDataverseId(existingParentId, accountId)) {
      return { action: 'noop', reason: 'already_linked', accountId };
    }
    return {
      action: 'conflict',
      reason: 'parent_already_populated',
      existingParentId,
      accountId,
    };
  }
  if (!current?._etag) {
    const error = new Error('contact.setParentAccountIfEmpty: Contact ETag required');
    error.code = 'reviewer_contact_parent_etag_missing';
    error.retryable = true;
    throw error;
  }

  try {
    await DynamicsService.updateRecord(ENTITY_SET, contactId, {
      'parentcustomerid_account@odata.bind': `/accounts(${accountId})`,
    }, {
      actingUserSystemId,
      ifMatch: current._etag,
    });
  } catch (error) {
    if (error?.status === 412 && _attempt < 2) {
      return setParentAccountIfEmpty(contactId, accountId, {
        actingUserSystemId,
        _attempt: _attempt + 1,
      });
    }
    throw error;
  }
  return { action: 'write', accountId };
}

// ────── Portal-identity bridge (contact-bridge-service) ───────────────────
// Deliberately narrower select than FIELD_SELECT — byte-mirror of the bridge's
// former inline CONTACT_SELECT constant.
const PORTAL_BRIDGE_SELECT = ['contactid', 'wmkf_portaloid', 'emailaddress1', 'firstname', 'lastname'].join(',');

/**
 * Byte-mirror of the bridge's former inline `findByOid`. Returns the raw
 * records array (top:2) so the caller keeps its own zero/one/multi-match
 * branching — this adapter method does not interpret cardinality.
 */
export async function findManyByPortalOid(oid) {
  const { records } = await DynamicsService.queryRecords(ENTITY_SET, {
    select: PORTAL_BRIDGE_SELECT,
    filter: odata.eq('wmkf_portaloid', oid),
    top: 2,
  });
  return records;
}

/**
 * Byte-mirror of the bridge's former inline `findByEmail`. Lowercases the
 * email before the OData filter (bridge's own normalization), top:5 so the
 * caller can detect multi-match. Returns the raw records array.
 */
export async function findManyByEmailLowercased(email) {
  const { records } = await DynamicsService.queryRecords(ENTITY_SET, {
    select: PORTAL_BRIDGE_SELECT,
    filter: odata.eq('emailaddress1', String(email).toLowerCase()),
    top: 5,
  });
  return records;
}

/**
 * Byte-mirror of the bridge's former inline `attachOidToContact`. PATCH
 * wmkf_portaloid only — caller's job to guard on null-before-attach.
 */
export async function setPortalOid(contactId, oid) {
  await DynamicsService.updateRecord(ENTITY_SET, contactId, {
    wmkf_portaloid: oid,
  });
}

/**
 * Byte-mirror of the bridge's former inline `createContact`'s transport call.
 * The caller owns body construction (name splitting, alt-key gating); this
 * is the raw POST.
 */
export async function createPortalContact(body) {
  return DynamicsService.createRecord(ENTITY_SET, body);
}

/**
 * Byte-mirror of the bridge's former inline `ensureAltKeyActive` transport
 * call. `entityLogicalName` is the Dataverse EntityDefinitions LogicalName
 * (singular, e.g. 'contact') — NOT the entity SET name used elsewhere in this
 * adapter, so it is passed through unvalidated by entitySet().
 */
export async function getEntityKeyStatus(entityLogicalName, keyLogicalName) {
  return DynamicsService.getEntityKey(entityLogicalName, keyLogicalName);
}

// ────── Long-tail caller absorption (Wave 6 / tail-2B) ────────────────────

/**
 * Raw PATCH passthrough for a caller-built arbitrary field payload. Byte-mirror
 * of lib/bill/honorarium-onboard-orchestrator.js's patchContactAddress
 * (address1_* fields, no options) — separate from `updateIdentityFields`
 * (which owns its own named-field non-blank filtering semantics and must not
 * gain a second, incompatible caller).
 */
export async function updateFields(contactId, payload, options) {
  if (options === undefined) {
    return DynamicsService.updateRecord(ENTITY_SET, contactId, payload);
  }
  return DynamicsService.updateRecord(ENTITY_SET, contactId, payload, options);
}

// Byte-mirror of lib/bill/onboard-reviewer-service.js's inline BILL_SELECT.
const BILL_SELECT = 'wmkf_billcomid,akoya_isvendor';

/**
 * Byte-mirror of onboard-reviewer-service's pre-read
 * `dynamics.getRecord('contacts', reviewerContactId, { select: 'wmkf_billcomid,akoya_isvendor' })`.
 */
export async function getBillingFieldsById(id) {
  return DynamicsService.getRecord(ENTITY_SET, id, { select: BILL_SELECT });
}

// Byte-mirror of lib/services/proposal-pi-identity.js's inline select.
const PI_IDENTITY_SELECT = 'fullname,firstname,lastname,wmkf_orcid,emailaddress1';

/**
 * Byte-mirror of proposal-pi-identity.resolveProposalPI's inline
 * `DynamicsService.getRecord('contacts', plId, { select: 'fullname,firstname,lastname,wmkf_orcid,emailaddress1' })`.
 */
export async function getPIIdentityById(id) {
  return DynamicsService.getRecord(ENTITY_SET, id, { select: PI_IDENTITY_SELECT });
}

// Byte-mirror of pages/api/workbench/grantee-deliverables/recipients.js's
// inline CONTACT_SELECT constant.
const INVITE_RECIPIENT_SELECT = 'contactid,fullname,firstname,lastname,emailaddress1';

/**
 * Byte-mirror of the grantee-deliverables recipients route's inline
 * `resolveContact`'s `DynamicsService.getRecord('contacts', id, { select: CONTACT_SELECT })`.
 */
export async function getInviteRecipientById(id) {
  return DynamicsService.getRecord(ENTITY_SET, id, { select: INVITE_RECIPIENT_SELECT });
}

/**
 * Generic single-record fetch with a caller-supplied `$select` — a raw
 * passthrough (byte-mirror) for callers whose field list is genuinely
 * bespoke and does not recur elsewhere. Byte-mirror of the external review
 * context route's inline
 * `DynamicsService.getRecord('contacts', contactId, { select: [...].join(',') })`.
 *
 * @param {string} id  contactid.
 * @param {string[]|string} select  field list (array or comma-string).
 * @returns {Promise<object>} raw DynamicsService.getRecord result.
 */
export async function getByIdWithSelect(id, select) {
  return DynamicsService.getRecord(ENTITY_SET, id, { select: odata.select(select) });
}

export const ENTITY_SET_NAME = ENTITY_SET;
