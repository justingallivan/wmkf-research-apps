/**
 * POST /api/review-manager/mark-received-no-file — Phase D rating snapshot
 * dual-write.
 *
 * When staff record ratings without a file, the route must now write the rating
 * rows into the wmkf_appreviewanswer snapshot (atomically with the parent PATCH)
 * so the child table is the complete system of record before the DTO/prefill
 * readers stop reading the parent rating columns. The "informal feedback"
 * scenario (no structuredData) must stay parent-only with NO snapshot rows.
 */

import { createMockReq, createMockRes } from '../helpers/auth-mock';
import { requireAppAccess } from '../../lib/utils/auth';
import { DynamicsService } from '../../lib/services/dynamics-service';

jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: jest.fn((_label, fn) => fn()),
}));
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: {
    updateRecord: jest.fn(),
    resolveEntitySetName: jest.fn(),
    executeChangeset: jest.fn(),
  },
}));
jest.mock('../../lib/external/review-question-fetcher', () => {
  const { reviewFormSchema } = require('../../lib/external/review-form-schema');
  return { getActiveQuestionSet: jest.fn(async () => reviewFormSchema.fields) };
});

const SUGGESTION_ID = '11111111-1111-1111-1111-111111111111';

let handler;
beforeAll(async () => {
  handler = (await import('../../pages/api/review-manager/mark-received-no-file')).default;
});

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({ session: { user: { dynamicsSystemuserId: 'staff-1' } } });
  DynamicsService.updateRecord.mockResolvedValue(undefined);
  DynamicsService.resolveEntitySetName.mockResolvedValue('wmkf_appreviewanswers');
  DynamicsService.executeChangeset.mockResolvedValue({ ok: true, operations: [] });
});

function post(body) {
  const req = createMockReq({ method: 'POST', body });
  const res = createMockRes();
  return { req, res };
}

test('ratings present → atomic changeset with 3 rating upserts + parent PATCH; no bare updateRecord', async () => {
  const { req, res } = post({ suggestionId: SUGGESTION_ID, structuredData: { impact: 3, risk: 2, overallRating: 5 } });
  await handler(req, res);
  expect(res.statusCode).toBe(200);

  expect(DynamicsService.updateRecord).not.toHaveBeenCalled();
  expect(DynamicsService.executeChangeset).toHaveBeenCalledTimes(1);
  const [ops, opts] = DynamicsService.executeChangeset.mock.calls[0];
  expect(opts).toEqual({ actingUserSystemId: 'staff-1' });

  const answerOps = ops.filter((o) => /wmkf_questionkey=/.test(o.url));
  expect(answerOps).toHaveLength(3);
  const impactOp = answerOps.find((o) => o.url.includes("wmkf_questionkey='impact'"));
  expect(impactOp.url).toContain(`_wmkf_appreviewersuggestion_value=${SUGGESTION_ID}`);
  expect(impactOp.body).toMatchObject({ wmkf_answervalue: 3, wmkf_questiontype: 'picklist', wmkf_questionorder: 1 });

  // Parent PATCH is the LAST op and carries the received-at + staff flag + ratings.
  const parentOp = ops[ops.length - 1];
  expect(parentOp.url).toBe(`wmkf_appreviewersuggestions(${SUGGESTION_ID})`);
  expect(parentOp.body).toMatchObject({
    wmkf_reviewerimpact: 3,
    wmkf_reviewuploadedbystaff: true,
  });
  expect(parentOp.body.wmkf_reviewreceivedat).toMatch(/^\d{4}-\d{2}-\d{2}T/);
});

test('informal feedback (no structuredData) → parent-only updateRecord, NO snapshot rows', async () => {
  const { req, res } = post({ suggestionId: SUGGESTION_ID });
  await handler(req, res);
  expect(res.statusCode).toBe(200);

  expect(DynamicsService.executeChangeset).not.toHaveBeenCalled();
  expect(DynamicsService.updateRecord).toHaveBeenCalledTimes(1);
  const [, , patch] = DynamicsService.updateRecord.mock.calls[0];
  expect(patch.wmkf_reviewuploadedbystaff).toBe(true);
  expect(patch.wmkf_reviewerimpact).toBeUndefined();
});

test('partial ratings → changeset writes only the present rating rows', async () => {
  const { req, res } = post({ suggestionId: SUGGESTION_ID, structuredData: { impact: 1 } });
  await handler(req, res);
  expect(res.statusCode).toBe(200);
  const [ops] = DynamicsService.executeChangeset.mock.calls[0];
  const answerOps = ops.filter((o) => /wmkf_questionkey=/.test(o.url));
  expect(answerOps.map((o) => o.url.match(/wmkf_questionkey='([^']+)'/)[1])).toEqual(['impact']);
});

test('changeset 404 → not_found', async () => {
  const err = new Error('changeset failed (404)');
  err.status = 404;
  DynamicsService.executeChangeset.mockRejectedValue(err);
  const { req, res } = post({ suggestionId: SUGGESTION_ID, structuredData: { impact: 3, risk: 2, overallRating: 5 } });
  await handler(req, res);
  expect(res.statusCode).toBe(404);
  expect(res._data).toMatchObject({ ok: false, reason: 'not_found' });
});

test('invalid GUID → 400 before any write', async () => {
  const { req, res } = post({ suggestionId: 'not-a-guid', structuredData: { impact: 3 } });
  await handler(req, res);
  expect(res.statusCode).toBe(400);
  expect(DynamicsService.updateRecord).not.toHaveBeenCalled();
  expect(DynamicsService.executeChangeset).not.toHaveBeenCalled();
});
