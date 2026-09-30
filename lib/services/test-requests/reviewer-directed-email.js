/** Exact, server-read binding for reviewer-directed mail about a test Request. */
import { isGuid } from '../../utils/guid.js';
import * as suggestions from '../../dataverse/adapters/reviewer-suggestion.js';
import * as people from '../../dataverse/adapters/potential-reviewer.js';
import { normalizeAddress } from './email-allowlist.js';
import { assertRequestEmailAllowed, resolveRequestTestState } from './request-test-state.js';
import { testRequestIsolationEnabled, syntheticReviewerIsolationEnabled } from './isolation.js';

function refuse() {
  throw Object.assign(new Error('Reviewer email refused: the test Request, suggestion, person and recipient do not form a verified binding.'), {
    code: 'test_request_reviewer_email_unbound', status: 409,
  });
}

function sameGuid(a, b) {
  return isGuid(a) && isGuid(b) && a.toLowerCase() === b.toLowerCase();
}

/** Called by reviewer-directed paths before token/claim writes and again at dispatch. */
export async function assertReviewerDirectedEmailBound({
  suggestionId, requestId, recipients,
  env = process.env,
  resolveState = resolveRequestTestState,
  getSuggestion = suggestions.findById,
  getPerson = people.getById,
  assertAllowlisted = assertRequestEmailAllowed,
} = {}) {
  try {
    if (!testRequestIsolationEnabled(env)) {
      await assertAllowlisted(requestId, { recipients, env });
      return { kind: 'ordinary_or_switch_off' };
    }
    if (!isGuid(requestId) || !isGuid(suggestionId)) refuse();
    const state = await resolveState(requestId);
    if (state.kind === 'ordinary') {
      await assertAllowlisted(requestId, { recipients, env });
      const finalState = await resolveState(requestId);
      if (finalState.kind !== 'ordinary') refuse();
      return state;
    }
    if (state.kind !== 'synthetic' || !isGuid(state.runId) || !syntheticReviewerIsolationEnabled(env)) refuse();
    const suggestion = await getSuggestion(suggestionId);
    if (!sameGuid(suggestion?.wmkf_appreviewersuggestionid, suggestionId)
      || !sameGuid(suggestion?._wmkf_request_value, requestId)
      || !isGuid(suggestion?._wmkf_potentialreviewer_value)) refuse();
    const personId = suggestion._wmkf_potentialreviewer_value;
    const person = await getPerson(personId);
    if (!sameGuid(person?.wmkf_potentialreviewersid, personId)
      || person?.wmkf_issyntheticreviewer !== true
      || (person.statecode !== undefined && person.statecode !== 0)) refuse();
    const stored = normalizeAddress(person.wmkf_emailaddress);
    if (!stored || !Array.isArray(recipients) || !recipients.length
      || recipients.some((recipient) => normalizeAddress(recipient) !== stored)) refuse();
    await assertAllowlisted(requestId, { recipients, env });
    const finalState = await resolveState(requestId);
    if (finalState.kind !== 'synthetic' || !sameGuid(finalState.runId, state.runId)) refuse();
    return state;
  } catch (error) {
    // This helper runs before the transport. A refusal or failed proof cannot
    // have dispatched a message, even if its caller already minted a token.
    if (error && typeof error === 'object') error.dispatched = false;
    throw error;
  }
}
