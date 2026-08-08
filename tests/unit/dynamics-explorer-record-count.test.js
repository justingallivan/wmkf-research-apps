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
  });

  // Relationship handlers return the SPECIFIC count of what was asked for and
  // usually a totalCount of everything matching in Dataverse. For these tools,
  // record_count means target rows returned, so the specific field must win.
  // These fixtures carry every field the real handler returns — an earlier
  // version omitted totalCount and therefore could not detect the precedence
  // bug at all.
  describe('relationship handlers prefer the target count over totalCount', () => {
    test('account -> emails counts emails, not the requests scanned to find them', () => {
      // handleAccountEmails returns requestCount (context) AND emailCount (target).
      expect(deriveRecordCount('get_related', {
        account: 'Texas Tech University',
        requestCount: 40,
        emailCount: 12,
        totalEmailCount: 300,
        hasMore: true,
        emails: 'formatted text',
      })).toBe(12);
    });

    test('account -> requests counts requests when that IS the target', () => {
      expect(deriveRecordCount('get_related', {
        account: 'x', requestCount: 7, totalCount: 250, hasMore: true,
        header: 'Request# | ...', requests: 'formatted text',
      })).toBe(7);
    });

    test('account -> payments counts returned payments, not total matches', () => {
      expect(deriveRecordCount('get_related', {
        account: 'x', paymentCount: 5, totalCount: 99, payments: 'formatted text',
      })).toBe(5);
    });

    test('request -> annotations uses annotationCount', () => {
      // annotationCount was missing from the field list entirely.
      // totalCount deliberately DIFFERS from annotationCount — equal values
      // would pass under either precedence and prove nothing.
      expect(deriveRecordCount('get_related', {
        annotationCount: 3, totalCount: 12, annotations: 'formatted text',
      })).toBe(3);
    });

    test('request -> reviewers uses reviewerCount and no longer reports zero', () => {
      // handleRequestReviewers returns ONLY reviewerCount — no totalCount, no
      // records array — so an omission here logged 0 on every success.
      expect(deriveRecordCount('get_related', {
        reviewerCount: 4, reviewers: 'formatted text',
      })).toBe(4);
    });

    test('find_reports_due counts reports, not total matches', () => {
      expect(deriveRecordCount('find_reports_due', {
        reportCount: 6, totalCount: 41, reports: 'formatted text',
      })).toBe(6);
    });
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

  test('export counts are no longer dropped, and beat totalCount when capped', () => {
    // A completed export returns BOTH exportedCount and totalCount; a capped or
    // trimmed export makes them differ, and the exported figure is the truth.
    expect(deriveRecordCount('export_csv', { exportedCount: 37, totalCount: 37, message: 'ok' })).toBe(37);
    expect(deriveRecordCount('export_csv', { exportedCount: 5000, totalCount: 12000, message: 'capped' })).toBe(5000);
    expect(deriveRecordCount('export_csv', { estimatedCount: 5000, estimatedCostCents: 100 })).toBe(5000);
    // A zero export is still reported as zero rather than skipped.
    expect(deriveRecordCount('export_csv', { exportedCount: 0, message: 'No records matched.' })).toBe(0);
  });

  test('describe_table reports one schema on success in either mode', () => {
    // List mode carries a real count of annotated tables.
    expect(deriveRecordCount('describe_table', { tables: 'a\nb\nc', count: 3, note: '...' })).toBe(3);
    // Detail mode has NO count field — additionalLiveFieldCount is a field
    // tally, not a result count, and must not be mistaken for one. Reporting 0
    // here filed a successful schema lookup under "zero results".
    expect(deriveRecordCount('describe_table', {
      table: 'akoya_request',
      entitySet: 'akoya_requests',
      description: 'Requests',
      fields: 'akoya_requestnum: string',
      rules: '',
      additionalLiveFieldCount: 87,
    })).toBe(1);
  });

  test('count_records reports its own count, including zero', () => {
    expect(deriveRecordCount('count_records', { count: 41 })).toBe(41);
    expect(deriveRecordCount('count_records', { count: 0 })).toBe(0);
  });

  test('collection tools report array lengths', () => {
    expect(deriveRecordCount('query_records', { records: [{}, {}], totalCount: 99 })).toBe(2);
    expect(deriveRecordCount('aggregate', { results: [{}, {}, {}], operation: 'sum' })).toBe(3);
  });

  test('document tools report their own count fields', () => {
    expect(deriveRecordCount('list_documents', { requestNumber: 'REQ-1', documentCount: 9 })).toBe(9);
    expect(deriveRecordCount('search_documents', { searchCount: 2 })).toBe(2);
  });

  test('a not-found source in a document tool is a zero-result, not an error', () => {
    // listDocuments/searchDocuments resolve the request first; that resolution
    // previously dropped the marker, so an unresolvable request logged -1.
    expect(deriveRecordCount('list_documents', {
      error: 'No request found matching "REQ-nope"', _notFound: true,
    })).toBe(0);
    expect(deriveRecordCount('search_documents', {
      error: 'No request found matching "REQ-nope"', _notFound: true,
    })).toBe(0);
    // A genuine failure in the same tool still reports -1.
    expect(deriveRecordCount('list_documents', {
      error: 'Either request_number or request_id is required.',
    })).toBe(-1);
  });

  test('non-object and empty results are zero, never NaN', () => {
    for (const value of [null, undefined, '', 'text', 0]) {
      expect(deriveRecordCount('search', value)).toBe(0);
    }
    // An unrecognized tool with no count field is still zero, not NaN.
    expect(Number.isFinite(deriveRecordCount('some_future_tool', { foo: 'bar' }))).toBe(true);
    expect(deriveRecordCount('some_future_tool', { foo: 'bar' })).toBe(0);
  });
});
