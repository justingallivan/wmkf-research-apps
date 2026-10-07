const {
  parseArgs,
  makeFixture,
  assertRankingOnly,
  parseSearchStatus,
  isDuplicateCycleConflict,
  getEffectiveUserIds,
  FIXTURE_REQUEST_IDS,
} = require('../../scripts/probe-proposal-ranking-persistence');
const {
  readFixtureReceipt,
  effectiveUserMatches,
  exactFixtureReadDenied,
  hasCompletePrivilegeList,
  privilegeNamesPresent,
} = require('../../scripts/probe-proposal-ranking-staff-privacy');

const IDS = {
  cycleId: '10000000-0000-4000-8000-000000000001',
  roundId: '10000000-0000-4000-8000-000000000002',
  listId: '10000000-0000-4000-8000-000000000003',
  creationOperationId: '10000000-0000-4000-8000-000000000004',
};

describe('Proposal Ranking persistence rehearsal safeguards', () => {
  test('defaults to read-only D99 and requires an explicit execute option', () => {
    expect(parseArgs(['node', 'script.js'])).toMatchObject({ cycleCode: 'D99', execute: false });
    expect(parseArgs(['node', 'script.js', '--cycle=D99', '--execute'])).toMatchObject({ cycleCode: 'D99', execute: true });
    expect(() => parseArgs(['node', 'script.js', '--cycle=2026'])).toThrow(/cycle/i);
  });

  test('fixture contains labeled synthetic GUIDs and writes no existing source-table fields', () => {
    const fixture = makeFixture({
      cycleCode: 'D99',
      actorSystemUserId: '20000000-0000-4000-8000-000000000001',
      now: '2026-10-07T12:00:00.000Z',
      ids: IDS,
    });
    expect(fixture.snapshot.rehearsal.synthetic).toBe(true);
    expect(fixture.snapshot.seedOrders.se).toEqual(FIXTURE_REQUEST_IDS);
    expect(fixture.snapshot.proposals).toHaveLength(2);
    expect(fixture.snapshot.proposals.every((proposal) => proposal.amountMinorUnits != null && proposal.currency?.precision === 2)).toBe(true);
    expect(Object.keys(fixture.coordinator.create).every((key) => key.startsWith('wmkf_'))).toBe(true);
    expect(Object.keys(fixture.round).every((key) => key.startsWith('wmkf_'))).toBe(true);
    expect(Object.keys(fixture.list).every((key) => key.startsWith('wmkf_'))).toBe(true);
    expect(JSON.stringify(fixture)).not.toMatch(/akoya_request|wmkf_appreviewersuggestion|grant/i);
  });

  test('only POST/PATCH operations to the three ranking entity sets are allowed', () => {
    const entitySets = {
      cycle: 'wmkf_proposalrankingcycles',
      round: 'wmkf_proposalrankingrounds',
      list: 'wmkf_proposalrankinglists',
    };
    expect(() => assertRankingOnly([
      { method: 'POST', url: 'wmkf_proposalrankingcycles' },
      { method: 'POST', url: 'wmkf_proposalrankingrounds' },
      { method: 'POST', url: 'wmkf_proposalrankinglists' },
    ], entitySets)).not.toThrow();
    expect(() => assertRankingOnly([{ method: 'PATCH', url: 'akoya_requests(10000000-0000-4000-8000-000000000001)' }], entitySets)).toThrow(/outside/i);
    expect(() => assertRankingOnly([{ method: 'DELETE', url: 'wmkf_proposalrankinglists(id)' }], entitySets)).toThrow(/outside/i);
  });

  test('search status reports only parsed status and ranking-entity membership', () => {
    expect(parseSearchStatus({ response: JSON.stringify({ value: {
      status: 'provisioned',
      entitystatusresults: [{ entitylogicalname: 'wmkf_proposalrankingcycle' }, { entitylogicalname: 'wmkf_proposalrankinground' }],
    } }) })).toEqual({
      status: 'provisioned',
      rankingEntityStatusListed: { cycle: true, round: true, list: false },
      rankingTablesAbsentFromSearchStatus: false,
    });
    expect(parseSearchStatus({ response: 'invalid json' })).toEqual({
      status: 'unverified', rankingEntityStatusListed: null, rankingTablesAbsentFromSearchStatus: null,
    });
  });

  test('duplicate cycle conflicts require a definite concurrency status and duplicate evidence', () => {
    expect(isDuplicateCycleConflict({ status: 409, dataverseCode: '0x80040237' })).toBe(true);
    expect(isDuplicateCycleConflict({ status: 400, dataverseMessage: 'Alternate key constraint violation' })).toBe(true);
    expect(isDuplicateCycleConflict({ status: 403, dataverseMessage: 'Duplicate key' })).toBe(false);
    expect(isDuplicateCycleConflict({ status: 409, message: 'Request failed' })).toBe(false);
  });

  test('staff identity uses EqualUserId rather than WhoAmI and rejects app identity', async () => {
    const client = { get: jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: { value: [{ systemuserid: '20000000-0000-4000-8000-000000000001' }] },
    }) };
    const result = await getEffectiveUserIds(client, '20000000-0000-4000-8000-000000000001');
    expect(client.get).toHaveBeenCalledWith(
      expect.stringContaining('EqualUserId(PropertyName=@p1)'),
      { MSCRMCallerID: '20000000-0000-4000-8000-000000000001' },
    );
    expect(result.userIds).toEqual(['20000000-0000-4000-8000-000000000001']);
    expect(effectiveUserMatches([{ systemuserid: result.userIds[0] }], result.userIds[0], '30000000-0000-4000-8000-000000000001')).toBe(true);
    expect(effectiveUserMatches([{ systemuserid: '30000000-0000-4000-8000-000000000001' }], result.userIds[0], '30000000-0000-4000-8000-000000000001')).toBe(false);
    expect(effectiveUserMatches([
      { systemuserid: result.userIds[0] },
      { systemuserid: '30000000-0000-4000-8000-000000000001' },
    ], result.userIds[0], '30000000-0000-4000-8000-000000000001')).toBe(false);
  });

  test('exact fixture privacy proof accepts only a 403 after successful app baselines', () => {
    expect(exactFixtureReadDenied(403)).toBe(true);
    expect(exactFixtureReadDenied(404)).toBe(false);
    expect(exactFixtureReadDenied(401)).toBe(false);
    expect(exactFixtureReadDenied(200)).toBe(false);
  });

  test('effective privilege report recognizes table Read privilege names', () => {
    expect(hasCompletePrivilegeList([])).toBe(false);
    expect(hasCompletePrivilegeList([{ PrivilegeName: 'prvReadwmkf_proposalrankingcycle' }, {}])).toBe(false);
    expect(hasCompletePrivilegeList([{ PrivilegeName: 'prvReadwmkf_proposalrankingcycle' }])).toBe(true);
    expect(privilegeNamesPresent([
      { PrivilegeName: 'prvReadwmkf_proposalrankinground' },
      { PrivilegeName: 'prvCreatewmkf_proposalrankinglist' },
    ])).toEqual({
      prvReadwmkf_proposalrankingcycle: false,
      prvReadwmkf_proposalrankinground: true,
      prvReadwmkf_proposalrankinglist: false,
    });
  });

  test('staff privacy probe requires the completed D99 sandbox receipt and exact retained IDs', () => {
    const receipt = {
      target: 'orgd9e66399.crm.dynamics.com',
      cycleCode: 'D99',
      result: 'verified-persistence',
      staffRead: { candidateSystemUserId: '20000000-0000-4000-8000-000000000001' },
      retained: {
        cycleId: '30000000-0000-4000-8000-000000000001',
        roundId: '30000000-0000-4000-8000-000000000002',
        listId: '30000000-0000-4000-8000-000000000003',
      },
    };
    expect(readFixtureReceipt(receipt)).toMatchObject({ staffUserId: receipt.staffRead.candidateSystemUserId });
    expect(() => readFixtureReceipt({ ...receipt, target: 'wmkf.crm.dynamics.com' })).toThrow(/completed rehearsal receipt/i);
    expect(() => readFixtureReceipt({ ...receipt, cycleCode: 'D26' })).toThrow(/completed rehearsal receipt/i);
    expect(() => readFixtureReceipt({ ...receipt, retained: { ...receipt.retained, roundId: null } })).toThrow(/valid retained round/i);
  });
});
