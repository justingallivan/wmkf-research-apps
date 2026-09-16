import { loadPreRpBriefInputs } from '../../lib/services/pre-rp-brief/input-service.js';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const APPLICANT_ID = '22222222-2222-4222-8222-222222222222';

function requestFixture(overrides = {}) {
  return {
    akoya_requestid: REQUEST_ID,
    akoya_requestnum: '1002379',
    akoya_title: 'A test project',
    _akoya_applicantid_value: APPLICANT_ID,
    _akoya_applicantid_value_formatted: 'Applicant University (annotation)',
    _wmkf_projectleader_value_formatted: 'Ada Lovelace',
    _wmkf_programdirector_value_formatted: 'Pat Director',
    wmkf_abstract: 'This project studies a phenomenon of interest.',
    wmkf_meetingdate: '2026-12-01',
    ...overrides,
  };
}

function dependenciesFixture(overrides = {}) {
  return {
    getRequest: jest.fn(async () => requestFixture()),
    getAccount: jest.fn(async () => ({ name: 'Applicant University' })),
    getWriteupRoster: jest.fn(async () => ({ reviews: [{ suggestionId: 'g1', name: 'Reviewer One', reviewReceivedAt: '2026-06-01T00:00:00Z' }], blockers: [] })),
    ...overrides,
  };
}

describe('loadPreRpBriefInputs', () => {
  it('builds the envelope with the exact request field names the renderer expects', async () => {
    const dependencies = dependenciesFixture();
    const result = await loadPreRpBriefInputs({ requestId: REQUEST_ID }, dependencies);

    expect(result.requestNumber).toBe('1002379');
    expect(result.cycleCode).toBeTruthy();
    expect(result.envelope).toEqual({
      schemaVersion: 1,
      artifactType: 'pre-rp-brief',
      request: {
        institutionName: 'Applicant University',
        projectTitle: 'A test project',
        principalInvestigator: 'Ada Lovelace',
        programDirector: 'Pat Director',
        abstract: 'This project studies a phenomenon of interest.',
      },
      reviews: [{ suggestionId: 'g1', name: 'Reviewer One', reviewReceivedAt: '2026-06-01T00:00:00Z' }],
    });
  });

  it('prefers the resolved Account name over the annotation, mirroring the briefing page', async () => {
    const dependencies = dependenciesFixture({
      getAccount: jest.fn(async () => ({ name: 'Resolved Account Name' })),
    });
    const result = await loadPreRpBriefInputs({ requestId: REQUEST_ID }, dependencies);
    expect(result.envelope.request.institutionName).toBe('Resolved Account Name');
  });

  it('falls back to the annotation name when the Account lookup fails (fail-soft, not fail-closed)', async () => {
    const dependencies = dependenciesFixture({
      getAccount: jest.fn(async () => { throw new Error('Account read failed'); }),
    });
    const result = await loadPreRpBriefInputs({ requestId: REQUEST_ID }, dependencies);
    expect(result.envelope.request.institutionName).toBe('Applicant University (annotation)');
  });

  it('fails closed on a missing abstract with the named message, before the roster is read', async () => {
    const dependencies = dependenciesFixture({
      getRequest: jest.fn(async () => requestFixture({ wmkf_abstract: '   ' })),
    });
    await expect(loadPreRpBriefInputs({ requestId: REQUEST_ID }, dependencies))
      .rejects.toThrow('Add the abstract on the Reviews tab first.');
    expect(dependencies.getWriteupRoster).not.toHaveBeenCalled();
  });

  it('fails closed when the request has no meeting-date cycle', async () => {
    const dependencies = dependenciesFixture({
      getRequest: jest.fn(async () => requestFixture({ wmkf_meetingdate: null })),
    });
    await expect(loadPreRpBriefInputs({ requestId: REQUEST_ID }, dependencies))
      .rejects.toThrow(/meeting-date cycle/);
  });

  it('fails closed on an invalid requestId before any read', async () => {
    const dependencies = dependenciesFixture();
    await expect(loadPreRpBriefInputs({ requestId: 'not-a-guid' }, dependencies))
      .rejects.toThrow('A valid requestId is required.');
    expect(dependencies.getRequest).not.toHaveBeenCalled();
  });

  it('fails closed when the resolved request does not match the requested id', async () => {
    const dependencies = dependenciesFixture({
      getRequest: jest.fn(async () => requestFixture({ akoya_requestid: '99999999-9999-4999-8999-999999999999' })),
    });
    await expect(loadPreRpBriefInputs({ requestId: REQUEST_ID }, dependencies))
      .rejects.toThrow('The request could not be resolved.');
  });
});
