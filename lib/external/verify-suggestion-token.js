/**
 * Token + suggestion-row verification for external-reviewer endpoints.
 *
 * `verifyToken()` (in lib/services/external-token.js) only does the
 * cryptographic + temporal layer. The authoritative layer — hash match and
 * revocation flag — lives on the suggestion row and needs a Dataverse round
 * trip. This helper bundles both into one call so the three external
 * endpoints (context, proposal, upload) share an identical contract.
 *
 * Returns a discriminated union. On success, the caller gets the suggestion
 * row with the request and reviewer expanded — the same data needed to
 * render the landing page or look up the SharePoint folder. On failure, the
 * `reason` lets the caller render a specific error state (expired vs.
 * revoked vs. malformed link).
 */

import { verifyToken, hashToken } from '../services/external-token';
import { DynamicsService } from '../services/dynamics-service';
import { bypassDynamicsRestrictions } from '../services/dynamics-context';
import { APPLICANT_DISPOSITION_EXCLUDED } from '../dataverse/adapters/reviewer-suggestion';

const SUGGESTION_SELECT = [
  'wmkf_appreviewersuggestionid',
  'wmkf_externaltokenhash',
  'wmkf_externaltokenrevoked',
  'wmkf_externaltokenexpires',
  'wmkf_proposalfirstaccessed',
  'wmkf_reviewreceivedat',
  'wmkf_reviewfilename',
  'wmkf_reviewsharepointfolder',
  'wmkf_revieweraffiliation',
  // Phase D: the 3 rating columns are no longer SELECTed — context.js reads the
  // prefill ratings from the wmkf_appreviewanswer snapshot. Affiliation stays
  // (parent identity column, still read for the prefill).
  'wmkf_accepted',
  'wmkf_declined',
  'wmkf_applicantdisposition',
  // Stage 2a state machine + engagement-row contact corrections (S143).
  'wmkf_responsetype',
  'wmkf_responsereceivedat',
  'wmkf_reviewstatus',
  'wmkf_emailsentat',
  'wmkf_reviewerfirstname',
  'wmkf_reviewerlastname',
  'wmkf_reviewernickname',
  'wmkf_reviewertitle',
  'wmkf_revieweremail',
  'wmkf_reviewerorcid',
  'wmkf_declinereason',
  'wmkf_declinereasonpicklist',
  'wmkf_declinereferral',
  'wmkf_honorariumoptout',
  'wmkf_withdrawnsufficientat',
  'wmkf_coiackedat',
  'wmkf_aiuseackedat',
  '_wmkf_coipolicyversion_value',
  '_wmkf_aiusepolicyversion_value',
  '_wmkf_potentialreviewer_value',
  '_wmkf_request_value',
].join(',');

const REQUEST_SELECT = [
  'akoya_requestid',
  'akoya_requestnum',
  'akoya_title',
  'wmkf_meetingdate',
  'wmkf_reviewduedate',
  // Stage 2a proposal summary card (S143).
  'wmkf_abstract',
  '_akoya_applicantid_value',
  '_wmkf_projectleader_value',
  // Co-PIs are read from the wmkf_apprequestperson junction in context.js
  // (post-S139 backfill); the legacy `_wmkf_copi1..5_value` slot fields are
  // obsolete read-only legacy and no longer selected here.
  '_wmkf_programdirector_value',
].join(',');

const REVIEWER_SELECT = [
  'wmkf_potentialreviewersid',
  'wmkf_name',
  'wmkf_emailaddress',
  'wmkf_organizationname',
  'wmkf_primaryaffiliation',
  // Stage 2a prefill — directory snapshot (S143).
  'wmkf_firstname',
  'wmkf_lastname',
  'wmkf_title',
  // ORCID back-prop hydration (design §5): the honorarium orchestrator reads
  // these off the expanded reviewer to flow a resolver-gated ORCID onto contact.
  'wmkf_orcid',
  'wmkf_identitystatus',
  // S308 board-writeup identity prefill: the confirmed person fields + the
  // enrichment department (wmkf_primaryaffiliation already above) that seed them.
  'wmkf_academicrank',
  'wmkf_primarydepartment',
  'wmkf_maininstitution',
  'wmkf_department',
  '_wmkf_contact_value',
].join(',');

/**
 * Verify a magic-link token and load the associated suggestion + request +
 * reviewer rows in one Dataverse call.
 *
 * @param {string} jwt - The raw token from the URL.
 * @returns {Promise<
 *   | { ok: true, payload: object, suggestion: object, request: object, reviewer: object }
 *   | { ok: false, reason: 'no_token'|'expired'|'invalid_signature'|'invalid_claim'|'malformed'
 *                      |'not_found'|'hash_mismatch'|'revoked'|'token_expires_passed' }
 * >}
 */
export async function verifySuggestionToken(jwt) {
  const verified = await verifyToken(jwt);
  if (!verified.valid) {
    return { ok: false, reason: verified.reason };
  }

  const { suggestionId } = verified.payload;
  if (!suggestionId) {
    return { ok: false, reason: 'malformed' };
  }

  // External token verification doesn't have a Dynamics restriction context;
  // bypass any ambient restrictions so the lookup always succeeds.
  let suggestion;
  try {
    suggestion = await bypassDynamicsRestrictions('external-token-verify', () =>
      DynamicsService.getRecord('wmkf_appreviewersuggestions', suggestionId, {
        select: SUGGESTION_SELECT,
        expand: `wmkf_Request($select=${REQUEST_SELECT}),wmkf_PotentialReviewer($select=${REVIEWER_SELECT})`,
      }),
    );
  } catch (e) {
    if (e.status === 404 || /Get record failed \(404\)/.test(e.message || '')) {
      return { ok: false, reason: 'not_found' };
    }
    throw e;
  }

  if (!suggestion?.wmkf_externaltokenhash) {
    // Suggestion exists but no token was ever minted for it. Treat as
    // not_found so we don't leak that distinction to the caller.
    return { ok: false, reason: 'not_found' };
  }
  if (suggestion.wmkf_externaltokenhash !== hashToken(jwt)) {
    return { ok: false, reason: 'hash_mismatch' };
  }
  if (suggestion.wmkf_externaltokenrevoked === true) {
    return { ok: false, reason: 'revoked' };
  }
  // Fail closed on an applicant-"excluded" engagement, even if a token was
  // minted before the row was excluded. This is the single chokepoint for ALL
  // external-reviewer access (context / respond / upload), so guarding here
  // covers every external path in one place. Reported as `revoked` so we don't
  // leak the disposition distinction and callers need no new error state — the
  // reviewer's access is, in effect, withdrawn.
  if (suggestion.wmkf_applicantdisposition === APPLICANT_DISPOSITION_EXCLUDED) {
    return { ok: false, reason: 'revoked' };
  }
  if (suggestion.wmkf_externaltokenexpires) {
    const expires = new Date(suggestion.wmkf_externaltokenexpires).getTime();
    if (Number.isFinite(expires) && expires <= Date.now()) {
      return { ok: false, reason: 'token_expires_passed' };
    }
  }

  const request = suggestion.wmkf_Request;
  const reviewer = suggestion.wmkf_PotentialReviewer;
  if (!request?.akoya_requestid || !request?.akoya_requestnum) {
    return { ok: false, reason: 'not_found' };
  }

  return {
    ok: true,
    payload: verified.payload,
    suggestion,
    request,
    reviewer: reviewer || null,
  };
}
