/** @jest-environment node */

const {
  parseArgs,
  proposeRosterLink,
  runBackfill,
} = require('../../scripts/link-roster-contacts');

const CONTACT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';

function dependencies(overrides = {}) {
  return {
    normalizeOrcid: jest.fn((value) => value === 'valid-orcid'
      ? { state: 'valid', id: '0000-0002-1825-0097' }
      : { state: 'malformed' }),
    findByOrcidCandidates: jest.fn(async () => ({ none: true })),
    searchByName: jest.fn(async () => []),
    writeLink: jest.fn(async () => true),
    findActiveConflict: jest.fn(async () => null),
    ...overrides,
  };
}

test('arguments are dry-run by default and confirmations require exact roster/GUID pairs', () => {
  expect(parseArgs([])).toEqual({ apply: false, actorProfileId: null, confirmations: new Map() });
  expect(parseArgs(['--apply', '--actor-profile-id', '7', '--confirm', `7=${CONTACT_ID.toUpperCase()}`]))
    .toEqual({ apply: true, actorProfileId: 7, confirmations: new Map([[7, CONTACT_ID]]) });
  expect(() => parseArgs(['--apply'])).toThrow(/actor-profile-id/);
  expect(() => parseArgs(['--confirm', '7=nope'])).toThrow(/valid Contact GUID/);
  expect(() => parseArgs(['--unknown'])).toThrow(/Unknown argument/);
});

test('only an exact active email-bearing ORCID match is automatic', async () => {
  const valid = dependencies({
    findByOrcidCandidates: jest.fn(async () => ({
      one: true,
      row: { contactid: CONTACT_ID, emailaddress1: ' Ada@Example.org ', statecode: 0 },
    })),
  });
  await expect(proposeRosterLink({ name: 'Ada', orcid: 'valid-orcid' }, valid)).resolves.toEqual({
    source: 'orcid', status: 'candidate', contactId: CONTACT_ID, email: 'ada@example.org', automatic: true,
  });

  const noEmail = dependencies({
    findByOrcidCandidates: jest.fn(async () => ({ one: true, row: { contactid: CONTACT_ID, statecode: 0 } })),
  });
  await expect(proposeRosterLink({ name: 'Ada', orcid: 'valid-orcid' }, noEmail))
    .resolves.toEqual({ source: 'orcid', status: 'email_missing' });
  expect(noEmail.searchByName).not.toHaveBeenCalled();
});

test('name matches require one usable candidate and never become automatic', async () => {
  const deps = dependencies({
    searchByName: jest.fn(async () => [{ contactid: CONTACT_ID, emailaddress1: 'ada@example.org', statecode: 0 }]),
  });
  await expect(proposeRosterLink({ name: 'Ada', orcid: 'N/A' }, deps)).resolves.toEqual({
    source: 'name', status: 'candidate', contactId: CONTACT_ID, email: 'ada@example.org', automatic: false,
  });

  deps.searchByName.mockResolvedValueOnce([
    { contactid: CONTACT_ID, emailaddress1: 'a@example.org', statecode: 0 },
    { contactid: OTHER_ID, emailaddress1: 'b@example.org', statecode: 0 },
  ]);
  await expect(proposeRosterLink({ name: 'Ada', orcid: 'N/A' }, deps))
    .resolves.toEqual(expect.objectContaining({
      source: 'name', status: 'ambiguous', candidates: expect.arrayContaining([
        expect.objectContaining({ contactId: CONTACT_ID }),
        expect.objectContaining({ contactId: OTHER_ID }),
      ]),
    }));
});

test('dry-run never writes; apply writes ORCID automatically and name only with matching confirmation', async () => {
  const rows = [
    { id: 1, name: 'ORCID Person', orcid: 'valid-orcid' },
    { id: 2, name: 'Name Person', orcid: 'N/A' },
  ];
  const deps = dependencies({
    findByOrcidCandidates: jest.fn(async () => ({
      one: true, row: { contactid: CONTACT_ID, emailaddress1: 'a@example.org', statecode: 0 },
    })),
    searchByName: jest.fn(async () => [{ contactid: OTHER_ID, emailaddress1: 'b@example.org', statecode: 0 }]),
  });
  const dry = await runBackfill(rows, { apply: false, actorProfileId: null, confirmations: new Map() }, deps);
  expect(dry.map((row) => row.outcome)).toEqual(['would_apply', 'confirmation_required']);
  expect(deps.writeLink).not.toHaveBeenCalled();

  const applied = await runBackfill(rows, { apply: true, actorProfileId: 42, confirmations: new Map([[2, OTHER_ID]]) }, deps);
  expect(applied.map((row) => row.outcome)).toEqual(['applied', 'applied']);
  expect(deps.writeLink).toHaveBeenNthCalledWith(1, 1, CONTACT_ID, 42);
  expect(deps.writeLink).toHaveBeenNthCalledWith(2, 2, OTHER_ID, 42);
});

test('an explicit confirmation that disagrees with an ORCID match blocks the write', async () => {
  const deps = dependencies({
    findByOrcidCandidates: jest.fn(async () => ({
      one: true, row: { contactid: CONTACT_ID, emailaddress1: 'a@example.org', statecode: 0 },
    })),
  });
  const result = await runBackfill(
    [{ id: 1, name: 'ORCID Person', orcid: 'valid-orcid', preferred_email: 'manual@example.org' }],
    { apply: true, actorProfileId: 42, confirmations: new Map([[1, OTHER_ID]]) },
    deps,
  );
  expect(result[0]).toEqual(expect.objectContaining({
    outcome: 'skipped', status: 'confirmation_mismatch', preferredEmail: 'manual@example.org',
  }));
  expect(deps.writeLink).not.toHaveBeenCalled();
});

test('a uniqueness conflict is reported per row and later rows continue', async () => {
  const duplicate = Object.assign(new Error('duplicate'), { code: '23505' });
  const deps = dependencies({
    findByOrcidCandidates: jest.fn(async () => ({
      one: true, row: { contactid: CONTACT_ID, emailaddress1: 'a@example.org', statecode: 0 },
    })),
    writeLink: jest.fn()
      .mockRejectedValueOnce(duplicate)
      .mockResolvedValueOnce(true),
    findActiveConflict: jest.fn(async () => ({ id: 99, name: 'Already Linked' })),
  });
  const result = await runBackfill([
    { id: 1, name: 'First', orcid: 'valid-orcid' },
    { id: 2, name: 'Second', orcid: 'valid-orcid' },
  ], { apply: true, actorProfileId: 42, confirmations: new Map() }, deps);
  expect(result[0]).toEqual(expect.objectContaining({
    outcome: 'conflict', conflictingRosterId: 99, conflictingName: 'Already Linked',
  }));
  expect(result[1].outcome).toBe('applied');
  expect(deps.writeLink).toHaveBeenCalledTimes(2);
});
