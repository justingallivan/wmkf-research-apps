import { summarizeResearchFunding } from '../../lib/services/proposal-ranking/research-funding.js';
import { RESEARCH_PROGRAM_IDS } from '../../shared/config/researchPrograms.js';

const currencies = new Map([['usd', { isocurrencycode: 'USD' }]]);
const grant = (patch = {}) => ({
  akoya_requestnum: '42', akoya_grant: 2000000, akoya_requeststatus: 'Closed',
  _akoya_programid_value: RESEARCH_PROGRAM_IDS[0], _wmkf_grantprogram_value_formatted: 'Research',
  wmkf_typeforrollup: 'Program', wmkf_supporttype2: '100000033',
  _transactioncurrencyid_value: 'usd', akoya_fiscalyear: 'December 2014',
  wmkf_meetingdate: '2014-12-11', akoya_decisiondate: '2015-01-05', ...patch,
});
const summarize = (rows, account = {}) => summarizeResearchFunding(rows, {
  wmkf_countofprogramgrants: rows.filter((row) => row.wmkf_typeforrollup === 'Program').length,
  wmkf_sumofprogramgrants: rows.filter((row) => row.wmkf_typeforrollup === 'Program').reduce((sum, row) => sum + row.akoya_grant, 0),
  ...account,
}, currencies);

test('research bucket retains equipment and project fellowships, not just the Research support tag', () => {
  expect(summarize([grant(), grant({ wmkf_supporttype2: '100000016', akoya_grant: 1500000 })])).toEqual({
    status: 'available', totalUsd: 3500000, qualifyingGrantCount: 2, lastAwardCycle: '2014-12',
  });
});

test.each([
  { wmkf_typeforrollup: 'Discretionary' }, { wmkf_typeforrollup: 'Special Grants' },
  { wmkf_typeforrollup: 'Special Projects' }, { _wmkf_grantprogram_value_formatted: 'Young Scholars' },
  { _akoya_programid_value: 'other-program' }, { wmkf_supporttype2: '100000001' },
  { wmkf_supporttype2: '100000033,100000015' }, { wmkf_supporttype2: '100000014' },
  { wmkf_supporttype2: '100000035' }, { wmkf_supporttype2: '100000036' },
  { wmkf_supporttype2: '100000024' }, { wmkf_supporttype2: '100000023' },
  { wmkf_supporttype2: '100000000' }, { wmkf_supporttype2: '100000009' },
  { akoya_requestnum: '800308' }, { akoya_requestnum: '860843' }, { akoya_requestnum: '963245' },
])('excludes nonqualifying support from subtotal AND latest date: %j', (patch) => {
  expect(summarize([grant(), grant({ ...patch, akoya_fiscalyear: 'June 2026', akoya_grant: 166000000 })])).toEqual({
    status: 'available', totalUsd: 2000000, qualifyingGrantCount: 1, lastAwardCycle: '2014-12',
  });
});

test('empty reconciled history is zero, whereas missing identities and inconsistent rollups are unavailable', () => {
  expect(summarize([])).toMatchObject({ status: 'available', totalUsd: 0, lastAwardCycle: null, qualifyingGrantCount: 0 });
  expect(summarizeResearchFunding([], null, currencies).status).toBe('unavailable');
  expect(summarize([], { wmkf_sumofprogramgrants: 100 }).status).toBe('unavailable');
  expect(summarize([grant()], { wmkf_countofprogramgrants: 2 }).status).toBe('unavailable');
});

test.each([
  { _wmkf_grantprogram_value_formatted: null }, { _akoya_programid_value: null },
  { wmkf_supporttype2: '999999999' }, { wmkf_supporttype2: null },
  { _transactioncurrencyid_value: 'unknown' }, { akoya_requeststatus: 'Phase II Pending' },
  { akoya_fiscalyear: null, wmkf_meetingdate: null, akoya_decisiondate: null },
])('unknown history never becomes zero or a partial subtotal: %j', (patch) => {
  expect(summarize([grant(patch)])).toMatchObject({ status: 'unavailable', totalUsd: null });
});

test('known mixed support is provisional and dates prefer award cycle over administrative decision dates', () => {
  expect(summarize([grant({ akoya_requestnum: '881024' }), grant({ akoya_fiscalyear: 'June 2025', akoya_decisiondate: '2026-02-18' })])).toMatchObject({ status: 'provisional', totalUsd: 4000000, lastAwardCycle: '2025-06' });
  expect(summarize([grant({ akoya_fiscalyear: null })]).lastAwardCycle).toBe('2014-12');
});

test('audited blank research tags remain available, general support remains provisional', () => {
  expect(summarize([grant({ akoya_requestnum: '997140', wmkf_supporttype2: null })]).status).toBe('available');
  expect(summarize([grant({ wmkf_supporttype2: '100000034' })]).status).toBe('provisional');
});
