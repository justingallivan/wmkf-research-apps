import {
  formatAwardTotal,
  formatInstitutionalFundingHistory,
  loadProgramGrants,
  programGrantFilter,
  programGrantRecencyDate,
  reconcileProgramGrantRollups,
  selectMostRecentProgramGrant,
} from '../../lib/services/pre-site-visit/funding-history';

const APPLICANT_ID = '22222222-2222-4222-8222-222222222222';

test('program-grant filter mirrors the account rollup predicate', () => {
  expect(programGrantFilter(APPLICANT_ID)).toBe(
    `_akoya_applicantid_value eq ${APPLICANT_ID} and wmkf_typeforrollup eq 'Program' and akoya_grant gt 0`,
  );
  expect(() => programGrantFilter('not-a-guid')).toThrow(/GUID/);
});

test('loadProgramGrants fetches every matching row with the rollup predicate and surfaces the cap', async () => {
  const rows = [{ akoya_requestid: 'a' }, { akoya_requestid: 'b' }];
  const queryAllRequests = jest.fn().mockResolvedValue({ records: rows, capped: false });
  await expect(loadProgramGrants(APPLICANT_ID, { queryAllRequests })).resolves.toEqual({ records: rows, capped: false });
  expect(queryAllRequests).toHaveBeenCalledWith({
    select: 'akoya_requestid,akoya_requestnum,akoya_fiscalyear,akoya_decisiondate,wmkf_meetingdate,akoya_grant,wmkf_wmkfprojectdescription',
    filter: programGrantFilter(APPLICANT_ID),
  });
  queryAllRequests.mockResolvedValue({ records: rows, capped: true });
  await expect(loadProgramGrants(APPLICANT_ID, { queryAllRequests })).resolves.toMatchObject({ capped: true });
  queryAllRequests.mockRejectedValue(new Error('503'));
  await expect(loadProgramGrants(APPLICANT_ID, { queryAllRequests })).rejects.toThrow('503');
});

test('reconcileProgramGrantRollups accepts agreement and rejects count or sum drift', () => {
  const records = [{ akoya_grant: 1000000 }, { akoya_grant: 750000.5 }];
  expect(reconcileProgramGrantRollups({ records, rollupCount: 2, rollupSum: 1750000.5 })).toEqual({ ok: true });
  expect(reconcileProgramGrantRollups({ records, rollupCount: '2', rollupSum: '1750000.50' })).toEqual({ ok: true });
  // stale-but-positive rollup (7 while live has 8): the Codex P1 case
  expect(reconcileProgramGrantRollups({ records, rollupCount: 1, rollupSum: 1000000 })).toMatchObject({ ok: false, reason: expect.stringContaining('count') });
  expect(reconcileProgramGrantRollups({ records, rollupCount: 2, rollupSum: 1000000 })).toMatchObject({ ok: false, reason: expect.stringContaining('sum') });
  expect(reconcileProgramGrantRollups({ records, rollupCount: 2, rollupSum: null })).toMatchObject({ ok: false });
  // zero rollup vs live rows, and the clean zero case
  expect(reconcileProgramGrantRollups({ records, rollupCount: null, rollupSum: null })).toMatchObject({ ok: false });
  expect(reconcileProgramGrantRollups({ records: [], rollupCount: 0, rollupSum: 0 })).toEqual({ ok: true });
  expect(reconcileProgramGrantRollups({ records: [], rollupCount: null, rollupSum: null })).toEqual({ ok: true });
  expect(reconcileProgramGrantRollups({ records: [], rollupCount: 0, rollupSum: 250000 })).toMatchObject({ ok: false, reason: expect.stringContaining('zero live rows') });
});

test('recency prefers the decision date, falls back to the meeting date, and fails on neither', () => {
  expect(programGrantRecencyDate({ akoya_decisiondate: '2026-06-11T00:00:00Z', wmkf_meetingdate: '2020-01-01' }))
    .toBe(Date.parse('2026-06-11T00:00:00Z'));
  expect(programGrantRecencyDate({ akoya_decisiondate: null, wmkf_meetingdate: '2020-12-01' })).toBe(Date.parse('2020-12-01'));
  expect(programGrantRecencyDate({ akoya_decisiondate: 'garbage', wmkf_meetingdate: null })).toBeNull();
  expect(programGrantRecencyDate({})).toBeNull();

  const older = { akoya_requestnum: '1', akoya_decisiondate: '2019-06-01' };
  const newestUndecided = { akoya_requestnum: '2', akoya_decisiondate: null, wmkf_meetingdate: '2026-06-01' };
  // a server-side `akoya_decisiondate desc` would have returned `older`; code-side recency does not
  expect(selectMostRecentProgramGrant([older, newestUndecided])).toBe(newestUndecided);
  expect(selectMostRecentProgramGrant([])).toBeNull();

  // tie on the date: stable winner regardless of row order
  const tieA = { akoya_requestnum: '1002001', akoya_requestid: 'aaaa', akoya_decisiondate: '2026-06-11' };
  const tieB = { akoya_requestnum: '1002002', akoya_requestid: 'bbbb', akoya_decisiondate: '2026-06-11' };
  expect(selectMostRecentProgramGrant([tieA, tieB])).toBe(tieB);
  expect(selectMostRecentProgramGrant([tieB, tieA])).toBe(tieB);
  const noNumA = { akoya_requestid: 'aaaa', akoya_decisiondate: '2026-06-11' };
  const noNumB = { akoya_requestid: 'bbbb', akoya_decisiondate: '2026-06-11' };
  expect(selectMostRecentProgramGrant([noNumA, noNumB])).toBe(noNumB);
  expect(selectMostRecentProgramGrant([noNumB, noNumA])).toBe(noNumB);
  expect(() => selectMostRecentProgramGrant([older, { akoya_requestnum: '3' }])).toThrow(/1001|3.*ambiguous|ambiguous/);
});

test.each([
  [9150000, '$9.15 million'],
  [1000000, '$1 million'],
  [1500000, '$1.5 million'],
  [12345678, '$12.35 million'],
  [750000, '$750,000'],
  [0, null],
  [null, null],
  ['abc', null],
])('formatAwardTotal(%p) → %p', (amount, expected) => {
  expect(formatAwardTotal(amount)).toBe(expected);
});

test('matches the Power Automate template sentence', () => {
  expect(formatInstitutionalFundingHistory({
    institutionName: 'Emory University',
    programGrantCount: 8,
    programGrantSum: 9150000,
    mostRecentGrant: {
      awardedIn: 'June 2026',
      description: 'To develop chemical tools to restore the function of defective proteins.',
    },
  })).toBe(
    'Emory University has received 8 awards totaling $9.15 million from WMKF. The most recent grant was awarded in June 2026 to develop chemical tools to restore the function of defective proteins.',
  );
});

test('singular award, sub-million total, and description without trailing period', () => {
  expect(formatInstitutionalFundingHistory({
    institutionName: 'Small College',
    programGrantCount: '1',
    programGrantSum: '750000',
    mostRecentGrant: { awardedIn: 'December 2019', description: 'To build a telescope' },
  })).toBe('Small College has received 1 award totaling $750,000 from WMKF. The most recent grant was awarded in December 2019 to build a telescope.');
});

test('leaves acronym-led descriptions capitalized and omits missing parts', () => {
  expect(formatInstitutionalFundingHistory({
    institutionName: 'Tech U',
    programGrantCount: 2,
    programGrantSum: 2000000,
    mostRecentGrant: { awardedIn: 'June 2021', description: 'NMR-guided design of enzymes' },
  })).toBe('Tech U has received 2 awards totaling $2 million from WMKF. The most recent grant was awarded in June 2021 NMR-guided design of enzymes.');
  expect(formatInstitutionalFundingHistory({
    institutionName: 'Tech U',
    programGrantCount: 2,
    programGrantSum: 2000000,
    mostRecentGrant: { awardedIn: null, description: 'To build a telescope' },
  })).toBe('Tech U has received 2 awards totaling $2 million from WMKF.');
  expect(formatInstitutionalFundingHistory({
    institutionName: 'Tech U',
    programGrantCount: 2,
    programGrantSum: 2000000,
    mostRecentGrant: { awardedIn: 'June 2020', description: '   ' },
  })).toBe('Tech U has received 2 awards totaling $2 million from WMKF. The most recent grant was awarded in June 2020.');
  expect(formatInstitutionalFundingHistory({
    institutionName: 'Tech U',
    programGrantCount: 2,
    programGrantSum: 2000000,
    mostRecentGrant: null,
  })).toBe('Tech U has received 2 awards totaling $2 million from WMKF.');
  expect(formatInstitutionalFundingHistory({
    institutionName: 'Tech U',
    programGrantCount: 2,
    programGrantSum: null,
    mostRecentGrant: null,
  })).toBe('Tech U has received 2 awards from WMKF.');
});

test('zero or missing count renders the no-prior-award sentence', () => {
  for (const count of [0, null, undefined, 'n/a']) {
    expect(formatInstitutionalFundingHistory({
      institutionName: 'New U', programGrantCount: count, programGrantSum: 0, mostRecentGrant: null,
    })).toBe('New U has not previously received a program grant from WMKF.');
  }
});

test('requires an institution name', () => {
  expect(() => formatInstitutionalFundingHistory({ institutionName: ' ', programGrantCount: 1, programGrantSum: 1 }))
    .toThrow(/institution name/);
});
