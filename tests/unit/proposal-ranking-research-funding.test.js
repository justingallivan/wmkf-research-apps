import { summarizeResearchFunding } from '../../lib/services/proposal-ranking/research-funding';
import { RESEARCH_PROGRAM_IDS } from '../../shared/config/researchPrograms';
const currencies = new Map([['usd', { isocurrencycode: 'USD' }]]);
const grant = {
  wmkf_typeforrollup: 'Program',
  _akoya_programid_value: RESEARCH_PROGRAM_IDS[0],
  _wmkf_grantprogram_value_formatted: 'Research',
  akoya_requeststatus: 'Approved',
  wmkf_supporttype2: '100000004',
  akoya_requestnum: '123',
  _transactioncurrencyid_value: 'usd',
  akoya_grant: 100,
  akoya_fiscalyear: 'June 2020',
  akoya_decisiondate: '2021-02-01',
};
const account = { wmkf_countofprogramgrants: 1, wmkf_sumofprogramgrants: 100 };
test('count and fiscal award year retain no public dollar total', () => {
  expect(summarizeResearchFunding([grant], account, currencies)).toEqual({
    status: 'available',
    qualifyingGrantCount: 1,
    latestAwardYear: 2020,
  });
});
test('zero qualifying awards differs from unavailable or provisional coverage', () => {
  expect(summarizeResearchFunding([], {}, currencies)).toEqual({
    status: 'available',
    qualifyingGrantCount: 0,
    latestAwardYear: null,
  });
  expect(summarizeResearchFunding([grant], {}, currencies).status).toBe(
    'unavailable',
  );
  expect(
    summarizeResearchFunding(
      [{ ...grant, akoya_requestnum: '881024' }],
      account,
      currencies,
    ).status,
  ).toBe('provisional');
  expect(
    summarizeResearchFunding(
      [{ ...grant, wmkf_supporttype2: '100000000' }],
      account,
      currencies,
    ).qualifyingGrantCount,
  ).toBe(0);
  expect(
    summarizeResearchFunding(
      [{ ...grant, wmkf_supporttype2: null }],
      account,
      currencies,
    ).status,
  ).toBe('unavailable');
});
