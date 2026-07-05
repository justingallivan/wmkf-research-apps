/**
 * Contract test for POST /api/expertise-finder/batch-match's SharePoint
 * folder-resolution step (the surface converted onto
 * sharepoint-document-location adapter). Golden path: no tracked location →
 * 404 with the documented DTO shape. Failure path: missing requestId → 400,
 * no lookup performed.
 *
 * @jest-environment node
 */

jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/services/model-override-loader', () => ({ loadModelOverrides: jest.fn().mockResolvedValue() }));
jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: (label, fn) => fn(),
}));
jest.mock('../../lib/dataverse/adapters/sharepoint-document-location.js', () => ({
  findByRegardingObject: jest.fn(),
  findByParentIds: jest.fn(),
}));

import { requireAppAccess } from '../../lib/utils/auth';
import * as sharepointDocumentLocationAdapter from '../../lib/dataverse/adapters/sharepoint-document-location.js';
import handler from '../../pages/api/expertise-finder/batch-match';

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

beforeEach(() => {
  requireAppAccess.mockReset().mockResolvedValue({ profileId: 'p' });
  sharepointDocumentLocationAdapter.findByRegardingObject.mockReset();
  sharepointDocumentLocationAdapter.findByParentIds.mockReset();
});

test('non-POST → 405', async () => {
  const res = mockRes();
  await handler({ method: 'GET', body: {} }, res);
  expect(res.statusCode).toBe(405);
});

test('missing requestId → 400, no SharePoint lookup', async () => {
  const res = mockRes();
  await handler({ method: 'POST', body: {} }, res);
  expect(res.statusCode).toBe(400);
  expect(sharepointDocumentLocationAdapter.findByRegardingObject).not.toHaveBeenCalled();
});

test('no tracked SharePoint location → 404 with requestNumber echoed', async () => {
  sharepointDocumentLocationAdapter.findByRegardingObject.mockResolvedValue({ records: [] });
  const res = mockRes();
  await handler({ method: 'POST', body: { requestId: 'req-1', requestNumber: 'R-1000' } }, res);
  expect(res.statusCode).toBe(404);
  expect(res.body).toEqual({
    error: 'No SharePoint document location found for this request',
    requestNumber: 'R-1000',
  });
  expect(sharepointDocumentLocationAdapter.findByRegardingObject).toHaveBeenCalledWith('req-1', {
    select: 'name,relativeurl,_parentsiteorlocation_value',
  });
});
