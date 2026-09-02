// @ts-check
/**
 * Authoritative lead-PD/superuser gate for request-bound reviewer mutations.
 *
 * A route supplies only session-derived actor/profile identity plus validated
 * request or suggestion ids. Suggestion ownership is resolved server-side;
 * no client-supplied request/PD relationship is trusted. Batch callers invoke
 * this once before their first write or email so authorization is all-or-none.
 */

import { getUserRole } from '../utils/auth';
import { isGuid } from '../utils/guid';
import * as grantRequestAdapter from '../dataverse/adapters/grant-request.js';
import * as suggestionAdapter from '../dataverse/adapters/reviewer-suggestion.js';
import { ServiceHttpError } from './service-http-error';
import { chunk as chunked } from '../utils/chunk.js';

/** @typedef {import('../utils/actor-ref.js').ActorRef} ActorRef */

const REQUEST_SELECT = 'akoya_requestid,_wmkf_programdirector_value';
const SUGGESTION_SELECT = 'wmkf_appreviewersuggestionid,_wmkf_request_value';
const AUTH_READ_CHUNK_SIZE = 40;

function normalizedIds(values) {
  return [...new Set((values || []).map((value) => String(value).trim().toLowerCase()))];
}

function assertGuids(ids, kind) {
  if (ids.some((id) => !isGuid(id))) {
    throw new ServiceHttpError(`${kind} must all be valid GUIDs.`, { httpStatus: 400 });
  }
}

/**
 * @param {Object} args
 * @param {string|number|null} args.profileId
 * @param {ActorRef|null} args.callerSystemId
 * @param {string[]} [args.requestIds]
 * @param {string[]} [args.suggestionIds]
 * @returns {Promise<{ requestIds: string[], isSuperuser: boolean }>}
 */
export async function authorizeReviewerRequestMutation({
  profileId,
  callerSystemId,
  requestIds = [],
  suggestionIds = [],
}) {
  const directRequestIds = normalizedIds(requestIds);
  const targetSuggestionIds = normalizedIds(suggestionIds);
  assertGuids(directRequestIds, 'requestIds');
  assertGuids(targetSuggestionIds, 'suggestionIds');

  const isSuperuser = (await getUserRole(/** @type {any} */ (profileId))) === 'superuser';
  const resolvedRequestIds = new Set(directRequestIds);

  if (targetSuggestionIds.length > 0) {
    let suggestionResults;
    try {
      suggestionResults = await Promise.all(chunked(targetSuggestionIds, AUTH_READ_CHUNK_SIZE).map((ids) => (
        suggestionAdapter.queryAllSuggestions({
          select: SUGGESTION_SELECT,
          filter: ids.map((id) => `wmkf_appreviewersuggestionid eq ${id}`).join(' or '),
          orderby: 'wmkf_appreviewersuggestionid asc',
        })
      )));
    } catch {
      throw new ServiceHttpError('Reviewer ownership could not be verified.', { httpStatus: 502 });
    }
    if (suggestionResults.some((result) => result.capped)) {
      throw new ServiceHttpError('Reviewer ownership could not be verified completely.', { httpStatus: 503 });
    }

    const suggestionRows = suggestionResults.flatMap((result) => result.records || []);
    const rowById = new Map(suggestionRows.map((row) => [
      String(row.wmkf_appreviewersuggestionid || '').toLowerCase(),
      row,
    ]));
    for (const suggestionId of targetSuggestionIds) {
      const requestId = rowById.get(suggestionId)?._wmkf_request_value;
      if (!requestId) {
        throw new ServiceHttpError('Reviewer suggestion was not found.', { httpStatus: 404 });
      }
      resolvedRequestIds.add(String(requestId).toLowerCase());
    }
  }

  const allRequestIds = [...resolvedRequestIds];
  if (allRequestIds.length === 0) {
    throw new ServiceHttpError('A request-bound reviewer target is required.', { httpStatus: 400 });
  }
  assertGuids(allRequestIds, 'requestIds');

  let requestResults;
  try {
    requestResults = await Promise.all(chunked(allRequestIds, AUTH_READ_CHUNK_SIZE).map((ids) => (
      grantRequestAdapter.findByIds(ids, { select: REQUEST_SELECT })
    )));
  } catch {
    throw new ServiceHttpError('Request ownership could not be verified.', { httpStatus: 502 });
  }
  const requestRows = requestResults.flatMap((result) => result.records || []);
  const requestById = new Map(requestRows.map((row) => [
    String(row.akoya_requestid || '').toLowerCase(),
    row,
  ]));

  for (const requestId of allRequestIds) {
    const request = requestById.get(requestId);
    if (!request) {
      throw new ServiceHttpError('Request was not found.', { httpStatus: 404 });
    }
    if (!isSuperuser) {
      const leadPd = request._wmkf_programdirector_value;
      const isLeadPd = Boolean(leadPd && callerSystemId
        && String(leadPd).toLowerCase() === String(callerSystemId).toLowerCase());
      if (!isLeadPd) {
        throw new ServiceHttpError(
          'Only the lead Program Director (or a superuser) can manage reviewer activity for this request.',
          { httpStatus: 403 },
        );
      }
    }
  }

  return { requestIds: allRequestIds, isSuperuser };
}
