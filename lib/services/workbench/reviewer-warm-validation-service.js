/**
 * Reviewer Find warm validation.
 *
 * Reads only server-owned request, SharePoint bucket, and Graph file metadata
 * needed to decide whether a cached roster remains displayable.  It never
 * accepts a client file binding, downloads proposal bytes, writes a Blob,
 * materializes applicant suggestions, parses exclusion prose, or calls an
 * evidence/model provider.
 */

import { createHash } from 'crypto';
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import { GraphService } from '../graph-service.js';
import { getRequestSharePointBuckets } from '../../utils/sharepoint-buckets.js';
import {
  STAGES,
  candidateIdentity,
  canonicalIso,
  planRosterFreshness,
} from '../reviewer-stage-freshness.js';

const REQUEST_SELECT = [
  'akoya_requestid',
  'akoya_requestnum',
  'wmkf_excludedreviewers',
  'wmkf_organizationname',
  '_akoya_applicantid_value',
  '_wmkf_projectleader_value',
  '_wmkf_potentialreviewer1_value',
  '_wmkf_potentialreviewer2_value',
  '_wmkf_potentialreviewer3_value',
  '_wmkf_potentialreviewer4_value',
  '_wmkf_potentialreviewer5_value',
].join(',');

const MAX_CANDIDATE_PLANS = 300;

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableStringify(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function opaqueVersion(namespace, value) {
  return createHash('sha256')
    .update(`${namespace}\n${stableStringify(value)}`)
    .digest('hex');
}

function normalizedText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('en-US');
}

function pathJoin(...parts) {
  return parts
    .map((part) => String(part || '').replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');
}

function isActiveRequestBucket(bucket) {
  return bucket?.source === 'dynamics'
    && String(bucket?.library || '').toLowerCase() === 'akoya_request'
    && typeof bucket?.folder === 'string'
    && bucket.folder.trim().length > 0;
}

function isGuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function sameGuid(left, right) {
  return isGuid(left) && isGuid(right) && left.toLowerCase() === right.toLowerCase();
}

function compactRequestInputs(request) {
  const slots = ['1', '2', '3', '4', '5'].map((slot) => ({
    slot: Number(slot),
    personId: normalizedText(request?.[`_wmkf_potentialreviewer${slot}_value`]),
    personLabel: normalizedText(request?.[`_wmkf_potentialreviewer${slot}_value_formatted`]),
  }));
  const pi = {
    id: normalizedText(request?._wmkf_projectleader_value),
    label: normalizedText(request?._wmkf_projectleader_value_formatted),
  };
  const applicantOrganization = {
    id: normalizedText(request?._akoya_applicantid_value),
    label: normalizedText(request?._akoya_applicantid_value_formatted),
    organizationName: normalizedText(request?.wmkf_organizationname),
  };
  const exclusions = normalizedText(request?.wmkf_excludedreviewers);
  return { slots, pi, applicantOrganization, exclusions };
}

export function projectApplicantWarmInputs(request) {
  if (!request?.akoya_requestid || !request?.akoya_requestnum) {
    return { state: 'error', reasonCode: 'authority_stale' };
  }
  const inputs = compactRequestInputs(request);
  const applicantInputVersion = opaqueVersion('reviewer-warm-applicant-input:v1', {
    requestId: normalizedText(request.akoya_requestid),
    slots: inputs.slots,
    exclusions: inputs.exclusions,
  });
  return {
    state: 'current',
    applicantInputVersion,
    summary: {
      recommendationSlotCount: inputs.slots.filter((slot) => !!slot.personId).length,
      hasExclusions: inputs.exclusions.length > 0,
      hasPi: !!(inputs.pi.id || inputs.pi.label),
      hasApplicantOrganization: !!(
        inputs.applicantOrganization.id
        || inputs.applicantOrganization.label
        || inputs.applicantOrganization.organizationName
      ),
    },
  };
}

function proposalMetadataVersion(requestId, metadata) {
  return opaqueVersion('reviewer-warm-proposal-content:v1', {
    requestId: normalizedText(requestId),
    driveId: metadata.driveId || null,
    itemId: metadata.id || null,
    eTag: metadata.eTag || null,
    versionId: metadata.versionId || null,
    lastModified: metadata.lastModified || null,
  });
}

function boundedMetadataText(value, maxLength = 1024) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maxLength;
}

// A Graph path match alone is not a versioned proposal binding.  Fail closed
// unless the file can be identified and at least one bounded change token is
// present, so an incomplete Graph response cannot certify a warm cache.
function hasCompleteProposalMetadata(metadata) {
  return !!metadata
    && boundedMetadataText(metadata.driveId, 512)
    && boundedMetadataText(metadata.id, 512)
    && [metadata.eTag, metadata.versionId, metadata.lastModified]
      .some((value) => boundedMetadataText(value, 1024));
}

function metadataCandidate(bucket, folder, filename) {
  return {
    library: bucket.library,
    folder: pathJoin(bucket.folder, folder),
    filename,
  };
}

async function resolveExactMetadata(candidates, getMetadataByPath) {
  const found = [];
  for (const candidate of candidates) {
    const metadata = await getMetadataByPath(
      candidate.library,
      candidate.folder,
      candidate.filename,
    );
    if (metadata) found.push({ ...candidate, metadata });
  }
  return found;
}

/**
 * Resolve only the current-cycle canonical or fallback binding.  Manual UI
 * file choices are intentionally absent from this contract: they are not
 * stored as an authoritative request binding, so guessing them would make a
 * stale cached row appear current.
 */
export async function resolveReviewerProposalMetadata({ requestId, requestNumber, deps = {} }) {
  const getBuckets = deps.getRequestSharePointBuckets || getRequestSharePointBuckets;
  // Keep GraphService as the receiver: its static implementation calls other
  // static helpers through `this`, which is lost if this method is assigned
  // directly as an unbound callback.
  const getMetadataByPath = deps.getFileMetadataByPath
    || ((...args) => GraphService.getFileMetadataByPath(...args));
  if (!isGuid(requestId) || !String(requestNumber || '').trim()) {
    return { state: 'error', reasonCode: 'authority_stale', proposalContentVersion: null };
  }

  let buckets;
  try {
    buckets = await getBuckets(requestId, requestNumber);
  } catch (error) {
    return { state: 'error', reasonCode: 'authority_stale', proposalContentVersion: null };
  }
  const activeBuckets = (Array.isArray(buckets) ? buckets : []).filter(isActiveRequestBucket);
  if (activeBuckets.length === 0) {
    return { state: 'stale', reasonCode: 'proposal_binding_changed', proposalContentVersion: null };
  }

  const canonicalFilename = `Proposal_${String(requestNumber).trim()}.pdf`;
  let canonical;
  try {
    canonical = await resolveExactMetadata(
      activeBuckets.map((bucket) => metadataCandidate(bucket, 'Reviewer Materials', canonicalFilename)),
      getMetadataByPath,
    );
  } catch (error) {
    return { state: 'error', reasonCode: 'authority_stale', proposalContentVersion: null };
  }
  if (canonical.length > 1) {
    return { state: 'stale', reasonCode: 'proposal_binding_changed', proposalContentVersion: null };
  }
  if (canonical.length === 1) {
    if (!hasCompleteProposalMetadata(canonical[0].metadata)) {
      return { state: 'stale', reasonCode: 'proposal_binding_changed', proposalContentVersion: null };
    }
    return {
      state: 'current',
      proposalContentVersion: proposalMetadataVersion(requestId, canonical[0].metadata),
      binding: 'canonical',
      bindingKey: `${canonical[0].library}::${canonical[0].folder}::${canonical[0].filename}`,
    };
  }

  let fallback;
  try {
    fallback = await resolveExactMetadata(
      activeBuckets.map((bucket) => metadataCandidate(bucket, 'Phase I', 'ProjectDescription.pdf')),
      getMetadataByPath,
    );
  } catch (error) {
    return { state: 'error', reasonCode: 'authority_stale', proposalContentVersion: null };
  }
  if (fallback.length !== 1) {
    return { state: 'stale', reasonCode: 'proposal_binding_changed', proposalContentVersion: null };
  }
  if (!hasCompleteProposalMetadata(fallback[0].metadata)) {
    return { state: 'stale', reasonCode: 'proposal_binding_changed', proposalContentVersion: null };
  }
  return {
    state: 'current',
    proposalContentVersion: proposalMetadataVersion(requestId, fallback[0].metadata),
    binding: 'fallback',
    bindingKey: `${fallback[0].library}::${fallback[0].folder}::${fallback[0].filename}`,
  };
}

function rosterCandidates(roster) {
  const seen = new Set();
  const candidates = [];
  for (const bucket of ['active', 'excluded', 'ineligible', 'blocked']) {
    for (const candidate of Array.isArray(roster?.[bucket]) ? roster[bucket] : []) {
      const key = typeof candidate?.candidateKey === 'string' ? candidate.candidateKey : null;
      if (!key || seen.has(key) || candidates.length >= MAX_CANDIDATE_PLANS) continue;
      seen.add(key);
      candidates.push(candidate);
    }
  }
  return candidates;
}

function candidatePotentialReviewerId(candidate) {
  const id = candidate?.potentialReviewerId
    || candidate?.seedResolvedPotentialReviewerId
    || candidate?.applicantKnownReviewer?.potentialReviewerId;
  return isGuid(id) ? String(id).toLowerCase() : null;
}

function applicantAnchorLane(candidate) {
  if (candidate?.isApplicantRecommended === true
    || candidate?.provenance?.kind === 'applicant_suggested') {
    return 'applicant';
  }
  // A non-applicant provenance is a server-stored classification. A bare
  // suggestion key is deliberately not enough: old/malformed rows can retain
  // that key after their applicant marker was lost, and must fail closed.
  if (typeof candidate?.provenance?.kind === 'string' && candidate.provenance.kind.trim()) {
    return 'non_applicant';
  }
  return candidateKeyForVersion(candidate)?.startsWith('suggestion:')
    ? 'ambiguous'
    : 'non_applicant';
}

function applicantSlotVersions(request) {
  const slotsByPerson = new Map();
  for (const slot of compactRequestInputs(request).slots) {
    if (!isGuid(slot.personId)) continue;
    const personId = slot.personId.toLowerCase();
    const slots = slotsByPerson.get(personId) || [];
    slots.push(slot.slot);
    slotsByPerson.set(personId, slots);
  }
  const versions = new Map();
  for (const [personId, slots] of slotsByPerson) {
    versions.set(personId, opaqueVersion('reviewer-warm-applicant-slot:v1', {
      requestId: normalizedText(request.akoya_requestid),
      personId,
      slots: slots.sort((a, b) => a - b),
    }));
  }
  return versions;
}

/**
 * Build the only applicant-anchor receipt this warm contract can certify.
 * The caller supplies server-read request and roster state; names, client
 * claims, and request-wide fingerprints never participate in this decision.
 */
export function buildApplicantAnchorRefreshReceipt({ request, candidate, completedAt } = {}) {
  const candidateKey = candidateKeyForVersion(candidate);
  const personId = candidatePotentialReviewerId(candidate);
  const requestId = normalizedText(request?.akoya_requestid);
  const when = canonicalIso(completedAt) ? completedAt : null;
  if (!candidateKey || !personId || !requestId || !when) return null;

  const sourceVersion = applicantSlotVersions(request).get(personId);
  if (!sourceVersion) return null;
  return {
    state: 'current',
    contractVersion: 1,
    sourceVersion,
    completedAt: when,
  };
}

function candidateKeyForVersion(candidate) {
  const candidateKey = typeof candidate?.candidateKey === 'string' ? candidate.candidateKey.trim() : '';
  return candidateKey.length > 0 && candidateKey.length <= 512 ? candidateKey : null;
}

function serverNotApplicableApplicantAnchor(candidate) {
  const candidateKey = candidateKeyForVersion(candidate);
  if (!candidateKey) return candidate;
  const sourceVersion = opaqueVersion('reviewer-warm-applicant-anchor-not-applicable:v1', { candidateKey });
  return {
    candidate: {
      ...candidate,
      stageFreshness: {
        ...(candidate.stageFreshness || {}),
        applicant_anchor: {
          state: 'not_applicable',
          contractVersion: 1,
          sourceVersion,
          completedAt: null,
        },
      },
    },
    authoritative: {
      authorityState: 'current',
      applicantInputVersion: null,
      proposalContentVersion: null,
      versions: { applicant_anchor: sourceVersion },
    },
    applicantAnchorAuthority: 'not_applicable',
  };
}

function plannerInputForCandidate({ candidate, proposal, slotVersions }) {
  const proposalContentVersion = proposal.proposalContentVersion || null;
  const lane = applicantAnchorLane(candidate);
  if (lane === 'ambiguous') {
    return {
      candidate: { ...candidate, candidateKey: null },
      authoritative: { authorityState: 'current', applicantInputVersion: null, proposalContentVersion, versions: {} },
      applicantAnchorAuthority: 'ambiguous',
    };
  }
  if (lane === 'non_applicant') {
    const notApplicable = serverNotApplicableApplicantAnchor(candidate);
    if (notApplicable?.candidate) {
      return {
        ...notApplicable,
        authoritative: { ...notApplicable.authoritative, proposalContentVersion },
      };
    }
    return {
      candidate,
      authoritative: { authorityState: 'current', applicantInputVersion: null, proposalContentVersion, versions: {} },
      applicantAnchorAuthority: 'ambiguous',
    };
  }

  const personId = candidatePotentialReviewerId(candidate);
  const slotVersion = personId ? slotVersions.get(personId) : null;
  if (!slotVersion) {
    // A recommendation lane without a current exact person slot is not
    // eligible for a cache hit. Passing no key to the pure planner yields its
    // canonical `candidate_missing` invalidation without using names.
    return {
      candidate: { ...candidate, candidateKey: null },
      authoritative: { authorityState: 'current', applicantInputVersion: null, proposalContentVersion, versions: {} },
      applicantAnchorAuthority: 'missing',
    };
  }
  return {
    candidate: { ...candidate, applicantInputVersion: slotVersion },
    authoritative: {
      authorityState: 'current',
      applicantInputVersion: slotVersion,
      proposalContentVersion,
      versions: { applicant_anchor: slotVersion },
    },
    applicantAnchorAuthority: 'matched_slot',
  };
}

function staleAuthoritativeInput(input, { proposal, applicantInput }) {
  const preserveApplicantAnchor = input.applicantAnchorAuthority === 'not_applicable'
    || (input.applicantAnchorAuthority === 'matched_slot' && applicantInput.state === 'current');
  return {
    ...input.authoritative,
    authorityState: 'stale',
    // The proposal resolver returns a content version only when the exact
    // binding remained readable. Do not retain one after its read failed.
    proposalContentVersion: proposal.state === 'current'
      ? input.authoritative.proposalContentVersion
      : null,
    applicantInputVersion: preserveApplicantAnchor
      ? input.authoritative.applicantInputVersion
      : null,
    versions: preserveApplicantAnchor
      ? input.authoritative.versions
      : {},
  };
}

function planWarmRosterCandidates({ roster, request, proposal, state, applicantInput }) {
  const candidates = rosterCandidates(roster);
  const slotVersions = applicantSlotVersions(request);
  return candidates.map((candidate) => {
    const input = plannerInputForCandidate({ candidate, proposal, slotVersions });
    const authoritative = state === 'current'
      ? input.authoritative
      : staleAuthoritativeInput(input, { proposal, applicantInput });
    const [plan] = planRosterFreshness({ candidates: [input.candidate], authoritative });
    // The unmatched-applicant planner input intentionally removes the key to
    // obtain `candidate_missing`; preserve the server-stored correlation key
    // for the client to associate that plan with its rendered row.
    return { ...plan, candidateKey: candidate.candidateKey };
  });
}

function projectPlan(plan) {
  const candidateKey = candidateIdentity({ candidateKey: plan?.candidateKey });
  return {
    // A plan is associated only by the canonical candidate key. The response
    // never needs the candidate display blob to surface evidence dates.
    candidateKey,
    cacheOutcome: plan.cacheOutcome,
    currentStages: Array.isArray(plan.currentStages) ? plan.currentStages.slice(0, 8) : [],
    pendingStages: Array.isArray(plan.pendingStages) ? plan.pendingStages.slice(0, 8) : [],
    refreshes: (Array.isArray(plan.refreshes) ? plan.refreshes : []).slice(0, 8).map((refresh) => ({
      stage: refresh.stage,
      reason: refresh.reason,
    })),
    promotionAuthority: plan.promotionAuthority,
    evidenceCheckedDates: Object.fromEntries(
      STAGES
        .filter((stage) => canonicalIso(plan?.evidenceCheckedDates?.[stage]))
        .map((stage) => [stage, plan.evidenceCheckedDates[stage]]),
    ),
  };
}

function hasUnrecoverableManualOverride(roster, bindingKey) {
  const candidates = rosterCandidates(roster);
  // `enrichedProposalKey` is a legacy per-candidate display/cache value, not a
  // server-authoritative request binding. Any value is therefore insufficient
  // to recover a historical manual selection. A matching exact canonical or
  // fallback key is enough to validate that row; any different historic key is
  // intentionally stale rather than guessed from navigation state.
  return !!bindingKey && candidates.some((candidate) => (
    typeof candidate?.enrichedProposalKey === 'string'
    && candidate.enrichedProposalKey.trim().length > 0
    && candidate.enrichedProposalKey !== bindingKey
  ));
}

/**
 * Server-only warm validation projection for roster GET mode=reconciled.
 * The response deliberately contains hashes, count/boolean input summaries,
 * and stage plans only; it never exposes raw exclusion prose, recommendation
 * names, email addresses, Graph paths, IDs, or eTags.
 */
export async function readReviewerWarmValidation({ requestId, roster, deps = {} }) {
  const getRequestById = deps.getRequestById || grantRequestAdapter.getById;
  let request;
  try {
    request = await getRequestById(requestId, { select: REQUEST_SELECT });
  } catch (error) {
    return { state: 'error', reasonCode: 'authority_stale', candidatePlans: [] };
  }
  if (!sameGuid(request?.akoya_requestid, requestId) || !request?.akoya_requestnum) {
    return { state: 'error', reasonCode: 'authority_stale', candidatePlans: [] };
  }

  const applicantInput = projectApplicantWarmInputs(request);
  const proposal = await resolveReviewerProposalMetadata({
    requestId,
    requestNumber: request.akoya_requestnum,
    deps,
  });
  const manualOverrideUnavailable = proposal.state === 'current'
    && hasUnrecoverableManualOverride(roster, proposal.bindingKey);
  const state = applicantInput.state === 'current' && proposal.state === 'current' && !manualOverrideUnavailable
    ? 'current'
    : applicantInput.state === 'error' || proposal.state === 'error'
      ? 'error'
      : 'stale';
  const reasonCode = manualOverrideUnavailable
    ? 'proposal_binding_changed'
    : state === 'current'
      ? null
      : proposal.reasonCode || applicantInput.reasonCode || 'authority_stale';
  const candidatePlans = planWarmRosterCandidates({
    roster,
    request,
    proposal,
    state,
    applicantInput,
  }).map(projectPlan).filter((plan) => !!plan.candidateKey);

  return {
    state,
    reasonCode,
    proposalContentVersion: proposal.proposalContentVersion || null,
    applicantInputVersion: applicantInput.applicantInputVersion || null,
    inputSummary: applicantInput.summary || null,
    candidatePlans,
  };
}

export {
  REQUEST_SELECT,
  stableStringify,
  opaqueVersion,
  pathJoin,
  rosterCandidates,
  hasCompleteProposalMetadata,
};
