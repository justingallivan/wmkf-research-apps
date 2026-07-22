/**
 * Read-only search-card reconciliation against Dataverse reviewer/contact rows.
 *
 * This service produces staff-facing evidence only. It never writes, exposes
 * Dataverse record IDs, changes candidate identity/contact fields, or grants
 * save authority. Callers must establish a trusted Dataverse context.
 */

import { lookupReviewerIdentity } from './reviewer-identity-lookup';
import { mayPersistIdentity } from './reviewer-identity-resolver';
import { normalizeOrcid } from '../utils/orcid-normalize';

const MAX_INSTITUTIONS = 8;
const ALLOWED_INSTITUTION_SOURCES = new Set([
  'staff_confirmed',
  'primary_affiliation',
  'organization',
]);
const ALLOWED_CONFLICT_REASONS = new Set([
  'orcid_email_split',
  'contact_linked_elsewhere',
  'email_mismatch',
]);

function cleanEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return email && email.length <= 254 ? email : null;
}

function validOrcid(value) {
  const normalized = normalizeOrcid(value);
  return normalized.state === 'valid' ? normalized.id : null;
}

function identityTrustsOrcid(identity, orcid) {
  if (!orcid || !mayPersistIdentity(identity?.status)) return false;
  return (identity.anchors || []).some((anchor) => {
    const anchorOrcid = validOrcid(anchor?.value)
      || validOrcid(String(anchor?.canonicalKey || '').replace(/^orcid:/i, ''));
    return anchorOrcid === orcid;
  });
}

function exactKeys(candidate) {
  const enrichment = candidate?.contactEnrichment || {};
  const candidateOrcid = validOrcid(enrichment.orcidId || enrichment.orcid || candidate?.orcid);
  const trustedOrcid = identityTrustsOrcid(enrichment.identity, candidateOrcid)
    ? candidateOrcid
    : null;
  const provisionalOrcid = trustedOrcid
    ? null
    : validOrcid(
        enrichment.orcidId
        || enrichment.orcid
        || enrichment.tierResults?.openalex_author?.orcid
        || null
      );
  return {
    email: cleanEmail(enrichment.email || candidate?.email),
    orcid: trustedOrcid || provisionalOrcid,
    provisionalOrcid: !!provisionalOrcid,
  };
}

function compactInstitutions(outcome) {
  const seen = new Set();
  const institutions = [];
  for (const reviewer of outcome?.referencedReviewers || []) {
    for (const entry of reviewer?.institutions || []) {
      const value = typeof entry?.value === 'string' ? entry.value.trim().slice(0, 500) : '';
      const source = ALLOWED_INSTITUTION_SOURCES.has(entry?.source) ? entry.source : null;
      const key = `${source || ''}|${value.toLowerCase()}`;
      if (!value || !source || seen.has(key)) continue;
      seen.add(key);
      institutions.push({ value, source });
      if (institutions.length >= MAX_INSTITUTIONS) return institutions;
    }
  }
  return institutions;
}

function recordKinds(outcome) {
  const kinds = [];
  if ((outcome?.referencedReviewers || []).length > 0) kinds.push('potential_reviewer');
  if ((outcome?.referencedContacts || []).length > 0) kinds.push('contact');
  return kinds;
}

function unavailableEvidence(checkedAt, reason = 'lookup_unavailable') {
  return {
    status: 'unavailable',
    matchKey: null,
    recordKinds: [],
    nameConsistent: null,
    institutions: [],
    reason,
    checkedAt,
  };
}

export function compactDataverseContactEvidence(outcome, {
  checkedAt,
  provisionalOrcid = false,
} = {}) {
  const base = {
    matchKey: outcome?.match?.matchKey === 'orcid' ? 'orcid'
      : outcome?.match?.matchKey === 'email' ? 'email'
        : null,
    recordKinds: recordKinds(outcome),
    nameConsistent: outcome?.match?.nameConsistent === true ? true
      : outcome?.match?.nameConsistent === false ? false
        : null,
    institutions: compactInstitutions(outcome),
    checkedAt,
  };

  if (outcome?.outcome === 'confident') {
    if (provisionalOrcid && base.matchKey === 'orcid') {
      return { ...base, status: 'review_required', reason: 'provisional_orcid_match' };
    }
    return { ...base, status: 'known', reason: null };
  }
  if (outcome?.outcome === 'candidates') {
    return {
      ...base,
      status: 'review_required',
      reason: provisionalOrcid ? 'provisional_orcid_match' : 'ambiguous_or_name_mismatch',
    };
  }
  if (outcome?.outcome === 'conflict') {
    return {
      ...base,
      status: 'review_required',
      reason: ALLOWED_CONFLICT_REASONS.has(outcome.reason) ? outcome.reason : 'identity_conflict',
    };
  }
  return { ...base, status: 'none', reason: null };
}

/**
 * Mutates each result only by attaching contactEnrichment.dataverseContactEvidence.
 * Lookup calls are deliberately sequential to avoid a Dataverse request burst.
 */
export async function reconcileReviewerContacts(candidates, {
  signal,
  skip = false,
  lookup = lookupReviewerIdentity,
  now = () => new Date().toISOString(),
} = {}) {
  const list = Array.isArray(candidates) ? candidates : [];
  const checkedAt = now();

  for (const candidate of list) {
    if (!candidate?.contactEnrichment) continue;
    if (skip || signal?.aborted) {
      candidate.contactEnrichment.dataverseContactEvidence = unavailableEvidence(
        checkedAt,
        skip ? 'partial_enrichment' : 'deadline_exceeded',
      );
      continue;
    }

    try {
      const keys = exactKeys(candidate);
      if (!keys.email && !keys.orcid) continue;
      const outcome = await lookup({
        name: candidate.name,
        email: keys.email,
        orcid: keys.orcid,
      }, { allowNameFallback: false });
      candidate.contactEnrichment.dataverseContactEvidence = compactDataverseContactEvidence(outcome, {
        checkedAt,
        provisionalOrcid: keys.provisionalOrcid,
      });
    } catch (error) {
      candidate.contactEnrichment.dataverseContactEvidence = unavailableEvidence(checkedAt);
    }
  }

  return list;
}
