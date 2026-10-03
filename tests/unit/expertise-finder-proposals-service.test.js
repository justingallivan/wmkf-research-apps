/**
 * Unit tests for lib/services/expertise-finder/proposals-service.js
 * (Stage 5 batch 1). Logic-level, adapter mocked.
 *
 * @jest-environment node
 */

jest.mock('../../lib/dataverse/adapters/grant-request.js', () => ({
  queryAllRequests: jest.fn(),
}));

import * as grantRequestAdapter from '../../lib/dataverse/adapters/grant-request.js';
import { queryProposals } from '../../lib/services/expertise-finder/proposals-service';

const record = (over = {}) => ({
  akoya_requestid: 'r1', akoya_requestnum: '2025-100', akoya_title: 'A Study',
  _akoya_programid_value_formatted: 'Science & Engineering', _akoya_programid_value: 'prog-1',
  _akoya_applicantid_value_formatted: 'Some University',
  _wmkf_projectleader_value_formatted: 'Dr. PI', _wmkf_programdirector_value_formatted: 'Dr. PD',
  wmkf_phaseistatus_formatted: 'Invited', wmkf_phaseiistatus_formatted: 'Pending',
  ...over,
});

beforeEach(() => {
  delete process.env.TEST_REQUEST_ISOLATION;
  grantRequestAdapter.queryAllRequests.mockReset();
});

afterEach(() => { delete process.env.TEST_REQUEST_ISOLATION; });

describe('queryProposals', () => {
  it('builds the historical filter/select/orderby and projects the DTO', async () => {
    grantRequestAdapter.queryAllRequests.mockResolvedValueOnce({ records: [record()] });
    const r = await queryProposals({ cycleCode: 'D25' });
    expect(grantRequestAdapter.queryAllRequests).toHaveBeenCalledWith(expect.objectContaining({
      filter: 'wmkf_meetingdate ge 2025-12-01T00:00:00Z and wmkf_meetingdate lt 2026-01-01T00:00:00Z and wmkf_request_type eq 100000001',
      orderby: 'akoya_requestnum asc',
    }));
    expect(r).toEqual({
      proposals: [{
        requestId: 'r1', requestNumber: '2025-100', title: 'A Study',
        program: 'Science & Engineering', programId: 'prog-1', institution: 'Some University',
        pi: 'Dr. PI', actualPd: 'Dr. PD', phaseIStatus: 'Invited', phaseIIStatus: 'Pending',
      }],
      totalCount: 1,
      cycleCode: 'D25',
      program: 'all',
    });
  });

  it('program=SE keeps only S&E-pattern programs; totalCount reflects the filtered set', async () => {
    grantRequestAdapter.queryAllRequests.mockResolvedValueOnce({
      records: [
        record(),
        record({ akoya_requestid: 'r2', _akoya_programid_value_formatted: 'Medical Research' }),
      ],
    });
    const r = await queryProposals({ cycleCode: 'D25', program: 'SE' });
    expect(r.proposals.map((p) => p.requestId)).toEqual(['r1']);
    expect(r.totalCount).toBe(1);
    expect(r.program).toBe('SE');
  });

  it('Stage 1d badges test rows but excludes them from the cycle total', async () => {
    process.env.TEST_REQUEST_ISOLATION = 'on';
    grantRequestAdapter.queryAllRequests.mockResolvedValueOnce({
      records: [record({
        wmkf_istestrequest: true,
        wmkf_testcreationrunid: '22222222-2222-4222-8222-222222222222',
      })],
    });
    const result = await queryProposals({ cycleCode: 'D25' });
    expect(grantRequestAdapter.queryAllRequests.mock.calls[0][0].select).toContain('wmkf_istestrequest');
    expect(result.proposals[0].isTestRequest).toBe(true);
    expect(result.totalCount).toBe(0);
  });

  it('unknown program code leaves the set unfiltered (historical behavior)', async () => {
    grantRequestAdapter.queryAllRequests.mockResolvedValueOnce({ records: [record()] });
    const r = await queryProposals({ cycleCode: 'D25', program: 'XX' });
    expect(r.proposals).toHaveLength(1);
    expect(r.program).toBe('XX');
  });

  it('fallback fields: missing formatted values project to empty strings / Untitled', async () => {
    grantRequestAdapter.queryAllRequests.mockResolvedValueOnce({
      records: [{ akoya_requestid: 'r3', akoya_requestnum: 'n', wmkf_phaseistatus: 5 }],
    });
    const r = await queryProposals({ cycleCode: 'J24' });
    expect(r.proposals[0]).toMatchObject({
      title: 'Untitled', program: '', institution: '', pi: '', actualPd: '',
      phaseIStatus: '5', phaseIIStatus: '',
    });
  });

  it('an unparseable cycle code throws before any query (fail loud, never a silent empty set)', async () => {
    await expect(queryProposals({ cycleCode: 'December 2025' })).rejects.toThrow('Invalid cycle code "December 2025"');
    expect(grantRequestAdapter.queryAllRequests).not.toHaveBeenCalled();
  });

  it('adapter errors propagate raw for the shell to map to 500', async () => {
    grantRequestAdapter.queryAllRequests.mockRejectedValueOnce(new Error('boom'));
    await expect(queryProposals({ cycleCode: 'J24' })).rejects.toThrow('boom');
  });
});
