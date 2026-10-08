jest.mock('../../lib/services/dynamics-service.js', () => ({
  DynamicsService: {
    queryAllRecords: jest.fn(),
    getRecord: jest.fn(),
  },
}));
jest.mock('../../lib/dataverse/adapters/review-answer.js', () => ({
  fetchAnswersBySuggestion: jest.fn(async () => ({})),
}));

import { DynamicsService } from '../../lib/services/dynamics-service.js';
import {
  listEnabledProposalRankingStaff,
  readEnabledProposalRankingStaff,
  readProposalRankingSource,
} from '../../lib/dataverse/adapters/proposal-ranking-source.js';
import { RESEARCH_PROGRAM_IDS } from '../../shared/config/researchPrograms.js';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const LEAD_ID = '22222222-2222-4222-8222-222222222222';
const CURRENCY_ID = '33333333-3333-4333-8333-333333333333';

beforeEach(() => {
  jest.clearAllMocks();
});

test('reads Dataverse currency precision and active staff using their verified raw fields', async () => {
  DynamicsService.queryAllRecords.mockImplementation(async (entitySet, options) => {
    if (entitySet === 'akoya_requests') {
      return { records: [{
        akoya_requestid: REQUEST_ID,
        akoya_requestnum: '1001',
        akoya_title: 'Proposal',
        akoya_request: 123.45,
        wmkf_organizationname: 'Institute',
        wmkf_meetingdate: '2026-06-15T00:00:00Z',
        akoya_requeststatus: 'Phase II Pending',
        wmkf_istestrequest: null,
        wmkf_testcreationrunid: null,
        _akoya_programid_value: RESEARCH_PROGRAM_IDS[0],
        _wmkf_programdirector_value: LEAD_ID,
        _transactioncurrencyid_value: CURRENCY_ID,
      }] };
    }
    if (entitySet === 'wmkf_appreviewersuggestions') return { records: [] };
    if (entitySet === 'transactioncurrencies') return { records: [{
      transactioncurrencyid: CURRENCY_ID,
      currencyname: 'US Dollar',
      isocurrencycode: 'USD',
      currencyprecision: 2,
    }] };
    if (entitySet === 'systemusers') return { records: [{
      systemuserid: LEAD_ID,
      fullname: 'Active staff',
      isdisabled: false,
    }] };
    throw new Error(`Unexpected source entity set: ${entitySet}`);
  });

  const source = await readProposalRankingSource('J26', {
    TEST_REQUEST_ISOLATION: 'on',
    SYNTHETIC_REVIEWER_ISOLATION: 'on',
  });

  expect(source.proposals[0].currency).toEqual({
    id: CURRENCY_ID,
    code: 'USD',
    name: 'US Dollar',
    precision: 2,
  });
  expect(source.proposals[0].leadSystemUser).toEqual({
    systemuserid: LEAD_ID,
    fullname: 'Active staff',
    isdisabled: false,
  });
  expect(DynamicsService.queryAllRecords).toHaveBeenCalledWith('transactioncurrencies', expect.objectContaining({
    select: 'transactioncurrencyid,currencyname,isocurrencycode,currencyprecision',
  }));
  expect(DynamicsService.queryAllRecords).toHaveBeenCalledWith('systemusers', expect.objectContaining({
    select: 'systemuserid,fullname,isdisabled',
    filter: expect.stringContaining('systemuserid eq'),
  }));
  expect(DynamicsService.queryAllRecords.mock.calls.some(([, options]) => options.select?.includes('statecode'))).toBe(false);
});

test('maps only the verified applicant-account East and West options; unknown or missing stays null', async () => {
  const eastId = '44444444-4444-4444-8444-444444444444';
  const westId = '55555555-5555-4555-8555-555555555555';
  const unknownId = '66666666-6666-4666-8666-666666666666';
  const rows = [
    { akoya_requestid: REQUEST_ID, _akoya_applicantid_value: eastId, wmkf_eastwest: undefined },
    { akoya_requestid: '77777777-7777-4777-8777-777777777777', _akoya_applicantid_value: westId },
    { akoya_requestid: '88888888-8888-4888-8888-888888888888', _akoya_applicantid_value: unknownId },
    { akoya_requestid: '99999999-9999-4999-8999-999999999999' },
  ].map((row) => ({
    akoya_requestnum: '1001', akoya_title: 'Proposal', akoya_request: null,
    wmkf_organizationname: 'Institute', wmkf_meetingdate: '2026-06-15T00:00:00Z',
    akoya_requeststatus: 'Phase II Pending', wmkf_istestrequest: null,
    wmkf_testcreationrunid: null, _akoya_programid_value: RESEARCH_PROGRAM_IDS[0],
    _wmkf_programdirector_value: null, _transactioncurrencyid_value: null, ...row,
  }));
  DynamicsService.queryAllRecords.mockImplementation(async (entitySet) => {
    if (entitySet === 'akoya_requests') return { records: rows };
    if (entitySet === 'wmkf_appreviewersuggestions') return { records: [] };
    if (entitySet === 'accounts') return { records: [
      { accountid: eastId, wmkf_eastwest: 100000000 },
      { accountid: westId, wmkf_eastwest: 100000001 },
      { accountid: unknownId, wmkf_eastwest: 100000099 },
    ] };
    throw new Error(`Unexpected source entity set: ${entitySet}`);
  });

  const source = await readProposalRankingSource('J26', {
    TEST_REQUEST_ISOLATION: 'on',
    SYNTHETIC_REVIEWER_ISOLATION: 'on',
  });

  expect(source.proposals.map((proposal) => proposal.institutionGeography)).toEqual(['East', 'West', null, null]);
  expect(DynamicsService.queryAllRecords).toHaveBeenCalledWith('akoya_requests', expect.objectContaining({
    select: expect.stringContaining('_akoya_applicantid_value'),
  }));
  expect(DynamicsService.queryAllRecords).toHaveBeenCalledWith('accounts', expect.objectContaining({
    select: 'accountid,wmkf_eastwest',
    filter: expect.stringContaining('accountid eq'),
  }));
});

test('staff readiness treats only explicit isdisabled false as active', async () => {
  DynamicsService.queryAllRecords.mockResolvedValue({ records: [
    { systemuserid: LEAD_ID, fullname: 'Active staff', isdisabled: false },
    { systemuserid: CURRENCY_ID, fullname: 'Unknown staff', isdisabled: null },
  ] });
  DynamicsService.getRecord
    .mockResolvedValueOnce({ systemuserid: LEAD_ID, fullname: 'Active staff', isdisabled: false })
    .mockResolvedValueOnce({ systemuserid: LEAD_ID, fullname: 'Unknown staff', isdisabled: null })
    .mockResolvedValueOnce({ systemuserid: LEAD_ID, fullname: 'Disabled staff', isdisabled: true });

  const listed = await listEnabledProposalRankingStaff();
  expect(listed.map(({ enabled }) => enabled)).toEqual([true, false]);
  expect(DynamicsService.queryAllRecords).toHaveBeenCalledWith('systemusers', expect.objectContaining({
    select: 'systemuserid,fullname,isdisabled',
    filter: 'isdisabled eq false',
  }));
  await expect(readEnabledProposalRankingStaff(LEAD_ID)).resolves.toEqual({
    systemUserId: LEAD_ID,
    name: 'Active staff',
    enabled: true,
  });
  await expect(readEnabledProposalRankingStaff(LEAD_ID)).resolves.toBeNull();
  await expect(readEnabledProposalRankingStaff(LEAD_ID)).resolves.toBeNull();
});
