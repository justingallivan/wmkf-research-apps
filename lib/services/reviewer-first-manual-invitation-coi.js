/**
 * First-invitation institution screen for staff-added reviewers.
 *
 * Only a current, server-read `staff_manual` suggestion with no invitation or
 * engagement history is in scope. The reviewer/staff-confirmed main-institution field
 * is the sole person-side institution input; blank means unknown and remains
 * allowed. Callers must run this before minting or recording the first link.
 */

import * as reviewerSuggestionAdapter from '../dataverse/adapters/reviewer-suggestion';
import * as potentialReviewerAdapter from '../dataverse/adapters/potential-reviewer';
import { loadCoiContext } from './reviewer-request-context';
import { createInstitutionIdentityResolver } from './institution-identity-resolver';
import { recomputeReviewerInstitutionCOI } from './reviewer-institution-coi-screen';
import { ServiceHttpError } from './service-http-error';

const CONFLICT_MESSAGE = 'This reviewer has a confirmed institution conflict with the current proposal.';
const UNAVAILABLE_MESSAGE = 'The reviewer’s institution conflict could not be verified. Retry after checking the proposal and reviewer record.';

function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function normalizedId(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function matchesExpectedId(actual, expected) {
  return !hasValue(expected) || normalizedId(actual) === normalizedId(expected);
}

function sourceTokens(suggestion) {
  return typeof suggestion?.wmkf_sources === 'string'
    ? suggestion.wmkf_sources.split(',').map((token) => token.trim())
    : [];
}

/** True only for an exact staff_manual token before any invitation/engagement. */
export function isFirstManualInvitation(suggestion) {
  if (!sourceTokens(suggestion).includes('staff_manual')) return false;
  return suggestion?.wmkf_invited !== true
    && !hasValue(suggestion?.wmkf_emailsentat)
    && suggestion?.wmkf_accepted !== true
    && suggestion?.wmkf_declined !== true
    && suggestion?.wmkf_responsetype == null
    && !hasValue(suggestion?.wmkf_responsereceivedat)
    && !hasValue(suggestion?.wmkf_reviewreceivedat)
    && !hasValue(suggestion?.wmkf_completedat)
    && !hasValue(suggestion?.wmkf_materialssentat)
    && !hasValue(suggestion?.wmkf_remindersentat)
    && !hasValue(suggestion?.wmkf_respondremindersentat)
    && !hasValue(suggestion?.wmkf_thankyousentat);
}

export class ReviewerFirstManualInvitationCoiError extends ServiceHttpError {
  constructor(code) {
    const conflict = code === 'manual_institution_coi';
    const message = conflict ? CONFLICT_MESSAGE : UNAVAILABLE_MESSAGE;
    const httpStatus = conflict ? 409 : 503;
    super(message, {
      httpStatus,
      code,
      body: { error: message, code },
    });
    this.name = 'ReviewerFirstManualInvitationCoiError';
  }
}

/**
 * Fresh-read a suggestion by its server-owned ID, then screen its linked
 * person's staff-confirmed main institution against the current request and PI.
 * A caller should invoke this only when its current row is a first manual invite;
 * the fresh read rechecks that the row remains in scope before any write.
 */
export async function screenFirstManualInvitationInstitutionCOI({
  suggestionId,
  expectedRequestId,
  expectedPersonId,
} = {}) {
  let suggestion;
  try {
    suggestion = await reviewerSuggestionAdapter.findById(suggestionId);
  } catch {
    throw new ReviewerFirstManualInvitationCoiError('manual_institution_coi_unavailable');
  }
  if (!suggestion) {
    throw new ReviewerFirstManualInvitationCoiError('manual_institution_coi_unavailable');
  }
  if (!matchesExpectedId(suggestion._wmkf_request_value, expectedRequestId)
    || !matchesExpectedId(suggestion._wmkf_potentialreviewer_value, expectedPersonId)) {
    throw new ReviewerFirstManualInvitationCoiError('manual_institution_coi_unavailable');
  }
  if (!isFirstManualInvitation(suggestion)) return { applicable: false, screened: false };

  const requestId = suggestion?._wmkf_request_value;
  const personId = suggestion?._wmkf_potentialreviewer_value;
  if (!requestId || !personId) {
    throw new ReviewerFirstManualInvitationCoiError('manual_institution_coi_unavailable');
  }

  let person;
  try {
    person = await potentialReviewerAdapter.getById(personId);
  } catch {
    throw new ReviewerFirstManualInvitationCoiError('manual_institution_coi_unavailable');
  }
  if (!person) {
    throw new ReviewerFirstManualInvitationCoiError('manual_institution_coi_unavailable');
  }

  // `wmkf_maininstitution` is the staff-confirmed current institution. The
  // legacy primary-affiliation and organization fields can be historical or
  // enrichment data, so they do not turn an unknown institution into a block.
  const mainInstitution = typeof person.wmkf_maininstitution === 'string'
    ? person.wmkf_maininstitution.trim()
    : '';
  if (!mainInstitution) {
    return { applicable: true, screened: false, reason: 'institution_unknown' };
  }

  let coiContext;
  try {
    coiContext = await loadCoiContext(requestId, {
      includeCoPIs: false,
      requireCompleteInstitutions: true,
    });
    if (!coiContext || !Array.isArray(coiContext.institutionEntries)
      || !coiContext.piResolution || coiContext.piResolution.state !== 'ok') {
      throw new Error('proposal_pi_unavailable');
    }
    const result = await recomputeReviewerInstitutionCOI({
      candidate: { name: person.wmkf_name || null },
      institutionEntries: coiContext.institutionEntries,
      serverAffiliations: [mainInstitution],
      institutionIdentityResolver: createInstitutionIdentityResolver(),
    });
    if (result?.decision?.dropDecision === 'dropped') {
      throw new ReviewerFirstManualInvitationCoiError('manual_institution_coi');
    }
  } catch (error) {
    if (error instanceof ReviewerFirstManualInvitationCoiError) throw error;
    throw new ReviewerFirstManualInvitationCoiError('manual_institution_coi_unavailable');
  }

  return { applicable: true, screened: true, reason: 'clear' };
}
