import JSZip from 'jszip';
import { REQUEST_SELECT, loadPreRpBriefInputs } from '../../lib/services/pre-rp-brief/input-service.js';
import { briefInputFingerprint, renderBrief } from '../../lib/services/pre-rp-brief/docx-renderer.js';

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

// Shape matches getWriteupRoster's real per-reviewer object
// (lib/services/review-manager/reviewers-service.js:597-614), not a
// hand-picked subset — Round-2 finding 1: never mock the return shape of a
// real function differently from its source.
function reviewerFixture(overrides = {}) {
  return {
    suggestionId: 'g1',
    name: 'Reviewer One',
    email: 'reviewer.one@example.org',
    reviewerAffiliation: null,
    affiliation: null,
    lastName: 'One',
    academicRank: 'professor',
    mainInstitution: 'University of Kansas Medical Center',
    areaOfExpertise: null,
    keywords: null,
    reviewReceivedAt: '2026-06-01T00:00:00Z',
    reviewerOverallAssessment: 5,
    answers: [],
    ...overrides,
  };
}

function writeupRosterFixture(overrides = {}) {
  return {
    reviewers: [reviewerFixture()],
    blockers: [],
    ...overrides,
  };
}

function dependenciesFixture(overrides = {}) {
  return {
    getRequest: jest.fn(async () => requestFixture()),
    getAccount: jest.fn(async () => ({ name: 'Applicant University' })),
    getWriteupRoster: jest.fn(async () => writeupRosterFixture()),
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
      reviews: [reviewerFixture()],
    });
  });

  it('maps getWriteupRoster\'s `reviewers` array (not a `reviews` field, which it does not have) into envelope.reviews', async () => {
    // Discriminating: getWriteupRoster's real return shape is
    // { reviewers, blockers } — a mock or implementation that reads
    // `.reviews` off that result gets `undefined`, not an array.
    const roster = writeupRosterFixture({
      reviewers: [reviewerFixture({ suggestionId: 'g2', name: 'Distinct Reviewer', academicRank: 'associate professor' })],
    });
    const dependencies = dependenciesFixture({ getWriteupRoster: jest.fn(async () => roster) });
    const result = await loadPreRpBriefInputs({ requestId: REQUEST_ID }, dependencies);

    expect(Array.isArray(result.envelope.reviews)).toBe(true);
    expect(result.envelope.reviews).toHaveLength(1);
    const [survived] = result.envelope.reviews;
    expect(survived.suggestionId).toBe('g2');
    expect(survived.name).toBe('Distinct Reviewer');
    expect(survived.academicRank).toBe('associate professor');
    expect(survived.reviewReceivedAt).toBe('2026-06-01T00:00:00Z');
  });

  it('composes end to end: real loadPreRpBriefInputs output renders and fingerprints without drift (Round-2 finding 1)', async () => {
    // No mocking of briefInputFingerprint/renderBrief's contract here — feed
    // the actual envelope this service builds, from a realistic roster
    // stub, straight into the actual renderer functions. If the roster
    // field-name seam (reviewers vs reviews) ever drifts again, this fails
    // with "reviews is not an array" or a rendered document missing the
    // referee sentence, not a passing mock.
    const dependencies = dependenciesFixture({
      getWriteupRoster: jest.fn(async () => writeupRosterFixture()),
    });
    const { envelope } = await loadPreRpBriefInputs({ requestId: REQUEST_ID }, dependencies);

    const fingerprint = briefInputFingerprint(envelope);
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);

    const { docx } = await renderBrief(envelope);
    const zip = await JSZip.loadAsync(docx);
    const documentXml = await zip.file('word/document.xml').async('string');
    expect(documentXml).toContain('Reviewer One');
    expect(documentXml).not.toMatch(/\[\[(?:DV|STAFF):/);
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

describe('REQUEST_SELECT', () => {
  // Production 2026-09-16: Dataverse returned 400 0x80060888 because the
  // select named `_akoya_applicantid_value_formatted` as a property. Formatted
  // values are annotations, never selectable columns.
  it('selects base lookups only and never a `_formatted` annotation name', () => {
    const fields = REQUEST_SELECT.split(',');
    expect(fields.some((f) => f.endsWith('_formatted'))).toBe(false);
    expect(fields).toEqual(expect.arrayContaining([
      '_akoya_applicantid_value', '_wmkf_projectleader_value', '_wmkf_programdirector_value',
    ]));
  });
});
