/**
 * Adapter: bibliometric write-back onto wmkf_potentialreviewers (the person).
 *
 * S213 appresearcher collapse: the bibliometric data that used to live on the
 * `wmkf_appresearcher` 1:1 sidecar now lives directly on the person row. This
 * module keeps its original method names (callers unchanged) but operates on
 * `wmkf_potentialreviewerses` + the bibliometric fields added in collapse Phase 1.
 * `affiliation` maps to the canonical `wmkf_primaryaffiliation` (500) — NOT the
 * legacy 100-char `wmkf_organizationname`. Identity fields (name, email) are NOT
 * written here — those belong to the person-identity adapter (potential-reviewer.js).
 *
 * (Folding this into potential-reviewer.js is a later tidy-up; kept separate now
 * to minimize caller churn during the collapse.)
 */

import { DynamicsService } from '../../services/dynamics-service.js';

const ENTITY_SET = 'wmkf_potentialreviewerses';

// Bibliometric fields now carried on the person (collapse Phase 1).
const BIBLIO_SELECT = [
  'wmkf_potentialreviewersid',
  'wmkf_primaryaffiliation',
  'wmkf_department',
  'wmkf_orcid',
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
  'wmkf_lastchecked',
  'wmkf_metricsupdatedat',
  'wmkf_contactenrichedat',
  'wmkf_contactenrichmentsource',
];

function pruneEmpty(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    out[k] = v;
  }
  return out;
}

function isEmpty(v) {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

/**
 * Read the bibliometric fields for a person. Returns the person row (bibliometric
 * subset), or null. (Name kept for call-site compatibility — the "potential
 * reviewer" IS the row now, so this is just a by-id read.)
 */
export async function getByPotentialReviewer(potentialReviewerId) {
  if (!potentialReviewerId) return null;
  try {
    return await DynamicsService.getRecord(ENTITY_SET, potentialReviewerId, {
      select: BIBLIO_SELECT.join(','),
    });
  } catch {
    return null;
  }
}

/**
 * Write the bibliometric snapshot onto the person (1:1 — no separate row).
 * Metric fields (hIndex, i10Index, totalCitations) always overwrite (snapshots);
 * other fields fill empty only (preserve manual edits). Identity fields
 * (name/email/normalizedName) are ignored here. Returns { id, created:false }.
 */
export async function upsertByPotentialReviewer(potentialReviewerId, {
  emailSource,
  orcid,
  orcidUrl,
  googleScholarId,
  googleScholarUrl,
  hIndex,
  i10Index,
  totalCitations,
  affiliation,
  department,
  website,
  facultyPageUrl,
  keywords,
}, { actingUserSystemId } = {}) {
  if (!potentialReviewerId) {
    throw new Error('researcher adapter: potentialReviewerId is required');
  }
  const now = new Date().toISOString();

  const metrics = pruneEmpty({
    wmkf_hindex: hIndex,
    wmkf_i10index: i10Index,
    wmkf_totalcitations: totalCitations,
  });
  const hasMetrics = Object.keys(metrics).length > 0;

  const fillIfEmpty = pruneEmpty({
    wmkf_emailsource: emailSource,
    wmkf_orcid: orcid,
    wmkf_orcidurl: orcidUrl,
    wmkf_googlescholarid: googleScholarId,
    wmkf_googlescholarurl: googleScholarUrl,
    wmkf_primaryaffiliation: affiliation,
    wmkf_department: department,
    wmkf_website: website,
    wmkf_facultypageurl: facultyPageUrl,
    wmkf_keywords: keywords,
  });

  const existing = await DynamicsService.getRecord(ENTITY_SET, potentialReviewerId, {
    select: BIBLIO_SELECT.join(','),
  });

  const merge = { ...metrics };
  if (hasMetrics) merge.wmkf_metricsupdatedat = now;
  merge.wmkf_lastchecked = now;
  for (const [k, v] of Object.entries(fillIfEmpty)) {
    if (isEmpty(existing?.[k])) merge[k] = v;
  }

  await DynamicsService.updateRecord(ENTITY_SET, potentialReviewerId, merge, { actingUserSystemId });
  return { id: potentialReviewerId, created: false };
}

/**
 * Edit bibliometric metadata on the person. `id` is the person's
 * wmkf_potentialreviewersid. Touches wmkf_lastchecked; advances
 * wmkf_metricsupdatedat only when a metric field is supplied.
 */
export async function updateById(id, updates, { actingUserSystemId } = {}) {
  if (!id) throw new Error('researcher.updateById: id required');
  const map = {
    emailSource: 'wmkf_emailsource',
    orcid: 'wmkf_orcid',
    orcidUrl: 'wmkf_orcidurl',
    googleScholarId: 'wmkf_googlescholarid',
    googleScholarUrl: 'wmkf_googlescholarurl',
    hIndex: 'wmkf_hindex',
    i10Index: 'wmkf_i10index',
    totalCitations: 'wmkf_totalcitations',
    affiliation: 'wmkf_primaryaffiliation',
    department: 'wmkf_department',
    website: 'wmkf_website',
    facultyPageUrl: 'wmkf_facultypageurl',
    keywords: 'wmkf_keywords',
  };
  const payload = {};
  let touchesMetrics = false;
  for (const [k, v] of Object.entries(updates || {})) {
    if (k in map && v !== undefined) {
      payload[map[k]] = v;
      if (k === 'hIndex' || k === 'i10Index' || k === 'totalCitations') touchesMetrics = true;
    }
  }
  if (Object.keys(payload).length === 0) return;

  const existing = await DynamicsService.getRecord(ENTITY_SET, id, { select: BIBLIO_SELECT.join(',') });
  const diff = {};
  for (const [k, v] of Object.entries(payload)) {
    if (!fieldsEqual(existing?.[k], v)) diff[k] = v;
  }
  if (Object.keys(diff).length === 0) return;

  const now = new Date().toISOString();
  diff.wmkf_lastchecked = now;
  if (touchesMetrics) diff.wmkf_metricsupdatedat = now;
  await DynamicsService.updateRecord(ENTITY_SET, id, diff, { actingUserSystemId });
}

function fieldsEqual(a, b) {
  const norm = (x) => {
    if (x === null || x === undefined) return '';
    if (typeof x === 'string') return x.trim().toLowerCase();
    return String(x);
  };
  return norm(a) === norm(b);
}

/**
 * Write the reviewer-identity resolver's CURRENT decision onto the person (the
 * wmkf_identity* fields, deployed S214). Always overwrites — it's the latest
 * verdict. `decision` is a ResolvedIdentity (lib/services/reviewer-identity-resolver.js).
 * verifiedAnchorsJson is a COMPACT projection (kept well under the Memo cap).
 */
export async function writeIdentityDecision(potentialReviewerId, decision, { actingUserSystemId } = {}) {
  if (!potentialReviewerId) throw new Error('researcher.writeIdentityDecision: id required');
  if (!decision || !decision.status) return;
  const anchorsCompact = JSON.stringify(
    (decision.anchors || []).map((a) => ({ type: a.type, canonicalKey: a.canonicalKey, sourceUrl: a.sourceUrl || null, verifier: a.verifier })),
  );
  const patch = {
    wmkf_identitystatus: decision.status,
    wmkf_identityconfidenceband: decision.confidenceBand || null,
    wmkf_identityresolverversion: decision.resolverVersion || null,
    wmkf_identityresolvedat: decision.resolvedAt || null,
    wmkf_identityevidencesummary: (decision.evidenceSummary || '').slice(0, 2000) || null,
    wmkf_identityverifiedanchorsjson: anchorsCompact.length <= 50000 ? anchorsCompact : '[]',
  };
  await DynamicsService.updateRecord(ENTITY_SET, potentialReviewerId, patch, { actingUserSystemId });
}

/**
 * Explicitly NULL identity-bearing fields (PATCH). Unlike upsertByPotentialReviewer
 * (which prunes nulls and so cannot clear), this DELIBERATELY writes nulls to
 * remove wrong/unverified values when the resolver downgrades below `probable`.
 * `fields` = Dataverse logical names (see RESOLVER_SOURCED_FIELDS in the resolver).
 */
export async function clearIdentityFields(potentialReviewerId, fields, { actingUserSystemId } = {}) {
  if (!potentialReviewerId) throw new Error('researcher.clearIdentityFields: id required');
  if (!Array.isArray(fields) || fields.length === 0) return;
  const patch = {};
  for (const f of fields) patch[f] = null;
  await DynamicsService.updateRecord(ENTITY_SET, potentialReviewerId, patch, { actingUserSystemId });
}

export const ENTITY_SET_NAME = ENTITY_SET;
