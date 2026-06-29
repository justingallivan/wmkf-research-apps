/**
 * GET /api/review-manager/reviewers — Phase 4 answer-snapshot read-back.
 *
 * Verifies the keyed child read attaches answers[] to SUBMITTED reviewers,
 * orders them by questionOrder, maps the DTO, and RE-SANITIZES answerHtml on
 * read (defense in depth before staff render). The adapter + DynamicsService are
 * mocked; the route's projection logic runs for real.
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
const SUGGESTION_ID = '11111111-1111-1111-1111-111111111111';
const PERSON_ID = '22222222-2222-2222-2222-222222222222';

let handler;
beforeAll(async () => {
  handler = (await import('../../pages/api/review-manager/reviewers')).default;
});

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({ session: { user: { azureEmail: 'pd@example.com' } } });
  // Request lookup (proposalId path → getRecord).
  DynamicsService.getRecord.mockResolvedValue({
    akoya_requestid: REQUEST_ID, akoya_requestnum: '1002788', akoya_title: 'Test', wmkf_meetingdate: null,
  });
  // One accepted + submitted suggestion.
  suggestionAdapter.findByRequest.mockResolvedValue([{
    wmkf_appreviewersuggestionid: SUGGESTION_ID,
    _wmkf_request_value: REQUEST_ID,
    _wmkf_potentialreviewer_value: PERSON_ID,
    wmkf_accepted: true,
    wmkf_reviewstatus: 100000003, // review_received
    wmkf_reviewreceivedat: '2026-06-28T12:00:00Z',
    wmkf_reviewerimpact: 3, wmkf_reviewerrisk: 2, wmkf_revieweroverallrating: 4,
  }]);
  // Person + researcher reads (queryRecords).
  DynamicsService.queryRecords.mockResolvedValue({
    records: [{ wmkf_potentialreviewersid: PERSON_ID, wmkf_name: 'Dr. X', wmkf_emailaddress: 'x@e.com' }],
  });
});

function get(query) {
  const req = createMockReq({ method: 'GET', query });
  const res = createMockRes();
  return { req, res };
}

test('attaches ordered, sanitized answers[] to a submitted reviewer', async () => {
  // Answer rows returned out of order, one carrying a stored XSS payload.
  DynamicsService.queryAllRecords.mockResolvedValue({
    records: [
      { _wmkf_appreviewersuggestion_value: SUGGESTION_ID, wmkf_questionkey: 'q4', wmkf_questionorder: 4, wmkf_questiontype: 'richtext', wmkf_questiontext: 'Q4', wmkf_answerhtml: '<p>ok</p><script>alert(1)</script>', wmkf_answertext: 'ok', wmkf_answervalue: null },
      { _wmkf_appreviewersuggestion_value: SUGGESTION_ID, wmkf_questionkey: 'impact', wmkf_questionorder: 1, wmkf_questiontype: 'picklist', wmkf_questiontext: 'Q1', wmkf_answerhtml: null, wmkf_answertext: 'broad', wmkf_answervalue: 3 },
    ],
  });

  const { req, res } = get({ proposalId: REQUEST_ID });
  await handler(req, res);

  expect(res.statusCode).toBe(200);
  const reviewer = res._data.proposals[0].reviewers[0];
  expect(reviewer.answers.map((a) => a.questionOrder)).toEqual([1, 4]); // ordered
  const q4 = reviewer.answers.find((a) => a.questionKey === 'q4');
  expect(q4.answerHtml).not.toMatch(/<script/i); // re-sanitized on read
  expect(q4.answerHtml).toContain('ok');
  // The keyed child read filtered by the lookup value attribute.
  const filterArg = DynamicsService.queryAllRecords.mock.calls[0][1].filter;
  expect(filterArg).toContain(`_wmkf_appreviewersuggestion_value eq ${SUGGESTION_ID}`);
});

test('a submitted reviewer whose child query returns nothing gets answers: []', async () => {
  DynamicsService.queryAllRecords.mockResolvedValue({ records: [] });
  const { req, res } = get({ proposalId: REQUEST_ID });
  await handler(req, res);
  expect(res.statusCode).toBe(200);
  expect(res._data.proposals[0].reviewers[0].answers).toEqual([]);
});

test('null / non-string answerHtml normalizes to empty (no sanitizer crash)', async () => {
  DynamicsService.queryAllRecords.mockResolvedValue({
    records: [
      { _wmkf_appreviewersuggestion_value: SUGGESTION_ID, wmkf_questionkey: 'risk', wmkf_questionorder: 3, wmkf_questiontype: 'picklist', wmkf_answerhtml: null, wmkf_answertext: 'med', wmkf_answervalue: 2 },
      { _wmkf_appreviewersuggestion_value: SUGGESTION_ID, wmkf_questionkey: 'q5', wmkf_questionorder: 5, wmkf_questiontype: 'richtext', wmkf_questiontext: 'Q5', wmkf_answerhtml: '', wmkf_answertext: '', wmkf_answervalue: null },
    ],
  });
  const { req, res } = get({ proposalId: REQUEST_ID });
  await handler(req, res);
  expect(res.statusCode).toBe(200);
  const answers = res._data.proposals[0].reviewers[0].answers;
  expect(answers.find((a) => a.questionKey === 'risk').answerHtml).toBe('');
  expect(answers.find((a) => a.questionKey === 'q5').answerHtml).toBe('');
});

test('child rows for an unrelated suggestion are not attached to this reviewer', async () => {
  DynamicsService.queryAllRecords.mockResolvedValue({
    records: [
      { _wmkf_appreviewersuggestion_value: 'ffffffff-ffff-ffff-ffff-ffffffffffff', wmkf_questionkey: 'q2', wmkf_questionorder: 2, wmkf_questiontype: 'richtext', wmkf_answerhtml: '<p>other</p>', wmkf_answervalue: null },
    ],
  });
  const { req, res } = get({ proposalId: REQUEST_ID });
  await handler(req, res);
  expect(res.statusCode).toBe(200);
  expect(res._data.proposals[0].reviewers[0].answers).toEqual([]); // grouped by sid, not ours
});

test('a truncated (capped) child read fails loud rather than returning a partial snapshot', async () => {
  DynamicsService.queryAllRecords.mockResolvedValue({ records: [], capped: true });
  const { req, res } = get({ proposalId: REQUEST_ID });
  await handler(req, res);
  expect(res.statusCode).toBe(500); // route catch → 500, never a silent partial
});

test('does not query answers when no reviewer has submitted', async () => {
  suggestionAdapter.findByRequest.mockResolvedValue([{
    wmkf_appreviewersuggestionid: SUGGESTION_ID,
    _wmkf_request_value: REQUEST_ID,
    _wmkf_potentialreviewer_value: PERSON_ID,
    wmkf_accepted: true,
    wmkf_reviewstatus: 100000001, // materials_sent, not submitted
    wmkf_reviewreceivedat: null,
  }]);

  const { req, res } = get({ proposalId: REQUEST_ID });
  await handler(req, res);

  expect(res.statusCode).toBe(200);
  expect(res._data.proposals[0].reviewers[0].answers).toEqual([]);
  expect(DynamicsService.queryAllRecords).not.toHaveBeenCalled();
});
