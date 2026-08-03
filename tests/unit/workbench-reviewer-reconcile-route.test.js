/** @jest-environment node */

jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: jest.fn((_name, fn) => fn()) }));
jest.mock('../../lib/services/workbench/reviewer-stage-reconciliation-service', () => ({
  reconcileReviewerStages: jest.fn(),
}));

import { parseRequest, statusFor } from '../../pages/api/workbench/reviewer-reconcile';

const REQUEST_ID = '11111111-1111-1111-1111-111111111111';
const STORED_KEY = 'candidate:alex%20reviewer|email:alex%40example.edu|orcid:-|affiliation:example%20university';

test('accepts only a request GUID and optional unique server-shaped stored keys', () => {
  expect(parseRequest({ requestId: REQUEST_ID })).toEqual({ valid: true, value: { requestId: REQUEST_ID } });
  expect(parseRequest({ requestId: REQUEST_ID, candidateKeys: [STORED_KEY] })).toEqual({
    valid: true,
    value: { requestId: REQUEST_ID, candidateKeys: [STORED_KEY] },
  });
  expect(parseRequest({ requestId: REQUEST_ID, candidateKeys: ['client:forged'] })).toMatchObject({ valid: false });
  expect(parseRequest({ requestId: REQUEST_ID, candidateKeys: [STORED_KEY, STORED_KEY] })).toMatchObject({ valid: false });
  expect(parseRequest({ requestId: REQUEST_ID, stage: 'identity' })).toMatchObject({ valid: false });
});

test('reports all-blocked/action-required reconciliation as non-success statuses', () => {
  expect(statusFor({ outcome: 'current' })).toBe(200);
  expect(statusFor({ outcome: 'partial' })).toBe(200);
  expect(statusFor({ outcome: 'action_required' })).toBe(409);
  expect(statusFor({ outcome: 'budget_exhausted' })).toBe(409);
  expect(statusFor({ outcome: 'failed_retryable' })).toBe(503);
});
