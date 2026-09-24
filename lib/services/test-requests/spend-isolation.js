import { isGuid } from '../../utils/guid.js';
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import {
  TEST_REQUEST_ISOLATION_FIELDS,
  classifyTestRequestSnapshot,
  testRequestIsolationEnabled,
} from './isolation.js';

const number = (value) => Number(value || 0);
const requestKey = (row) => String(row.request_id ?? '').trim().toLowerCase();
const CLASSIFY_CHUNK_SIZE = 50;
const CLASSIFY_SELECT = Object.freeze([
  'akoya_requestid',
  TEST_REQUEST_ISOLATION_FIELDS.marker,
  TEST_REQUEST_ISOLATION_FIELDS.runId,
]);

/**
 * Batch-classify Request IDs. Returns a Map of lowercased ID → kind; an ID
 * that is not a GUID, is missing from the read, or sits in a failed chunk
 * is 'unknown'.
 */
async function classifyRequestIds(ids, findByIds) {
  const kinds = new Map();
  const readable = [];
  for (const id of ids) {
    if (isGuid(id)) readable.push(id);
    else kinds.set(id, 'unknown');
  }
  for (let index = 0; index < readable.length; index += CLASSIFY_CHUNK_SIZE) {
    const chunk = readable.slice(index, index + CLASSIFY_CHUNK_SIZE);
    let records = [];
    try {
      ({ records = [] } = await findByIds(chunk, { select: [...CLASSIFY_SELECT], top: chunk.length }));
    } catch {
      records = [];
    }
    const byId = new Map(records.map((row) => [String(row.akoya_requestid).toLowerCase(), row]));
    for (const id of chunk) {
      const row = byId.get(id);
      kinds.set(id, row ? classifyTestRequestSnapshot(row).kind : 'unknown');
    }
  }
  return kinds;
}

/**
 * Separate pre-aggregated review-panel spend groups into ordinary rows and a
 * single test-request spend line, by their trusted Request ID. Reporting use
 * only (admin usage dashboard); the spend-check alarm counts all spend.
 *
 * If any request cannot be classified, nothing is removed: the caller gets
 * every row back with `isolation.available: false`, so totals are never
 * silently short.
 */
export async function excludeTestRequestSpendRows(
  rows,
  { env = process.env, findByIds = grantRequestAdapter.findByIds } = {},
) {
  if (!testRequestIsolationEnabled(env)) return { rows, isolation: null };
  const all = rows || [];
  const ids = [...new Set(all.map(requestKey))];
  const kinds = await classifyRequestIds(ids, findByIds);

  const testStateUnknown = ids.filter((id) => kinds.get(id) === 'unknown').length;
  if (testStateUnknown > 0) {
    return { rows: all, isolation: { available: false, testStateUnknown } };
  }

  const included = [];
  const testSpend = { attemptCount: 0, knownCostCents: 0, unknownCount: 0 };
  for (const row of all) {
    if (kinds.get(requestKey(row)) === 'ordinary') {
      included.push(row);
      continue;
    }
    testSpend.attemptCount += number(row.attempt_count);
    testSpend.knownCostCents += number(row.known_cost_cents);
    testSpend.unknownCount += number(row.unknown_count);
  }
  return { rows: included, isolation: { available: true, testSpend } };
}
