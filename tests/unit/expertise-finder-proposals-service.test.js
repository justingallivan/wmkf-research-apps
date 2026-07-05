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
  grantRequestAdapter.queryAllRequests.mockReset();
});

describe('queryProposals', () => {
  it('builds the historical filter/select/orderby and projects the DTO', async () => {
    grantRequestAdapter.queryAllRequests.mockResolvedValueOnce({ records: [record()] });
    const r = await queryProposals({ fiscalYear: 'December 2025' });
    expect(grantRequestAdapter.queryAllRequests).toHaveBeenCalledWith(expect.objectContaining({
      filter: "akoya_fiscalyear eq 'December 2025' and wmkf_request_type eq 100000001",
      orderby: 'akoya_requestnum asc',
    }));
    expect(r).toEqual({
      proposals: [{
        requestId: 'r1', requestNumber: '2025-100', title: 'A Study',
        program: 'Science & Engineering', programId: 'prog-1', institution: 'Some University',
        pi: 'Dr. PI', actualPd: 'Dr. PD', phaseIStatus: 'Invited', phaseIIStatus: 'Pending',
      }],
      totalCount: 1,
      fiscalYear: 'December 2025',
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
    const r = await queryProposals({ fiscalYear: 'December 2025', program: 'SE' });
    expect(r.proposals.map((p) => p.requestId)).toEqual(['r1']);
    expect(r.totalCount).toBe(1);
    expect(r.program).toBe('SE');
  });

  it('unknown program code leaves the set unfiltered (historical behavior)', async () => {
    grantRequestAdapter.queryAllRequests.mockResolvedValueOnce({ records: [record()] });
    const r = await queryProposals({ fiscalYear: 'December 2025', program: 'XX' });
    expect(r.proposals).toHaveLength(1);
    expect(r.program).toBe('XX');
  });

  it('fallback fields: missing formatted values project to empty strings / Untitled', async () => {
    grantRequestAdapter.queryAllRequests.mockResolvedValueOnce({
      records: [{ akoya_requestid: 'r3', akoya_requestnum: 'n', wmkf_phaseistatus: 5 }],
    });
    const r = await queryProposals({ fiscalYear: 'FY' });
    expect(r.proposals[0]).toMatchObject({
      title: 'Untitled', program: '', institution: '', pi: '', actualPd: '',
      phaseIStatus: '5', phaseIIStatus: '',
    });
  });

  it('adapter errors propagate raw for the shell to map to 500', async () => {
    grantRequestAdapter.queryAllRequests.mockRejectedValueOnce(new Error('boom'));
    await expect(queryProposals({ fiscalYear: 'FY' })).rejects.toThrow('boom');
  });
});
