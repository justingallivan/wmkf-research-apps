/** @jest-environment node */

import {
  getActiveStaffRecipientDirectory,
  getSiteVisitRecipientDirectory,
} from '../../lib/services/site-visit/recipient-directory-service';

function dependencies(overrides = {}) {
  return {
    listProfiles: jest.fn(async () => [
      { id: 1, display_name: 'Mapped Staff', azure_email: 'mapped@example.org', dynamics_systemuser_id: 'USER-1' },
      { id: 2, display_name: 'Unique Email', azure_email: 'unique@example.org', dynamics_systemuser_id: null },
      { id: 3, display_name: 'Ambiguous Email', azure_email: 'duplicate@example.org', dynamics_systemuser_id: null },
      { id: 4, display_name: 'Mismatch', azure_email: 'profile@example.org', dynamics_systemuser_id: 'USER-4' },
    ]),
    listSystemUsers: jest.fn(async () => ({
      records: [
        { systemuserid: 'user-1', fullname: 'Mapped Staff', internalemailaddress: 'mapped@example.org', isdisabled: false },
        { systemuserid: 'user-2', fullname: 'Unique Email', internalemailaddress: 'unique@example.org', isdisabled: false },
        { systemuserid: 'user-3a', fullname: 'Duplicate One', internalemailaddress: 'duplicate@example.org', isdisabled: false },
        { systemuserid: 'user-3b', fullname: 'Duplicate Two', internalemailaddress: 'duplicate@example.org', isdisabled: false },
        { systemuserid: 'user-4', fullname: 'Mismatch', internalemailaddress: 'other@example.org', isdisabled: false },
        { systemuserid: 'user-5', fullname: 'Disabled', internalemailaddress: 'disabled@example.org', isdisabled: true },
      ],
    })),
    listRoster: jest.fn(async () => [{
      id: 10,
      name: 'Legacy Consultant',
      role_type: 'Consultant',
      role: 'Professor',
      affiliation: 'Example University',
      preferred_email: 'legacy@example.org',
    }]),
    ...overrides,
  };
}

test('staff extraction preserves exact mapped-ID and unique same-email behavior', async () => {
  const staff = await getActiveStaffRecipientDirectory(dependencies());
  expect(staff).toEqual([
    {
      kind: 'staff',
      profileId: 1,
      name: 'Mapped Staff',
      email: 'mapped@example.org',
      systemUserId: 'user-1',
    },
    {
      kind: 'staff',
      profileId: 2,
      name: 'Unique Email',
      email: 'unique@example.org',
      systemUserId: 'user-2',
    },
  ]);
});

test('legacy Site Visit directory still includes the Expertise Finder roster', async () => {
  const directory = await getSiteVisitRecipientDirectory(dependencies());
  expect(directory.staff).toHaveLength(2);
  expect(directory.external).toEqual([{
    kind: 'roster',
    rosterId: 10,
    name: 'Legacy Consultant',
    email: 'legacy@example.org',
    roleType: 'Consultant',
    role: 'Professor',
    affiliation: 'Example University',
  }]);
});
