/** @jest-environment node */
jest.mock('../../lib/dataverse/adapters/grant-request', () => ({ findByIds: jest.fn() }));
import { findByIds } from '../../lib/dataverse/adapters/grant-request';
import { staffContactRequestEnabled } from '../../lib/services/contact-enrichment/staff-contact-scope';

const id = '12345678-1234-4000-8888-123456789abc';
beforeEach(() => jest.clearAllMocks());

test.each([null, '', 'J27', { program: 'Research' }])('rejects an invalid or missing request ID', async input => {
  expect(await staffContactRequestEnabled(input)).toBe(false);
  expect(findByIds).not.toHaveBeenCalled();
});

test('requires the exact request, linked cycle and broad Research program together', async () => {
  findByIds.mockResolvedValueOnce({ records: [{ akoya_requestid: id.toUpperCase() }] })
    .mockResolvedValueOnce({ records: [] });
  expect(await staffContactRequestEnabled(id)).toBe(true);
  expect(findByIds).toHaveBeenCalledWith([id], {
    select: ['akoya_requestid'],
    filter: "wmkf_GrantCycle/wmkf_cyclecode eq 'J27' and wmkf_GrantProgram/wmkf_name eq 'Research'",
  });
  expect(await staffContactRequestEnabled(id)).toBe(false);
});

test('surfaces a failed read instead of continuing enrichment with the scope disabled', async () => {
  findByIds.mockRejectedValueOnce(new Error('Dataverse unavailable'));
  await expect(staffContactRequestEnabled(id)).rejects.toThrow('Dataverse unavailable');
});
