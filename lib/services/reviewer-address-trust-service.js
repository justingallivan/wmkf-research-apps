/**
 * Server orchestration for reviewer exact-address trust actions.
 *
 * Pre-promotion verification writes only a server-owned Postgres roster
 * receipt. Person-scoped Dataverse authority is written later by the promotion
 * services once they have resolved the stable reviewer person. Repair requests
 * are durable system_alerts rows and never unblock a candidate by themselves.
 */

import { createHash } from 'crypto';
import NotificationService from './notification-service';
import * as suggestionAdapter from '../dataverse/adapters/reviewer-suggestion';
import * as potentialReviewerAdapter from '../dataverse/adapters/potential-reviewer';
import {
  attestAddress,
  findCandidatesByKeys,
} from './reviewer-roster-store';
import { withRemediation } from '../utils/reviewer-remediation';
import { emailConfidence } from '../utils/reviewer-invite';
import { reviewerSuggestionCandidateKey } from '../utils/reviewer-candidate-key';
import {
  createStaffVerifiedState,
  normalizeAddress,
  parseAddressTrustState,
} from '../utils/reviewer-address-trust';

function sameId(a, b) {
  return !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

function repairKey(requestId, candidateKey, code) {
  const digest = createHash('sha256')
    .update(`${requestId}\n${candidateKey}\n${code}`)
    .digest('hex')
    .slice(0, 32);
  return `reviewer-address-repair:${digest}`;
}

async function requireRosterCandidate(requestId, candidateKey) {
  const [candidate] = await findCandidatesByKeys(requestId, [candidateKey]);
  return candidate || null;
}

async function resolveRepairCandidate(requestId, candidateKey, suggestionId) {
  if (candidateKey) {
    const candidate = await requireRosterCandidate(requestId, candidateKey);
    return candidate ? { candidate, candidateKey } : null;
  }
  if (!suggestionId) return null;
  const suggestion = await suggestionAdapter.findById(suggestionId);
  if (!suggestion || !sameId(suggestion._wmkf_request_value, requestId)) return null;
  const personId = suggestion._wmkf_potentialreviewer_value || null;
  const person = personId ? await potentialReviewerAdapter.getById(personId) : null;
  return {
    candidateKey: reviewerSuggestionCandidateKey(suggestionId),
    candidate: {
      suggestionId,
      potentialReviewerId: personId,
      name: person?.wmkf_name || null,
      email: person?.wmkf_emailaddress || null,
    },
  };
}

export async function verifyPersonAndAddress({
  requestId,
  candidateKey,
  suggestionId = null,
  email,
  evidenceType,
  evidenceUrl,
  note,
  actorProfileId,
  actorSystemUserId,
}) {
  if (suggestionId && !candidateKey) {
    const suggestion = await suggestionAdapter.findById(suggestionId);
    if (!suggestion || !sameId(suggestion._wmkf_request_value, requestId)) {
      return withRemediation({
        success: false,
        decision: 'blocked',
        code: 'candidate_stale',
        message: 'The reviewer is no longer attached to this request. Reload before verifying.',
      });
    }
    const personId = suggestion._wmkf_potentialreviewer_value;
    const person = personId ? await potentialReviewerAdapter.getById(personId) : null;
    const exactEmail = normalizeAddress(email);
    if (!person?._etag || exactEmail !== normalizeAddress(person.wmkf_emailaddress)) {
      return withRemediation({
        success: false,
        decision: 'blocked',
        code: 'candidate_stale',
        message: 'The reviewer address changed. Reload and verify the current value.',
      });
    }
    const readiness = emailConfidence(person);
    if (readiness.action === 'ready') {
      return {
        success: true,
        decision: 'already_ready',
        code: 'address_already_ready',
        message: 'This reviewer address already has invite-ready provenance.',
        suggestionId,
        remediation: [],
      };
    }
    const stableCandidateKey = reviewerSuggestionCandidateKey(suggestionId);
    const currentTrust = parseAddressTrustState(person.wmkf_addresstruststatejson, {
      storedEmail: person.wmkf_emailaddress,
    });
    const resolution = currentTrust.valid && currentTrust.state.status === 'conflict_pending'
      ? {
          conflict: currentTrust.state.conflict,
          decision: exactEmail === currentTrust.state.email ? 'keep_stored' : 'use_found',
          actorProfileId: actorProfileId || null,
          actorSystemUserId: actorSystemUserId || null,
          resolvedAt: new Date().toISOString(),
        }
      : null;
    const addressTrustStateJson = JSON.stringify(createStaffVerifiedState({
      email: exactEmail,
      actorProfileId,
      actorSystemUserId,
      requestId,
      candidateKey: stableCandidateKey,
      evidenceType,
      evidenceUrl,
      note,
      resolution,
    }));
    await potentialReviewerAdapter.update(personId, {
      email: exactEmail,
      emailSource: 'staff_verified',
      addressTrustStateJson,
    }, {
      actingUserSystemId: actorSystemUserId,
      ifMatch: person._etag,
    });
    return {
      success: true,
      decision: 'person_address_verified',
      code: 'address_attested',
      message: 'The exact reviewer address and evidence were recorded.',
      suggestionId,
      remediation: [],
    };
  }
  const recorded = await attestAddress(requestId, candidateKey, {
    email,
    evidenceType,
    evidenceUrl,
    note,
    actorProfileId,
    actorSystemUserId,
  });
  if (!recorded) {
    return withRemediation({
      success: false,
      decision: 'blocked',
      code: 'candidate_stale',
      message: 'The reviewer or displayed address changed. Reload and verify the current value.',
    });
  }
  return {
    success: true,
    decision: 'attested_pending_promotion',
    code: 'address_attested',
    message: 'The exact address is verified and will be bound to the reviewer when promoted.',
    receiptId: recorded.receiptId,
    candidateKey,
    candidate: recorded.candidate,
    remediation: [],
  };
}

export async function retryAddressCheck({ requestId, candidateKey }) {
  const candidate = await requireRosterCandidate(requestId, candidateKey);
  if (!candidate) {
    return withRemediation({
      success: false,
      decision: 'blocked',
      code: 'candidate_stale',
      message: 'The reviewer is no longer in the current Find roster. Reload the request.',
    });
  }
  return {
    success: true,
    decision: 'refreshed',
    code: 'candidate_refreshed',
    candidateKey,
    candidate,
    remediation: [],
  };
}

export async function createAddressRepairRequest({
  requestId,
  candidateKey,
  suggestionId = null,
  code,
  actorProfileId,
  actorSystemUserId,
}) {
  const resolved = await resolveRepairCandidate(requestId, candidateKey, suggestionId);
  if (!resolved) {
    return withRemediation({
      success: false,
      decision: 'blocked',
      code: 'candidate_stale',
      message: 'The reviewer is no longer in the current Find roster. Reload before requesting repair.',
    });
  }
  const candidate = resolved.candidate;
  const repairCandidateKey = resolved.candidateKey;
  const normalizedCode = typeof code === 'string' && code.trim()
    ? code.trim().slice(0, 100)
    : 'unknown';
  const alert = await NotificationService.notify({
    type: 'reviewer_address_repair_requested',
    severity: 'warning',
    title: 'Reviewer address repair requested',
    message: `Staff requested reviewer identity/address repair for request ${requestId}.`,
    metadata: {
      requestId,
      candidateKey: repairCandidateKey,
      candidateName: candidate.name || null,
      suggestionId: candidate.suggestionId || suggestionId || null,
      potentialReviewerId: candidate.potentialReviewerId || null,
      code: normalizedCode,
      requestedByProfileId: actorProfileId || null,
      requestedBySystemUserId: actorSystemUserId || null,
    },
    source: 'reviewer-address-trust',
    category: 'reviewers',
    autoResolveKey: repairKey(requestId, repairCandidateKey, normalizedCode),
  });
  return {
    success: true,
    decision: 'repair_requested',
    code: normalizedCode,
    repairReference: alert?.id || repairKey(requestId, repairCandidateKey, normalizedCode),
    adminUrl: '/admin#system-alerts',
    message: alert
      ? 'Repair request created. The reviewer remains blocked until the underlying record is fixed.'
      : 'An active repair request already exists. The reviewer remains blocked until it is resolved.',
    remediation: [],
  };
}
