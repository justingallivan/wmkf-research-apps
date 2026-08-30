/** @jest-environment node */

import {
  CURATED_RECIPIENT_MAX_ENTRIES,
  CURATED_RECIPIENT_SEARCH_LIMIT,
  CURATED_RECIPIENT_SETTING_KEY,
  getCuratedRecipientAdminState,
  getCuratedRecipientOptions,
  readCuratedRecipientConfig,
  searchCuratedRecipientContacts,
  validateCuratedRecipientConfig,
  writeCuratedRecipientConfig,
} from '../../lib/services/site-visit/curated-recipient-service';
import { CONTACT_BATCH_MAX_IDS } from '../../lib/dataverse/adapters/contact';

const CONTACT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_CONTACT_ID = '22222222-2222-4222-8222-222222222222';

function dependencies(overrides = {}) {
  return {
    getSettingStrict: jest.fn(async () => ({ found: false, value: null })),
    setSetting: jest.fn(async () => true),
    getActiveStaff: jest.fn(async () => [{
      kind: 'staff',
      profileId: 7,
      name: 'Alice Staff',
      email: 'alice@example.org',
      systemUserId: 'system-user-7',
    }]),
    getContactsByIds: jest.fn(async (ids) => ids.map((id) => ({
      contactid: id,
      fullname: id === CONTACT_ID ? 'Casey Consultant' : 'Bailey Board',
      emailaddress1: id === CONTACT_ID ? 'casey@example.org' : 'bailey@example.org',
      statecode: 0,
    }))),
    searchContactsByName: jest.fn(async () => [{
      contactid: CONTACT_ID,
      fullname: 'Casey Consultant',
      emailaddress1: 'casey@example.org',
      statecode: 0,
    }]),
    findContactsByEmail: jest.fn(async () => ({
      one: true,
      row: {
        contactid: CONTACT_ID,
        fullname: 'Casey Consultant',
        emailaddress1: 'casey@example.org',
        statecode: 0,
      },
    })),
    ...overrides,
  };
}

const validConfig = {
  version: 1,
  entries: [
    { kind: 'staff', profileId: 7 },
    { kind: 'contact', contactId: CONTACT_ID, category: 'consultant' },
  ],
};

test('the directory entry cap is the Contact batch-query cap', () => {
  expect(CURATED_RECIPIENT_MAX_ENTRIES).toBe(CONTACT_BATCH_MAX_IDS);
});

test('validates a reference-only config and canonicalizes Contact GUID casing', () => {
  expect(validateCuratedRecipientConfig({
    version: 1,
    entries: [{ kind: 'contact', contactId: CONTACT_ID.toUpperCase(), category: 'board' }],
  })).toEqual({
    version: 1,
    entries: [{ kind: 'contact', contactId: CONTACT_ID, category: 'board' }],
  });
});

test.each([
  { version: 1, entries: [{ kind: 'staff', profileId: 7, email: 'copied@example.org' }] },
  { version: 1, entries: [{ kind: 'contact', contactId: CONTACT_ID, category: 'other' }] },
  { version: 1, entries: [{ kind: 'staff', profileId: 7 }, { kind: 'staff', profileId: 7 }] },
  { version: 2, entries: [] },
  { version: 1, entries: Array.from({ length: CURATED_RECIPIENT_MAX_ENTRIES + 1 }, (_, index) => ({
    kind: 'staff',
    profileId: index + 1,
  })) },
])('rejects malformed, copied, duplicate, unknown-version, or over-cap config', (config) => {
  expect(() => validateCuratedRecipientConfig(config)).toThrow();
});

test('missing setting is an empty directory; malformed persisted JSON fails closed', async () => {
  expect(await readCuratedRecipientConfig(dependencies())).toEqual({ version: 1, entries: [] });
  await expect(readCuratedRecipientConfig(dependencies({
    getSettingStrict: jest.fn(async () => ({ found: true, value: '{broken' })),
  }))).rejects.toMatchObject({ httpStatus: 503, code: 'site_visit_recipient_config_invalid' });
});

test('settings read failure is not mistaken for an empty directory', async () => {
  await expect(readCuratedRecipientConfig(dependencies({
    getSettingStrict: jest.fn(async () => { throw new Error('Dataverse unavailable'); }),
  }))).rejects.toMatchObject({ httpStatus: 503, code: 'site_visit_recipient_config_unavailable' });
});

test('resolves eligible staff and Contacts live, sorted by category and name', async () => {
  const deps = dependencies({
    getSettingStrict: jest.fn(async () => ({
      found: true,
      value: JSON.stringify({
        version: 1,
        entries: [
          { kind: 'contact', contactId: OTHER_CONTACT_ID, category: 'board' },
          { kind: 'staff', profileId: 7 },
          { kind: 'contact', contactId: CONTACT_ID, category: 'consultant' },
        ],
      }),
    })),
  });
  expect(await getCuratedRecipientOptions(deps)).toEqual([
    { key: 'recipient-option-0', category: 'staff', name: 'Alice Staff', email: 'alice@example.org' },
    { key: 'recipient-option-1', category: 'consultant', name: 'Casey Consultant', email: 'casey@example.org' },
    { key: 'recipient-option-2', category: 'board', name: 'Bailey Board', email: 'bailey@example.org' },
  ]);
  expect(deps.getContactsByIds).toHaveBeenCalledTimes(1);
  expect(deps.getContactsByIds).toHaveBeenCalledWith([OTHER_CONTACT_ID, CONTACT_ID]);
  expect(JSON.stringify(await getCuratedRecipientOptions(deps))).not.toContain(CONTACT_ID);
});

test('unavailable identities remain visible to Admin but never enter Workbench options', async () => {
  const deps = dependencies({
    getSettingStrict: jest.fn(async () => ({ found: true, value: JSON.stringify(validConfig) })),
    getActiveStaff: jest.fn(async () => []),
    getContactsByIds: jest.fn(async () => [{
      contactid: CONTACT_ID,
      fullname: 'Casey Consultant',
      emailaddress1: null,
      statecode: 0,
    }]),
  });
  expect(await getCuratedRecipientOptions(deps)).toEqual([]);
  const admin = await getCuratedRecipientAdminState(deps);
  expect(admin.entries).toEqual(expect.arrayContaining([
    expect.objectContaining({ key: 'staff:7', available: false, reason: 'staff_unavailable' }),
    expect.objectContaining({ key: 'contact:' + CONTACT_ID, available: false, reason: 'contact_email_missing' }),
  ]));
});

test('Workbench deduplicates a repeated resolved email after category sorting', async () => {
  const deps = dependencies({
    getSettingStrict: jest.fn(async () => ({ found: true, value: JSON.stringify(validConfig) })),
    getContactsByIds: jest.fn(async () => [{
      contactid: CONTACT_ID,
      fullname: 'Alice Staff Contact',
      emailaddress1: 'ALICE@example.org',
      statecode: 0,
    }]),
  });
  expect(await getCuratedRecipientOptions(deps)).toEqual([
    { key: 'recipient-option-0', category: 'staff', name: 'Alice Staff', email: 'alice@example.org' },
  ]);
});

test('a Contact omitted by the bounded query is stale while query failures remain operational errors', async () => {
  const missing = dependencies({
    getSettingStrict: jest.fn(async () => ({
      found: true,
      value: JSON.stringify({
        version: 1,
        entries: [{ kind: 'contact', contactId: CONTACT_ID, category: 'consultant' }],
      }),
    })),
    getContactsByIds: jest.fn(async () => []),
  });
  const admin = await getCuratedRecipientAdminState(missing);
  expect(admin.entries).toEqual([
    expect.objectContaining({ contactId: CONTACT_ID, available: false, reason: 'contact_missing' }),
  ]);

  const failed = dependencies({
    getSettingStrict: missing.getSettingStrict,
    getContactsByIds: jest.fn(async () => { throw new Error('Dataverse timed out'); }),
  });
  await expect(getCuratedRecipientOptions(failed)).rejects.toThrow('Dataverse timed out');
});

test('write verifies every reference and stores no resolved names or emails', async () => {
  const deps = dependencies();
  const result = await writeCuratedRecipientConfig(validConfig, 42, deps);
  expect(result.entries).toHaveLength(2);
  expect(deps.setSetting).toHaveBeenCalledWith(
    CURATED_RECIPIENT_SETTING_KEY,
    JSON.stringify(validConfig),
    42,
  );
  const stored = deps.setSetting.mock.calls[0][1];
  expect(stored).not.toContain('Alice');
  expect(stored).not.toContain('@');
});

test('write refuses unresolved entries and performs no partial save', async () => {
  const deps = dependencies({ getActiveStaff: jest.fn(async () => []) });
  await expect(writeCuratedRecipientConfig(validConfig, 42, deps))
    .rejects.toMatchObject({ httpStatus: 409, code: 'site_visit_recipient_unresolved' });
  expect(deps.setSetting).not.toHaveBeenCalled();
});

test('Contact search supports name and exact-email paths and marks unusable rows', async () => {
  const byName = dependencies();
  expect(await searchCuratedRecipientContacts('Casey', byName)).toEqual({
    contacts: [expect.objectContaining({ contactId: CONTACT_ID, available: true })],
    truncated: false,
    limit: CURATED_RECIPIENT_SEARCH_LIMIT,
  });
  expect(byName.searchContactsByName).toHaveBeenCalledWith('Casey', { top: 51 });

  const byEmail = dependencies({
    findContactsByEmail: jest.fn(async () => ({
      ambiguous: true,
      rows: [{
        contactid: CONTACT_ID,
        fullname: 'Casey Consultant',
        emailaddress1: null,
        statecode: 0,
      }],
    })),
  });
  expect(await searchCuratedRecipientContacts('casey@example.org', byEmail)).toEqual({
    contacts: [expect.objectContaining({ contactId: CONTACT_ID, available: false, reason: 'contact_email_missing' })],
    truncated: false,
    limit: CURATED_RECIPIENT_SEARCH_LIMIT,
  });
  expect(byEmail.searchContactsByName).not.toHaveBeenCalled();
});

test('Contact name search returns up to 50 rows and discloses additional matches from one bounded probe', async () => {
  const rows = Array.from({ length: CURATED_RECIPIENT_SEARCH_LIMIT + 1 }, (_, index) => ({
    contactid: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    fullname: `Harris ${index + 1}`,
    emailaddress1: `harris${index + 1}@example.org`,
    statecode: 0,
  }));
  const deps = dependencies({ searchContactsByName: jest.fn(async () => rows) });

  const result = await searchCuratedRecipientContacts('Harris', deps);

  expect(result.contacts).toHaveLength(CURATED_RECIPIENT_SEARCH_LIMIT);
  expect(result).toMatchObject({ truncated: true, limit: CURATED_RECIPIENT_SEARCH_LIMIT });
  expect(deps.searchContactsByName).toHaveBeenCalledTimes(1);
  expect(deps.searchContactsByName).toHaveBeenCalledWith('Harris', { top: 51 });
});

test('Contact name search does not report truncation when exactly 50 rows match', async () => {
  const rows = Array.from({ length: CURATED_RECIPIENT_SEARCH_LIMIT }, (_, index) => ({
    contactid: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    fullname: `Harris ${index + 1}`,
    emailaddress1: `harris${index + 1}@example.org`,
    statecode: 0,
  }));
  const deps = dependencies({ searchContactsByName: jest.fn(async () => rows) });

  const result = await searchCuratedRecipientContacts('Harris', deps);

  expect(result.contacts).toHaveLength(CURATED_RECIPIENT_SEARCH_LIMIT);
  expect(result).toMatchObject({ truncated: false, limit: CURATED_RECIPIENT_SEARCH_LIMIT });
  expect(deps.searchContactsByName).toHaveBeenCalledTimes(1);
});

test('Contact search rejects unbounded or empty input before Dataverse reads', async () => {
  const deps = dependencies();
  await expect(searchCuratedRecipientContacts('x', deps)).rejects.toMatchObject({ httpStatus: 400 });
  await expect(searchCuratedRecipientContacts('x'.repeat(101), deps)).rejects.toMatchObject({ httpStatus: 400 });
  expect(deps.searchContactsByName).not.toHaveBeenCalled();
  expect(deps.findContactsByEmail).not.toHaveBeenCalled();
});
