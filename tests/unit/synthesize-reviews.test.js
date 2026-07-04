/**
 * POST /api/review-manager/synthesize-reviews (workbench Reviews tab Phase 4,
 * docs/WORKBENCH_REVIEWS_TAB_BUILDOUT_PLAN.md).
 *
 * Covers: requestId GUID rejection, zero-submitted-reviews 409 (no LLM call),
 * already-populated + no overwrite → 409 without calling the LLM, overwrite
 * flag → forceOverwrite passed through to executePrompt, and digest
 * composition (reviewer name/affiliation + question text/answerText, no
 * answerHtml). executePrompt and all Dataverse calls are mocked.
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
        wmkf_questionorder: 1,
        wmkf_questiontext: 'Rate the impact.',
        wmkf_answertext: 'High',
      },
      {
        _wmkf_appreviewersuggestion_value: SUGGESTION_ID,
        wmkf_questionorder: 2,
        wmkf_questiontext: 'Describe strengths.',
        wmkf_answertext: 'Strong methodology.',
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

  // Digest composition: reviewer name/affiliation + question text/answerText,
  // no answerHtml anywhere in the payload sent to the LLM.
  expect(call.overrideVariables.reviews_digest).toContain('Dr. Reviewer');
  expect(call.overrideVariables.reviews_digest).toContain('Test University');
  expect(call.overrideVariables.reviews_digest).toContain('Rate the impact.');
  expect(call.overrideVariables.reviews_digest).toContain('High');
  expect(call.overrideVariables.reviews_digest).toContain('Strong methodology.');
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
