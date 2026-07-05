/**
 * @jest-environment node
 */

jest.mock('../../lib/utils/auth', () => ({
  requireAppAccess: jest.fn(async () => ({ session: { user: { azureEmail: 'pd@example.org' } } })),
}));
jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: jest.fn((_label, fn) => fn()),
}));
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: {
    getRecord: jest.fn(),
    queryRecords: jest.fn(),
  },
}));
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  __esModule: true,
  findByRequest: jest.fn(),
  findRemovedByRequest: jest.fn(async () => []),
  aggregateReviewHistory: jest.fn(async () => ({})),
  APPLICANT_DISPOSITION_MAP: { recommended: 100000000 },
  RESPONSE_TYPE_BY_VALUE: {},
}));
jest.mock('../../lib/dataverse/adapters/potential-reviewer', () => {
  // queryReviewers is a thin DynamicsService.queryRecords passthrough
  // (data-access-layer conversion, Stages 3-6) — forward through the
  // ALSO-mocked dynamics-service module so the existing entity-keyed stub
  // below keeps working.
  const { DynamicsService } = jest.requireMock('../../lib/services/dynamics-service');
  return {
    queryReviewers: (options) => DynamicsService.queryRecords('wmkf_potentialreviewerses', options),
  };
});
jest.mock('../../lib/dataverse/adapters/researcher', () => ({}));
jest.mock('../../lib/external/token-lifecycle', () => ({
  ensureToken: jest.fn(),
}));

const { DynamicsService } = require('../../lib/services/dynamics-service');
const suggestionAdapter = require('../../lib/dataverse/adapters/reviewer-suggestion');

function mockRes() {
  const res = {};
  res.statusCode = 200;
  res.body = null;
  res.status = jest.fn((c) => { res.statusCode = c; return res; });
  res.json = jest.fn((b) => { res.body = b; return res; });
  return res;
}

describe('my-candidates GET — facultyPageUrl document gate', () => {
  let handler;

  beforeAll(() => {
    handler = require('../../pages/api/reviewer-finder/my-candidates').default;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    DynamicsService.getRecord.mockResolvedValue({
      akoya_requestid: '11111111-1111-1111-1111-111111111111',
      akoya_requestnum: 'R-1',
      akoya_title: 'Request',
    });
    suggestionAdapter.findByRequest.mockResolvedValue([{
      wmkf_appreviewersuggestionid: 'S1',
      _wmkf_request_value: '11111111-1111-1111-1111-111111111111',
      _wmkf_potentialreviewer_value: '22222222-2222-2222-2222-222222222222',
      wmkf_sources: 'literature_retrieved',
      wmkf_selected: true,
    }]);
    DynamicsService.queryRecords.mockImplementation(async (entity) => {
      if (entity === 'wmkf_potentialreviewerses') {
        return { records: [{
          wmkf_potentialreviewersid: '22222222-2222-2222-2222-222222222222',
          wmkf_name: 'Dr X',
          wmkf_facultypageurl: 'https://mit.edu/faculty/example-cv.pdf',
        }] };
      }
      return { records: [] };
    });
  });

  test('document facultyPageUrl is nulled before response render data', async () => {
    const req = {
      method: 'GET',
      query: { requestId: '11111111-1111-1111-1111-111111111111' },
    };
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.proposals[0].candidates[0].facultyPageUrl).toBeNull();
  });
});
