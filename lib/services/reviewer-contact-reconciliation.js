/**
 * Search-card reconciliation against Dataverse reviewer/contact rows.
 *
 * The normal result is bounded, staff-facing evidence. In one deliberately
 * narrow case it also records durable safety state: a trusted ORCID resolves
 * one exact reviewer person while independently persist-worthy enrichment
 * finds a different address from the one stored on that person. It never
 * changes either address or exposes Dataverse record IDs. Callers must
 * establish a trusted Dataverse context.
 */

import { lookupReviewerIdentity } from './reviewer-identity-lookup';
import { mayPersistIdentity } from './reviewer-identity-resolver';
import { normalizeOrcid } from '../utils/orcid-normalize';
import * as potentialReviewerAdapter from '../dataverse/adapters/potential-reviewer';
import { reviewerCandidateKey } from '../utils/reviewer-candidate-key';
import {
  addressConflictDisposition,
  addressTrustDecision,
  createConflictPendingState,
  normalizeAddress,
} from '../utils/reviewer-address-trust';

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

/**
 * Resolve the exact active reviewer person that is safe to receive durable,
 * person-scoped address state. A public ORCID carried by a search provider is
 * only a lookup hint; the current resolver decision must independently ground
 * that ORCID before it can authorize a write.
 */
export async function resolveTrustedReviewerPerson(candidate, {
  lookup = lookupReviewerIdentity,
  getReviewer = potentialReviewerAdapter.getById,
} = {}) {
  const keys = exactKeys(candidate);
  if (!candidate?.name || !keys.orcid || keys.provisionalOrcid) return null;
  const outcome = await lookup({
    name: candidate.name,
    email: null,
    orcid: keys.orcid,
  }, { allowNameFallback: false });
  if (outcome?.outcome !== 'confident'
    || outcome.match?.matchKey !== 'orcid'
    || outcome.match?.nameConsistent !== true
    || !outcome.match?.reviewerId) return null;
  const person = await getReviewer(outcome.match.reviewerId);
  if (!person || (person.statecode !== undefined && person.statecode !== 0)) return null;
  return { personId: outcome.match.reviewerId, person };
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
 * Attaches bounded reconciliation evidence and, for an exact durable
 * contradiction, boolean conflict/repair projections. Lookup calls remain
 * sequential to avoid a Dataverse request burst.
 */
export async function reconcileReviewerContacts(candidates, {
  signal,
  skip = false,
  requestId = null,
  actingUserSystemId = null,
  lookup = lookupReviewerIdentity,
  getReviewer = potentialReviewerAdapter.getById,
  updateReviewer = potentialReviewerAdapter.update,
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

      const foundEmail = normalizeAddress(candidate.contactEnrichment.email || candidate.email);
      const storedEmailAtLookup = normalizeAddress(outcome?.match?.context?.email);
      const exactStableReviewer = outcome?.outcome === 'confident'
        && outcome.match?.matchKey === 'orcid'
        && outcome.match?.nameConsistent === true
        && !!outcome.match?.reviewerId
        && !!keys.orcid
        && !keys.provisionalOrcid;
      const durableContradiction = exactStableReviewer
        && candidate.contactEnrichment.emailPersistAllowed === true
        && !!foundEmail
        && !!storedEmailAtLookup
        && foundEmail !== storedEmailAtLookup
        && !!requestId;

      if (durableContradiction) {
        try {
          const currentPerson = await getReviewer(outcome.match.reviewerId);
          const currentEmail = normalizeAddress(currentPerson?.wmkf_emailaddress);
          if (!currentEmail) throw new Error('Exact reviewer no longer has a valid stored address');

          // The person may have been corrected after the lookup but before this
          // ETag-guarded read. If it now agrees with enrichment, there is no
          // contradiction left to record.
          if (currentEmail === foundEmail) continue;

          const currentTrust = addressTrustDecision(currentPerson);
          const disposition = addressConflictDisposition(currentTrust.state, {
            email: currentEmail,
            foundEmail,
            reason: 'email_mismatch',
          });
          if (disposition === 'resolved') continue;

          let conflictState = disposition === 'existing' ? currentTrust.state : null;
          if (disposition === 'write') {
            conflictState = createConflictPendingState({
              currentState: currentTrust.state,
              email: currentEmail,
              reason: 'email_mismatch',
              foundEmail,
              source: candidate.contactEnrichment.emailSource || null,
              requestId,
              candidateKey: reviewerCandidateKey(candidate) || `person:${outcome.match.reviewerId}`,
              detectedAt: checkedAt,
            });
            await updateReviewer(outcome.match.reviewerId, {
              addressTrustStateJson: JSON.stringify(conflictState),
            }, {
              actingUserSystemId,
              ifMatch: currentPerson._etag,
            });
          }
          candidate.addressConflictPending = true;
          candidate.contactEnrichment.addressConflictPending = true;
          candidate.contactEnrichment.dataverseContactEvidence = {
            ...candidate.contactEnrichment.dataverseContactEvidence,
            status: 'review_required',
            reason: conflictState.conflict?.reason || 'email_mismatch',
          };
        } catch (error) {
          candidate.conflictRecordUnavailable = true;
          candidate.contactEnrichment.conflictRecordUnavailable = true;
          candidate.contactEnrichment.dataverseContactEvidence = {
            ...candidate.contactEnrichment.dataverseContactEvidence,
            status: 'review_required',
            reason: 'conflict_record_unavailable',
          };
        }
      }
    } catch (error) {
      candidate.contactEnrichment.dataverseContactEvidence = unavailableEvidence(checkedAt);
    }
  }

  return list;
}
