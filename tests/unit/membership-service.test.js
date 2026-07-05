/**
 * Contract test for lib/services/membership-service.js. Golden path:
 * getLiveMembershipsForContact's filter/select/DTO shape, and the
 * Submitter-role / any-role guards built on it. Failure path: a contact with
 * no live memberships fails both guards.
 *
 * @jest-environment node
 */
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: { queryRecords: jest.fn() },
}));

import { DynamicsService } from '../../lib/services/dynamics-service';
import {
  getLiveMembershipsForContact,
  hasSubmitterRole,
  hasLiveMembership,
  APPROVAL_STATUS,
  ROLE,
  STATECODE_ACTIVE,
} from '../../lib/services/membership-service';

const CONTACT_ID = 'contact-1';
const ACCOUNT_ID = 'account-1';

beforeEach(() => {
  DynamicsService.queryRecords.mockReset();
});

test('getLiveMembershipsForContact issues the live filter and maps the DTO', async () => {
  DynamicsService.queryRecords.mockResolvedValue({
    records: [{
      wmkf_portalmembershipid: 'm1',
      _wmkf_account_value: ACCOUNT_ID,
      _wmkf_contact_value: CONTACT_ID,
      wmkf_role: ROLE.SUBMITTER,
      wmkf_isprimary: true,
    }],
  });

  const result = await getLiveMembershipsForContact(CONTACT_ID);

  expect(DynamicsService.queryRecords).toHaveBeenCalledWith('wmkf_portalmemberships', {
    select: 'wmkf_portalmembershipid,_wmkf_contact_value,_wmkf_account_value,wmkf_role,wmkf_isprimary,wmkf_approvalstatus,statecode',
    filter: `_wmkf_contact_value eq ${CONTACT_ID} and wmkf_approvalstatus eq ${APPROVAL_STATUS.APPROVED} and statecode eq ${STATECODE_ACTIVE}`,
    top: 100,
  });
  expect(result).toEqual([{ membershipId: 'm1', accountId: ACCOUNT_ID, contactId: CONTACT_ID, role: ROLE.SUBMITTER, isPrimary: true }]);
});

test('missing contactId throws', async () => {
  await expect(getLiveMembershipsForContact(null)).rejects.toThrow('contactId required');
});

test('hasSubmitterRole true for a live Submitter membership on the account', async () => {
  DynamicsService.queryRecords.mockResolvedValue({
    records: [{ wmkf_portalmembershipid: 'm1', _wmkf_account_value: ACCOUNT_ID, _wmkf_contact_value: CONTACT_ID, wmkf_role: ROLE.SUBMITTER }],
  });
  await expect(hasSubmitterRole(CONTACT_ID, ACCOUNT_ID)).resolves.toBe(true);
});

test('hasSubmitterRole false for a Contributor-only membership', async () => {
  DynamicsService.queryRecords.mockResolvedValue({
    records: [{ wmkf_portalmembershipid: 'm1', _wmkf_account_value: ACCOUNT_ID, _wmkf_contact_value: CONTACT_ID, wmkf_role: ROLE.CONTRIBUTOR }],
  });
  await expect(hasSubmitterRole(CONTACT_ID, ACCOUNT_ID)).resolves.toBe(false);
  await expect(hasLiveMembership(CONTACT_ID, ACCOUNT_ID)).resolves.toBe(true);
});

test('no live memberships → both guards false without querying twice unnecessarily', async () => {
  DynamicsService.queryRecords.mockResolvedValue({ records: [] });
  await expect(hasSubmitterRole(CONTACT_ID, ACCOUNT_ID)).resolves.toBe(false);
  await expect(hasLiveMembership(CONTACT_ID, ACCOUNT_ID)).resolves.toBe(false);
});

test('hasSubmitterRole/hasLiveMembership short-circuit false without a query when ids are missing', async () => {
  await expect(hasSubmitterRole(null, ACCOUNT_ID)).resolves.toBe(false);
  await expect(hasLiveMembership(CONTACT_ID, null)).resolves.toBe(false);
  expect(DynamicsService.queryRecords).not.toHaveBeenCalled();
});
