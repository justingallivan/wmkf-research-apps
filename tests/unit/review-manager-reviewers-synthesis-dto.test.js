/**
 * GET /api/review-manager/reviewers — stored AI review synthesis projection
 * (workbench Reviews tab Phase 4, docs/WORKBENCH_REVIEWS_TAB_BUILDOUT_PLAN.md).
 *
 * Verifies `proposal.reviewSynthesis` is parsed fail-soft from
 * `wmkf_reviewsynthesisjson`: valid JSON parses to an object, missing/null/
 * malformed JSON degrades to null rather than throwing/500ing.
 */

import { createMockReq, createMockRes } from '../helpers/auth-mock';
import { requireAppAccess } from '../../lib/utils/auth';
import { DynamicsService } from '../../lib/services/dynamics-service';
import * as suggestionAdapter from '../../lib/dataverse/adapters/reviewer-suggestion';

jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: jest.fn((_label, fn) => fn()),
}));
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: {
    getRecord: jest.fn(),
    queryRecords: jest.fn(),
    queryAllRecords: jest.fn(),
  },
}));
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  findByRequest: jest.fn(),
  RESPONSE_TYPE_BY_VALUE: {},
}));

const REQUEST_ID = '550e8400-e29b-41d4-a716-446655440000';

let handler;
beforeAll(async () => {
  handler = (await import('../../pages/api/review-manager/reviewers')).default;
});

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({ session: { user: { azureEmail: 'pd@example.com' } } });
  DynamicsService.queryRecords.mockResolvedValue({ records: [] });
  DynamicsService.queryAllRecords.mockResolvedValue({ records: [] });
  // At least one accepted suggestion so the route builds a `proposals[0]`
  // entry (the DTO returns an empty proposals list on zero suggestions,
  // which would make `proposals[0].reviewSynthesis` meaningless to assert).
  suggestionAdapter.findByRequest.mockResolvedValue([
    {
      wmkf_appreviewersuggestionid: '33333333-3333-3333-3333-333333333333',
      _wmkf_request_value: REQUEST_ID,
      _wmkf_potentialreviewer_value: null,
      wmkf_accepted: true,
      wmkf_reviewreceivedat: null,
    },
  ]);
});

function get(query) {
  const req = createMockReq({ method: 'GET', query });
  const res = createMockRes();
  return { req, res };
}

test('valid JSON in wmkf_reviewsynthesisjson parses to an object', async () => {
  DynamicsService.getRecord.mockResolvedValue({
    akoya_requestid: REQUEST_ID,
    akoya_requestnum: '1002788',
    akoya_title: 'Test',
    wmkf_meetingdate: null,
    wmkf_reviewsynthesisjson: JSON.stringify({ consensus: ['a'], overall: 'ok' }),
  });
  const { req, res } = get({ proposalId: REQUEST_ID });
  await handler(req, res);
  expect(res.statusCode).toBe(200);
  // The parse NORMALIZES: missing sections become safe empty defaults so the
  // client can render every key without presence checks.
  expect(res._data.proposals[0].reviewSynthesis).toEqual({
    consensus: ['a'],
    disagreements: [],
    keyConcerns: [],
    ratingSummaries: [],
    overall: 'ok',
  });
});

test('non-string array items and junk keys are stripped (hand-edited/PA-written column)', async () => {
  DynamicsService.getRecord.mockResolvedValue({
    akoya_requestid: REQUEST_ID,
    akoya_requestnum: '1002788',
    akoya_title: 'Test',
    wmkf_meetingdate: null,
    wmkf_reviewsynthesisjson: JSON.stringify({
      synthesis: {
        consensus: ['ok', { nested: 'object' }, 42, null],
        keyConcerns: 'not-an-array',
        ratingSummaries: [{ questionKey: 'impact', summary: 'fine' }, 'junk', { questionText: 7 }],
        overall: { not: 'a string' },
        injectedExtra: 'dropped',
      },
    }),
  });
  const { req, res } = get({ proposalId: REQUEST_ID });
  await handler(req, res);
  expect(res.statusCode).toBe(200);
  expect(res._data.proposals[0].reviewSynthesis).toEqual({
    consensus: ['ok'],
    disagreements: [],
    keyConcerns: [],
    ratingSummaries: [
      { questionKey: 'impact', questionText: '', summary: 'fine' },
      { questionKey: '', questionText: '', summary: '' },
    ],
    overall: '',
  });
});

test.each([
  ['null', null],
  ['empty string', ''],
  ['malformed JSON', '{not valid json'],
  ['a bare JSON string (not an object)', '"just a string"'],
])('%s degrades to null, not a throw', async (_label, raw) => {
  DynamicsService.getRecord.mockResolvedValue({
    akoya_requestid: REQUEST_ID,
    akoya_requestnum: '1002788',
    akoya_title: 'Test',
    wmkf_meetingdate: null,
    wmkf_reviewsynthesisjson: raw,
  });
  const { req, res } = get({ proposalId: REQUEST_ID });
  await handler(req, res);
  expect(res.statusCode).toBe(200);
  expect(res._data.proposals[0].reviewSynthesis).toBeNull();
});
