/**
 * @jest-environment node
 *
 * Tests for GET /api/workbench/reviewer-rollup — GUID validation and the
 * case-insensitive rollup-key match (Codex S260: Dataverse may echo
 * _wmkf_request_value in a different case than the query value).
 */
jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn(async () => ({ profileId: 1 })) }));
jest.mock('../../lib/services/dynamics-context', () => ({ bypassDynamicsRestrictions: (_l, fn) => fn() }));
jest.mock('../../lib/services/reviewer-rollup', () => {
  const actual = jest.requireActual('../../lib/services/reviewer-rollup');
  return { ...actual, fetchReviewerRollup: jest.fn() };
});

import handler from '../../pages/api/workbench/reviewer-rollup';
import { fetchReviewerRollup } from '../../lib/services/reviewer-rollup';

const GUID_LOWER = '0000000a-0000-4000-8000-00000000000b';
const GUID_UPPER = GUID_LOWER.toUpperCase();

function res() {
  return {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    setHeader() {},
  };
}

beforeEach(() => { fetchReviewerRollup.mockReset(); });

it('400 when requestId is not a valid GUID (no service call)', async () => {
  const r = res();
  await handler({ method: 'GET', query: { requestId: 'nope' } }, r);
  expect(r.statusCode).toBe(400);
  expect(fetchReviewerRollup).not.toHaveBeenCalled();
});

it('matches the rollup key case-insensitively (upper query, lower-keyed result)', async () => {
  fetchReviewerRollup.mockResolvedValue({ [GUID_LOWER]: { candidates: 5, invited: 4, accepted: 3, declined: 0, held: 0, completed: 1 } });
  const r = res();
  await handler({ method: 'GET', query: { requestId: GUID_UPPER } }, r);
  expect(r.statusCode).toBe(200);
  expect(r.body.counts.candidates).toBe(5);   // NOT zeroed by a casing mismatch
  expect(r.body.counts.completed).toBe(1);
  expect(r.body.workRemaining).toBe('review'); // 3 accepted ≥ needed
  expect(typeof r.body.hint).toBe('string');
});

it('returns empty counts (not an error) when the request has no suggestion rows', async () => {
  fetchReviewerRollup.mockResolvedValue({});
  const r = res();
  await handler({ method: 'GET', query: { requestId: GUID_LOWER } }, r);
  expect(r.statusCode).toBe(200);
  expect(r.body.counts).toEqual({
    candidates: 0,
    invited: 0,
    accepted: 0,
    declined: 0,
    held: 0,
    completed: 0,
    progress: { total: 0, accepted: 0, pending: 0, declined: 0, uninvited: 0 },
  });
  expect(r.body.workRemaining).toBe('find');
});
