/**
 * proposal-pi-identity — resolve the proposal's PI (Principal Investigator) from
 * STRUCTURED Dataverse data instead of LLM-extracted proposal text.
 *
 * The PI is the request's Project Leader (`_wmkf_projectleader_value`, falling back
 * to `_wmkf_researchleader_value`) — a `contact` that already carries `wmkf_orcid`.
 * ORCID → exact OpenAlex author, the hard identity key (no name-search namesake
 * hazard). This supersedes the LLM-extract identity path that misresolved "Wen Li"
 * → "Yanping Li" (see docs/REVIEWER_FINDER_SPARSE_PROPOSAL_ANCHOR_STRATEGY.md §12.2
 * and memory project-reviewer-pi-identity-structured).
 *
 * READ-ONLY. Two Dataverse reads + one OpenAlex call. NEVER throws for a
 * "couldn't resolve" outcome — it returns an explicit `{ resolved: false, reason }`
 * so the caller can fail OPEN to the existing proposal-text identity. The ONE thing
 * it does propagate is an abort / time-budget signal (so the caller's deadline is
 * honored, not silently swallowed — Codex S240 #13).
 *
 * The caller owns the Dynamics bypass context (this service is context-agnostic so
 * it stays unit-testable); pass the deadline `signal` via opts.
 */

const { DynamicsService } = require('./dynamics-service');
const { OpenAlexService } = require('./openalex-service');
const { ContactParser } = require('../utils/contact-parser');
const { normalizeOrcid } = require('../utils/orcid-normalize');
const { forenamesContradict } = require('./reviewer-identity-evidence');

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isAbort(err) {
  return err?.name === 'AbortError'
    || err?.code === 'openalex_timeout'
    || err?.code === 'reviewer_time_budget_exceeded';
}

function normName(name) {
  return ContactParser.normalizeNameForMatch(ContactParser.stripHonorifics(name || ''));
}

/**
 * Does the OpenAlex author resolved from the contact's ORCID actually correspond to
 * the contact? Guards a MIS-ENTERED ORCID (Codex S240 #2 / §12.2 residual risk):
 * surnames must agree AND the forenames must not FULLY contradict (a full-forename
 * contradiction like "Jane" vs "John" is the mis-entry signature; an initial-only
 * OpenAlex name does not contradict). When either name is missing we cannot check,
 * so we trust the exact ORCID key.
 */
function nameGuardPasses(contactName, openAlexName) {
  if (!contactName || !openAlexName) return true; // can't check → trust the ORCID hard key
  const a = normName(contactName);
  const b = normName(openAlexName);
  if (!a || !b) return true;
  if (!ContactParser.namesMatch(a, b)) return false;          // surname disagreement
  if (forenamesContradict(contactName, openAlexName)) return false; // full-forename contradiction
  return true;
}

/**
 * @param {string} requestId - akoya_request GUID
 * @param {{signal?: AbortSignal}} [opts]
 * @returns {Promise<
 *   | { resolved: true, orcid, openAlexAuthorId, canonicalName, contactName, institution, emailDomain }
 *   | { resolved: false, reason, ...partial }
 * >}
 */
async function resolveProposalPI(requestId, { signal } = {}) {
  if (!requestId || !GUID_RE.test(String(requestId))) {
    return { resolved: false, reason: 'no_request_id' };
  }

  // 1. request → Project Leader (fallback Research Leader) contact id
  let request;
  try {
    request = await DynamicsService.getRecord('akoya_requests', requestId, {
      select: 'akoya_requestid,_wmkf_projectleader_value,_wmkf_researchleader_value',
    });
  } catch (err) {
    if (isAbort(err)) throw err;
    return { resolved: false, reason: 'request_read_failed', error: err.message };
  }
  const plId = request?._wmkf_projectleader_value || request?._wmkf_researchleader_value;
  if (!plId) return { resolved: false, reason: 'no_project_leader' };

  // 2. contact → ORCID + name + email domain
  let contact;
  try {
    contact = await DynamicsService.getRecord('contacts', plId, {
      select: 'fullname,firstname,lastname,wmkf_orcid,emailaddress1',
    });
  } catch (err) {
    if (isAbort(err)) throw err;
    return { resolved: false, reason: 'contact_read_failed', error: err.message };
  }
  const contactName = contact?.fullname
    || [contact?.firstname, contact?.lastname].filter(Boolean).join(' ')
    || null;
  const emailDomain = (contact?.emailaddress1 || '').split('@')[1]?.toLowerCase() || null;

  const orcidResult = normalizeOrcid(contact?.wmkf_orcid);
  if (orcidResult.state !== 'valid') {
    // No ORCID, or a malformed/checksum-invalid one → go INERT (do NOT fall back to
    // a name-search author cluster). The proposal is carried by proposal-text
    // identity. (project-openalex-merge-use-orcid-works.)
    return {
      resolved: false,
      reason: orcidResult.state === 'malformed' ? 'orcid_malformed' : 'no_orcid',
      contactName,
      emailDomain,
    };
  }
  const orcid = orcidResult.id;

  // 3. ORCID → exact OpenAlex author
  let author;
  try {
    author = await OpenAlexService.getAuthorByOrcid(orcid, { signal });
  } catch (err) {
    if (isAbort(err)) throw err;
    return { resolved: false, reason: 'openalex_error', orcid, contactName, emailDomain, error: err.message };
  }
  if (!author || !author.openAlexId) {
    return { resolved: false, reason: 'orcid_not_in_openalex', orcid, contactName, emailDomain };
  }

  // 4. name cross-check guard (mis-entered ORCID → different person)
  if (!nameGuardPasses(contactName, author.displayName)) {
    return {
      resolved: false,
      reason: 'name_mismatch',
      orcid,
      contactName,
      openAlexName: author.displayName,
      emailDomain,
    };
  }

  // 5. resolved
  return {
    resolved: true,
    orcid,
    openAlexAuthorId: author.openAlexId,
    canonicalName: author.displayName || contactName,
    contactName,
    institution: author.lastKnownInstitution || null,
    emailDomain,
  };
}

const OPENALEX_SHORT_ID_RE = /A\d+$/i;
function shortOpenAlexId(id) {
  const m = String(id || '').trim().match(OPENALEX_SHORT_ID_RE);
  return m ? m[0].toUpperCase() : null;
}

/**
 * IDENTITY-level PI exclusion (Codex S240 #5): drop any candidate that resolves to
 * the PI's exact identity — shared ORCID or same OpenAlex author id. Identity
 * equality ONLY, never name equality (the name-fuzzy author filter covers names).
 *
 * GATED on a trusted identity status: unresolved/ambiguous candidates still carry
 * orcid/openAlexId fields, so acting on them would risk excluding a NAMESAKE. Only
 * `confirmed`/`probable` candidates are eligible. A no-op unless the PI is resolved.
 *
 * @param {Array} candidates
 * @param {object} pi - resolveProposalPI() result
 * @returns {{ kept: Array, removed: Array }}
 */
function excludePiIdentity(candidates, pi) {
  const list = Array.isArray(candidates) ? candidates : [];
  if (!pi?.resolved) return { kept: list, removed: [] };
  const piOrcid = pi.orcid || null; // already canonical from resolveProposalPI
  const piAuthor = pi.openAlexAuthorId ? shortOpenAlexId(pi.openAlexAuthorId) : null;
  if (!piOrcid && !piAuthor) return { kept: list, removed: [] };

  const removed = [];
  const kept = list.filter((c) => {
    if (c?.identityStatus !== 'confirmed' && c?.identityStatus !== 'probable') return true;
    const rawOrcid = c.orcid || c.orcidId;
    const cOrcid = rawOrcid ? (normalizeOrcid(rawOrcid).id || null) : null;
    const cAuthor = shortOpenAlexId(c.openAlexId || c.openAlexAuthorId);
    const isPi = (piOrcid && cOrcid && piOrcid === cOrcid)
      || (piAuthor && cAuthor && piAuthor === cAuthor);
    if (isPi) { removed.push(c); return false; }
    return true;
  });
  return { kept, removed };
}

module.exports = {
  resolveProposalPI,
  excludePiIdentity,
  _internals: { nameGuardPasses, shortOpenAlexId, GUID_RE },
};
