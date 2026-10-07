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
