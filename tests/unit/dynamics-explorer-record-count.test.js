/**
 * record_count telemetry for the Dynamics Explorer query log.
 *
 * The old falsy-chain
 * (`records?.length || results?.length || count || searchCount || …`) logged a
 * STRING LENGTH for search, 0 for a successful get_entity, and 0 for every
 * export. That made the failure aggregates untrustworthy for triage — the
 * zero-result bucket was dominated by successes and the errored bucket included
 * legitimate not-founds. These cases pin the corrected semantics.
 */

// chat.js pulls in the whole Dataverse/Graph/Excel/auth chain at import time
// (the auth path reaches ESM-only `jose`, which Jest cannot parse). Stub the
// heavy edges so this stays a unit test of the counting rule.
jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../shared/api/middleware/rateLimiter', () => ({ nextRateLimiter: () => jest.fn() }));
jest.mock('../../lib/services/model-override-loader', () => ({ loadModelOverrides: jest.fn() }));
jest.mock('../../lib/services/llm-client', () => ({ LLMClient: jest.fn() }));
jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));
jest.mock('../../lib/services/dynamics-service', () => ({ DynamicsService: {} }));
jest.mock('../../lib/services/graph-service', () => ({ GraphService: {} }));
jest.mock('../../lib/utils/sharepoint-buckets', () => ({ getRequestSharePointBuckets: jest.fn() }));
jest.mock('../../lib/services/dynamics-explorer-taxonomy', () => ({
  buildResolvedTaxonomyPromptBlock: jest.fn(),
}));
jest.mock('exceljs', () => ({}));

let deriveRecordCount;

beforeAll(async () => {
  ({ deriveRecordCount } = await import('../../pages/api/dynamics-explorer/chat'));
});

describe('deriveRecordCount', () => {
  test('search reports its total, never the length of the formatted string', () => {
    const formatted = '[account] (3 results)\nTexas Tech University\n  ID: a1\n'.repeat(4);
    expect(formatted.length).toBeGreaterThan(100); // the number the old code logged
    expect(deriveRecordCount('search', { totalCount: 3, query: 'Texas Tech', results: formatted })).toBe(3);
  });

  test('search with no hits reports zero', () => {
    expect(deriveRecordCount('search', { totalCount: 0, query: 'x', message: 'No results found.' })).toBe(0);
  });

  test('a successful get_entity reports one record, not zero', () => {
    // getEntity resolves to a BARE record — no records array, no count field.
    const record = { accountid: 'a1', name: 'Texas Tech University', akoya_countofrequests: 12 };
    expect(deriveRecordCount('get_entity', record)).toBe(1);
    expect(deriveRecordCount('get_record', record)).toBe(1);
  });

  test('a not-found is a zero-result answer, not an errored call', () => {
    expect(deriveRecordCount('get_entity', {
      error: 'No account found matching "Nowhere University"',
      _notFound: true,
    })).toBe(0);
  });

  test('a real tool error still reports -1', () => {
    expect(deriveRecordCount('query_records', { error: 'Could not find a property named ...' })).toBe(-1);
  });

  test('a validator rejection reports zero, not an error', () => {
    expect(deriveRecordCount('count_records', { error: 'DENIED: ...', _validatorReject: true })).toBe(0);
  });

  test('export counts are no longer dropped', () => {
    expect(deriveRecordCount('export_csv', { exportedCount: 37, message: 'ok' })).toBe(37);
    expect(deriveRecordCount('export_csv', { estimatedCount: 5000, estimatedCostCents: 100 })).toBe(5000);
    // A zero export is still reported as zero rather than skipped.
    expect(deriveRecordCount('export_csv', { exportedCount: 0, message: 'No records matched.' })).toBe(0);
  });

  test('count_records reports its own count, including zero', () => {
    expect(deriveRecordCount('count_records', { count: 41 })).toBe(41);
    expect(deriveRecordCount('count_records', { count: 0 })).toBe(0);
  });

  test('collection tools report array lengths', () => {
    expect(deriveRecordCount('query_records', { records: [{}, {}], totalCount: 99 })).toBe(2);
    expect(deriveRecordCount('aggregate', { results: [{}, {}, {}], operation: 'sum' })).toBe(3);
  });

  test('relationship tools report their own count fields', () => {
    expect(deriveRecordCount('get_related', { account: 'x', emailCount: 12, emails: 'text' })).toBe(12);
    expect(deriveRecordCount('find_reports_due', { reportCount: 4, reports: 'text' })).toBe(4);
    expect(deriveRecordCount('list_documents', { documentCount: 9 })).toBe(9);
    expect(deriveRecordCount('search_documents', { searchCount: 2 })).toBe(2);
  });

  test('non-object and empty results are zero, never NaN', () => {
    for (const value of [null, undefined, '', 'text', 0]) {
      expect(deriveRecordCount('search', value)).toBe(0);
    }
    expect(deriveRecordCount('describe_table', { table: 'akoya_request', fields: 'a: b' })).toBe(0);
  });
});
