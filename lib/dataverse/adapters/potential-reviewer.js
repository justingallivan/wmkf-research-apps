/**
 * Adapter: wmkf_potentialreviewers (Connor's lead/person record).
 *
 * One row per real person. Identity-bearing acceptance promotes to a CRM
 * contact through the wmkf_contact lookup; invitation send does not.
 * Email is the de-dupe key.
 */

import { DynamicsService } from '../../services/dynamics-service.js';
import { normalizeOrcid } from '../../utils/orcid-normalize.js';
import { ContactParser } from '../../utils/contact-parser.js';
import * as odata from '../core/odata.js';
import { entitySet, selectFields } from '../core/entity-registry.js';
import { adapterError, isDataverseRecordNotFound } from '../core/errors.js';
import { translateDuplicateKeyError } from '../duplicate-key.js';

const ENTITY_SET = entitySet('wmkf_potentialreviewerses');

const FIELD_SELECT = selectFields('wmkf_potentialreviewerses');

function splitName(fullName) {
  const trimmed = (fullName || '').trim();
  if (!trimmed) return { firstName: '', lastName: '' };
  const cleaned = trimmed.replace(/^(dr\.?|prof\.?|professor)\s+/i, '');
  const parts = cleaned.split(/\s+/);
  if (parts.length === 1) return { firstName: '', lastName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

// wmkf_name is stored raw — Dynamics does NOT recompute it — so normalize
// whitespace (trim ends + collapse internal runs) on every write, or padded /
// double-spaced values persist (agent-wiki dataverse-dynamics note). first/last
// already come clean from splitName. Falls back to the original for an empty/
// non-string value so pruneEmpty/clamp keep their existing behavior.
function cleanName(name) {
  return ContactParser.normalizeDisplayName(name) || name;
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
  // Canonical affiliation home. 500 is the column's hard cap, NOT a stylistic
  // limit — a longer value 400s the whole write (prod: req 1002833, "Hongjun
  // Song", a long multi-institution OpenAlex affiliation). It's "unclamped"
  // only relative to the 100-char wmkf_organizationname shadow, never the column.
  wmkf_primaryaffiliation: 500,
  // S308 board-writeup identity column caps (match the schema-as-code maxLength).
  wmkf_academicrank: 200,
  wmkf_primarydepartment: 255,
  wmkf_maininstitution: 255,
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

function normalizeEmail(email) {
  if (email === null || email === undefined) return '';
  return String(email).trim().toLowerCase();
}

function rowAffiliation(row) {
  return row?.wmkf_primaryaffiliation || row?.wmkf_organizationname || null;
}

function matchesEmail(row, email) {
  return !!row?.wmkf_potentialreviewersid
    && normalizeEmail(row.wmkf_emailaddress) === normalizeEmail(email);
}

function candidateResult(records, idField) {
  if (records.length === 0) return { none: true };
  if (records.length > 1) return { ambiguous: true, count: records.length, rows: records };
  return { one: true, id: records[0][idField], row: records[0] };
}

export async function getByEmail(email) {
  if (!email) return null;
  const result = await findByEmailCandidates(email);
  if (result.none) return null;
  if (result.one) return result.row;
  throw adapterError('More than one active potential reviewer owns this email address.', {
    code: 'ambiguous_email_owner',
    status: 409,
    details: { count: result.count },
  });
}

export async function getById(id) {
  return DynamicsService.getRecord(ENTITY_SET, id, { select: odata.select(FIELD_SELECT) });
}

/**
 * Read-only lookup for reviewer-email reconciliation. A record-scoped Dataverse
 * ObjectDoesNotExist response means the person is gone; every other 404/error
 * remains loud so configuration failures cannot masquerade as lifecycle state.
 */
export async function getForEmailReconcile(id) {
  try {
    return await getById(id);
  } catch (error) {
    if (isDataverseRecordNotFound(error)) return null;
    throw error;
  }
}

export async function findByEmailCandidates(email) {
  const norm = normalizeEmail(email);
  if (!norm) return { none: true };
  const { records } = await DynamicsService.queryRecords(ENTITY_SET, {
    select: odata.select(FIELD_SELECT),
    filter: odata.eq('wmkf_emailaddress', norm),
    top: 2,
  });
  const matches = (records || []).filter((r) => normalizeEmail(r.wmkf_emailaddress) === norm);
  const active = matches.filter((row) => row.statecode === undefined || row.statecode === 0);
  if (active.length > 0) {
    return {
      ...candidateResult(active, 'wmkf_potentialreviewersid'),
      inactiveRows: matches.filter((row) => row.statecode !== undefined && row.statecode !== 0),
    };
  }
  return candidateResult(matches, 'wmkf_potentialreviewersid');
}

export async function findByOrcidCandidates(orcid) {
  const norm = normalizeOrcid(orcid);
  if (norm.state !== 'valid') return { none: true };
  const { records } = await DynamicsService.queryRecords(ENTITY_SET, {
    select: odata.select(FIELD_SELECT),
    filter: odata.eq('wmkf_orcid', norm.id),
    top: 2,
  });
  const matches = (records || []).filter((r) => normalizeOrcid(r.wmkf_orcid).id === norm.id);
  return candidateResult(matches, 'wmkf_potentialreviewersid');
}

export async function findByContactId(contactId) {
  if (!contactId) return null;
  const { records } = await DynamicsService.queryRecords(ENTITY_SET, {
    select: odata.select(FIELD_SELECT),
    filter: odata.eqRaw('_wmkf_contact_value', odata.escape(contactId)),
    top: 2,
  });
  return (records || [])[0] || null;
}

export async function create({ name, email, emailSource, addressTrustStateJson, affiliation, expertise, whyChosen }, { actingUserSystemId } = {}) {
  const { firstName, lastName } = splitName(name);
  const incoming = clamp(pruneEmpty({
    wmkf_name: cleanName(name),
    wmkf_firstname: firstName,
    wmkf_lastname: lastName,
    wmkf_emailaddress: email,
    // Same invariant as `update`/`upsertByEmail` (S387): an address is never created
    // without its provenance when the caller has one to assert. `pruneEmpty` drops it
    // otherwise, so a caller with no source is unchanged.
    wmkf_emailsource: emailSource,
    wmkf_addresstruststatejson: addressTrustStateJson,
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
  const select = odata.select(FIELD_SELECT);
  const escapedFirst = odata.escape(firstName);
  const escapedLast = odata.escape(lastName || firstName);
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

  const fallback = await DynamicsService.queryRecords(ENTITY_SET, {
    select,
    filter: odata.contains('wmkf_name', ContactParser.stripHonorifics(name || '').trim()),
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
 * Passing `existing` means the caller already performed the email lookup; null
 * is a checked miss and must not trigger a second getByEmail.
 *
 * Returns { id, created } plus additive affiliation metadata.
 */
export async function upsertByEmail({ name, email, emailSource, addressTrustStateJson, affiliation, expertise, whyChosen }, options = {}) {
  const { actingUserSystemId } = options;
  const hasEvaluatedExisting = Object.prototype.hasOwnProperty.call(options, 'existing');
  const evaluatedExisting = options.existing || null;
  const { firstName, lastName } = splitName(name);

  // Affiliation (D-AFF, S213): the canonical home is wmkf_primaryaffiliation
  // (clamped to its 500 column cap); wmkf_organizationname is kept as a clamped
  // (100) compat shadow so readers not yet migrated off it don't regress. clamp()
  // caps both to their respective FIELD_MAX (the 500 cap added after req 1002833).
  const incoming = clamp(pruneEmpty({
    wmkf_name: cleanName(name),
    wmkf_firstname: firstName,
    wmkf_lastname: lastName,
    wmkf_emailaddress: normalizeEmail(email) || null,
    // Provenance rides WITH the address (S387, second adversarial review). When
    // save-candidates wrote the address here and the source in a later researcher upsert, a
    // failure between them left a fresh person row holding an address with no recorded
    // provenance — still gated to a quick check, but the evidence was lost.
    // `pruneEmpty` drops this when the caller has no source to assert.
    wmkf_emailsource: emailSource,
    wmkf_addresstruststatejson: addressTrustStateJson,
    wmkf_primaryaffiliation: affiliation,
    wmkf_organizationname: affiliation,
    wmkf_areaofexpertise: expertise,
    wmkf_whyreviewerwaschosen: whyChosen,
  }));

  async function reuse(row) {
    if (row.statecode !== undefined && row.statecode !== 0) {
      throw adapterError('The email address belongs to an inactive potential reviewer.', {
        code: 'inactive_email_owner',
        status: 409,
        details: { potentialReviewerId: row.wmkf_potentialreviewersid },
      });
    }
    const merge = {};
    for (const [k, v] of Object.entries(incoming)) {
      const current = row[k];
      const isEmpty = current === null || current === undefined ||
        (typeof current === 'string' && current.trim() === '');
      if (isEmpty) merge[k] = v;
    }
    if (Object.keys(merge).length > 0) {
      await DynamicsService.updateRecord(ENTITY_SET, row.wmkf_potentialreviewersid, merge, { actingUserSystemId });
    }
    return {
      id: row.wmkf_potentialreviewersid,
      created: false,
      reusedAffiliation: rowAffiliation(row),
    };
  }

  if (email) {
    let reuseTarget = null;
    if (hasEvaluatedExisting) {
      if (evaluatedExisting) {
        if (!matchesEmail(evaluatedExisting, email)) {
          throw new Error('potential-reviewer.upsertByEmail: existing email does not match payload email');
        }
        reuseTarget = evaluatedExisting;
      }
    } else {
      const owner = await findByEmailCandidates(email);
      if (owner.ambiguous) {
        throw adapterError('More than one active potential reviewer owns this email address.', {
          code: 'ambiguous_email_owner',
          status: 409,
          details: { count: owner.count },
        });
      }
      reuseTarget = owner.one ? owner.row : null;
    }
    if (reuseTarget) {
      return reuse(reuseTarget);
    }
  }

  try {
    const created = await DynamicsService.createRecord(ENTITY_SET, incoming, { actingUserSystemId });
    return { id: created.wmkf_potentialreviewersid, created: true, reusedAffiliation: null };
  } catch (err) {
    const duplicate = translateDuplicateKeyError(err);
    const isCreateRace = duplicate?.field === 'wmkf_emailaddress'
      || ((err?.status === 409 || err?.status === 412)
        && /duplicate|already exists|matching key values|alternate key/i.test(err?.message || ''));
    if (!email || !isCreateRace) throw err;

    const owner = await findByEmailCandidates(email);
    if (owner.one) return reuse(owner.row);
    if (owner.ambiguous) {
      throw adapterError('A concurrent save exposed multiple active owners for this email address.', {
        code: 'ambiguous_email_owner',
        status: 409,
        details: { count: owner.count },
      });
    }
    throw err;
  }
}

/**
 * Edit person-identity fields. Pass any subset of { name, email, affiliation,
 * expertise, whyChosen, academicRank, primaryDepartment, mainInstitution }; only
 * present keys are written. Affiliation writes to the canonical
 * wmkf_primaryaffiliation (clamped to its 500 column cap) AND a clamped copy to the
 * legacy wmkf_organizationname (100) compat shadow (S213 D-AFF). The three S308
 * board-writeup identity fields are reviewer/staff-CONFIRMED and write to their own
 * dedicated columns — never to the enrichment-sourced affiliation/department.
 */
export async function update(id, updates, { actingUserSystemId, ifMatch } = {}) {
  if (!id) throw new Error('potential-reviewer.update: id required');
  const { name, email, emailSource, addressTrustStateJson, affiliation, expertise, whyChosen,
    academicRank, primaryDepartment, mainInstitution } = updates || {};

  const payload = {};
  if (name !== undefined) {
    payload.wmkf_name = cleanName(name);
    const { firstName, lastName } = splitName(name);
    if (firstName) payload.wmkf_firstname = firstName;
    if (lastName) payload.wmkf_lastname = lastName;
  }
  const normalizedUpdateEmail = typeof email === 'string' ? email.trim() : '';
  if (normalizedUpdateEmail) payload.wmkf_emailaddress = normalizedUpdateEmail.toLowerCase();
  // The address and its provenance belong in the SAME PATCH (S387, adversarial review
  // finding 3). When they were two calls, an address change that landed while the
  // follow-up source write failed left the row describing the NEW address with the OLD
  // source — e.g. a hand-typed address inheriting a stored `orcid`, which the send gate
  // reads as `ready` and sends without an acknowledgement. Written together, a
  // duplicate-key rejection drops both, so a source can never outlive its address.
  if (normalizedUpdateEmail && emailSource !== undefined) payload.wmkf_emailsource = emailSource;
  if (addressTrustStateJson !== undefined) {
    payload.wmkf_addresstruststatejson = addressTrustStateJson === null
      ? null
      : String(addressTrustStateJson);
  }
  if (affiliation !== undefined) {
    payload.wmkf_primaryaffiliation = affiliation;   // canonical (clamped to 500 below)
    payload.wmkf_organizationname = affiliation;     // compat shadow (clamped to 100 below)
  }
  if (expertise !== undefined) payload.wmkf_areaofexpertise = expertise;
  if (whyChosen !== undefined) payload.wmkf_whyreviewerwaschosen = whyChosen;
  // S308 board-writeup identity — reviewer/staff-confirmed, own columns.
  if (academicRank !== undefined) payload.wmkf_academicrank = academicRank;
  if (primaryDepartment !== undefined) payload.wmkf_primarydepartment = primaryDepartment;
  if (mainInstitution !== undefined) payload.wmkf_maininstitution = mainInstitution;

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

  await DynamicsService.updateRecord(
    ENTITY_SET,
    id,
    diff,
    { actingUserSystemId, ...(ifMatch ? { ifMatch } : {}) },
  );
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
  if (!current) {
    throw adapterError('Potential reviewer does not exist', {
      code: 'potential_reviewer_not_found',
      status: 404,
      details: { potentialReviewerId, contactId },
    });
  }
  if (current?._wmkf_contact_value) {
    if (String(current._wmkf_contact_value).toLowerCase() === String(contactId).toLowerCase()) {
      return { action: 'noop', contactId };
    }
    throw adapterError('Potential reviewer is already linked to a different contact', {
      code: 'reviewer_linked_elsewhere',
      status: 409,
      details: { potentialReviewerId, existingContactId: current._wmkf_contact_value, contactId },
    });
  }
  const linked = await findByContactId(contactId);
  if (linked && String(linked.wmkf_potentialreviewersid).toLowerCase() !== String(potentialReviewerId).toLowerCase()) {
    throw adapterError('Contact is already linked to a different potential reviewer', {
      code: 'contact_linked_elsewhere',
      status: 409,
      details: { contactId, existingReviewerId: linked.wmkf_potentialreviewersid, potentialReviewerId },
    });
  }
  if (!current._etag) {
    throw adapterError('Potential reviewer link update requires a current ETag', {
      code: 'reviewer_link_etag_missing',
      status: 409,
      details: { potentialReviewerId, contactId },
    });
  }
  await DynamicsService.updateRecord(ENTITY_SET, potentialReviewerId, {
    'wmkf_Contact@odata.bind': `/contacts(${contactId})`,
  }, { actingUserSystemId, ifMatch: current._etag });
  return { action: 'link', contactId };
}

// ───────── Merge support (S289) ─────────
// Merge needs a WIDER read than the shared FIELD_SELECT (which omits the wave6
// bibliometric + identity fields). This is a SEPARATE constant on purpose —
// widening FIELD_SELECT would change every getByEmail/getById caller and can trip
// DynamicsService.checkRestriction for those callers (design doc §Chunk 1).
const MERGE_FIELD_SELECT = Array.from(new Set([
  ...FIELD_SELECT,
  'wmkf_department',
  'wmkf_orcidurl',
  'wmkf_googlescholarid',
  'wmkf_googlescholarurl',
  'wmkf_hindex',
  'wmkf_i10index',
  'wmkf_totalcitations',
  'wmkf_website',
  'wmkf_facultypageurl',
  'wmkf_keywords',
  'wmkf_emailsource',
  'wmkf_identitystatus',
  // Surfaced so the merge can reject a re-run against a loser that's already
  // inactive (0=Active, 1=Inactive). The Set keeps this harmlessly idempotent
  // now that statecode is also part of the shared FIELD_SELECT.
  'statecode',
]));

/** Read one person row with the full merge field set (incl. wave6 biblio/identity)
 *  + its ETag. Used by the merge planner to diff keeper vs loser. */
export async function getByIdForMerge(id) {
  if (!id) throw new Error('potential-reviewer.getByIdForMerge: id required');
  return DynamicsService.getRecord(ENTITY_SET, id, { select: odata.select(MERGE_FIELD_SELECT) });
}

/** Blank the email so the unique alt-key (wmkf_emailaddress_unique) is freed
 *  before the keeper takes the same address (merge step 6). */
export async function clearEmail(id, { actingUserSystemId, ifMatch } = {}) {
  if (!id) throw new Error('potential-reviewer.clearEmail: id required');
  // Clear the provenance WITH the address (S387 — the mirror of the pairing invariant).
  // A source left behind describes an address the row no longer has, so the next address
  // written by any path that does not set a source would silently inherit it; in the merge
  // flow that means a loser row keeping `orcid` after its address moved to the keeper.
  await DynamicsService.updateRecord(
    ENTITY_SET,
    id,
    { wmkf_emailaddress: null, wmkf_emailsource: null },
    { actingUserSystemId, ifMatch },
  );
}

/**
 * Explicit staff clear for a shared person address. Unlike `update`, this
 * destructive command requires the exact address/source/ETag the editor saw
 * plus a reason, then re-reads before the conditional PATCH.
 */
export async function clearEmailForEdit(id, {
  expectedEmail,
  expectedEmailSource,
  expectedEtag,
  reason,
} = {}, { actingUserSystemId } = {}) {
  if (!id) throw new Error('potential-reviewer.clearEmailForEdit: id required');
  const expected = normalizeEmail(expectedEmail);
  const expectedSource = String(expectedEmailSource || '').trim();
  if (!expected || !expectedEtag || !String(reason || '').trim()) {
    throw adapterError('Clearing a reviewer email requires the expected address, ETag, and reason.', {
      code: 'contact_clear_evidence_required',
      status: 400,
    });
  }

  const current = await getByIdForMerge(id);
  const currentEmail = normalizeEmail(current?.wmkf_emailaddress);
  const currentSource = String(current?.wmkf_emailsource || '').trim();
  if (
    currentEmail !== expected
    || currentSource !== expectedSource
    || current?._etag !== expectedEtag
  ) {
    throw adapterError('The reviewer email changed. Reload before clearing it.', {
      code: 'contact_clear_conflict',
      status: 409,
    });
  }

  await DynamicsService.updateRecord(
    ENTITY_SET,
    id,
    { wmkf_emailaddress: null, wmkf_emailsource: null },
    { actingUserSystemId, ifMatch: expectedEtag },
  );
  return { cleared: true, reason: String(reason).trim() };
}

/** Deactivate (soft-retire) a merged-away loser row (merge step 7). statecode=1 /
 *  statuscode=2 is the Dataverse "Inactive" pair for a custom entity. */
export async function deactivate(id, { actingUserSystemId, ifMatch } = {}) {
  if (!id) throw new Error('potential-reviewer.deactivate: id required');
  await DynamicsService.updateRecord(ENTITY_SET, id, { statecode: 1, statuscode: 2 }, { actingUserSystemId, ifMatch });
}

/**
 * Delete one exact, newly-created reviewer row during bounded compensation.
 * The caller must first prove by fresh reads that the row has no contact,
 * suggestion/engagement, applicant-slot, or other known reference. Requiring
 * the fresh ETag prevents deleting a row that changed after that proof.
 */
export async function deleteExactNew(id, { actingUserSystemId, ifMatch } = {}) {
  if (!id || !ifMatch) {
    throw new Error('potential-reviewer.deleteExactNew: id and ifMatch are required');
  }
  return DynamicsService.deleteRecord(ENTITY_SET, id, { actingUserSystemId, ifMatch });
}

/**
 * Single-record fetch with a caller-supplied `$select` (or a full-record read
 * when `select` is omitted) — mirrors grant-request.getById's optional-select
 * shape. Serves the several custom-select `getRecord('wmkf_potentialreviewerses', ...)`
 * call sites across the review-flow cluster (render-emails, send-emails,
 * withdraw-sufficient, reviewer-reminder-sweep) whose field lists don't match
 * `getById`'s fixed FIELD_SELECT.
 */
export async function getByIdWithSelect(id, { select } = {}) {
  if (select === undefined) {
    return DynamicsService.getRecord(ENTITY_SET, id);
  }
  return DynamicsService.getRecord(ENTITY_SET, id, { select: odata.select(select) });
}

/**
 * Business-filter query passthrough — mirrors DynamicsService.queryRecords
 * arg-for-arg, exactly like grant-request.js's queryRequests. Exists so
 * callers with a bespoke OR-chain/filter (person-batch lookups, researcher
 * hydration) can drop the raw DynamicsService import without that filter
 * moving into the adapter.
 */
/**
 * Auto-paginating sibling of `queryReviewers`. `queryRecords` returns ONE page (25 by
 * default) plus `hasMore`, so a caller that needs the whole population and ignores
 * `hasMore` silently scans a fraction of it — a maintenance sweep reading 25 of 385 person
 * rows reported "nothing to do" and looked clean (S387). Use this whenever the answer
 * depends on having seen every row.
 */
export async function queryAllReviewers(options) {
  return DynamicsService.queryAllRecords(ENTITY_SET, options);
}

export async function queryReviewers(options) {
  return DynamicsService.queryRecords(ENTITY_SET, options);
}

export const ENTITY_SET_NAME = ENTITY_SET;
export { MERGE_FIELD_SELECT };
