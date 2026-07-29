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
 * The stored email is read only to prove that a stronger source label describes
 * that exact address before upgrading provenance.
 *
 * (Folding this into potential-reviewer.js is a later tidy-up; kept separate now
 * to minimize caller churn during the collapse.)
 */

import { DynamicsService } from '../../services/dynamics-service.js';
import * as odata from '../core/odata.js';
import { entitySet } from '../core/entity-registry.js';
// Address-provenance precedence lives with the send-gate classifier that defines the
// tiers, so the adapter cannot disagree with the gate about which source is stronger.
import { emailSourceOutranks } from '../../utils/reviewer-invite.js';

const ENTITY_SET = entitySet('wmkf_potentialreviewerses');

// Bibliometric fields now carried on the person (collapse Phase 1).
const BIBLIO_SELECT = [
  'wmkf_potentialreviewersid',
  'wmkf_emailaddress',
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

const IDENTITY_BINDING_FIELDS = Object.freeze([
  'wmkf_identitybindingversion',
  'wmkf_identitybindingsource',
  'wmkf_identitybindinganchor',
  'wmkf_identityboundat',
  'wmkf_identityderivedbindingversion',
  'wmkf_identityfieldlineagejson',
]);

const IDENTITY_LINEAGE_VALUE_FIELDS = Object.freeze([
  'wmkf_googlescholarid',
  'wmkf_googlescholarurl',
  'wmkf_hindex',
  'wmkf_i10index',
  'wmkf_totalcitations',
  'wmkf_orcid',
  'wmkf_orcidurl',
]);

const IDENTITY_DECISION_FIELDS = Object.freeze([
  'wmkf_identitystatus',
  'wmkf_identityconfidenceband',
  'wmkf_identityresolverversion',
  'wmkf_identityresolvedat',
  'wmkf_identityevidencesummary',
  'wmkf_identityverifiedanchorsjson',
]);

const IDENTITY_BINDING_SELECT = Object.freeze([
  'wmkf_potentialreviewersid',
  ...IDENTITY_BINDING_FIELDS,
  ...IDENTITY_LINEAGE_VALUE_FIELDS,
  ...IDENTITY_DECISION_FIELDS,
]);

const IDENTITY_BINDING_COMPLETE_PATCH_FIELDS = Object.freeze([
  ...IDENTITY_BINDING_FIELDS,
  ...IDENTITY_LINEAGE_VALUE_FIELDS,
  ...IDENTITY_DECISION_FIELDS,
]);
const IDENTITY_BINDING_PATCH_FIELDS = new Set(IDENTITY_BINDING_COMPLETE_PATCH_FIELDS);

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

// Hard Dynamics caps on the FREE-TEXT string columns this adapter writes — a value
// over the cap 400s the WHOLE write (observed prod: req 1002833, "Hongjun Song", a
// long multi-institution OpenAlex affiliation). Caps are the ACTUAL schema maxLengths
// (lib/dataverse/schema/wave6/02_wmkf_potentialreviewers_bibliometric.json), not
// guesses. Only free-text fields are listed: an enrichment string can plausibly
// overflow them, and ellipsis-truncation keeps them legible. Structured columns
// (orcid/url/scholar-id, the URL fields) are deliberately omitted — they're bounded
// upstream and a mid-string ellipsis would corrupt a URL/ID rather than help; if one
// ever 400s it needs a drop-not-truncate strategy, not this. Mirrors the
// wmkf_primaryaffiliation:500 entry in potential-reviewer.js FIELD_MAX.
const FIELD_MAX = {
  wmkf_primaryaffiliation: 500,
  wmkf_department: 255,
};
function clampField(key, v) {
  const max = FIELD_MAX[key];
  if (max && typeof v === 'string' && v.length > max) {
    return v.slice(0, max - 1).trimEnd() + '…';
  }
  return v;
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
      select: odata.select(BIBLIO_SELECT),
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
  email,
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
    wmkf_primaryaffiliation: clampField('wmkf_primaryaffiliation', affiliation),
    wmkf_department: clampField('wmkf_department', department),
    wmkf_website: website,
    wmkf_facultypageurl: facultyPageUrl,
    wmkf_keywords: keywords,
  });

  const existing = await DynamicsService.getRecord(ENTITY_SET, potentialReviewerId, {
    select: odata.select(BIBLIO_SELECT),
  });

  const merge = { ...metrics };
  if (hasMetrics) merge.wmkf_metricsupdatedat = now;
  merge.wmkf_lastchecked = now;
  for (const [k, v] of Object.entries(fillIfEmpty)) {
    if (isEmpty(existing?.[k])) merge[k] = v;
  }

  // Manual and contested sources are explicit safety assertions and must be
  // AUTHORITATIVE — overwrite any stale trusted source (the other descriptive
  // fields stay fill-only to preserve staff edits). Without this, a row whose
  // address was downgraded to quick-check/research-only could still read ready from an
  // old `wmkf_emailsource` value on the live person record.
  if (emailSource === 'manual' || emailSource === 'search_contested') merge.wmkf_emailsource = emailSource;
  const incomingEmail = String(email || '').trim().toLowerCase();
  const sameStoredEmail = !!incomingEmail
    && incomingEmail === String(existing?.wmkf_emailaddress || '').trim().toLowerCase();
  const storedSource = String(existing?.wmkf_emailsource || '').trim().toLowerCase();

  // Provenance PRECEDENCE (S387). `wmkf_emailsource` is otherwise fill-if-empty, so the
  // FIRST source ever recorded for a person pinned their address tier forever: a reviewer
  // whose address was captured as `serp_search` on one request stayed `research_only` —
  // unsendable — even after another request's enrichment found the SAME address embedded
  // in their own PubMed affiliation string (`affiliation`, a quick-check source). Observed
  // live on request 1002874: the roster row said `affiliation` while the person row said
  // `serp_search`, so the reviewer could not be invited at all.
  //
  // Now a strictly stronger tier supersedes a weaker one. Preconditions are the ones the
  // narrow `scholarly_multi` upgrade this replaces already enforced, and they matter:
  //   - SAME address only. A source describes one specific address; promoting the tier
  //     while the address differs would relabel evidence onto a different string.
  //   - ETag-conditional, so a concurrent write cannot be clobbered by the upgrade.
  //   - strictly greater, so an equal tier never churns the value (and a staff attestation
  //     is not displaced by a same-tier machine source).
  //   - both sides KNOWN (`emailSourceTier` returns null otherwise), so an unrecognized
  //     source neither upgrades nor is upgraded.
  // Downgrades stay explicit: only `manual`/`search_contested` overwrite above, because
  // those are safety assertions rather than evidence claims.
  const sourceUpgrade = sameStoredEmail
    && !!existing?._etag
    && emailSourceOutranks(emailSource, storedSource);
  if (sourceUpgrade) {
    merge.wmkf_emailsource = emailSource;
  }

  await DynamicsService.updateRecord(ENTITY_SET, potentialReviewerId, merge, {
    actingUserSystemId,
    ...(sourceUpgrade ? { ifMatch: existing._etag } : {}),
  });
  return { id: potentialReviewerId, created: false };
}

/**
 * Edit bibliometric metadata on the person. `id` is the person's
 * wmkf_potentialreviewersid. Touches wmkf_lastchecked; advances
 * wmkf_metricsupdatedat only when a metric field is supplied.
 */
/**
 * @param {object} [options]
 * @param {string} [options.actingUserSystemId]
 * @param {string} [options.ifMatch] - row ETag for an optimistic-concurrency write.
 *   Opt-in: existing callers pass nothing and keep last-write-wins. Supplying it makes
 *   Dataverse reject the PATCH with 412 when ANY field on the row changed since the
 *   caller's read — required by callers whose write is only valid for the exact row
 *   state they validated (S387: a staff address attestation must not land on an address
 *   another session substituted after the check).
 */
export async function updateById(id, updates, { actingUserSystemId, ifMatch } = {}) {
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
      payload[map[k]] = clampField(map[k], v);
      if (k === 'hIndex' || k === 'i10Index' || k === 'totalCitations') touchesMetrics = true;
    }
  }
  if (Object.keys(payload).length === 0) return;

  const existing = await DynamicsService.getRecord(ENTITY_SET, id, { select: odata.select(BIBLIO_SELECT) });
  const diff = {};
  for (const [k, v] of Object.entries(payload)) {
    if (!fieldsEqual(existing?.[k], v)) diff[k] = v;
  }
  if (Object.keys(diff).length === 0) return;

  const now = new Date().toISOString();
  diff.wmkf_lastchecked = now;
  if (touchesMetrics) diff.wmkf_metricsupdatedat = now;
  await DynamicsService.updateRecord(ENTITY_SET, id, diff, {
    actingUserSystemId,
    ...(ifMatch ? { ifMatch } : {}),
  });
}

function fieldsEqual(a, b) {
  const norm = (x) => {
    if (x === null || x === undefined) return '';
    if (typeof x === 'string') return x.trim().toLowerCase();
    return String(x);
  };
  return norm(a) === norm(b);
}

export const IDENTITY_DECISION_ORIGIN = Object.freeze({
  SELF_REPORT: 'self_report',
  AUTOMATED: 'automated',
});

const IDENTITY_DECISION_STATUSES = new Set(['confirmed', 'probable', 'unresolved', 'ambiguous']);

function assertIdentityOrigin(identityOrigin, allowedOrigins, operation) {
  if (!allowedOrigins.includes(identityOrigin)) {
    throw new Error(`${operation}: explicit identityOrigin required (${allowedOrigins.join(' or ')})`);
  }
}

/**
 * Write the CURRENT reviewer-identity decision onto the person. `identityOrigin`
 * is a transitional, server-only trust marker: only a reviewer self-report may
 * persist `confirmed`; automated decisions are persisted as at most `probable`.
 * `decision` is a ResolvedIdentity (lib/services/reviewer-identity-resolver.js).
 * verifiedAnchorsJson is a COMPACT projection (kept well under the Memo cap).
 */
export async function writeIdentityDecision(potentialReviewerId, decision, { actingUserSystemId, identityOrigin } = {}) {
  if (!potentialReviewerId) throw new Error('researcher.writeIdentityDecision: id required');
  if (!decision || !IDENTITY_DECISION_STATUSES.has(decision.status)) {
    throw new Error('researcher.writeIdentityDecision: known decision status required');
  }
  assertIdentityOrigin(
    identityOrigin,
    [IDENTITY_DECISION_ORIGIN.SELF_REPORT, IDENTITY_DECISION_ORIGIN.AUTOMATED],
    'researcher.writeIdentityDecision',
  );
  if (identityOrigin === IDENTITY_DECISION_ORIGIN.SELF_REPORT && decision.status !== 'confirmed') {
    throw new Error('researcher.writeIdentityDecision: self_report origin requires confirmed status');
  }

  let decisionToPersist = decision;
  if (identityOrigin === IDENTITY_DECISION_ORIGIN.AUTOMATED) {
    // Fail closed: every automated write must prove it will not overwrite a
    // stored reviewer attestation. Read errors intentionally propagate.
    const cur = await DynamicsService.getRecord(ENTITY_SET, potentialReviewerId, {
      select: 'wmkf_potentialreviewersid,wmkf_identitystatus',
    });
    if (cur?.wmkf_identitystatus === 'confirmed') return;
    if (decision.status === 'confirmed') {
      const summaryDetail = String(decision.evidenceSummary || '')
        .replace(/^confirmed\s+[—-]\s*/i, '')
        .trim();
      decisionToPersist = {
        ...decision,
        status: 'probable',
        confidenceBand: 'medium',
        evidenceSummary: `probable — automated high-confidence decision capped at persistence boundary${summaryDetail ? `; ${summaryDetail}` : ''}`,
      };
    }
  }
  const anchorsCompact = JSON.stringify(
    (decisionToPersist.anchors || []).map((a) => ({ type: a.type, canonicalKey: a.canonicalKey, sourceUrl: a.sourceUrl || null, verifier: a.verifier })),
  );
  const patch = {
    wmkf_identitystatus: decisionToPersist.status,
    wmkf_identityconfidenceband: decisionToPersist.confidenceBand || null,
    wmkf_identityresolverversion: decisionToPersist.resolverVersion || null,
    wmkf_identityresolvedat: decisionToPersist.resolvedAt || null,
    wmkf_identityevidencesummary: (decisionToPersist.evidenceSummary || '').slice(0, 2000) || null,
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
export async function clearIdentityFields(potentialReviewerId, fields, { actingUserSystemId, identityOrigin } = {}) {
  if (!potentialReviewerId) throw new Error('researcher.clearIdentityFields: id required');
  assertIdentityOrigin(identityOrigin, [IDENTITY_DECISION_ORIGIN.AUTOMATED], 'researcher.clearIdentityFields');
  if (!Array.isArray(fields) || fields.length === 0) return;
  // Never clear a reviewer-confirmed record. Fail closed: let a read error
  // propagate rather than clear a record whose status we could not verify.
  const cur = await DynamicsService.getRecord(ENTITY_SET, potentialReviewerId, {
    select: 'wmkf_potentialreviewersid,wmkf_identitystatus',
  });
  if (cur?.wmkf_identitystatus === 'confirmed') return;
  const patch = {};
  for (const f of fields) patch[f] = null;
  await DynamicsService.updateRecord(ENTITY_SET, potentialReviewerId, patch, { actingUserSystemId });
}

/**
 * Fail-closed read for the versioned identity-binding writer. Dataverse supplies
 * `@odata.etag` outside `$select`; processAnnotations exposes it as `_etag`.
 * Unlike getByPotentialReviewer, read errors intentionally propagate.
 */
export async function getIdentityBindingForUpdate(potentialReviewerId) {
  if (!potentialReviewerId) throw new Error('researcher.getIdentityBindingForUpdate: id required');
  return DynamicsService.getRecord(ENTITY_SET, potentialReviewerId, {
    select: odata.select(IDENTITY_BINDING_SELECT),
  });
}

/**
 * Apply one complete, conditional identity-binding PATCH. Explicit nulls are
 * preserved. The strict allowlist prevents this narrow concurrency seam from
 * becoming a generic person-row writer.
 */
export async function patchIdentityBinding(
  potentialReviewerId,
  patch,
  { ifMatch, actingUserSystemId } = {},
) {
  if (!potentialReviewerId) throw new Error('researcher.patchIdentityBinding: id required');
  if (typeof ifMatch !== 'string' || !ifMatch.trim()) {
    throw new Error('researcher.patchIdentityBinding: non-empty ifMatch required');
  }
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).length === 0) {
    throw new Error('researcher.patchIdentityBinding: non-empty patch required');
  }
  const unknown = Object.keys(patch).filter((field) => !IDENTITY_BINDING_PATCH_FIELDS.has(field));
  if (unknown.length > 0) {
    throw new Error(`researcher.patchIdentityBinding: unsupported fields (${unknown.join(', ')})`);
  }
  const missingBindingFields = IDENTITY_BINDING_COMPLETE_PATCH_FIELDS.filter(
    (field) => !Object.prototype.hasOwnProperty.call(patch, field),
  );
  if (missingBindingFields.length > 0) {
    throw new Error(`researcher.patchIdentityBinding: incomplete identity patch (${missingBindingFields.join(', ')})`);
  }
  const undefinedFields = IDENTITY_BINDING_COMPLETE_PATCH_FIELDS.filter((field) => patch[field] === undefined);
  if (undefinedFields.length > 0) {
    throw new Error(`researcher.patchIdentityBinding: undefined identity fields (${undefinedFields.join(', ')})`);
  }

  await DynamicsService.updateRecord(ENTITY_SET, potentialReviewerId, patch, {
    ifMatch,
    actingUserSystemId,
  });
}

export const ENTITY_SET_NAME = ENTITY_SET;
