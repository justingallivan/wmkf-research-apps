/**
 * @jest-environment node
 *
 * Tests-before coverage (docs/DATA_ACCESS_LAYER_MIGRATION_PLAN.md Stages 3-6)
 * for pages/api/reviewer-finder/my-proposals.js ahead of converting its raw
 * DynamicsService calls to the grant-request/reviewer-suggestion adapters.
 * Captures CURRENT behavior: golden path (cycle list; proposals-in-cycle DTO
 * shape incl. reviewer counts) and one failure path (no active PD → 404).
 */
import { createMockReq, createMockRes } from '../helpers/auth-mock';

jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: jest.fn((_label, fn) => fn()),
}));
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: { queryAllRecords: jest.fn() },
}));
jest.mock('../../lib/services/program-director-resolver', () => ({
  resolveByEmail: jest.fn(),
}));

const { requireAppAccess } = require('../../lib/utils/auth');
const { DynamicsService } = require('../../lib/services/dynamics-service');
const { resolveByEmail } = require('../../lib/services/program-director-resolver');

const PD = { systemuserid: 'pd-1', fullName: 'Dr. PD' };

let handler;
beforeAll(() => {
  handler = require('../../pages/api/reviewer-finder/my-proposals').default;
});

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({ session: { user: { azureEmail: 'pd@example.org' } } });
});

test('golden path: no cycleCode returns the distinct cycles for the PD', async () => {
  resolveByEmail.mockResolvedValue(PD);
  DynamicsService.queryAllRecords.mockResolvedValue({
    records: [{ akoya_requestid: 'r1', wmkf_meetingdate: '2026-06-15' }],
  });

  const req = createMockReq({ method: 'GET', query: {} });
  const res = createMockRes();
  await handler(req, res);

  expect(res.status).toHaveBeenCalledWith(200);
  expect(res._data.success).toBe(true);
  expect(res._data.programDirector).toEqual({ systemuserid: 'pd-1', fullName: 'Dr. PD' });
  expect(res._data.cycles).toEqual([
    expect.objectContaining({ code: 'J26', count: 1 }),
  ]);
});

test('golden path: cycleCode returns the proposals-in-cycle DTO with reviewer counts', async () => {
  resolveByEmail.mockResolvedValue(PD);
  DynamicsService.queryAllRecords.mockImplementation(async (entity) => {
    if (entity === 'akoya_requests') {
      return {
        records: [{
          akoya_requestid: 'r1',
          akoya_requestnum: 'REQ-1',
          wmkf_meetingdate: '2026-06-15',
          akoya_requeststatus: 'Phase II Pending',
          wmkf_phaseiistatus: null,
        }],
      };
    }
    if (entity === 'wmkf_appreviewersuggestions') {
      return {
        records: [{
          _wmkf_request_value: 'r1', wmkf_invited: true, wmkf_accepted: true,
          wmkf_declined: false, wmkf_emailsentat: '2026-01-01T00:00:00Z', wmkf_responsetype: null,
        }],
      };
    }
    return { records: [] };
  });

  const req = createMockReq({ method: 'GET', query: { cycleCode: 'J26' } });
  const res = createMockRes();
  await handler(req, res);

  expect(res.status).toHaveBeenCalledWith(200);
  expect(res._data.proposals).toEqual([
    expect.objectContaining({ requestId: 'r1', requestNumber: 'REQ-1', reviewerAccepted: 1 }),
  ]);
});

test('failure path: no active Dynamics systemuser for the PD email → 404', async () => {
  resolveByEmail.mockResolvedValue(null);

  const req = createMockReq({ method: 'GET', query: {} });
  const res = createMockRes();
  await handler(req, res);

  expect(res.status).toHaveBeenCalledWith(404);
});
