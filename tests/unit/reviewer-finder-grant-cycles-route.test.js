/**
 * @jest-environment node
 *
 * The route must preserve proposal rows that cannot join an active cycle.
 */
jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/services/grant-cycles-dataverse', () => ({
  listCycles: jest.fn(),
  fetchCounts: jest.fn(),
  findByShortCode: jest.fn(),
  createCycle: jest.fn(),
  updateCycleById: jest.fn(),
  archiveCycleById: jest.fn(),
  normalizeShortCode: jest.fn((value) => String(value || '').trim().toUpperCase() || null),
}));
jest.mock('../../lib/utils/blob-proxy', () => ({ proxifyBlobUrl: jest.fn((value) => value) }));
jest.mock('../../lib/utils/cycle-material-ref', () => ({
  isPrivateCycleMaterialPathname: jest.fn(() => false),
  cycleMaterialDownloadPath: jest.fn(),
}));

import { requireAppAccess } from '../../lib/utils/auth';
import { listCycles, fetchCounts } from '../../lib/services/grant-cycles-dataverse';
import handler from '../../pages/api/reviewer-finder/grant-cycles';

function mockRes() {
  const res = { statusCode: 200, body: null, headers: {} };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.setHeader = (key, value) => { res.headers[key] = value; };
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({});
  listCycles.mockResolvedValue([
    { id: 'cycle-j26', name: 'June 2026', fiscalYearCode: 'June 2026', shortCode: 'J26', additionalAttachments: [] },
  ]);
  fetchCounts.mockResolvedValue({
    proposalCountsByFiscalYear: new Map([['June 2026', 2]]),
    candidateCountsByShortCode: new Map([['J26', 4]]),
    unassignedProposalCount: 3,
    unassignedCandidateCount: 1,
  });
});

test('GET exposes conserved unmatched proposal count and passes listed cycles to counting', async () => {
  const res = mockRes();
  await handler({ method: 'GET', query: {} }, res);

  expect(res.statusCode).toBe(200);
  expect(fetchCounts).toHaveBeenCalledWith(expect.arrayContaining([
    expect.objectContaining({ name: 'June 2026' }),
  ]));
  expect(res.body.cycles[0]).toEqual(expect.objectContaining({ proposalCount: 2, candidateCount: 4 }));
  expect(res.body.unassigned).toEqual({ proposalCount: 3, candidateCount: 1 });
});
