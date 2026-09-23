/**
 * Server-side test-request state for one Grant Request.
 *
 * Reads only the marker and run ID for a request GUID and classifies them with
 * the pure isolation policy. Any failure to read (invalid ID, missing row,
 * unselectable field, transport error) returns `unknown`, so callers fail
 * closed; callers decide what `unknown` blocks. This establishes no actor
 * authorization and never accepts a caller-supplied classification.
 */

import { isGuid } from '../../utils/guid.js';
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import { TEST_REQUEST_ISOLATION_FIELDS, classifyTestRequestSnapshot } from './isolation.js';

const TEST_STATE_SELECT = Object.freeze([
  TEST_REQUEST_ISOLATION_FIELDS.marker,
  TEST_REQUEST_ISOLATION_FIELDS.runId,
]);

export async function resolveRequestTestState(
  requestId,
  { getRequestById = grantRequestAdapter.getById } = {},
) {
  if (!isGuid(requestId)) return { kind: 'unknown', reason: 'request_id_invalid' };
  let row;
  try {
    row = await getRequestById(requestId.trim(), { select: [...TEST_STATE_SELECT] });
  } catch (error) {
    return { kind: 'unknown', reason: error?.status === 404 ? 'request_not_found' : 'read_failed' };
  }
  return classifyTestRequestSnapshot(row);
}
