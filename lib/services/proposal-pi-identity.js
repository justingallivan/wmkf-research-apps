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
const { ORCIDService } = require('./orcid-service');
const { ContactParser } = require('../utils/contact-parser');
const { normalizeOrcid } = require('../utils/orcid-normalize');
const { forenamesContradict } = require('./reviewer-identity-evidence');

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isAbort(err) {
  return err?.name === 'AbortError'
    || err?.code === 'openalex_timeout'
    || err?.code === 'reviewer_time_budget_exceeded';
}

// Honor the time-budget signal INSIDE the resolver (Codex post-impl #1): the
// budget can fire during a Dynamics read or before an inert-return branch, and an
// inert `{ resolved:false }` would then mask the timeout. Throw the abort reason so
// the caller surfaces a real timeout instead of silently losing PI coverage.
function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason || Object.assign(new Error('aborted'), { name: 'AbortError' });
}

// Best-effort ORCID-registry name for the SAME ORCID under review (Codex pre-impl
// #3/#17, post-impl #3): a second authoritative name source besides OpenAlex's
// display_name to catch a mis-entered ORCID whose OpenAlex record is a merged or
// variant name. Best-effort: missing creds / 404 / non-abort error → null (the
// OpenAlex name still gates); an abort/budget error propagates.
// Returns BOTH the registry name (name-guard second source) and the ORCID-current
// affiliation (preferred over OpenAlex's stale last-known for institution COI — Chunk 2a
// D). One getProfile call serves both. Best-effort: missing creds / 404 / non-abort
// error → { registryName: null, currentAffiliation: null }; abort/budget propagates.
async function fetchOrcidRegistryProfile(orcid, { signal } = {}) {
  const empty = { registryName: null, currentAffiliation: null };
  const clientId = process.env.ORCID_CLIENT_ID;
  const clientSecret = process.env.ORCID_CLIENT_SECRET;
  if (!orcid || !clientId || !clientSecret) return empty;
  let profile;
  try {
    profile = await ORCIDService.getProfile(orcid, clientId, clientSecret, { signal });
  } catch (err) {
    if (isAbort(err)) throw err;
    return empty;
  }
  if (!profile) return empty;
  const registryName = profile.creditName
    || [profile.givenNames, profile.familyName].filter(Boolean).join(' ').trim()
    || null;
  return { registryName, currentAffiliation: profile.currentAffiliation || null };
}

function normName(name) {
  return ContactParser.normalizeNameForMatch(ContactParser.stripHonorifics(name || ''));
}

/**
 * Does the author resolved from the contact's ORCID actually correspond to the
 * contact? Guards a MIS-ENTERED ORCID (Codex #2 / §12.2 residual risk). The contact
 * name must AGREE (surname match AND no full-forename contradiction — an initial-only
 * authoritative name does not contradict) with EVERY available authoritative name
 * source (OpenAlex display_name + ORCID-registry name).
 *
 * FAIL-DANGEROUS FIX (Codex post-impl #2): when we cannot check — the contact has no
 * usable name, or NO authoritative name source is available — we must ABSTAIN, not
 * blindly trust the ORCID. A mis-entered ORCID on a contact with a blank name would
 * otherwise resolve as a confirmed (wrong) PI.
 *
 * @returns {{ ok: true } | { ok: false, reason: 'name_uncheckable' | 'name_mismatch', mismatchName?: string }}
 */
function evaluateNameGuard(contactName, authoritativeNames) {
  const c = normName(contactName);
  if (!c) return { ok: false, reason: 'name_uncheckable' };
  const usable = (authoritativeNames || []).filter((n) => normName(n));
  if (usable.length === 0) return { ok: false, reason: 'name_uncheckable' };
  for (const n of usable) {
    if (!ContactParser.namesMatch(c, normName(n))) return { ok: false, reason: 'name_mismatch', mismatchName: n };
    if (forenamesContradict(contactName, n)) return { ok: false, reason: 'name_mismatch', mismatchName: n };
  }
  return { ok: true };
}

/**
 * Append the canonical PI name to an existing proposal-authors list (Codex #15):
 * APPEND + de-dupe, NEVER replace the LLM-derived PI + co-investigators. Returns a
 * new array. No-op when the PI is unresolved or already present.
 */
function appendPiName(proposalAuthors, pi) {
  const list = Array.isArray(proposalAuthors) ? [...proposalAuthors] : [];
  if (!pi?.resolved || !pi.canonicalName) return list;
  const piNorm = normName(pi.canonicalName);
  const already = list.some((n) => ContactParser.namesMatch(piNorm, normName(n)));
  if (!already) list.push(pi.canonicalName);
  return list;
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
  throwIfAborted(signal);
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
    throwIfAborted(signal); // budget may have fired alongside a non-abort read error — don't mask it
    return { resolved: false, reason: 'request_read_failed', error: err.message };
  }
  throwIfAborted(signal);
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
    throwIfAborted(signal); // budget may have fired alongside a non-abort read error — don't mask it
    return { resolved: false, reason: 'contact_read_failed', error: err.message };
  }
  throwIfAborted(signal);
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
    throwIfAborted(signal); // don't let a concurrent budget abort hide behind a non-abort OpenAlex error
    return { resolved: false, reason: 'openalex_error', orcid, contactName, emailDomain, error: err.message };
  }
  throwIfAborted(signal);
  if (!author || !author.openAlexId) {
    return { resolved: false, reason: 'orcid_not_in_openalex', orcid, contactName, emailDomain };
  }

  // 4. name cross-check guard (mis-entered ORCID → different person). Check the
  // contact name against BOTH OpenAlex display_name and the ORCID-registry name
  // (best-effort second source). Abstain if it contradicts either, or if we have no
  // usable name to check against (fail-dangerous fix, Codex post-impl #2).
  const { registryName, currentAffiliation } = await fetchOrcidRegistryProfile(orcid, { signal }); // throws on abort
  throwIfAborted(signal);
  const guard = evaluateNameGuard(contactName, [author.displayName, registryName]);
  if (!guard.ok) {
    return {
      resolved: false,
      reason: guard.reason, // 'name_mismatch' | 'name_uncheckable'
      orcid,
      contactName,
      openAlexName: author.displayName || null,
      registryName: registryName || null,
      mismatchName: guard.mismatchName || null,
      emailDomain,
    };
  }

  // 5. resolved. Expose BOTH institution signals so the COI union (Chunk 2a D2) can
  // include ORCID-current AND OpenAlex-last-known. `institution` keeps the Chunk-1
  // contract (prefer ORCID-current — D — else OpenAlex) for any single-value consumer.
  const currentAffil = currentAffiliation || null;
  const lastKnownInstitution = author.lastKnownInstitution || null;
  return {
    resolved: true,
    orcid,
    openAlexAuthorId: author.openAlexId,
    canonicalName: author.displayName || registryName || contactName,
    contactName,
    currentAffiliation: currentAffil,
    lastKnownInstitution,
    institution: currentAffil || lastKnownInstitution,
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

/**
 * Build the institution UNION for COI (Chunk 2a D2): every known PI-institution
 * signal — ORCID-current affiliation + OpenAlex last-known + the LLM-extracted
 * proposal authorInstitution — deduped (case/space-insensitive). Errs toward
 * over-exclusion (same-institution is a policy conflict). Empty when nothing is
 * known → callers fall back to today's single-value behavior. NOTE: covers the PI's
 * institutions only; co-PI institutions are not extracted (accepted gap, §2 D2).
 *
 * @param {object|null} pi - resolveProposalPI() result
 * @param {string|null} authorInstitution - LLM-extracted proposal institution
 * @returns {string[]}
 */
function piInstitutions(pi, authorInstitution) {
  const raw = [
    pi?.resolved ? pi.currentAffiliation : null,
    pi?.resolved ? pi.lastKnownInstitution : null,
    authorInstitution,
  ].filter((s) => s && String(s).trim());
  const seen = new Set();
  const out = [];
  for (const inst of raw) {
    const key = String(inst).toLowerCase().replace(/\s+/g, ' ').trim();
    if (!seen.has(key)) { seen.add(key); out.push(inst); }
  }
  return out;
}

module.exports = {
  resolveProposalPI,
  excludePiIdentity,
  appendPiName,
  piInstitutions,
  _internals: { evaluateNameGuard, appendPiName, shortOpenAlexId, fetchOrcidRegistryProfile, piInstitutions, GUID_RE },
};
