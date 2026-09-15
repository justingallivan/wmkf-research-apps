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
      dataverse_contact_id: null,
    }]),
    getContactsByIds: jest.fn(async () => []),
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
    linked: false,
    roleType: 'Consultant',
    role: 'Professor',
    affiliation: 'Example University',
  }]);
});

test('linked rows use only an active Dataverse Contact primary email', async () => {
  const activeId = '11111111-1111-4111-8111-111111111111';
  const inactiveId = '22222222-2222-4222-8222-222222222222';
  const missingId = '33333333-3333-4333-8333-333333333333';
  const emailLessId = '44444444-4444-4444-8444-444444444444';
  const deps = dependencies({
    listRoster: jest.fn(async () => [
      { id: 10, name: 'Active Link', role_type: 'Board', preferred_email: 'stale@example.org', dataverse_contact_id: activeId },
      { id: 11, name: 'Inactive Link', role_type: 'Board', preferred_email: 'fallback@example.org', dataverse_contact_id: inactiveId },
      { id: 12, name: 'Missing Link', role_type: 'Consultant', preferred_email: 'fallback@example.org', dataverse_contact_id: missingId },
      { id: 13, name: 'Email-less Link', role_type: 'Consultant', preferred_email: 'fallback@example.org', dataverse_contact_id: emailLessId },
    ]),
    getContactsByIds: jest.fn(async () => [
      { contactid: activeId, emailaddress1: ' LIVE@Example.org ', statecode: 0 },
      { contactid: inactiveId, emailaddress1: 'inactive@example.org', statecode: 1 },
      { contactid: emailLessId, emailaddress1: null, statecode: 0 },
    ]),
  });

  const directory = await getSiteVisitRecipientDirectory(deps);

  expect(deps.getContactsByIds).toHaveBeenCalledWith([activeId, inactiveId, missingId, emailLessId]);
  expect(directory.external).toEqual([
    expect.objectContaining({ rosterId: 10, email: 'live@example.org', linked: true }),
    expect.objectContaining({ rosterId: 11, email: null, linked: true }),
    expect.objectContaining({ rosterId: 12, email: null, linked: true }),
    expect.objectContaining({ rosterId: 13, email: null, linked: true }),
  ]);
});

test('linked rows are fetched in bounded chunks and an unlinked roster skips Contact reads', async () => {
  const linkedRoster = Array.from({ length: 51 }, (_, index) => ({
    id: index + 1,
    name: `Person ${index + 1}`,
    role_type: 'Board',
    preferred_email: null,
    dataverse_contact_id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  }));
  const getContactsByIds = jest.fn(async (ids) => ids.map((contactid) => ({
    contactid,
    emailaddress1: `${contactid.slice(-2)}@example.org`,
    statecode: 0,
  })));
  await getSiteVisitRecipientDirectory(dependencies({
    listRoster: jest.fn(async () => linkedRoster),
    getContactsByIds,
  }));
  expect(getContactsByIds).toHaveBeenCalledTimes(2);
  expect(getContactsByIds.mock.calls.map(([ids]) => ids.length)).toEqual([50, 1]);

  const unlinkedRead = jest.fn(async () => []);
  await getSiteVisitRecipientDirectory(dependencies({ getContactsByIds: unlinkedRead }));
  expect(unlinkedRead).not.toHaveBeenCalled();
});

test('staff enumeration fails loud instead of accepting a capped Dataverse result', async () => {
  await expect(getActiveStaffRecipientDirectory(dependencies({
    listSystemUsers: jest.fn(async () => ({ records: [], capped: true })),
  }))).rejects.toMatchObject({
    httpStatus: 503,
    code: 'site_visit_staff_directory_capped',
  });
});

test('staff failures are observed while the roster read is still pending', async () => {
  const staffFailure = new Error('staff directory unavailable');
  const deps = dependencies({
    listProfiles: jest.fn(async () => { throw staffFailure; }),
    listRoster: jest.fn(() => new Promise((resolve) => {
      setTimeout(() => resolve([]), 10);
    })),
  });

  await expect(getSiteVisitRecipientDirectory(deps)).rejects.toBe(staffFailure);
});
