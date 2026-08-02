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
import { planRosterFreshness } from '../reviewer-stage-freshness.js';

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
  const institutionCoiVersion = opaqueVersion('reviewer-warm-institution-coi:v1', {
    requestId: normalizedText(request.akoya_requestid),
    pi: inputs.pi,
    applicantOrganization: inputs.applicantOrganization,
  });
  return {
    state: 'current',
    applicantInputVersion,
    institutionCoiVersion,
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
  const getMetadataByPath = deps.getFileMetadataByPath || GraphService.getFileMetadataByPath;
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
  return {
    state: 'current',
    proposalContentVersion: proposalMetadataVersion(requestId, fallback[0].metadata),
    binding: 'fallback',
    bindingKey: `${fallback[0].library}::${fallback[0].folder}::${fallback[0].filename}`,
  };
}

function warmAuthorityVersions({ applicantInput, proposal }) {
  const fixed = (stage) => opaqueVersion(`reviewer-warm-${stage}:v1`, { contract: 1 });
  return {
    applicant_anchor: applicantInput.applicantInputVersion,
    identity: opaqueVersion('reviewer-warm-identity:v1', { input: applicantInput.applicantInputVersion }),
    institution_coi: applicantInput.institutionCoiVersion,
    coauthor_coi: proposal.proposalContentVersion,
    eligibility: fixed('eligibility'),
    contact: fixed('contact'),
    address_trust: fixed('address-trust'),
    roster_persistence: fixed('roster-persistence'),
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

function projectPlan(plan) {
  return {
    candidateKey: plan.candidateKey,
    cacheOutcome: plan.cacheOutcome,
    currentStages: Array.isArray(plan.currentStages) ? plan.currentStages.slice(0, 8) : [],
    pendingStages: Array.isArray(plan.pendingStages) ? plan.pendingStages.slice(0, 8) : [],
    refreshes: (Array.isArray(plan.refreshes) ? plan.refreshes : []).slice(0, 8).map((refresh) => ({
      stage: refresh.stage,
      reason: refresh.reason,
    })),
    promotionAuthority: plan.promotionAuthority,
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
  if (!request?.akoya_requestid || !request?.akoya_requestnum) {
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
  const authoritative = state === 'current'
    ? {
        authorityState: 'current',
        proposalContentVersion: proposal.proposalContentVersion,
        applicantInputVersion: applicantInput.applicantInputVersion,
        versions: warmAuthorityVersions({ applicantInput, proposal }),
      }
    : {
        authorityState: 'stale',
        proposalContentVersion: proposal.proposalContentVersion || null,
        applicantInputVersion: applicantInput.applicantInputVersion || null,
        versions: {},
      };
  const candidatePlans = planRosterFreshness({
    candidates: rosterCandidates(roster),
    authoritative,
  }).map(projectPlan);

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
  warmAuthorityVersions,
};
