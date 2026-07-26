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
  // core/changeset.js#runChangeset asserts a trusted DAL context (Stage 7,
  // docs/DATA_ACCESS_LAYER_MIGRATION_PLAN.md); this route's own bypass above
  // is mocked to a no-op passthrough, so the assertion is mocked too — the
  // route establishes a real context in production.
  assertTrustedDalContext: jest.fn(),
}));
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: {
    getRecord: jest.fn(),
    updateRecord: jest.fn(),
    resolveEntitySetName: jest.fn(),
    executeChangeset: jest.fn(),
  },
}));
jest.mock('../../lib/external/review-question-fetcher', () => {
  const { reviewFormSchema } = require('../../lib/external/review-form-schema');
  return {
    getActiveQuestionSet: jest.fn(async () => reviewFormSchema.fields),
    getAuthoritativeQuestionSet: jest.fn(async () => reviewFormSchema.fields),
  };
});

const SUGGESTION_ID = '11111111-1111-1111-1111-111111111111';

let handler;
beforeAll(async () => {
  handler = (await import('../../pages/api/review-manager/mark-received-no-file')).default;
});

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({ session: { user: { dynamicsSystemuserId: 'staff-1' } } });
  DynamicsService.getRecord.mockResolvedValue({
    wmkf_accepted: true,
    wmkf_declined: false,
    wmkf_reviewreceivedat: null,
    wmkf_reviewstatus: 100000002,
    _etag: 'W/"receipt-authorized"',
  });
  DynamicsService.updateRecord.mockResolvedValue(undefined);
  DynamicsService.resolveEntitySetName.mockResolvedValue('wmkf_appreviewanswers');
  DynamicsService.executeChangeset.mockResolvedValue({ ok: true, operations: [] });
});

function post(body) {
  const req = createMockReq({ method: 'POST', body });
  const res = createMockRes();
  return { req, res };
}

test('wrong method → 405 with Allow header, before auth runs', async () => {
  const req = createMockReq({ method: 'GET', body: {} });
  const res = createMockRes();
  await handler(req, res);
  expect(res.statusCode).toBe(405);
  expect(res._data).toEqual({ ok: false, reason: 'method_not_allowed' });
  expect(res.setHeader).toHaveBeenCalledWith('Allow', 'POST');
  expect(requireAppAccess).not.toHaveBeenCalled();
});

test('unauthenticated → short-circuits before any lookup or write', async () => {
  requireAppAccess.mockResolvedValueOnce(null);
  const { req, res } = post({ suggestionId: SUGGESTION_ID, structuredData: { impact: 3 } });
  await handler(req, res);
  expect(DynamicsService.updateRecord).not.toHaveBeenCalled();
  expect(DynamicsService.executeChangeset).not.toHaveBeenCalled();
});

test('structured answers present → atomic changeset with 2 ratings + multiselect + parent PATCH', async () => {
  const { req, res } = post({
    suggestionId: SUGGESTION_ID,
    structuredData: { impactAreas: [1, 4], riskLevel: 2, overallAssessment: 5 },
  });
  await handler(req, res);
  expect(res.statusCode).toBe(200);

  expect(DynamicsService.updateRecord).not.toHaveBeenCalled();
  expect(DynamicsService.executeChangeset).toHaveBeenCalledTimes(1);
  const [ops, opts] = DynamicsService.executeChangeset.mock.calls[0];
  expect(opts).toEqual({ actingUserSystemId: 'staff-1' });

  const answerOps = ops.filter((o) => /wmkf_questionkey=/.test(o.url));
  expect(answerOps).toHaveLength(3);
  const impactOp = answerOps.find((o) => o.url.includes("wmkf_questionkey='impactAreas'"));
  expect(impactOp.url).toContain(`_wmkf_appreviewersuggestion_value=${SUGGESTION_ID}`);
  expect(impactOp.body).toMatchObject({
    wmkf_answervalue: null,
    wmkf_questiontype: 'multiselect',
    wmkf_questionorder: 3,
  });
  expect(JSON.parse(impactOp.body.wmkf_answervalues)).toEqual([
    { value: 1, label: 'Provide enabling tools to the community' },
    { value: 4, label: 'Revise textbooks' },
  ]);

  // Parent PATCH is the LAST op and carries received-at + staff flag — but NOT
  // the rating columns (Phase E: ratings live only in the snapshot rows above).
  const parentOp = ops[ops.length - 1];
  expect(parentOp.url).toBe(`wmkf_appreviewersuggestions(${SUGGESTION_ID})`);
  expect(parentOp.body).toMatchObject({ wmkf_reviewuploadedbystaff: true });
  expect(parentOp.body.wmkf_reviewerimpact).toBeUndefined();
  expect(parentOp.body.wmkf_reviewerrisk).toBeUndefined();
  expect(parentOp.body.wmkf_revieweroverallrating).toBeUndefined();
  expect(parentOp.body.wmkf_reviewreceivedat).toMatch(/^\d{4}-\d{2}-\d{2}T/);
});

test('informal feedback (no structuredData) → parent-only updateRecord, NO snapshot rows', async () => {
  const { req, res } = post({ suggestionId: SUGGESTION_ID });
  await handler(req, res);
  expect(res.statusCode).toBe(200);
  expect(res._data).toEqual({ ok: true });

  expect(DynamicsService.executeChangeset).not.toHaveBeenCalled();
  expect(DynamicsService.updateRecord).toHaveBeenCalledTimes(1);
  const [, , patch] = DynamicsService.updateRecord.mock.calls[0];
  expect(patch.wmkf_reviewuploadedbystaff).toBe(true);
  expect(patch.wmkf_reviewerimpact).toBeUndefined();
});

test('partial ratings → changeset writes only the present rating rows', async () => {
  const { req, res } = post({ suggestionId: SUGGESTION_ID, structuredData: { riskLevel: 1 } });
  await handler(req, res);
  expect(res.statusCode).toBe(200);
  const [ops] = DynamicsService.executeChangeset.mock.calls[0];
  const answerOps = ops.filter((o) => /wmkf_questionkey=/.test(o.url));
  expect(answerOps.map((o) => o.url.match(/wmkf_questionkey='([^']+)'/)[1])).toEqual(['riskLevel']);
});

test('changeset 404 → not_found', async () => {
  const err = new Error('changeset failed (404)');
  err.status = 404;
  DynamicsService.executeChangeset.mockRejectedValue(err);
  const { req, res } = post({
    suggestionId: SUGGESTION_ID,
    structuredData: { impactAreas: [3], riskLevel: 2, overallAssessment: 5 },
  });
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
