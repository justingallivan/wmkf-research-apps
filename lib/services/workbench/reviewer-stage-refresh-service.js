/**
 * Server-authoritative, one-candidate/one-stage Reviewer Find refresh.
 *
 * The request body is a closed correlation target.  Every other input,
 * including source versions, proposal binding, provider policy, and evidence,
 * is read or derived on the server after authentication.
 */

import { createHash, randomUUID } from 'crypto';
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request';
import * as reviewerSuggestionAdapter from '../../dataverse/adapters/reviewer-suggestion';
import { GraphService } from '../graph-service';
import { extractTextFromBuffer } from '../../utils/file-loader';
import { ClaudeReviewerService } from '../claude-reviewer-service';
import { deriveProposalAuthorNames } from '../../utils/proposal-authors';
import {
  normalizeProposalAuthors,
  proposalAuthorFingerprint,
} from '../reviewer-proposal-author-fingerprint';
import {
  completeStageRefreshWithEvidence,
  failStageRefresh,
  finalizeCachedRosterEvidence,
  findCandidateByKey,
  recoverExpiredStageRefresh,
  startStageRefresh,
} from '../reviewer-roster-store';
import {
  CONTRACT_VERSIONS,
  DEFAULT_AGE_POLICY,
  candidateStageLease,
  canonicalIso,
  planCandidateFreshness,
} from '../reviewer-stage-freshness';
import * as sourceVersions from './reviewer-stage-source-versions';
import {
  REQUEST_SELECT,
  buildApplicantAnchorRefreshReceipt,
  projectApplicantWarmInputs,
  resolveReviewerProposalMetadata,
} from './reviewer-warm-validation-service';
import { institutionDomainInputFingerprint } from './institution-domain-input-fingerprint';
import { produceIdentityEvidence, projectIdentityEvidence } from './reviewer-stage-producers/identity';
import { produceInstitutionDomainsEvidence } from './reviewer-stage-producers/institution-domains';
import { produceInstitutionCoiEvidence } from './reviewer-stage-producers/institution-coi';
import { produceCoauthorCoiEvidence } from './reviewer-stage-producers/coauthor-coi';
import { produceEligibilityEvidence } from './reviewer-stage-producers/eligibility';
import { produceReviewerContactEvidence } from './reviewer-stage-producers/contact';
import { canonicalStoredReviewerCandidateKey } from '../../utils/reviewer-candidate-key';

export const EXECUTABLE_REVIEWER_REFRESH_STAGES = Object.freeze([
  'applicant_anchor', 'identity', 'institution_domains', 'institution_coi',
  'coauthor_coi', 'eligibility', 'contact', 'roster_persistence',
]);

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAGE_PREREQUISITES = Object.freeze({
  applicant_anchor: [],
  identity: ['applicant_anchor'],
  institution_domains: ['identity'],
  institution_coi: ['identity'],
  coauthor_coi: ['identity'],
  eligibility: ['identity', 'institution_domains'],
  contact: ['identity', 'institution_domains'],
  roster_persistence: [
    'applicant_anchor', 'identity', 'institution_domains', 'institution_coi',
    'coauthor_coi', 'eligibility', 'contact', 'address_trust',
  ],
});
const ACTIVE_ROSTER_STATUS = 'active';
const MANUAL_TIMEOUT_MS = 55_000;

function hash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function guid(value) { return typeof value === 'string' && GUID_RE.test(value); }
function sameGuid(left, right) { return guid(left) && guid(right) && left.toLowerCase() === right.toLowerCase(); }
function safeToken(value) { return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 128 && !/[\u0000-\u001f\u007f]/.test(value); }
function canonicalKey(value) { return canonicalStoredReviewerCandidateKey(value); }
function boundedDeadlineAt(value) {
  return Number.isFinite(value) && value > Date.now()
    ? Math.min(value, Date.now() + MANUAL_TIMEOUT_MS)
    : Date.now() + MANUAL_TIMEOUT_MS;
}
function remainingDeadlineMs(deadlineAt) { return Math.max(1, deadlineAt - Date.now()); }
function isApplicantCandidate(candidate) { return candidate?.isApplicantRecommended === true || candidate?.provenance?.kind === 'applicant_suggested'; }
function candidatePersonId(candidate) {
  const id = candidate?.potentialReviewerId || candidate?.applicantKnownReviewer?.potentialReviewerId;
  return guid(id) ? id : null;
}
const CLIENT_RESPONSE_REASONS = new Set([
  'no_roster_history', 'candidate_added', 'candidate_missing', 'candidate_input_changed',
  'applicant_set_changed', 'proposal_binding_changed', 'proposal_content_changed',
  'warm_cache_version_changed', 'stage_contract_changed', 'stage_missing',
  'stage_incomplete', 'prior_write_incomplete', 'prior_refresh_incomplete',
  'authority_stale', 'engagement_changed', 'roster_snapshot_changed', 'manual_refresh',
  'unclassified_miss', 'refresh_not_required', 'authority_changed', 'refresh_in_progress',
  'lease_recovery_required', 'lease_repair_required',
  'prerequisite_stale', 'prerequisite_action_required', 'stage_not_executable',
  'canonical_candidate_unavailable', 'invalid_refresh_target',
]);
function clientReason(code) {
  return CLIENT_RESPONSE_REASONS.has(code)
    ? code
    : code === 'dedicated_address_action' || code === 'dedicated_identity_action'
      ? 'prerequisite_action_required'
      : 'authority_stale';
}
function response({ outcome, requestId, candidateKey, stage, code = null, stageState = 'stale', reasonCode = null, updatedAt = null, candidatePlan = null, leaseStage = null } = {}) {
  return {
    outcome, requestId, candidateKey, stage, requestedStage: stage,
    ...(code ? { code } : {}),
    stageState,
    reasonCode: CLIENT_RESPONSE_REASONS.has(reasonCode) ? reasonCode : null,
    ...(updatedAt ? { rosterVersion: updatedAt } : {}),
    ...(leaseStage ? { leaseStage } : {}),
    ...(candidatePlan ? { candidatePlan } : {}),
  };
}
function rejected(args, code, plan = null) { return response({ ...args, outcome: 'rejected', code, stageState: 'stale', reasonCode: clientReason(code), candidatePlan: plan }); }
function stageLease(candidate, stage) { return candidate?.stageRefresh?.[stage] || null; }
function expired(lease) { return canonicalIso(lease?.refreshStartedAt) && Date.now() - Date.parse(lease.refreshStartedAt) > DEFAULT_AGE_POLICY.leaseMs; }
function stageAction(stage, plannedAction = null) {
  if (plannedAction === 'recover_expired_lease') return 'recover_expired_lease';
  if (plannedAction === 'operator_repair_required') return 'operator_repair_required';
  if (stage === 'roster_persistence') return 'finalize_cached_evidence';
  if (stage === 'address_trust') return 'dedicated_address_action';
  return 'refresh_stage';
}
function safePlan(plan) {
  if (!plan) return null;
  return {
    cacheOutcome: plan.cacheOutcome,
    currentStages: Array.isArray(plan.currentStages) ? plan.currentStages : [],
    pendingStages: Array.isArray(plan.pendingStages) ? plan.pendingStages : [],
    refreshes: (Array.isArray(plan.refreshes) ? plan.refreshes : []).map((entry) => ({
      stage: entry.stage, reason: entry.reason, action: stageAction(entry.stage, entry.action),
    })),
    leaseRepairRequired: plan.leaseRepairRequired === true,
    promotionAuthority: plan.promotionAuthority,
  };
}

/**
 * Server-only planning primitive for the bounded reconciliation coordinator.
 * It reads the exact active roster row and derives the same source-bound plan
 * used by a manual stage refresh; it never starts a lease or executes a
 * provider.  `reconciliationContext` is private in-memory reuse only.
 */
export async function planReviewerCandidateRefresh({ requestId, candidateKey, reconciliationContext = null } = {}) {
  const canonicalCandidateKey = canonicalKey(candidateKey);
  if (!guid(requestId) || !canonicalCandidateKey) {
    return { outcome: 'rejected', code: 'invalid_refresh_target', candidateKey: canonicalCandidateKey || null };
  }
  let candidate;
  try {
    candidate = await findCandidateByKey(requestId, canonicalCandidateKey);
  } catch {
    return { outcome: 'failed_retryable', code: 'request_authority_unavailable', candidateKey: canonicalCandidateKey };
  }
  if (!candidate || candidate.rosterStatus !== ACTIVE_ROSTER_STATUS) {
    return { outcome: 'rejected', code: 'canonical_candidate_unavailable', candidateKey: canonicalCandidateKey };
  }
  let context;
  try {
    context = await serverContext(requestId, candidate, { requestContext: reconciliationContext });
  } catch {
    return { outcome: 'failed_retryable', code: 'request_authority_unavailable', candidateKey: canonicalCandidateKey };
  }
  if (!context) return { outcome: 'failed_retryable', code: 'request_authority_unavailable', candidateKey: canonicalCandidateKey };
  return {
    outcome: 'planned',
    candidateKey: canonicalCandidateKey,
    expectedUpdatedAt: candidate.rosterUpdatedAt || null,
    plan: safePlan(context.plan),
  };
}

function requestCoiContextVersion(request) {
  return sourceVersions.buildRequestCoiContextVersion({
    requestId: request?.akoya_requestid,
    applicantOrganization: {
      id: request?._akoya_applicantid_value,
      label: request?._akoya_applicantid_value_formatted,
      organizationName: request?.wmkf_organizationname,
    },
    principalInvestigator: {
      id: request?._wmkf_projectleader_value,
      label: request?._wmkf_projectleader_value_formatted,
    },
  });
}

/**
 * Create a request-scoped, in-memory authority snapshot for a bounded
 * reconciliation run.  It is never accepted from an API request or persisted:
 * it only amortizes the first request/proposal metadata reads.  Every stage
 * still obtains a fresh post-producer authority read before publishing a
 * receipt, so this cache cannot make changed request/proposal state current.
 */
export async function createReviewerStageRefreshRequestContext(requestId) {
  if (!guid(requestId)) return null;
  const request = await grantRequestAdapter.getById(requestId, { select: REQUEST_SELECT });
  if (!sameGuid(request?.akoya_requestid, requestId) || !request?.akoya_requestnum) return null;
  const proposal = await resolveReviewerProposalMetadata({ requestId, requestNumber: request.akoya_requestnum });
  return {
    requestId,
    request,
    proposal,
    // Proposal analysis is exact-binding/version scoped below.  It is bounded
    // in-memory work reuse, not a durable authority cache.
    proposalAnalysis: null,
  };
}

async function serverContext(requestId, candidate, {
  allowUnsealedDomainPreview = false,
  requestContext = null,
  forceFresh = false,
} = {}) {
  const reusable = !forceFresh
    && requestContext?.requestId === requestId
    && sameGuid(requestContext?.request?.akoya_requestid, requestId)
    && requestContext?.proposal;
  const request = reusable
    ? requestContext.request
    : await grantRequestAdapter.getById(requestId, { select: REQUEST_SELECT });
  if (!sameGuid(request?.akoya_requestid, requestId) || !request?.akoya_requestnum) return null;
  const proposal = reusable
    ? requestContext.proposal
    : await resolveReviewerProposalMetadata({ requestId, requestNumber: request.akoya_requestnum });
  const applicantReceipt = isApplicantCandidate(candidate)
    ? buildApplicantAnchorRefreshReceipt({ request, candidate, completedAt: new Date().toISOString() })
    : null;
  const snapshot = sourceVersions.buildReviewerStageDependencySnapshot({
    candidate,
    requestId,
    rosterUpdatedAt: candidate.rosterUpdatedAt,
    applicantInputVersion: applicantReceipt?.sourceVersion || null,
    proposalContentVersion: proposal.state === 'current' ? proposal.proposalContentVersion : null,
    requestCoiContextVersion: requestCoiContextVersion(request),
    allowUnsealedDomainPreview,
  });
  const authoritative = {
    ...snapshot,
    authorityState: proposal.state === 'current' && projectApplicantWarmInputs(request).state === 'current'
      ? 'current' : 'stale',
  };
  const plan = planCandidateFreshness({ candidate, authoritative });
  return { request, proposal, candidate, snapshot: authoritative, plan };
}

function requiredStagesCurrent(plan, stage) {
  const current = new Set(plan?.currentStages || []);
  return (STAGE_PREREQUISITES[stage] || []).every((dependency) => current.has(dependency));
}
function stageNeedsRefresh(plan, stage) { return (plan?.refreshes || []).some((entry) => entry.stage === stage); }
function expectedSource(snapshot, stage) {
  const value = snapshot?.stageInputVersions?.[stage];
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value) ? value : null;
}
function providerCredentials() {
  return {
    serpApiKey: process.env.SERP_API_KEY,
    orcidClientId: process.env.ORCID_CLIENT_ID,
    orcidClientSecret: process.env.ORCID_CLIENT_SECRET,
    claudeApiKey: process.env.CLAUDE_API_KEY,
  };
}

async function validateApplicantAnchor(requestId, candidate) {
  if (!isApplicantCandidate(candidate)) return { ok: true, applicant: false };
  const suggestionId = candidate.suggestionId;
  const personId = candidatePersonId(candidate);
  if (!guid(suggestionId) || !personId) return { ok: false, code: 'canonical_candidate_unavailable' };
  const suggestion = await reviewerSuggestionAdapter.findById(suggestionId);
  if (!sameGuid(suggestion?.wmkf_appreviewersuggestionid, suggestionId)
    || !sameGuid(suggestion?._wmkf_request_value, requestId)
    || !sameGuid(suggestion?._wmkf_potentialreviewer_value, personId)
    || !reviewerSuggestionAdapter.hasApplicantProvenance(suggestion)) {
    return { ok: false, code: 'suggestion_anchor_mismatch' };
  }
  return { ok: true, applicant: true };
}

function applicantEnvelope(context) {
  if (!isApplicantCandidate(context.candidate)) {
    const sourceVersion = expectedSource(context.snapshot, 'applicant_anchor');
    return {
      outcome: 'not_applicable', evidencePatch: {},
      receipt: {
        state: 'not_applicable', contractVersion: 1, sourceVersion,
        resultVersion: hash({ sourceVersion, stage: 'applicant_anchor', result: 'server_not_applicable' }),
        completedAt: new Date().toISOString(), reasonCode: 'server_not_applicable', failureCode: null,
      },
    };
  }
  const receipt = buildApplicantAnchorRefreshReceipt({ request: context.request, candidate: context.candidate, completedAt: new Date().toISOString() });
  return receipt ? {
    outcome: 'current', evidencePatch: { applicantInputVersion: receipt.sourceVersion },
    receipt: { ...receipt, resultVersion: receipt.sourceVersion, reasonCode: null, failureCode: null },
  } : null;
}

function coauthorAuthors(candidate) {
  const vector = Array.isArray(candidate?.coauthorAuthorResults) ? candidate.coauthorAuthorResults : null;
  if (!vector || vector.length > 16 || vector.some((entry) => typeof entry?.author !== 'string')) return null;
  return vector.map((entry) => entry.author);
}

function reusableCoauthorCoverage(candidate, expectedSourceVersion) {
  const receipt = candidate?.stageFreshness?.coauthor_coi;
  const results = Array.isArray(candidate?.coauthorAuthorResults) ? candidate.coauthorAuthorResults : null;
  if (!results || receipt?.sourceVersion !== expectedSourceVersion) return null;
  const authors = coauthorAuthors(candidate);
  if (!authors || results.some((entry) => !['complete', 'failed'].includes(entry?.status))) return null;
  const retryAuthors = results.filter((entry) => entry.status === 'failed').map((entry) => entry.author);
  return retryAuthors.length ? { results, retryAuthors } : null;
}

function authorityChangedEnvelope(stage, sourceVersion) {
  return {
    outcome: 'incomplete',
    evidencePatch: {},
    receipt: {
      state: 'incomplete',
      contractVersion: CONTRACT_VERSIONS[stage],
      sourceVersion,
      resultVersion: hash({ stage, sourceVersion, outcome: 'authority_changed' }),
      completedAt: null,
      reasonCode: null,
      failureCode: 'authority_changed',
    },
  };
}

function proposalBindingPath(proposal) {
  const parts = typeof proposal?.bindingKey === 'string' ? proposal.bindingKey.split('::') : [];
  if (parts.length !== 3 || parts.some((part) => !part || part.length > 1024)) return null;
  return { library: parts[0], folder: parts[1], filename: parts[2] };
}

function boundedProposalInfo(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const text = (entry, max) => typeof entry === 'string' && entry.trim() && entry.trim().length <= max
    ? entry.trim()
    : null;
  const title = text(value.title, 600);
  const primaryResearchArea = text(value.primaryResearchArea, 600);
  // Identity runtime uses only these bounded fields.  Do not retain raw
  // analysis, proposal prose, authors, or a browser-carried context on the
  // candidate blob.
  return title || primaryResearchArea ? { title, primaryResearchArea } : null;
}

function boundedProposalAuthors(value) {
  // All cold producers share this exact normalizer and its 48-author bound.
  // Manual refresh must never manufacture a second fingerprint namespace.
  return normalizeProposalAuthors(deriveProposalAuthorNames(value));
}

/**
 * Read and analyze the exact Graph-bound proposal in-memory for a manual
 * targeted stage refresh. The metadata is asserted before and after the
 * download so a moving file cannot lend authority to the result.  The closed
 * return value deliberately carries only the fields each manual producer may
 * consume, never proposal prose.
 */
async function loadServerBoundProposalAnalysis(context, signal, requestContext = null, deadlineAt = null) {
  const binding = proposalBindingPath(context?.proposal);
  const before = context?.proposal;
  const requestId = context?.request?.akoya_requestid;
  const requestNumber = context?.request?.akoya_requestnum;
  if (!binding || before?.state !== 'current'
    || !process.env.CLAUDE_API_KEY || !requestId || !requestNumber) return null;
  const cached = requestContext?.proposalAnalysis;
  if (cached?.proposalContentVersion === before.proposalContentVersion
    && cached?.bindingKey === before.bindingKey
    && cached.analysis) {
    return cached.analysis;
  }
  try {
    const downloaded = await GraphService.downloadFileByPath(binding.library, binding.folder, binding.filename);
    if (!downloaded?.buffer) return null;
    const proposalText = await extractTextFromBuffer(downloaded.buffer, binding.filename, downloaded.mimeType);
    if (typeof proposalText !== 'string' || proposalText.trim().length < 100) return null;
    const analysis = await ClaudeReviewerService.analyzeProposal(proposalText, process.env.CLAUDE_API_KEY, {
      reviewerCount: 1,
      analysisPurpose: 'proposal_info',
      signal,
      deadlineAt: boundedDeadlineAt(deadlineAt),
    });
    const after = await resolveReviewerProposalMetadata({ requestId, requestNumber });
    if (after?.state !== 'current'
      || after.proposalContentVersion !== before.proposalContentVersion
      || after.bindingKey !== before.bindingKey) return null;
    const proposalInfo = boundedProposalInfo(analysis?.proposalInfo);
    const proposalAuthors = boundedProposalAuthors(analysis?.proposalInfo);
    const proposalAuthorVersionValue = proposalAuthorFingerprint(
      before.proposalContentVersion,
      proposalAuthors,
    );
    const result = {
      proposalInfo,
      proposalAuthors,
      proposalAuthorVersion: proposalAuthorVersionValue,
    };
    // Retain only exact proposal-version/binding work inside this request's
    // server-owned reconciliation context. A later stage reuses it only after
    // its own fresh authority check confirms the same opaque version.
    if (requestContext && requestContext.requestId === requestId) {
      requestContext.proposalAnalysis = {
        proposalContentVersion: before.proposalContentVersion,
        bindingKey: before.bindingKey,
        analysis: result,
      };
    }
    return result;
  } catch {
    return null;
  }
}

async function loadServerBoundProposalInfo(context, signal, requestContext = null, deadlineAt = null) {
  const analysis = await loadServerBoundProposalAnalysis(context, signal, requestContext, deadlineAt);
  return analysis?.proposalInfo || null;
}

async function withCoauthorProposalAuthority(context, signal, requestContext = null, deadlineAt = null) {
  const analysis = await loadServerBoundProposalAnalysis(context, signal, requestContext, deadlineAt);
  if (!analysis || !Array.isArray(analysis.proposalAuthors) || !analysis.proposalAuthorVersion) return null;
  const candidate = {
    ...context.candidate,
    proposalAuthorVersion: analysis.proposalAuthorVersion,
  };
  const refreshed = await serverContext(context.request.akoya_requestid, candidate);
  if (!refreshed || refreshed.proposal?.state !== 'current'
    || refreshed.proposal.proposalContentVersion !== context.proposal.proposalContentVersion) return null;
  return { ...refreshed, coauthorProposal: analysis };
}

async function executeStage(stage, context, signal, requestContext = null, deadlineAt = null) {
  const sourceVersion = expectedSource(context.snapshot, stage);
  if (!sourceVersion) return null;
  const candidate = context.candidate;
  const completedAt = new Date().toISOString();
  if (stage === 'applicant_anchor') return applicantEnvelope(context);
  if (stage === 'identity') {
    const proposalInfo = await loadServerBoundProposalInfo(context, signal, requestContext, deadlineAt);
    if (!proposalInfo) {
      return projectIdentityEvidence({
        candidate,
        applicantInputVersion: context.snapshot.applicantInputVersion,
        proposalContentVersion: context.snapshot.proposalContentVersion,
        identityResult: null,
        completedAt,
        expectedSourceVersion: sourceVersion,
      });
    }
    return produceIdentityEvidence({
      candidate, applicantInputVersion: context.snapshot.applicantInputVersion,
      proposalContentVersion: context.snapshot.proposalContentVersion,
      proposalInfo, completedAt, signal, expectedSourceVersion: sourceVersion,
    });
  }
  if (stage === 'institution_domains') return produceInstitutionDomainsEvidence({
    candidate, identityReceipt: candidate.stageFreshness?.identity,
    identityEvidence: candidate.identityEvidence, identityResult: candidate.identityEvidence,
    signal, completedAt, expectedSourceVersion: sourceVersion,
    expectedInputFingerprint: institutionDomainInputFingerprint(candidate),
  });
  if (stage === 'institution_coi') return produceInstitutionCoiEvidence({
    requestId: context.request.akoya_requestid, candidate,
    identityReceipt: candidate.stageFreshness?.identity,
    identityEvidence: candidate.identityEvidence, identityResult: candidate.identityEvidence,
    signal, completedAt, expectedSourceVersion: sourceVersion,
  });
  if (stage === 'coauthor_coi') {
    const retry = reusableCoauthorCoverage(candidate, sourceVersion);
    const authors = retry
      ? coauthorAuthors(candidate)
      : context.coauthorProposal?.proposalAuthors;
    const authorVersion = retry
      ? candidate.proposalAuthorVersion
      : context.coauthorProposal?.proposalAuthorVersion;
    if (!authors || !authorVersion || !context.snapshot.proposalContentVersion) return null;
    return produceCoauthorCoiEvidence({
      candidate, proposalAuthors: authors, proposalAuthorVersion: authorVersion,
      sourceVersion, expectedSourceVersion: sourceVersion, signal,
      deadlineAt: boundedDeadlineAt(deadlineAt),
      ...(retry ? { priorAuthorResults: retry.results, retryAuthors: retry.retryAuthors } : {}),
    });
  }
  if (stage === 'eligibility') return produceEligibilityEvidence({
    candidate, trustedDomains: candidate.trustedInstitutionDomains,
    sourceVersion, expectedSourceVersion: sourceVersion,
    credentials: providerCredentials(), signal, deadlineAt: boundedDeadlineAt(deadlineAt),
  });
  if (stage === 'contact') return produceReviewerContactEvidence({
    candidate, institutionDomains: candidate.trustedInstitutionDomains,
    sourceVersion, expectedSourceVersion: sourceVersion, credentials: providerCredentials(),
    policy: { usePubmed: true, useOrcid: true, useClaudeSearch: true, useSerpSearch: false },
    signal, deadlineAt: boundedDeadlineAt(deadlineAt),
  });
  return null;
}

function sameStageAuthority(before, after, stage) {
  return before?.candidateKey === after?.candidateKey
    && before?.requestId === after?.requestId
    && before?.proposalContentVersion === after?.proposalContentVersion
    && before?.stageInputVersions?.[stage] === after?.stageInputVersions?.[stage];
}

/**
 * Once a lease exists, every producer failure must attempt to leave a
 * retryable receipt rather than strand the candidate in an in-progress UI
 * state. If the store itself is unavailable, we cannot safely issue a second
 * blind mutation; the persisted lease remains recoverable through the
 * existing expiry path and the caller receives an explicit retryable result.
 */
async function safelyFailLeasedStage(requestId, candidateKey, expectedUpdatedAt, stage, attemptId, options) {
  try {
    return await failStageRefresh(requestId, candidateKey, expectedUpdatedAt, stage, attemptId, options);
  } catch {
    return { outcome: 'failed_retryable', code: 'roster_write_failed' };
  }
}

/** Execute exactly one planned stage. */
export async function refreshReviewerCandidateStage({
  requestId,
  candidateKey,
  stage,
  expectedUpdatedAt,
  // Internal-only request-scoped context from the reconciliation service. API
  // callers cannot provide this object; see the closed route body schema.
  reconciliationContext = null,
  // Private upper bound supplied only by the bounded reconciliation service.
  // Standalone staff refreshes retain their existing 55-second limit.
  deadlineAt = null,
} = {}) {
  const args = { requestId, candidateKey: canonicalKey(candidateKey), stage };
  if (!guid(requestId) || !args.candidateKey || !safeToken(expectedUpdatedAt)) return rejected(args, 'invalid_refresh_target');
  if (stage === 'address_trust') return rejected(args, 'dedicated_address_action');
  if (!EXECUTABLE_REVIEWER_REFRESH_STAGES.includes(stage)) return rejected(args, 'stage_not_executable');

  let stored;
  try {
    stored = await findCandidateByKey(requestId, args.candidateKey);
  } catch {
    return rejected(args, 'request_authority_unavailable');
  }
  if (!stored || stored.candidateKey !== args.candidateKey || stored.rosterStatus !== ACTIVE_ROSTER_STATUS) {
    return rejected(args, 'canonical_candidate_unavailable');
  }
  // Pre-fix rows can contain more than one lease. Treat the first deterministic
  // stage as the candidate-wide owner so staff can recover old leases one at a
  // time without two expired stages blocking each other forever.
  const owningLease = candidateStageLease(stored);
  if (owningLease && !owningLease.valid) {
    return response({
      ...args,
      outcome: 'lease_repair_required',
      code: 'lease_repair_required',
      stageState: 'stale',
      reasonCode: 'lease_repair_required',
      leaseStage: owningLease.stage,
    });
  }
  if (owningLease && owningLease.stage !== stage) {
    const recoveryRequired = owningLease.expired;
    return response({
      ...args,
      outcome: recoveryRequired ? 'lease_recovery_required' : 'refresh_in_progress',
      code: recoveryRequired ? 'lease_recovery_required' : 'candidate_refresh_in_progress',
      stageState: recoveryRequired ? 'stale' : 'refreshing',
      reasonCode: recoveryRequired ? 'lease_recovery_required' : 'refresh_in_progress',
      leaseStage: owningLease.stage,
    });
  }
  let context;
  try {
    context = await serverContext(requestId, stored, {
      allowUnsealedDomainPreview: stage === 'institution_domains',
      requestContext: reconciliationContext,
    });
  } catch { return rejected(args, 'request_authority_unavailable'); }
  if (!context) return rejected(args, 'request_authority_unavailable');
  let plan = safePlan(context.plan);
  const liveLease = stageLease(stored, stage);
  if (liveLease) {
    if (!safeToken(liveLease.refreshAttemptId) || !canonicalIso(liveLease.refreshStartedAt)) {
      return rejected(args, 'refresh_lease_invalid', plan);
    }
    if (!expired(liveLease)) {
      return response({ ...args, outcome: 'refresh_in_progress', stageState: 'refreshing', reasonCode: 'refresh_in_progress', candidatePlan: plan });
    }
    // Recovery is an explicit same-stage action selected by the server-owned
    // plan. Re-read authority for the owning stage, then let the store enforce
    // row token + attempt ID + active status + minimum lease age atomically.
    let recoveryCandidate;
    try {
      recoveryCandidate = await findCandidateByKey(requestId, args.candidateKey);
    } catch {
      return rejected(args, 'request_authority_unavailable', plan);
    }
    let recoveryContext;
    try {
      recoveryContext = recoveryCandidate
        ? await serverContext(requestId, recoveryCandidate, {
          allowUnsealedDomainPreview: stage === 'institution_domains',
          requestContext: reconciliationContext,
          // Recovering an old lease must never rely on an earlier request
          // snapshot: this is the durable boundary before a repair write.
          forceFresh: true,
        })
        : null;
    } catch { recoveryContext = null; }
    if (!recoveryContext) return rejected(args, 'request_authority_unavailable', plan);
    const normalRecoverySource = expectedSource(recoveryContext.snapshot, stage);
    // If an upstream invalidation (most commonly the proposal binding) leaves
    // this stage without a derivable normal source, clear only the expired
    // same-stage lease with a server-scoped recovery marker.  The store writes
    // an *incomplete* receipt, so this marker cannot make evidence current or
    // authorize promotion; after authority returns, ordinary planning will
    // schedule the normal producer.  No provider work happens on this path.
    const recoverySource = normalRecoverySource || sourceVersions.expiredLeaseRecoverySourceVersion({
      requestId: recoveryContext.request?.akoya_requestid,
      candidateKey: recoveryContext.candidate?.candidateKey,
      stage,
    });
    if (!recoverySource) return rejected(args, 'request_authority_unavailable', plan);
    plan = safePlan(recoveryContext.plan);
    let recovered;
    try {
      recovered = await recoverExpiredStageRefresh(
        requestId,
        args.candidateKey,
        expectedUpdatedAt.trim(),
        stage,
        liveLease.refreshAttemptId,
        {
          leaseMs: DEFAULT_AGE_POLICY.leaseMs,
          expectedSourceVersion: recoverySource,
        },
      );
    } catch {
      return rejected(args, 'roster_write_failed', plan);
    }
    return response({
      ...args,
      outcome: recovered.outcome,
      code: recovered.code || null,
      stageState: recovered.outcome === 'failed_retryable' ? 'incomplete' : 'stale',
      reasonCode: recovered.outcome === 'failed_retryable'
        ? 'prior_refresh_incomplete'
        : 'roster_snapshot_changed',
      updatedAt: recovered.updatedAt,
      candidatePlan: plan,
    });
  }
  if (stage === 'roster_persistence') {
    if (!requiredStagesCurrent(context.plan, stage)) return rejected(args, 'prerequisite_stale', plan);
    let finalized;
    try {
      finalized = await finalizeCachedRosterEvidence(requestId, args.candidateKey, expectedUpdatedAt);
    } catch {
      return rejected(args, 'roster_write_failed', plan);
    }
    return response({
      ...args,
      outcome: finalized.outcome,
      stageState: finalized.outcome === 'recorded' ? 'current' : 'stale',
      reasonCode: finalized.outcome === 'recorded' ? null : 'roster_snapshot_changed',
      updatedAt: finalized.updatedAt,
      candidatePlan: plan,
    });
  }
  if (!stageNeedsRefresh(context.plan, stage)) {
    return response({ ...args, outcome: 'not_required', stageState: 'current', reasonCode: 'refresh_not_required', candidatePlan: plan });
  }
  if (!requiredStagesCurrent(context.plan, stage)) return rejected(args, 'prerequisite_stale', plan);

  try {
    const anchor = await validateApplicantAnchor(requestId, context.candidate);
    if (!anchor.ok) return rejected(args, anchor.code, plan);
  } catch { return rejected(args, 'suggestion_anchor_unavailable', plan); }
  const token = expectedUpdatedAt.trim();
  // A complete prior coverage vector may retry only its failed authors.  Every
  // other manual coauthor run derives the author list and its opaque
  // fingerprint from one exact, pre/post-stable Graph proposal analysis.  It
  // never accepts authors carried in a roster/browser prose blob.
  if (stage === 'coauthor_coi') {
    const reusable = reusableCoauthorCoverage(context.candidate, expectedSource(context.snapshot, stage));
    if (!reusable) {
      const analysisController = new AbortController();
      const analysisTimeout = setTimeout(() => analysisController.abort(), remainingDeadlineMs(boundedDeadlineAt(deadlineAt)));
      try {
        const withProposal = await withCoauthorProposalAuthority(
          context,
          analysisController.signal,
          reconciliationContext,
          deadlineAt,
        );
        if (!withProposal) return rejected(args, 'prerequisite_action_required', plan);
        context = withProposal;
        plan = safePlan(context.plan);
      } catch {
        return rejected(args, 'request_authority_unavailable', plan);
      } finally {
        clearTimeout(analysisTimeout);
      }
    }
  }
  if (!expectedSource(context.snapshot, stage)) {
    return rejected(args, stage === 'coauthor_coi' ? 'prerequisite_action_required' : 'stage_not_executable', plan);
  }
  const attemptId = randomUUID();
  let started;
  try {
    started = await startStageRefresh(requestId, args.candidateKey, token, stage, {
      attemptId, reason: 'manual_refresh', startedAt: new Date().toISOString(),
    });
  } catch {
    return rejected(args, 'roster_write_failed', plan);
  }
  if (started.outcome !== 'recorded' || !safeToken(started.updatedAt)) return response({
    ...args,
    outcome: started.outcome,
    code: started.code || null,
    stageState: started.outcome === 'refresh_in_progress' ? 'refreshing' : 'stale',
    reasonCode: started.outcome === 'lease_recovery_required'
      ? 'lease_recovery_required'
      : started.outcome === 'refresh_in_progress' ? 'refresh_in_progress' : 'roster_snapshot_changed',
    leaseStage: started.leaseStage || null,
    candidatePlan: plan,
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), remainingDeadlineMs(boundedDeadlineAt(deadlineAt)));
  try {
    const envelope = await executeStage(stage, context, controller.signal, reconciliationContext, deadlineAt);
    if (!envelope || envelope.receipt?.sourceVersion !== expectedSource(context.snapshot, stage)) {
      const failed = await safelyFailLeasedStage(requestId, args.candidateKey, started.updatedAt, stage, attemptId, {
        terminal: false,
        errorCode: 'retryable_failure',
        expectedSourceVersion: expectedSource(context.snapshot, stage),
      });
      return response({ ...args, outcome: failed.outcome, stageState: 'incomplete', candidatePlan: plan });
    }
    const current = await findCandidateByKey(requestId, args.candidateKey);
    const currentAnchor = current ? await validateApplicantAnchor(requestId, current).catch(() => ({ ok: false })) : null;
    // Institution-domain execution is the sole pre-projection path permitted
    // to derive the input fingerprint. Normal warm reads remain sealed-only;
    // this second pre-write authority comparison uses the same narrow preview
    // so it can detect a changed input before the first sealed receipt exists.
    const afterCandidate = current && stage === 'coauthor_coi' && context.coauthorProposal?.proposalAuthorVersion
      ? { ...current, proposalAuthorVersion: context.coauthorProposal.proposalAuthorVersion }
      : current;
    const after = afterCandidate
      ? await serverContext(requestId, afterCandidate, {
        allowUnsealedDomainPreview: stage === 'institution_domains',
        // The post-producer guard deliberately re-reads current request and
        // proposal authority instead of trusting the reconciliation cache.
        forceFresh: true,
      })
      : null;
    if (!currentAnchor?.ok || !after || !sameStageAuthority(context.snapshot, after.snapshot, stage)) {
      let persisted;
      try {
        persisted = await completeStageRefreshWithEvidence(
          requestId,
          args.candidateKey,
          started.updatedAt,
          stage,
          attemptId,
          authorityChangedEnvelope(stage, expectedSource(context.snapshot, stage)),
        );
      } catch {
        persisted = await safelyFailLeasedStage(requestId, args.candidateKey, started.updatedAt, stage, attemptId, {
          terminal: false,
          errorCode: 'retryable_failure',
          expectedSourceVersion: expectedSource(context.snapshot, stage),
        });
      }
      return response({
        ...args,
        outcome: persisted.outcome === 'recorded' ? 'failed_retryable' : persisted.outcome,
        stageState: persisted.outcome === 'recorded' ? 'incomplete' : 'stale',
        reasonCode: 'authority_changed',
        candidatePlan: plan,
      });
    }
    let completed;
    try {
      completed = await completeStageRefreshWithEvidence(requestId, args.candidateKey, started.updatedAt, stage, attemptId, envelope);
    } catch {
      completed = await safelyFailLeasedStage(requestId, args.candidateKey, started.updatedAt, stage, attemptId, {
        terminal: false,
        errorCode: 'retryable_failure',
        expectedSourceVersion: expectedSource(context.snapshot, stage),
      });
    }
    return response({
      ...args,
      outcome: completed.outcome,
      stageState: completed.outcome === 'recorded' ? envelope.receipt.state : 'stale',
      reasonCode: completed.outcome === 'recorded' ? envelope.receipt.reasonCode : 'roster_snapshot_changed',
      updatedAt: completed.updatedAt,
      // `after.plan` was derived before the guarded completion write. The UI
      // immediately reloads the roster after a recorded refresh, so never
      // present that prior plan as if it described the newly persisted row.
      // Failed/stale completions can still use it as diagnostic context.
      candidatePlan: completed.outcome === 'recorded' ? null : safePlan(after.plan),
    });
  } catch {
    const failed = await safelyFailLeasedStage(requestId, args.candidateKey, started.updatedAt, stage, attemptId, {
      terminal: false,
      errorCode: 'retryable_failure',
      expectedSourceVersion: expectedSource(context.snapshot, stage),
    });
    return response({ ...args, outcome: failed.outcome, stageState: 'incomplete', candidatePlan: plan });
  } finally {
    clearTimeout(timeout);
  }
}

export const _internals = {
  safePlan,
  serverContext,
  executeStage,
  expectedSource,
  requiredStagesCurrent,
  sameStageAuthority,
  loadServerBoundProposalAnalysis,
  loadServerBoundProposalInfo,
  boundedProposalInfo,
  boundedProposalAuthors,
};
