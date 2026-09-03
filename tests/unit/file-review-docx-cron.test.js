/** @jest-environment node */

jest.mock('../../lib/dataverse/core/context', () => ({
  withDalContext: (_label, fn) => Promise.resolve().then(fn),
}));
const sweepMissingIndividualReviewFiles = jest.fn();
jest.mock('../../lib/services/review-documents/individual-file-service', () => ({
  sweepMissingIndividualReviewFiles: (...args) => sweepMissingIndividualReviewFiles(...args),
}));
jest.mock('../../lib/services/maintenance-service', () => ({
  __esModule: true,
  default: {
    startRun: jest.fn(async () => 'run-1'),
    completeRun: jest.fn(async () => {}),
  },
}));

import handler from '../../pages/api/cron/file-review-docx';
import MaintenanceService from '../../lib/services/maintenance-service';

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.setHeader = (key, value) => { res.headers[key] = value; };
  return res;
}

const OLD_ENV = process.env;
beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...OLD_ENV, NODE_ENV: 'production', CRON_SECRET: 'topsecret' };
  sweepMissingIndividualReviewFiles.mockResolvedValue({
    status: 'completed', scanned: 0, attempted: 0, counts: {}, results: [],
  });
});
afterEach(() => { process.env = OLD_ENV; });

test('rejects requests without the cron bearer secret', async () => {
  const res = mockRes();
  await handler({ method: 'GET', query: {}, headers: {} }, res);
  expect(res.statusCode).toBe(401);
  expect(sweepMissingIndividualReviewFiles).not.toHaveBeenCalled();
});

test('runs the bounded sweep inside the cron shell', async () => {
  const res = mockRes();
  await handler({
    method: 'GET',
    query: { scanCap: '70', attemptCap: '7' },
    headers: { authorization: 'Bearer topsecret' },
  }, res);
  expect(res.statusCode).toBe(200);
  expect(sweepMissingIndividualReviewFiles).toHaveBeenCalledWith({ scanCap: 70, attemptCap: 7 });
  expect(MaintenanceService.completeRun).toHaveBeenCalledWith('run-1', expect.objectContaining({ status: 'completed' }));
});

test('records actionable per-row results as a failed maintenance run', async () => {
  sweepMissingIndividualReviewFiles.mockResolvedValue({
    status: 'completed', scanned: 1, attempted: 1,
    counts: { content_conflict: 1 }, results: [{ suggestionId: 's1', status: 'content_conflict' }],
  });
  const res = mockRes();
  await handler({ method: 'POST', query: {}, headers: { authorization: 'Bearer topsecret' } }, res);
  expect(MaintenanceService.completeRun).toHaveBeenCalledWith('run-1', expect.objectContaining({
    status: 'failed',
    errorMessage: expect.stringContaining('1 review DOCX'),
  }));
});
