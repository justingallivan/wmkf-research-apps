/**
 * GET /api/workbench/grantee-deliverables/cycle-export — chunk 8 output (c).
 * Staff-authed combined-HTML cycle export. Covers method guard, cycleCode
 * validation, the awardee query + bounded assembly, text/html response, the
 * empty-cycle page, fail-soft per-award skip, and query failure → 503.
 *
 * @jest-environment node
 */
jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/services/dynamics-service', () => ({ DynamicsService: { queryAllRecords: jest.fn() } }));
jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: (l, fn) => Promise.resolve().then(() => (typeof l === 'function' ? l() : fn())),
}));
jest.mock('../../lib/services/grantee-document-assembly', () => ({ assembleGranteeDocument: jest.fn() }));

import { requireAppAccess } from '../../lib/utils/auth';
import { DynamicsService } from '../../lib/services/dynamics-service';
import { assembleGranteeDocument } from '../../lib/services/grantee-document-assembly';
import handler from '../../pages/api/workbench/grantee-deliverables/cycle-export';

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.send = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  return res;
}

const model = (institution) => ({ institution, bodyHtml: `<p>${institution} abstract</p>` });

beforeEach(() => {
  requireAppAccess.mockReset().mockResolvedValue({ profileId: 'p', session: { user: {} } });
  DynamicsService.queryAllRecords.mockReset();
  assembleGranteeDocument.mockReset();
});

test('non-GET → 405', async () => {
  const res = mockRes();
  await handler({ method: 'POST', query: {}, headers: {} }, res);
  expect(res.statusCode).toBe(405);
});

test('unauthenticated caller: short-circuit, no query or assembly', async () => {
  requireAppAccess.mockResolvedValue(null);
  const res = mockRes();
  await handler({ method: 'GET', query: { cycleCode: 'J26' }, headers: {} }, res);
  expect(DynamicsService.queryAllRecords).not.toHaveBeenCalled();
  expect(assembleGranteeDocument).not.toHaveBeenCalled();
});

test('query failure envelope carries the cycleCode (non-{error}-only body)', async () => {
  DynamicsService.queryAllRecords.mockRejectedValue(new Error('dataverse down'));
  const res = mockRes();
  await handler({ method: 'GET', query: { cycleCode: 'J26' }, headers: {} }, res);
  expect(res.statusCode).toBe(503);
  expect(res.body).toEqual({ error: 'Awardee query failed.', cycleCode: 'J26' });
});

test('invalid cycleCode → 400 (no query)', async () => {
  const res = mockRes();
  await handler({ method: 'GET', query: { cycleCode: 'nope' }, headers: {} }, res);
  expect(res.statusCode).toBe(400);
  expect(DynamicsService.queryAllRecords).not.toHaveBeenCalled();
});

test('happy path → 200 text/html combined page', async () => {
  DynamicsService.queryAllRecords.mockResolvedValue({ records: [{ akoya_requestid: 'a' }, { akoya_requestid: 'b' }], totalCount: 2, capped: false });
  assembleGranteeDocument.mockImplementation((id) => Promise.resolve(model(id === 'a' ? 'Caltech' : 'MIT')));
  const res = mockRes();
  await handler({ method: 'GET', query: { cycleCode: 'J26' }, headers: {} }, res);
  expect(res.statusCode).toBe(200);
  expect(res.headers['Content-Type']).toBe('text/html; charset=utf-8');
  expect(res.body).toContain('<!DOCTYPE html>');
  expect(res.body).toContain('June 2026 — awarded research');
  expect(res.body).toContain('Caltech');
  expect(res.body).toContain('MIT');
  expect(res.body).toContain('2 awards');
  expect(assembleGranteeDocument).toHaveBeenCalledWith('a', { includeImageRef: true });
});

test('empty cycle → 200 page with 0 awards', async () => {
  DynamicsService.queryAllRecords.mockResolvedValue({ records: [], totalCount: 0, capped: false });
  const res = mockRes();
  await handler({ method: 'GET', query: { cycleCode: 'J26' }, headers: {} }, res);
  expect(res.statusCode).toBe(200);
  expect(res.body).toContain('0 awards');
  expect(assembleGranteeDocument).not.toHaveBeenCalled();
});

test('fail-soft: an award that fails to assemble is skipped', async () => {
  DynamicsService.queryAllRecords.mockResolvedValue({ records: [{ akoya_requestid: 'a' }, { akoya_requestid: 'b' }], totalCount: 2, capped: false });
  assembleGranteeDocument.mockImplementation((id) => (id === 'a' ? Promise.resolve(model('Caltech')) : Promise.reject(new Error('boom'))));
  const res = mockRes();
  await handler({ method: 'GET', query: { cycleCode: 'J26' }, headers: {} }, res);
  expect(res.statusCode).toBe(200);
  expect(res.body).toContain('Caltech');
  expect(res.body).toContain('1 award<');
});

test('capped query renders a visible truncation notice', async () => {
  DynamicsService.queryAllRecords.mockResolvedValue({ records: [{ akoya_requestid: 'a' }], totalCount: 30, capped: true });
  assembleGranteeDocument.mockResolvedValue(model('Caltech'));
  const res = mockRes();
  await handler({ method: 'GET', query: { cycleCode: 'J26' }, headers: {} }, res);
  expect(res.statusCode).toBe(200);
  expect(res.body).toContain('Export truncated: Dataverse returned 1 of 30 award records');
  expect(res.body).toContain('class="export-notice"');
});

test('awardee query failure → 503', async () => {
  DynamicsService.queryAllRecords.mockRejectedValue(new Error('dataverse down'));
  const res = mockRes();
  await handler({ method: 'GET', query: { cycleCode: 'J26' }, headers: {} }, res);
  expect(res.statusCode).toBe(503);
});
