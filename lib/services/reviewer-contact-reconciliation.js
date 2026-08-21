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
import * as reviewerSuggestionAdapter from '../dataverse/adapters/reviewer-suggestion';
import * as grantRequestAdapter from '../dataverse/adapters/grant-request';
import { reviewerCandidateKey } from '../utils/reviewer-candidate-key';
import { hasServerIdentityDecisionReceipt } from './reviewer-candidate-attestation';
import {
  addressConflictDisposition,
  addressTrustDecision,
  createConflictPendingState,
  normalizeAddress,
} from '../utils/reviewer-address-trust';

const MAX_INSTITUTIONS = 8;
const PRIOR_REQUEST_SOURCE_LIMIT = 25;
const PRIOR_REQUEST_DISPLAY_LIMIT = 3;
const PRIOR_REQUEST_LOOKUP_CHUNK = 25;
const PRIOR_REQUEST_PRESENTATION_BUDGET_MS = 3000;
const PRIOR_REQUEST_SELECT = [
  'akoya_requestid',
  'akoya_requestnum',
  'akoya_title',
  'akoya_fiscalyear',
  'wmkf_meetingdate',
];
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
  allowInactive = false,
} = {}) {
  const keys = exactKeys(candidate);
  if (!hasServerIdentityDecisionReceipt(candidate)
    || !candidate?.name || !keys.orcid || keys.provisionalOrcid) return null;
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
  if (!person || (!allowInactive && person.statecode !== undefined && person.statecode !== 0)) return null;
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

function boundedRequestText(value, max) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}

function compactPriorRequest(record) {
  const requestId = boundedRequestText(record?.akoya_requestid, 80);
  if (!requestId) return null;
  return {
    requestId,
    requestNumber: boundedRequestText(record?.akoya_requestnum, 80),
    title: boundedRequestText(record?.akoya_title, 500),
    fiscalYear: boundedRequestText(record?.akoya_fiscalyear, 120),
    meetingDate: boundedRequestText(record?.wmkf_meetingdate, 40),
  };
}

function priorRequestSortKey(request) {
  const meetingDate = Date.parse(request?.meetingDate || '');
  if (Number.isFinite(meetingDate)) return meetingDate;
  return Number.NEGATIVE_INFINITY;
}

function sortPriorRequests(a, b) {
  const dateDelta = priorRequestSortKey(b) - priorRequestSortKey(a);
  if (Number.isFinite(dateDelta) && dateDelta !== 0) return dateDelta;
  const fiscalDelta = String(b?.fiscalYear || '').localeCompare(String(a?.fiscalYear || ''), undefined, {
    numeric: true,
  });
  if (fiscalDelta !== 0) return fiscalDelta;
  return String(b?.requestNumber || '').localeCompare(String(a?.requestNumber || ''), undefined, {
    numeric: true,
  });
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function settledSource(read) {
  try {
    return { ok: true, value: await read };
  } catch {
    return { ok: false, value: null };
  }
}

/**
 * Return bounded, read-only request context for one server-resolved Potential
 * Reviewer. Source failures are independent; no candidate object is accepted or
 * mutated, so a late result cannot alter an already-returned reconciliation DTO.
 */
export async function loadPriorRequestContext(potentialReviewerId, currentRequestId, {
  findSuggestionLinks = reviewerSuggestionAdapter.findRequestLinksByPotentialReviewer,
  findLegacyRequests = grantRequestAdapter.findByPotentialReviewerSlots,
  findRequestsByIds = grantRequestAdapter.findByIds,
} = {}) {
  const [suggestionSource, legacySource] = await Promise.all([
    settledSource(findSuggestionLinks(potentialReviewerId, { top: PRIOR_REQUEST_SOURCE_LIMIT })),
    settledSource(findLegacyRequests(potentialReviewerId, { top: PRIOR_REQUEST_SOURCE_LIMIT })),
  ]);
  if (!suggestionSource.ok && !legacySource.ok) return null;

  const currentId = String(currentRequestId || '').toLowerCase();
  const suggestionIds = Array.from(new Set(
    (suggestionSource.value?.records || [])
      .map((row) => boundedRequestText(row?._wmkf_request_value, 80))
      .filter((id) => id && id.toLowerCase() !== currentId),
  ));

  const metadataSources = await Promise.all(
    chunks(suggestionIds, PRIOR_REQUEST_LOOKUP_CHUNK).map((requestIds) => (
      settledSource(findRequestsByIds(requestIds, {
        select: PRIOR_REQUEST_SELECT,
        top: requestIds.length,
      }))
    )),
  );

  let complete = suggestionSource.ok
    && legacySource.ok
    && suggestionSource.value?.hasMore !== true
    && legacySource.value?.hasMore !== true;
  const byRequestId = new Map();
  const addRecord = (record) => {
    const compact = compactPriorRequest(record);
    if (!compact || compact.requestId.toLowerCase() === currentId) return;
    byRequestId.set(compact.requestId.toLowerCase(), compact);
  };

  for (const row of legacySource.value?.records || []) addRecord(row);
  for (const source of metadataSources) {
    if (!source.ok || source.value?.hasMore === true) {
      complete = false;
      continue;
    }
    for (const row of source.value?.records || []) addRecord(row);
  }

  const resolvedSuggestionIds = new Set(
    metadataSources.flatMap((source) => (source.value?.records || []))
      .map((row) => String(row?.akoya_requestid || '').toLowerCase())
      .filter(Boolean),
  );
  if (suggestionIds.some((id) => !resolvedSuggestionIds.has(id.toLowerCase()))) complete = false;

  const requests = Array.from(byRequestId.values()).sort(sortPriorRequests);
  if (requests.length === 0) return null;
  return {
    complete,
    ...(complete ? { totalCount: requests.length } : {}),
    requests: requests.slice(0, PRIOR_REQUEST_DISPLAY_LIMIT),
  };
}

function withinPresentationBudget(promise, budgetMs) {
  return new Promise((resolve) => {
    let finished = false;
    const settle = (value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => settle(null), budgetMs);
    promise.then(settle, () => settle(null));
  });
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
  includePriorRequestContext = false,
  priorRequestContextLoader = loadPriorRequestContext,
  priorRequestBudgetMs = PRIOR_REQUEST_PRESENTATION_BUDGET_MS,
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
      const mayLoadPriorRequestContext = includePriorRequestContext
        && exactStableReviewer
        && !!requestId
        && hasServerIdentityDecisionReceipt(candidate);
      if (mayLoadPriorRequestContext) {
        const priorRequestContext = await withinPresentationBudget(
          priorRequestContextLoader(outcome.match.reviewerId, requestId),
          priorRequestBudgetMs,
        );
        if (priorRequestContext?.requests?.length > 0) {
          candidate.contactEnrichment.dataverseContactEvidence = {
            ...candidate.contactEnrichment.dataverseContactEvidence,
            priorRequestContext,
          };
        }
      }
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
          if (!currentPerson?._etag) throw new Error('Exact reviewer version is unavailable');

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
