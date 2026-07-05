/**
 * POST /api/review-manager/synthesize-reviews (workbench Reviews tab Phase 4,
 * docs/WORKBENCH_REVIEWS_TAB_BUILDOUT_PLAN.md).
 *
 * Covers: requestId GUID rejection, zero-submitted-reviews 409 (no LLM call),
 * already-populated + no overwrite → 409 without calling the LLM, overwrite
 * flag → forceOverwrite passed through to executePrompt, writeback failures
 * surfaced to the client, and digest composition (reviewer name/affiliation +
 * question key/type/text + answerValue/answerText, no answerHtml).
 * executePrompt and all Dataverse calls are mocked.
 */

import { createMockReq, createMockRes } from '../helpers/auth-mock';
import { requireAppAccess } from '../../lib/utils/auth';
import { DynamicsService } from '../../lib/services/dynamics-service';
import * as suggestionAdapter from '../../lib/dataverse/adapters/reviewer-suggestion';
import { executePrompt } from '../../lib/services/execute-prompt';

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
}));
jest.mock('../../lib/services/execute-prompt', () => ({
  executePrompt: jest.fn(),
}));

const REQUEST_ID = '550e8400-e29b-41d4-a716-446655440000';
const SUGGESTION_ID = '11111111-1111-1111-1111-111111111111';
const PERSON_ID = '22222222-2222-2222-2222-222222222222';

let handler;
beforeAll(async () => {
  handler = (await import('../../pages/api/review-manager/synthesize-reviews')).default;
});

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({ session: { user: { dynamicsSystemuserId: 'user-1' } } });
  DynamicsService.queryRecords.mockResolvedValue({
    records: [{ wmkf_potentialreviewersid: PERSON_ID, wmkf_name: 'Dr. Reviewer' }],
  });
  DynamicsService.queryAllRecords.mockResolvedValue({
    records: [
      {
        _wmkf_appreviewersuggestion_value: SUGGESTION_ID,
        wmkf_questionkey: 'impact',
        wmkf_questionorder: 1,
        wmkf_questiontext: 'Rate the impact.',
        wmkf_questiontype: 'picklist',
        wmkf_answervalue: 4,
        wmkf_answertext: 'High',
        wmkf_answerhtml: '<p>High</p>',
      },
      {
        _wmkf_appreviewersuggestion_value: SUGGESTION_ID,
        wmkf_questionkey: 'strengths',
        wmkf_questionorder: 2,
        wmkf_questiontext: 'Describe strengths.',
        wmkf_questiontype: 'richtext',
        wmkf_answervalue: null,
        wmkf_answertext: 'Strong methodology.',
        wmkf_answerhtml: '<p>Strong methodology.</p>',
      },
    ],
    capped: false,
  });
});

function post(body) {
  const req = createMockReq({ method: 'POST', body });
  const res = createMockRes();
  return { req, res };
}

test('GET is rejected with 405 method_not_allowed and Allow: POST', async () => {
  const { req, res } = post();
  req.method = 'GET';
  await handler(req, res);
  expect(res.statusCode).toBe(405);
  expect(res._data).toEqual({ ok: false, reason: 'method_not_allowed' });
  expect(res._headers.Allow).toBe('POST');
});

test('unauthenticated request short-circuits before any Dataverse call', async () => {
  requireAppAccess.mockResolvedValueOnce(null);
  const { req, res } = post({ requestId: REQUEST_ID });
  await handler(req, res);
  expect(res.status).not.toHaveBeenCalled();
  expect(suggestionAdapter.findByRequest).not.toHaveBeenCalled();
});

test('rejects a non-GUID requestId with 400, before any Dataverse call', async () => {
  const { req, res } = post({ requestId: 'not-a-guid' });
  await handler(req, res);
  expect(res.statusCode).toBe(400);
  expect(suggestionAdapter.findByRequest).not.toHaveBeenCalled();
});

test('zero submitted reviews → 409 no_submitted_reviews, no LLM call', async () => {
  suggestionAdapter.findByRequest.mockResolvedValue([
    { wmkf_appreviewersuggestionid: SUGGESTION_ID, wmkf_accepted: true, wmkf_reviewreceivedat: null },
  ]);
  const { req, res } = post({ requestId: REQUEST_ID });
  await handler(req, res);
  expect(res.statusCode).toBe(409);
  expect(res._data).toMatchObject({ ok: false, reason: 'no_submitted_reviews' });
  expect(executePrompt).not.toHaveBeenCalled();
});

test('already-populated synthesis + no overwrite → 409 already_exists, no LLM call', async () => {
  suggestionAdapter.findByRequest.mockResolvedValue([
    {
      wmkf_appreviewersuggestionid: SUGGESTION_ID,
      _wmkf_potentialreviewer_value: PERSON_ID,
      wmkf_accepted: true,
      wmkf_reviewreceivedat: '2026-06-01T00:00:00Z',
      wmkf_revieweraffiliation: 'Test University',
    },
  ]);
  DynamicsService.getRecord.mockResolvedValue({
    wmkf_reviewsynthesisjson: '{"consensus":[]}',
    modifiedon: '2026-06-02T00:00:00Z',
  });
  const { req, res } = post({ requestId: REQUEST_ID });
  await handler(req, res);
  expect(res.statusCode).toBe(409);
  expect(res._data).toMatchObject({ ok: false, reason: 'already_exists' });
  expect(executePrompt).not.toHaveBeenCalled();
});

test('overwrite:true bypasses the already-exists gate and passes forceOverwrite through', async () => {
  suggestionAdapter.findByRequest.mockResolvedValue([
    {
      wmkf_appreviewersuggestionid: SUGGESTION_ID,
      _wmkf_potentialreviewer_value: PERSON_ID,
      wmkf_accepted: true,
      wmkf_reviewreceivedat: '2026-06-01T00:00:00Z',
      wmkf_revieweraffiliation: 'Test University',
    },
  ]);
  DynamicsService.getRecord.mockResolvedValue({ wmkf_reviewsynthesisjson: '{"consensus":[]}' });
  executePrompt.mockResolvedValue({
    blocked: false,
    parsed: { synthesis: { consensus: ['x'], disagreements: [], keyConcerns: [], ratingSummaries: [], overall: 'ok' } },
    runId: 'run-1',
    writeResults: { allOk: true, results: [{ output: 'synthesis', ok: true }] },
  });

  const { req, res } = post({ requestId: REQUEST_ID, overwrite: true });
  await handler(req, res);

  expect(res.statusCode).toBe(200);
  expect(res._data.ok).toBe(true);
  expect(executePrompt).toHaveBeenCalledTimes(1);
  const call = executePrompt.mock.calls[0][0];
  expect(call.promptName).toBe('review-synthesis.generate');
  expect(call.requestId).toBe(REQUEST_ID);
  expect(call.forceOverwrite).toBe(true);
  expect(call.runSource).toBe('Vercel Interactive');

  expect(DynamicsService.queryAllRecords.mock.calls[0][1].select).toContain('wmkf_answervalue');

  const digest = call.overrideVariables.reviews_digest;
  // Digest composition: reviewer name/affiliation + question metadata +
  // answerValue/answerText, no answerHtml anywhere in the payload sent to the LLM.
  expect(digest).toContain('Dr. Reviewer');
  expect(digest).toContain('Test University');
  expect(digest).toContain('Question key: impact');
  expect(digest).toContain('Question type: picklist');
  expect(digest).toContain('Question text: Rate the impact.');
  expect(digest).toContain('Answer value: 4');
  expect(digest).toContain('Answer text: High');
  expect(digest).toContain('Question key: strengths');
  expect(digest).toContain('Question type: richtext');
  expect(digest).toContain('Answer text: Strong methodology.');
  expect(digest).not.toContain('<p>');
});

test('200 success pins the full response envelope (ok, synthesis, runId, writtenToDynamics)', async () => {
  suggestionAdapter.findByRequest.mockResolvedValue([
    {
      wmkf_appreviewersuggestionid: SUGGESTION_ID,
      _wmkf_potentialreviewer_value: PERSON_ID,
      wmkf_accepted: true,
      wmkf_reviewreceivedat: '2026-06-01T00:00:00Z',
      wmkf_revieweraffiliation: 'Test University',
    },
  ]);
  DynamicsService.getRecord.mockResolvedValue({ wmkf_reviewsynthesisjson: null });
  const synthesis = { consensus: ['x'], disagreements: [], keyConcerns: [], ratingSummaries: [], overall: 'ok' };
  executePrompt.mockResolvedValue({
    blocked: false,
    parsed: { synthesis },
    runId: 'run-full',
    writeResults: { allOk: true, results: [{ output: 'synthesis', ok: true }] },
  });

  const { req, res } = post({ requestId: REQUEST_ID });
  await handler(req, res);

  expect(res.statusCode).toBe(200);
  expect(res._data).toEqual({ ok: true, synthesis, runId: 'run-full', writtenToDynamics: true });
});

test('no prior synthesis (empty memo) proceeds without overwrite flag', async () => {
  suggestionAdapter.findByRequest.mockResolvedValue([
    {
      wmkf_appreviewersuggestionid: SUGGESTION_ID,
      _wmkf_potentialreviewer_value: PERSON_ID,
      wmkf_accepted: true,
      wmkf_reviewreceivedat: '2026-06-01T00:00:00Z',
      wmkf_revieweraffiliation: 'Test University',
    },
  ]);
  DynamicsService.getRecord.mockResolvedValue({ wmkf_reviewsynthesisjson: null });
  executePrompt.mockResolvedValue({
    blocked: false,
    parsed: { synthesis: { consensus: [], disagreements: [], keyConcerns: [], ratingSummaries: [], overall: '' } },
    runId: 'run-2',
    writeResults: { allOk: true, results: [{ output: 'synthesis', ok: true }] },
  });

  const { req, res } = post({ requestId: REQUEST_ID });
  await handler(req, res);

  expect(res.statusCode).toBe(200);
  expect(executePrompt).toHaveBeenCalledTimes(1);
  expect(executePrompt.mock.calls[0][0].forceOverwrite).toBe(false);
});

test.each([
  ['writeback_failed', 502],
  ['concurrent_edit', 409],
])('Executor synthesis write failure (%s) returns %i instead of ok:true', async (reason, expectedStatus) => {
  suggestionAdapter.findByRequest.mockResolvedValue([
    {
      wmkf_appreviewersuggestionid: SUGGESTION_ID,
      _wmkf_potentialreviewer_value: PERSON_ID,
      wmkf_accepted: true,
      wmkf_reviewreceivedat: '2026-06-01T00:00:00Z',
      wmkf_revieweraffiliation: 'Test University',
    },
  ]);
  DynamicsService.getRecord.mockResolvedValue({ wmkf_reviewsynthesisjson: null });
  executePrompt.mockResolvedValue({
    blocked: false,
    parsed: { synthesis: { consensus: [], disagreements: [], keyConcerns: [], ratingSummaries: [], overall: '' } },
    runId: 'run-write-failed',
    writeResults: { allOk: false, results: [{ output: 'synthesis', ok: false, reason }] },
  });

  const { req, res } = post({ requestId: REQUEST_ID });
  await handler(req, res);

  expect(res.statusCode).toBe(expectedStatus);
  expect(res._data).toMatchObject({
    ok: false,
    reason,
    runId: 'run-write-failed',
    writtenToDynamics: false,
  });
});
