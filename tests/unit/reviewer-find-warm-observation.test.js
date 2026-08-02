jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));

const { sql } = require('@vercel/postgres');
const {
  EFFECT_CLASSES,
  OBSERVATION_HEADER,
  POST_AUTH_SCOPE,
  REVIEWER_FIND_WARM_REACHABILITY_INVENTORY,
  observationFromRequest,
  observeReviewerFindWarmEffect,
  reviewerFindWarmObservationSummary,
  withReviewerFindWarmObservation,
} = require('../../lib/services/workbench/reviewer-find-warm-observation');
const { listForRequest } = require('../../lib/services/reviewer-roster-store');
const { getRecord, queryAllRecords, queryRecords } = require('../../lib/services/dynamics/read-ops');
const { GraphService } = require('../../lib/services/graph-service');

const OBSERVATION_ID = 'rfw_0123456789abcdef0123456789abcdef';

function response({ status = 200, body = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function serviceStub() {
  return {
    resolveLogicalName: jest.fn((value) => value),
    checkRestriction: jest.fn(),
    getAccessToken: jest.fn().mockResolvedValue('token'),
    buildHeaders: jest.fn(() => ({ Authorization: 'Bearer token' })),
    processAnnotations: jest.fn((value) => value),
  };
}

function effectEvents(logSpy) {
  return logSpy.mock.calls
    .filter(([label]) => label === 'reviewer-find-warm-observation')
    .map(([, event]) => event);
}

describe('Reviewer Find warm observation', () => {
  let logSpy;

  beforeEach(() => {
    sql.mockReset();
    global.fetch = jest.fn();
    logSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    global.fetch = jest.fn();
  });

  test('recognizes only a bounded, single-valued correlation header on warm GET modes', () => {
    expect(POST_AUTH_SCOPE).toBe('authenticated_reviewer_roster_cached_or_reconciled_get');
    expect(observationFromRequest({
      method: 'GET',
      query: { mode: 'cached' },
      headers: { [OBSERVATION_HEADER]: OBSERVATION_ID },
    })).toEqual({
      observationId: OBSERVATION_ID,
      route: 'reviewer_roster',
      mode: 'cached',
    });
    expect(observationFromRequest({
      method: 'GET',
      query: { mode: 'cached' },
      headers: { [OBSERVATION_HEADER]: 'not-a-valid-observation' },
    })).toBeNull();
    expect(observationFromRequest({
      method: 'GET',
      query: { mode: ['cached', 'reconciled'] },
      headers: { [OBSERVATION_HEADER]: OBSERVATION_ID },
    })).toBeNull();
    expect(observationFromRequest({
      method: 'PATCH',
      query: { mode: 'cached' },
      headers: { [OBSERVATION_HEADER]: OBSERVATION_ID },
    })).toBeNull();
  });

  test('is behavior-neutral and silent without a valid observation ID', async () => {
    sql.mockResolvedValue({ rows: [] });
    const result = await withReviewerFindWarmObservation({
      observationId: 'malformed',
      route: 'reviewer_roster',
      mode: 'cached',
    }, () => listForRequest('00000000-0000-0000-0000-000000000001'));

    expect(result).toEqual({ active: [], excluded: [], ineligible: [], blocked: [], savedKeys: [], allNames: [] });
    expect(sql).toHaveBeenCalledTimes(1);
    expect(effectEvents(logSpy)).toEqual([]);
  });

  test('marks an instrumentation failure incomplete without changing the wrapped result', async () => {
    let effectAttempted = false;
    logSpy.mockImplementation((label, event) => {
      if (label === 'reviewer-find-warm-observation' && event?.event === 'effect') {
        effectAttempted = true;
        throw new Error('test log sink failure');
      }
      return undefined;
    });

    const result = await withReviewerFindWarmObservation({
      observationId: OBSERVATION_ID,
      route: 'reviewer_roster',
      mode: 'cached',
    }, async () => {
      const value = await observeReviewerFindWarmEffect({
        effectClass: 'postgres_read',
        operation: 'reviewer_roster_list',
      }, async () => 'product-result');
      return { value, summary: reviewerFindWarmObservationSummary() };
    });

    expect(effectAttempted).toBe(true);
    expect(result.value).toBe('product-result');
    expect(result.summary.complete).toBe(false);
    expect(result.summary.instrumentationFailures).toBeGreaterThan(0);
  });

  test('positive controls observe every current reachable warm chokepoint', async () => {
    sql.mockResolvedValue({ rows: [] });
    global.fetch
      .mockResolvedValueOnce(response({ body: { value: [] } }))
      .mockResolvedValueOnce(response({ body: { value: [] } }))
      .mockResolvedValueOnce(response({ body: { value: [] } }))
      .mockResolvedValueOnce(response({ body: { value: [] } }));

    const getSiteId = jest.spyOn(GraphService, 'getSiteId').mockResolvedValue('site');
    const getDriveId = jest.spyOn(GraphService, 'getDriveId').mockResolvedValue('drive');
    const getAccessToken = jest.spyOn(GraphService, 'getAccessToken').mockResolvedValue('graph-token');
    const buildHeaders = jest.spyOn(GraphService, 'buildHeaders').mockReturnValue({ Authorization: 'Bearer graph-token' });
    global.fetch.mockResolvedValueOnce(response({ body: {
      id: 'item', name: 'Proposal.pdf', size: 1, eTag: 'etag', lastModifiedDateTime: '2026-01-01T00:00:00.000Z', file: {},
    } }));

    const service = serviceStub();
    const result = await withReviewerFindWarmObservation({
      observationId: OBSERVATION_ID,
      route: 'reviewer_roster',
      mode: 'reconciled',
    }, async () => {
      await listForRequest('00000000-0000-0000-0000-000000000001');
      await queryRecords(service, 'sharepointdocumentlocations', { filter: 'x eq y', top: 1 });
      await getRecord(service, 'akoya_requests', '00000000-0000-0000-0000-000000000001', { select: 'akoya_requestid' });
      await queryAllRecords(service, 'wmkf_appreviewersuggestions', { filter: 'x eq y' });
      await GraphService.getFileMetadataByPath('akoya_request', 'Reviewer Materials', 'Proposal.pdf');
      return reviewerFindWarmObservationSummary();
    });

    expect(result.complete).toBe(true);
    const observed = effectEvents(logSpy)
      .filter((event) => event.event === 'effect' && event.reasonCode === 'completed')
      .map((event) => `${event.effectClass}:${event.operation}`);
    expect(observed).toEqual(expect.arrayContaining([
      'postgres_read:reviewer_roster_list',
      'dataverse_read:dataverse_query_records',
      'dataverse_read:dataverse_get_record',
      'dataverse_read:dataverse_query_all_records',
      'graph_metadata:graph_file_metadata_by_path',
    ]));
    expect(getSiteId).toHaveBeenCalledTimes(1);
    expect(getDriveId).toHaveBeenCalledTimes(1);
    expect(getAccessToken).toHaveBeenCalledTimes(1);
    expect(buildHeaders).toHaveBeenCalledTimes(1);
  });

  test('the inventory is total and every reachable entry names an instrumented source marker', () => {
    expect(new Set(REVIEWER_FIND_WARM_REACHABILITY_INVENTORY.map((entry) => entry.effectClass)))
      .toEqual(new Set(EFFECT_CLASSES));
    for (const entry of REVIEWER_FIND_WARM_REACHABILITY_INVENTORY) {
      if (entry.reachable) {
        expect(entry.chokepoint).toEqual(expect.any(String));
        expect(entry.marker).toEqual(expect.any(String));
      } else {
        expect(entry.nonReachabilityReason).toEqual(expect.any(String));
      }
    }
  });
});
