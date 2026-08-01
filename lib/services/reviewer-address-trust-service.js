/**
 * Server orchestration for reviewer exact-address trust actions.
 *
 * Pre-promotion verification writes a server-owned Postgres roster receipt.
 * When an exact stable person has a pending conflict, the same action also
 * resolves person-scoped Dataverse state before clearing the roster block;
 * an already-promoted exact suggestion writes that person directly under ETag.
 * Repair requests are durable system_alerts rows and never unblock alone.
 */

import { createHash } from 'crypto';
import NotificationService from './notification-service';
import * as suggestionAdapter from '../dataverse/adapters/reviewer-suggestion';
import * as potentialReviewerAdapter from '../dataverse/adapters/potential-reviewer';
import { translateDuplicateKeyError } from '../dataverse/duplicate-key';
import {
  attestAddress,
  clearAddressTrustBlocks,
  findCandidatesByKeys,
  recordSurfaced,
} from './reviewer-roster-store';
import { resolveTrustedReviewerPerson } from './reviewer-contact-reconciliation';
import { withRemediation } from '../utils/reviewer-remediation';
import { emailConfidence } from '../utils/reviewer-invite';
import { reviewerSuggestionCandidateKey } from '../utils/reviewer-candidate-key';
import {
  addressConflictDisposition,
  createConflictPendingState,
  createStaffVerifiedState,
  normalizeAddress,
  parseAddressTrustState,
  receiptCanResolveConflict,
} from '../utils/reviewer-address-trust';

function sameId(a, b) {
  return !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

function isActivePerson(person) {
  return !!person && (person.statecode === undefined || person.statecode === 0);
}

function isPreconditionFailure(error) {
  return error?.status === 412 || error?.response?.status === 412;
}

function repairKey(requestId, candidateKey, code) {
  const digest = createHash('sha256')
    .update(`${requestId}\n${candidateKey}\n${code}`)
    .digest('hex')
    .slice(0, 32);
  return `reviewer-address-repair:${digest}`;
}

async function requireRosterCandidate(requestId, candidateKey, allowedStatuses = null) {
  const [candidate] = await findCandidatesByKeys(requestId, [candidateKey]);
  if (!candidate) return null;
  if (allowedStatuses && !allowedStatuses.has(candidate.rosterStatus)) return null;
  return candidate;
}

async function resolveConflictPerson(requestId, candidate) {
  if (candidate?.suggestionId) {
    const suggestion = await suggestionAdapter.findById(candidate.suggestionId);
    if (!suggestion || !sameId(suggestion._wmkf_request_value, requestId)) return null;
    const personId = suggestion._wmkf_potentialreviewer_value || null;
    const person = personId ? await potentialReviewerAdapter.getById(personId) : null;
    return personId && person ? { personId, person } : null;
  }
  return resolveTrustedReviewerPerson(candidate, { allowInactive: true });
}

function partialReceiptFailure(recorded, {
  code,
  message,
  personUpdated = false,
} = {}) {
  return withRemediation({
    success: false,
    decision: 'blocked',
    code,
    message,
    partialSuccess: true,
    receiptRecorded: true,
    personUpdated,
    receiptId: recorded.receiptId,
    candidate: recorded.candidate,
  });
}

export async function getAddressConflict({ requestId, candidateKey }) {
  const candidate = await requireRosterCandidate(requestId, candidateKey, new Set(['active']));
  if (!candidate) {
    return withRemediation({
      success: false,
      decision: 'blocked',
      code: 'candidate_stale',
      message: 'The reviewer is no longer in the current Find roster. Reload the request.',
    });
  }
  const resolved = await resolveConflictPerson(requestId, candidate);
  if (resolved && !isActivePerson(resolved.person)) {
    return withRemediation({
      success: false,
      decision: 'blocked',
      code: 'person_inactive',
      message: 'This reviewer record is inactive and must be repaired before its address can be reviewed.',
    });
  }
  if (candidate.conflictRecordUnavailable === true && !resolved) {
    return withRemediation({
      success: false,
      decision: 'blocked',
      code: 'conflict_record_unavailable',
      message: 'The exact reviewer record could not be re-established. Retry or create a repair request.',
    });
  }
  const parsed = resolved ? parseAddressTrustState(
    resolved.person.wmkf_addresstruststatejson,
    { storedEmail: resolved.person.wmkf_emailaddress },
  ) : null;
  if (!parsed?.valid || parsed.state.status !== 'conflict_pending') {
    return withRemediation({
      success: false,
      decision: 'blocked',
      code: 'candidate_stale',
      message: 'The address conflict is no longer current. Reload or create a repair request from this reviewer card.',
    });
  }
  return {
    success: true,
    decision: 'review_address_conflict',
    code: 'address_conflict_pending',
    candidateKey,
    conflict: {
      storedEmail: parsed.state.conflict.storedEmail,
      foundEmail: parsed.state.conflict.foundEmail,
      reason: parsed.state.conflict.reason,
      detectedAt: parsed.state.conflict.detectedAt,
    },
    remediation: [],
  };
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
    if (person && !isActivePerson(person)) {
      return withRemediation({
        success: false,
        decision: 'blocked',
        code: 'person_inactive',
        message: 'This reviewer record is inactive and must be repaired before its address can be verified.',
      });
    }
    const exactEmail = normalizeAddress(email);
    const currentTrust = parseAddressTrustState(person?.wmkf_addresstruststatejson, {
      storedEmail: person?.wmkf_emailaddress,
    });
    const pendingConflict = currentTrust.valid && currentTrust.state.status === 'conflict_pending'
      ? currentTrust.state.conflict
      : null;
    const permittedEmails = new Set([
      normalizeAddress(person?.wmkf_emailaddress),
      pendingConflict ? normalizeAddress(pendingConflict.foundEmail) : null,
    ].filter(Boolean));
    if (!person?._etag || !exactEmail || !permittedEmails.has(exactEmail)) {
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
    const attestedAt = new Date().toISOString();
    if (pendingConflict && !receiptCanResolveConflict({
      personConfirmed: true,
      attestedAt,
    }, pendingConflict)) {
      return withRemediation({
        success: false,
        decision: 'blocked',
        code: 'candidate_stale',
        message: 'The address conflict changed while it was being reviewed. Reload and try again.',
      });
    }
    const resolution = currentTrust.valid && currentTrust.state.status === 'conflict_pending'
      ? {
          conflict: currentTrust.state.conflict,
          decision: exactEmail === currentTrust.state.email ? 'keep_stored' : 'use_found',
          actorProfileId: actorProfileId || null,
          actorSystemUserId: actorSystemUserId || null,
          resolvedAt: attestedAt,
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
      attestedAt,
      resolution,
    }));
    try {
      await potentialReviewerAdapter.update(personId, {
        email: exactEmail,
        emailSource: 'staff_verified',
        addressTrustStateJson,
      }, {
        actingUserSystemId: actorSystemUserId,
        ifMatch: person._etag,
      });
    } catch (error) {
      if (translateDuplicateKeyError(error)) {
        return withRemediation({
          success: false,
          decision: 'blocked',
          code: 'email_conflict',
          message: 'That address belongs to another reviewer record. Request repair to resolve the duplicate.',
        });
      }
      if (isPreconditionFailure(error)) {
        return withRemediation({
          success: false,
          decision: 'blocked',
          code: 'candidate_stale',
          message: 'The reviewer changed while the address was being verified. Reload and review the current value.',
        });
      }
      throw error;
    }
    return {
      success: true,
      decision: 'person_address_verified',
      code: 'address_attested',
      message: 'The exact reviewer address and evidence were recorded.',
      suggestionId,
      remediation: [],
    };
  }
  const rosterCandidate = await requireRosterCandidate(
    requestId,
    candidateKey,
    new Set(['active', 'saved']),
  );
  if (!rosterCandidate) {
    return withRemediation({
      success: false,
      decision: 'blocked',
      code: 'candidate_stale',
      message: 'The reviewer is no longer in the current Find roster. Reload before verifying.',
    });
  }
  const conflictPerson = await resolveConflictPerson(requestId, rosterCandidate);
  if (conflictPerson && !isActivePerson(conflictPerson.person)) {
    return withRemediation({
      success: false,
      decision: 'blocked',
      code: 'person_inactive',
      message: 'This reviewer record is inactive and must be repaired before its address can be verified.',
    });
  }
  const conflictTrust = conflictPerson ? parseAddressTrustState(
    conflictPerson.person.wmkf_addresstruststatejson,
    { storedEmail: conflictPerson.person.wmkf_emailaddress },
  ) : null;
  const pendingConflict = conflictTrust?.valid && conflictTrust.state.status === 'conflict_pending'
    ? conflictTrust.state.conflict
    : null;
  const exactEmail = normalizeAddress(email);
  if (rosterCandidate.addressConflictPending === true && !pendingConflict) {
    return withRemediation({
      success: false,
      decision: 'blocked',
      code: 'candidate_stale',
      message: 'The address conflict changed. Retry the check before choosing an address.',
    });
  }
  if (pendingConflict && !new Set([
    normalizeAddress(pendingConflict.storedEmail),
    normalizeAddress(pendingConflict.foundEmail),
  ]).has(exactEmail)) {
    return withRemediation({
      success: false,
      decision: 'blocked',
      code: 'candidate_stale',
      message: 'Choose one of the two current conflict addresses after reloading the card.',
    });
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
  if (pendingConflict) {
    if (!receiptCanResolveConflict(recorded.receipt, pendingConflict)) {
      return partialReceiptFailure(recorded, {
        code: 'candidate_stale',
        message: 'The conflict changed while it was being verified. Reload and try again.',
      });
    }
    const addressTrustStateJson = JSON.stringify(createStaffVerifiedState({
      email: exactEmail,
      actorProfileId,
      actorSystemUserId,
      requestId,
      candidateKey,
      evidenceType,
      evidenceUrl,
      note,
      attestedAt: recorded.receipt.attestedAt,
      resolution: {
        conflict: pendingConflict,
        decision: exactEmail === normalizeAddress(pendingConflict.storedEmail) ? 'keep_stored' : 'use_found',
        actorProfileId: actorProfileId || null,
        actorSystemUserId: actorSystemUserId || null,
        resolvedAt: recorded.receipt.attestedAt,
      },
    }));
    try {
      await potentialReviewerAdapter.update(conflictPerson.personId, {
        email: exactEmail,
        emailSource: 'staff_verified',
        addressTrustStateJson,
      }, {
        actingUserSystemId: actorSystemUserId,
        ifMatch: conflictPerson.person._etag,
      });
    } catch (error) {
      if (translateDuplicateKeyError(error)) {
        return partialReceiptFailure(recorded, {
          code: 'email_conflict',
          message: 'That address belongs to another reviewer record. Request repair to resolve the duplicate.',
        });
      }
      if (isPreconditionFailure(error)) {
        return partialReceiptFailure(recorded, {
          code: 'candidate_stale',
          message: 'The reviewer changed after the evidence was recorded. Reload and review the current address.',
        });
      }
      return partialReceiptFailure(recorded, {
        code: 'conflict_record_unavailable',
        message: 'The evidence was recorded, but the reviewer address could not be updated. Retry or create a repair request.',
      });
    }
    const cleared = await clearAddressTrustBlocks(requestId, candidateKey, {
      receiptId: recorded.receiptId,
      expectedUpdatedAt: recorded.candidate.rosterUpdatedAt,
    });
    if (!cleared) {
      return partialReceiptFailure(recorded, {
        code: 'candidate_stale',
        message: 'The person address was resolved, but the card changed meanwhile. Reload the request.',
        personUpdated: true,
      });
    }
    return {
      success: true,
      decision: 'address_conflict_resolved',
      code: 'address_attested',
      message: 'The address conflict was resolved and the selected address is invite-ready.',
      receiptId: recorded.receiptId,
      candidateKey,
      candidate: cleared,
      remediation: [],
    };
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

export async function retryAddressCheck({
  requestId,
  candidateKey,
  actorSystemUserId = null,
}) {
  const candidate = await requireRosterCandidate(requestId, candidateKey, new Set(['active']));
  if (!candidate) {
    return withRemediation({
      success: false,
      decision: 'blocked',
      code: 'candidate_stale',
      message: 'The reviewer is no longer in the current Find roster. Reload the request.',
    });
  }
  if (candidate.conflictRecordUnavailable !== true && candidate.addressConflictPending !== true) {
    return withRemediation({
      success: false,
      decision: 'blocked',
      code: 'candidate_stale',
      message: 'This reviewer no longer has an address check that needs retrying. Reload the request.',
    });
  }
  const refreshed = {
    ...candidate,
    addressConflictPending: false,
    conflictRecordUnavailable: false,
    contactEnrichment: {
      ...(candidate.contactEnrichment || {}),
      addressConflictPending: false,
      conflictRecordUnavailable: false,
    },
  };
  delete refreshed.rosterUpdatedAt;
  delete refreshed.rosterStatus;
  const resolved = await resolveConflictPerson(requestId, candidate);
  if (!resolved) {
    return withRemediation({
      success: false,
      decision: 'blocked',
      code: 'conflict_record_unavailable',
      message: 'The exact reviewer record could not be re-established. Retry or create a repair request.',
    });
  }
  if (!isActivePerson(resolved.person)) {
    return withRemediation({
      success: false,
      decision: 'blocked',
      code: 'person_inactive',
      message: 'This reviewer record is inactive and must be repaired before its address can be checked.',
    });
  }
  const currentTrust = parseAddressTrustState(
    resolved.person.wmkf_addresstruststatejson,
    { storedEmail: resolved.person.wmkf_emailaddress },
  );
  const storedEmail = normalizeAddress(resolved.person.wmkf_emailaddress);
  const foundEmail = normalizeAddress(candidate.contactEnrichment?.email || candidate.email);
  const receipt = candidate.addressTrustReceipt || null;
  const receiptEmail = normalizeAddress(receipt?.email);
  const projectResolved = (person = resolved.person) => {
    const readiness = emailConfidence(person);
    refreshed.applicantContactMismatch = false;
    refreshed.addressConflictPending = false;
    refreshed.email = storedEmail;
    refreshed.emailSource = person.wmkf_emailsource || null;
    refreshed.emailPersistAllowed = false;
    refreshed.contactEnrichment.addressConflictPending = false;
    refreshed.contactEnrichment.email = storedEmail;
    refreshed.contactEnrichment.emailSource = person.wmkf_emailsource || null;
    refreshed.contactEnrichment.emailPersistAllowed = false;
    if (refreshed.applicantKnownReviewer) {
      refreshed.applicantKnownReviewer = {
        ...refreshed.applicantKnownReviewer,
        email: storedEmail,
        emailSource: person.wmkf_emailsource || null,
        addressConflictPending: false,
        addressTrustVerified: readiness.action === 'ready',
        emailReadiness: {
          level: readiness.level,
          action: readiness.action,
          reason: readiness.reason,
        },
      };
    }
  };

  // A prior verification may have committed its roster receipt before the
  // ETag-guarded Dataverse write failed. Retry that exact adjudication; never
  // reinterpret the newly attested address as a fresh contradiction.
  if (receipt?.personConfirmed === true && receiptEmail) {
    let personUpdated = false;
    if (currentTrust.valid && currentTrust.state.status === 'conflict_pending') {
      const conflict = currentTrust.state.conflict;
      const allowed = new Set([
        normalizeAddress(conflict.storedEmail),
        normalizeAddress(conflict.foundEmail),
      ]);
      if (!allowed.has(receiptEmail) || !receiptCanResolveConflict(receipt, conflict)) {
        return withRemediation({
          success: false,
          decision: 'blocked',
          code: 'candidate_stale',
          message: 'The address conflict changed after this evidence was recorded. Reload and review both addresses.',
        });
      }
      const verifiedState = createStaffVerifiedState({
        email: receiptEmail,
        actorProfileId: receipt.actorProfileId,
        actorSystemUserId: receipt.actorSystemUserId,
        requestId,
        candidateKey,
        evidenceType: receipt.evidenceType,
        evidenceUrl: receipt.evidenceUrl,
        note: receipt.note,
        attestedAt: receipt.attestedAt,
        resolution: {
          conflict,
          decision: receiptEmail === normalizeAddress(conflict.storedEmail) ? 'keep_stored' : 'use_found',
          actorProfileId: receipt.actorProfileId || null,
          actorSystemUserId: receipt.actorSystemUserId || null,
          resolvedAt: receipt.attestedAt,
        },
      });
      try {
        await potentialReviewerAdapter.update(resolved.personId, {
          email: receiptEmail,
          emailSource: 'staff_verified',
          addressTrustStateJson: JSON.stringify(verifiedState),
        }, {
          actingUserSystemId: actorSystemUserId,
          ifMatch: resolved.person._etag,
        });
        personUpdated = true;
      } catch (error) {
        if (translateDuplicateKeyError(error)) {
          return withRemediation({
            success: false,
            decision: 'blocked',
            code: 'email_conflict',
            message: 'That address belongs to another reviewer record. Request repair to resolve the duplicate.',
          });
        }
        if (isPreconditionFailure(error)) {
          return withRemediation({
            success: false,
            decision: 'blocked',
            code: 'candidate_stale',
            message: 'The reviewer changed while the recorded evidence was being retried. Reload and review the current address.',
          });
        }
        return withRemediation({
          success: false,
          decision: 'blocked',
          code: 'conflict_record_unavailable',
          message: 'The evidence remains recorded, but the reviewer address still could not be updated. Retry or create a repair request.',
        });
      }
    } else if (currentTrust.reason === 'absent'
      && candidate.conflictRecordUnavailable === true
      && receiptEmail === foundEmail) {
      // The original durable conflict write failed before a person bundle
      // existed, but staff subsequently verified the exact displayed address.
      // There is nothing to replay on the person yet. The roster receipt keeps
      // the adjudicated A/B pair and selected address; clearing both roster block
      // flags records that staff resolved this request-scoped contradiction, while
      // promotion still must bind the receipt atomically to an exact person.
    } else if (!(currentTrust.valid
      && currentTrust.state.status === 'staff_verified'
      && storedEmail === receiptEmail)) {
      return withRemediation({
        success: false,
        decision: 'blocked',
        code: 'candidate_stale',
        message: 'The reviewer address changed after this evidence was recorded. Reload and verify the current value.',
      });
    }

    const cleared = await clearAddressTrustBlocks(requestId, candidateKey, {
      receiptId: receipt.receiptId,
      expectedUpdatedAt: candidate.rosterUpdatedAt,
    });
    if (!cleared) {
      return withRemediation({
        success: false,
        decision: 'blocked',
        code: 'candidate_stale',
        message: personUpdated
          ? 'The reviewer address was resolved, but the card changed meanwhile. Reload the request.'
          : 'The reviewer address is resolved, but the card changed meanwhile. Reload the request.',
        partialSuccess: personUpdated,
        personUpdated,
      });
    }
    return {
      success: true,
      decision: 'address_conflict_resolved',
      code: 'address_attested',
      message: 'The recorded evidence was applied and the reviewer address is invite-ready.',
      candidateKey,
      candidate: cleared,
      remediation: [],
    };
  }

  if (currentTrust.valid && currentTrust.state.status === 'conflict_pending') {
    refreshed.addressConflictPending = true;
    refreshed.contactEnrichment.addressConflictPending = true;
  } else {
    const canRecordContradiction = !!storedEmail && !!foundEmail
      && storedEmail !== foundEmail
      && candidate.contactEnrichment?.emailPersistAllowed === true;
    if (canRecordContradiction) {
      const disposition = addressConflictDisposition(currentTrust.state, {
        email: storedEmail,
        foundEmail,
        reason: 'email_mismatch',
      });
      if (disposition === 'write') {
        const conflictState = createConflictPendingState({
          currentState: currentTrust.state,
          email: storedEmail,
          reason: 'email_mismatch',
          foundEmail,
          source: candidate.contactEnrichment?.emailSource || null,
          requestId,
          candidateKey,
        });
        try {
          await potentialReviewerAdapter.update(resolved.personId, {
            addressTrustStateJson: JSON.stringify(conflictState),
          }, {
            actingUserSystemId: actorSystemUserId,
            ifMatch: resolved.person._etag,
          });
        } catch (error) {
          if (isPreconditionFailure(error)) {
            return withRemediation({
              success: false,
              decision: 'blocked',
              code: 'candidate_stale',
              message: 'The reviewer changed while the conflict check was retried. Reload and review the current address.',
            });
          }
          return withRemediation({
            success: false,
            decision: 'blocked',
            code: 'conflict_record_unavailable',
            message: 'The conflict still could not be recorded. Retry or create a repair request.',
          });
        }
      }
      if (disposition === 'resolved') projectResolved();
      else {
        refreshed.addressConflictPending = true;
        refreshed.contactEnrichment.addressConflictPending = true;
      }
    } else if (currentTrust.valid && currentTrust.state.status === 'staff_verified') {
      projectResolved();
    }
  }
  const recorded = await recordSurfaced(requestId, [refreshed], {
    expectedUpdatedAt: candidate.rosterUpdatedAt,
  });
  if (!recorded) {
    return withRemediation({
      success: false,
      decision: 'blocked',
      code: 'candidate_stale',
      message: 'The reviewer changed while the check was running. Reload and retry.',
    });
  }
  const current = await requireRosterCandidate(requestId, candidateKey);
  return {
    success: true,
    decision: 'refreshed',
    code: 'candidate_refreshed',
    candidateKey,
    candidate: current,
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
