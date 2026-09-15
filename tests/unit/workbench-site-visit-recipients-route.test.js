/** @jest-environment node */

jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: jest.fn((_label, fn) => fn()) }));
jest.mock('../../lib/services/site-visit/recipient-directory-service', () => ({
  getSiteVisitRecipientDirectory: jest.fn(),
}));

import { requireAppAccess } from '../../lib/utils/auth';
import { withDalContext } from '../../lib/dataverse/core/context';
import { getSiteVisitRecipientDirectory } from '../../lib/services/site-visit/recipient-directory-service';
import handler from '../../pages/api/workbench/site-visit/recipients';

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((body) => { res.body = body; return res; });
  res.setHeader = jest.fn();
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({ profileId: 7 });
  getSiteVisitRecipientDirectory.mockResolvedValue({
    staff: [{ kind: 'staff', profileId: 7, name: 'Staff', email: 'staff@example.org', systemUserId: 'secret-id' }],
    external: [{ kind: 'roster', rosterId: 8, name: 'Board', email: null, linked: true, roleType: 'Board' }],
  });
});

test('route strips staff system IDs while preserving the external linked boolean', async () => {
  const res = mockRes();
  await handler({ method: 'GET' }, res);
  expect(requireAppAccess).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'reviewers');
  expect(withDalContext).toHaveBeenCalledWith('workbench-site-visit-recipient-directory', expect.any(Function));
  expect(res.statusCode).toBe(200);
  expect(res.body.staff[0]).not.toHaveProperty('systemUserId');
  expect(res.body.external).toEqual([expect.objectContaining({ linked: true })]);
  expect(res.body.external[0]).not.toHaveProperty('dataverse_contact_id');
});
