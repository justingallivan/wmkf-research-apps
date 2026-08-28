import {
  findMostRecentProgramGrant,
  formatAwardTotal,
  formatInstitutionalFundingHistory,
  programGrantFilter,
} from '../../lib/services/pre-site-visit/funding-history';

const APPLICANT_ID = '22222222-2222-4222-8222-222222222222';

test('program-grant filter mirrors the account rollup predicate', () => {
  expect(programGrantFilter(APPLICANT_ID)).toBe(
    `_akoya_applicantid_value eq ${APPLICANT_ID} and wmkf_typeforrollup eq 'Program' and akoya_grant gt 0`,
  );
  expect(() => programGrantFilter('not-a-guid')).toThrow(/GUID/);
});

test('findMostRecentProgramGrant queries newest-by-decision-date and returns the first row or null', async () => {
  const row = { akoya_requestid: 'x', akoya_fiscalyear: 'June 2026' };
  const queryRequests = jest.fn().mockResolvedValue({ records: [row] });
  await expect(findMostRecentProgramGrant(APPLICANT_ID, { queryRequests })).resolves.toBe(row);
  expect(queryRequests).toHaveBeenCalledWith({
    select: 'akoya_requestid,akoya_requestnum,akoya_fiscalyear,akoya_decisiondate,wmkf_wmkfprojectdescription',
    filter: programGrantFilter(APPLICANT_ID),
    orderby: 'akoya_decisiondate desc',
    top: 1,
  });
  queryRequests.mockResolvedValue({ records: [] });
  await expect(findMostRecentProgramGrant(APPLICANT_ID, { queryRequests })).resolves.toBeNull();
  queryRequests.mockRejectedValue(new Error('503'));
  await expect(findMostRecentProgramGrant(APPLICANT_ID, { queryRequests })).rejects.toThrow('503');
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
    'Emory University has received 8 awards totaling $9.15 million from WMFK. The most recent grant was awarded in June 2026 to develop chemical tools to restore the function of defective proteins.'.replace('WMFK', 'WMKF'),
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
    mostRecentGrant: { awardedIn: null, description: 'NMR-guided design of enzymes' },
  })).toBe('Tech U has received 2 awards totaling $2 million from WMKF. The most recent grant was awarded NMR-guided design of enzymes.');
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
