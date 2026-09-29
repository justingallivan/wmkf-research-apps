/**
 * Suggested-reviewer binding runner (docs/plans/TEST_REQUEST_FACTORY_CAST_AND_STATUS_PLAN_2026-09-28.md,
 * Design B, third bullet): attaches the production synthetic cast's suggested
 * reviewer to a ready production test Request as one applicant-recommended
 * `wmkf_appreviewersuggestion`, owner-run through the CLI, one per run.
 *
 * Factory-only by design. The ordinary suggestion adapter
 * (`lib/dataverse/adapters/reviewer-suggestion.js` `assertPersonBindable`)
 * refuses a synthetic person under `SYNTHETIC_REVIEWER_ISOLATION=on`, so this
 * module writes through the injected raw client instead, wrapped by
 * `fenceCastBindingClient`, which admits exactly one POST: the preallocated
 * suggestion, bound to the journaled cast person and this run's destination
 * Request. `tests/unit/test-request-cast-binding-boundary.test.js` pins that
 * nothing outside the Factory imports it.
 *
 * Order: every read and refusal before any ledger write (run, Request marker,
 * cast member, live person, existing suggestion for the pair) → preallocate
 * the suggestion GUID → journal it (`planned`) → mark `dispatched` → POST →
 * read back by GUID → `verified`, or `needs_attention`. A binding left
 * `dispatched` is recovered by reading its GUID, never by re-POSTing. A
 * binding left `planned` was never sent (the dispatch mark precedes the
 * POST), so it is dispatched once, as its first POST.
 */
import crypto from 'node:crypto';
import { APPLICANT_DISPOSITION_MAP } from '../../../shared/config/reviewerLifecycle.js';
import { meetingDateToCycleCode } from '../../utils/cycle-code.js';
import { bodyOrThrow, guidEqual } from './basic-clone-steps.js';
import { fenceCastBindingClient } from './production-write-fence.js';

export const CAST_SUGGESTION_LABEL = 'Applicant recommendation (test Request cast)';
const SUGGESTION_SET = '/wmkf_appreviewersuggestions';
const SUGGESTION_SELECT = [
  'wmkf_appreviewersuggestionid', '_wmkf_potentialreviewer_value', '_wmkf_request_value',
  'wmkf_applicantdisposition', 'wmkf_selected', 'statecode',
].join(',');
const ACTIVE = 0;

function refusal(message, code = 'cast_binding_refused') {
  return Object.assign(new Error(message), { code });
}

async function readRequest(client, requestId) {
  const select = ['akoya_requestid', 'wmkf_istestrequest', 'wmkf_testcreationrunid', 'wmkf_meetingdate'].join(',');
  const row = bodyOrThrow('Request read', await client.get(`/akoya_requests(${requestId})?$select=${select}`));
  if (!guidEqual(row.akoya_requestid, requestId)) throw refusal('Request read returned a different row.');
  return row;
}

async function readPerson(client, personId) {
  const select = ['wmkf_potentialreviewersid', 'statecode', 'wmkf_issyntheticreviewer'].join(',');
  const row = bodyOrThrow('cast person read', await client.get(`/wmkf_potentialreviewerses(${personId})?$select=${select}`));
  if (!guidEqual(row.wmkf_potentialreviewersid, personId)) throw refusal('Cast person read returned a different row.');
  return row;
}

/** The suggestion at the preallocated GUID, or null when Dataverse says 404. Any other failure throws. */
export async function readSuggestionById(client, bindingId) {
  const response = await client.get(`${SUGGESTION_SET}(${bindingId})?$select=${SUGGESTION_SELECT}`);
  if (response?.status === 404) return null;
  return bodyOrThrow('suggestion readback', response);
}

async function listPairSuggestions(client, personId, requestId) {
  const filter = `_wmkf_potentialreviewer_value eq ${personId} and _wmkf_request_value eq ${requestId}`;
  const response = await client.get(`${SUGGESTION_SET}?$select=${SUGGESTION_SELECT}&$filter=${encodeURIComponent(filter)}&$top=10`);
  return bodyOrThrow('existing suggestion read', response).value || [];
}

/** The one create body, in the applicant intake shape (reviewer-suggestion.js ensureApplicantRecommended). */
export function buildCastSuggestionBody({ bindingId, personId, requestId, meetingDate }) {
  const body = { wmkf_appreviewersuggestionid: bindingId, wmkf_suggestionlabel: CAST_SUGGESTION_LABEL };
  const cycle = meetingDate ? meetingDateToCycleCode(meetingDate) : null;
  if (cycle) body.wmkf_grantcyclecode = cycle.toUpperCase();
  body.wmkf_sources = 'applicant';
  body.wmkf_selected = false;
  body.wmkf_applicantdisposition = APPLICANT_DISPOSITION_MAP.recommended;
  body['wmkf_PotentialReviewer@odata.bind'] = `/wmkf_potentialreviewerses(${personId})`;
  body['wmkf_Request@odata.bind'] = `/akoya_requests(${requestId})`;
  return body;
}

/** Why a read-back suggestion is not the binding this run wanted, or null when it is. */
export function bindingMismatch(row, { bindingId, personId, requestId }) {
  if (!guidEqual(row?.wmkf_appreviewersuggestionid, bindingId)) return 'the readback is a different suggestion';
  if (!guidEqual(row._wmkf_potentialreviewer_value, personId)) return 'the suggestion is not bound to the cast person';
  if (!guidEqual(row._wmkf_request_value, requestId)) return 'the suggestion is not bound to the destination Request';
  if (row.wmkf_applicantdisposition !== APPLICANT_DISPOSITION_MAP.recommended) return 'the suggestion is not applicant-recommended';
  if (row.wmkf_selected !== false) return 'the suggestion is not unselected';
  if (row.statecode !== undefined && row.statecode !== ACTIVE) return 'the suggestion is not active';
  return null;
}

/** Refusals that need no ledger write: the run, its Request, the cast person and the pair. */
async function assertBindable({ client, ledger, runId }) {
  const run = await ledger.getRun(runId);
  if (!run) throw refusal('No test request run with that ID.');
  if (run.destinationEnvironment !== 'production') throw refusal('The cast binding runs only on production test Requests.');
  if (run.status !== 'ready') throw refusal(`Run is ${run.status}; only a ready run's Request can take the cast suggestion.`);
  const request = await readRequest(client, run.destinationRequestId);
  if (request.wmkf_istestrequest !== true || !guidEqual(request.wmkf_testcreationrunid, run.runId)) {
    throw refusal('The Request does not carry this run\'s test marker.');
  }
  const member = (await ledger.listCastMembers({ environment: 'production' })).find((m) => m.role === 'suggested_reviewer');
  if (!member) throw refusal('The production cast has no suggested reviewer.');
  if (member.status !== 'verified') throw refusal(`The cast suggested reviewer is ${member.status}; only a verified member can be bound.`);
  const person = await readPerson(client, member.memberId);
  if (person.statecode !== ACTIVE) throw refusal('The cast suggested reviewer is not active.');
  if (person.wmkf_issyntheticreviewer !== true) throw refusal('The cast suggested reviewer does not carry the synthetic reviewer marker.');
  return { run, request, member };
}

function receipt({ bindingId, personId, requestId, recovered }) {
  return { kind: 'cast_binding', suggestionId: bindingId, destinationPersonId: personId, requestId, recovered };
}

async function stop(ledger, bindingId, error, code = 'cast_binding_needs_attention') {
  await ledger.markCastBindingNeedsAttention({ bindingId, error });
  throw refusal(`Cast binding needs attention: ${error}.`, code);
}

/** Read the preallocated GUID and settle the dispatched binding: verified, or needs_attention. */
async function settle({ client, ledger, ids, recovered, postError = null }) {
  const row = await readSuggestionById(client, ids.bindingId);
  if (!row) {
    const detail = postError ? `the POST failed (${postError}) and` : 'a prior POST may have been sent but';
    return stop(ledger, ids.bindingId, `${detail} the suggestion is not readable at its preallocated GUID; resolve manually, never re-POST`, 'cast_binding_ambiguous');
  }
  const mismatch = bindingMismatch(row, ids);
  if (mismatch) return stop(ledger, ids.bindingId, mismatch);
  const verified = await ledger.markCastBindingVerified({ bindingId: ids.bindingId, readback: receipt({ ...ids, recovered }) });
  if (!verified) throw refusal('The ledger refused to mark the binding verified (it was not dispatched).');
  return { bindingId: ids.bindingId, status: 'verified', recovered };
}

async function dispatch({ client, ledger, run, request, ids }) {
  // Build the body before the dispatch mark, so a read failure leaves nothing dispatched.
  const body = buildCastSuggestionBody({ ...ids, meetingDate: request.wmkf_meetingdate });
  const fenced = fenceCastBindingClient(client, {
    bindingId: ids.bindingId, personId: ids.personId, destinationRequestId: run.destinationRequestId, sourceRequestId: run.sourceRequestId,
    label: CAST_SUGGESTION_LABEL,
  });
  if (!(await ledger.markCastBindingDispatched({ bindingId: ids.bindingId }))) {
    throw refusal('The ledger refused to mark the binding dispatched; nothing was sent.');
  }
  let postError = null;
  let recovered = false;
  try {
    const response = await fenced.post(SUGGESTION_SET, body);
    if (!response?.ok) {
      postError = `status ${response?.status ?? 'none'}`;
      recovered = true;
    }
  } catch (error) {
    postError = error?.message || 'no readable result';
    recovered = true;
  }
  return settle({ client, ledger, ids, recovered, postError });
}

/**
 * Bind the production cast's suggested reviewer to the run's destination
 * Request, or resume / report the run's existing binding.
 *
 * @param {{ client: object, ledger: object, runId: string }} input
 *   `client`: lib/dataverse/client.js instance bound to production;
 *   `ledger`: createRunLedger(db).
 * @returns {Promise<{ bindingId: string, status: 'verified', recovered: boolean, alreadyVerified?: boolean }>}
 */
export async function runCastBinding({ client, ledger, runId }) {
  const { run, request, member } = await assertBindable({ client, ledger, runId });
  const personId = member.memberId;
  const ids = { personId, requestId: run.destinationRequestId };
  const existing = await ledger.getCastBinding({ runId: run.runId, memberId: personId });

  if (existing?.status === 'verified') {
    return { bindingId: existing.bindingId, status: 'verified', recovered: false, alreadyVerified: true };
  }
  if (existing?.status === 'needs_attention') {
    throw refusal(`This run's cast binding needs attention (${existing.error || 'no detail'}); inspect it.`, 'cast_binding_needs_attention');
  }
  const foreign = (await listPairSuggestions(client, personId, run.destinationRequestId))
    .filter((row) => !guidEqual(row.wmkf_appreviewersuggestionid, existing?.bindingId));
  if (foreign.length) {
    throw refusal('A suggestion for the cast person on this Request exists that this run did not journal; refusing to adopt it.', 'cast_binding_present_not_owned');
  }

  if (existing?.status === 'dispatched') {
    return settle({ client, ledger, ids: { ...ids, bindingId: existing.bindingId }, recovered: true });
  }
  if (existing?.status === 'planned') {
    // Planned is journaled before the dispatch mark, which precedes the POST:
    // nothing was sent. A row already at the GUID was written by someone else.
    if (await readSuggestionById(client, existing.bindingId)) {
      return stop(ledger, existing.bindingId, 'a planned binding\'s GUID already holds a suggestion this run never sent');
    }
    return dispatch({ client, ledger, run, request, ids: { ...ids, bindingId: existing.bindingId } });
  }
  if (existing) throw refusal(`This run's cast binding is ${existing.status}.`);

  const planned = await ledger.planCastBinding({ bindingId: crypto.randomUUID(), runId: run.runId, memberId: personId });
  return dispatch({ client, ledger, run, request, ids: { ...ids, bindingId: planned.bindingId } });
}
