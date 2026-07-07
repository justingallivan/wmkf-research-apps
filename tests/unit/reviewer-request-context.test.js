/**
 * @jest-environment node
 */

const getRecord = jest.fn();
jest.mock('../../lib/services/dynamics-service.js', () => ({
  DynamicsService: { getRecord: (...a) => getRecord(...a) },
}));

const fetchCoPIs = jest.fn(async () => []);
jest.mock('../../lib/services/proposal-participants.js', () => ({
  fetchCoPIs: (...a) => fetchCoPIs(...a),
}));

const resolveProposalPI = jest.fn(async () => ({ resolved: false, reason: 'no_orcid' }));
const piInstitutions = jest.fn(() => []);
jest.mock('../../lib/services/proposal-pi-identity.js', () => ({
  resolveProposalPI: (...a) => resolveProposalPI(...a),
  piInstitutions: (...a) => piInstitutions(...a),
}));

import {
  formatTrustedRequestMetadata,
  loadCoiContext,
  loadReviewerRequestContext,
  mergeRequestContextIntoAnalysisResult,
  projectReviewerRequestContext,
} from '../../lib/services/reviewer-request-context.js';

const REQUEST_ID = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  jest.clearAllMocks();
  fetchCoPIs.mockResolvedValue([]);
  resolveProposalPI.mockResolvedValue({ resolved: false, reason: 'no_orcid' });
  piInstitutions.mockReturnValue([]);
});

describe('reviewer request context', () => {
  test('projects Dataverse request metadata into the stable proposalInfo fields', () => {
    const context = projectReviewerRequestContext({
      akoya_requestid: '11111111-1111-1111-1111-111111111111',
      akoya_title: 'Request Title',
      wmkf_abstract: 'Request abstract',
      _akoya_applicantid_value_formatted: 'Applicant University',
      _wmkf_projectleader_value_formatted: 'Dr. PI',
      _akoya_programid_value_formatted: 'Science and Engineering Research',
      _wmkf_programareaserved_value_formatted: 'Stale Program',
      _wmkf_grantprogram_value_formatted: 'Research',
    }, ['Dr. Co A', 'Dr. Co B']);

    expect(context).toMatchObject({
      title: 'Request Title',
      programArea: 'Science and Engineering Research',
      principalInvestigator: 'Dr. PI',
      proposalAuthors: 'Dr. PI',
      coInvestigators: 'Dr. Co A, Dr. Co B',
      coInvestigatorCount: '2',
      authorInstitution: 'Applicant University',
      abstract: 'Request abstract',
    });
  });

  test('merges Dataverse-owned fields without disturbing scientific analysis fields', () => {
    const merged = mergeRequestContextIntoAnalysisResult({
      proposalInfo: {
        title: 'LLM title',
        primaryResearchArea: 'Geoscience',
        keywords: 'ice, paleoclimate',
      },
      reviewerSuggestions: [{ name: 'Dr. Reviewer' }],
      searchQueries: { pubmed: [], arxiv: [], biorxiv: [], chemrxiv: [] },
    }, {
      title: 'Request title',
      programArea: 'Science',
      principalInvestigator: 'Dr. PI',
      proposalAuthors: 'Dr. PI',
      coInvestigators: 'None',
      coInvestigatorCount: '0',
      authorInstitution: 'University',
      abstract: 'Request abstract',
    });

    expect(merged.proposalInfo).toMatchObject({
      title: 'Request title',
      programArea: 'Science',
      principalInvestigator: 'Dr. PI',
      primaryResearchArea: 'Geoscience',
      keywords: 'ice, paleoclimate',
    });
    expect(merged.reviewerSuggestions).toHaveLength(1);
  });

  test('requires a requestId when loading Dataverse context', async () => {
    await expect(loadReviewerRequestContext(null)).rejects.toMatchObject({
      statusCode: 400,
      message: 'requestId is required for reviewer analysis',
    });
  });

  test('golden path: loads the akoya_request row and projects trusted context', async () => {
    getRecord.mockResolvedValue({
      akoya_requestid: REQUEST_ID,
      akoya_title: 'Request Title',
      wmkf_abstract: 'Request abstract',
      _akoya_applicantid_value_formatted: 'Applicant University',
      _wmkf_projectleader_value_formatted: 'Dr. PI',
      _akoya_programid_value_formatted: 'Science and Engineering Research',
    });
    fetchCoPIs.mockResolvedValue(['Dr. Co A']);

    const context = await loadReviewerRequestContext(REQUEST_ID);

    expect(getRecord).toHaveBeenCalledWith('akoya_requests', REQUEST_ID, expect.objectContaining({
      select: expect.stringContaining('akoya_requestid'),
    }));
    expect(fetchCoPIs).toHaveBeenCalledWith(REQUEST_ID);
    expect(context).toMatchObject({
      requestId: REQUEST_ID,
      title: 'Request Title',
      programArea: 'Science and Engineering Research',
      principalInvestigator: 'Dr. PI',
      coInvestigators: 'Dr. Co A',
      abstract: 'Request abstract',
    });
  });

  test('applicant account fetch failure warns and falls back to formatted institution names', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    getRecord
      .mockResolvedValueOnce({
        akoya_requestid: REQUEST_ID,
        akoya_title: 'Request Title',
        wmkf_abstract: 'Request abstract',
        _akoya_applicantid_value: '22222222-2222-4222-8222-222222222222',
        _akoya_applicantid_value_formatted: 'Applicant University',
        wmkf_organizationname: 'Applicant U',
        _wmkf_projectleader_value_formatted: 'Dr. PI',
      })
      .mockRejectedValueOnce(new Error('account read failed'))
      .mockRejectedValueOnce(new Error('account read failed'));

    const context = await loadReviewerRequestContext(REQUEST_ID);

    expect(context.applicantInstitutionNames).toEqual(['Applicant University', 'Applicant U']);
    expect(warnSpy).toHaveBeenCalledWith(
      '[reviewer-request-context] applicant_account_variant_fetch_failed',
      expect.objectContaining({
        requestId: REQUEST_ID,
        applicantId: '22222222-2222-4222-8222-222222222222',
        attempts: 2,
        error: 'account read failed',
      }),
    );
    warnSpy.mockRestore();
  });

  test('save-time COI context skips Co-PI reads and includes complete applicant variants', async () => {
    fetchCoPIs.mockRejectedValue(new Error('Co-PI read failed'));
    resolveProposalPI.mockResolvedValue({
      resolved: true,
      currentAffiliation: 'PI University',
    });
    piInstitutions.mockReturnValue([{ name: 'PI University' }]);
    getRecord
      .mockResolvedValueOnce({
        akoya_requestid: REQUEST_ID,
        akoya_title: 'Request Title',
        wmkf_abstract: 'Request abstract',
        _akoya_applicantid_value: '22222222-2222-4222-8222-222222222222',
        _akoya_applicantid_value_formatted: 'Applicant University',
        wmkf_organizationname: 'Applicant U',
        _wmkf_projectleader_value_formatted: 'Dr. PI',
      })
      .mockResolvedValueOnce({
        name: 'Applicant University',
        akoya_aka: 'Applicant U',
        wmkf_legalname: 'Applicant University Legal Name',
      });

    const context = await loadCoiContext(REQUEST_ID);

    expect(fetchCoPIs).not.toHaveBeenCalled();
    expect(resolveProposalPI).toHaveBeenCalledWith(REQUEST_ID, { signal: undefined });
    expect(context.applicantInstitutionContext).toMatchObject({
      state: 'complete',
      applicantAccountId: '22222222-2222-4222-8222-222222222222',
      names: ['Applicant University', 'Applicant U', 'Applicant University Legal Name'],
    });
    expect(context.requestContext.coInvestigators).toBe('None');
    expect(context.institutionEntries).toEqual([
      { identity: 'Applicant University', display: 'Applicant University' },
      { identity: 'Applicant U', display: 'Applicant U' },
      { identity: 'Applicant University Legal Name', display: 'Applicant University Legal Name' },
      { identity: { name: 'PI University' }, display: 'PI University' },
    ]);
  });

  test('save-time COI context treats absent applicant lookup as complete when formatted names exist', async () => {
    getRecord.mockResolvedValueOnce({
      akoya_requestid: REQUEST_ID,
      _akoya_applicantid_value_formatted: 'Formatted Applicant University',
    });

    const context = await loadCoiContext(REQUEST_ID);

    expect(context.applicantInstitutionContext).toMatchObject({
      state: 'complete',
      applicantAccountId: null,
      names: ['Formatted Applicant University'],
    });
    expect(context.institutionEntries).toEqual([
      { identity: 'Formatted Applicant University', display: 'Formatted Applicant University' },
    ]);
  });

  test('save-time COI context marks PI read failures as failed resolution state', async () => {
    resolveProposalPI.mockResolvedValue({
      resolved: false,
      reason: 'contact_read_failed',
      error: 'contact read down',
    });
    getRecord.mockResolvedValueOnce({
      akoya_requestid: REQUEST_ID,
      _akoya_applicantid_value_formatted: 'Formatted Applicant University',
    });

    const context = await loadCoiContext(REQUEST_ID);

    expect(context.piResolution).toEqual({
      state: 'failed',
      reason: 'contact_read_failed',
      error: 'contact read down',
    });
    expect(context.institutionEntries).toEqual([
      { identity: 'Formatted Applicant University', display: 'Formatted Applicant University' },
    ]);
  });

  test('save-time COI context treats clean no-PI as ok resolution state', async () => {
    resolveProposalPI.mockResolvedValue({ resolved: false, reason: 'no_project_leader' });
    getRecord.mockResolvedValueOnce({
      akoya_requestid: REQUEST_ID,
      _akoya_applicantid_value_formatted: 'Formatted Applicant University',
    });

    const context = await loadCoiContext(REQUEST_ID);

    expect(context.piResolution).toEqual({
      state: 'ok',
      reason: 'no_project_leader',
    });
  });

  test('save-time COI context marks thrown non-abort PI resolution as failed state', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    resolveProposalPI.mockRejectedValue(new Error('resolver exploded'));
    getRecord.mockResolvedValueOnce({
      akoya_requestid: REQUEST_ID,
      _akoya_applicantid_value_formatted: 'Formatted Applicant University',
    });

    const context = await loadCoiContext(REQUEST_ID);

    expect(context.piIdentity).toBeNull();
    expect(context.piResolution).toEqual({
      state: 'failed',
      reason: 'pi_resolve_threw',
      error: 'resolver exploded',
    });
    warnSpy.mockRestore();
  });

  test('save-time COI context marks disabled PI resolution as ok and does not call resolver', async () => {
    getRecord.mockResolvedValueOnce({
      akoya_requestid: REQUEST_ID,
      _akoya_applicantid_value_formatted: 'Formatted Applicant University',
    });

    const context = await loadCoiContext(REQUEST_ID, { resolvePi: false });

    expect(resolveProposalPI).not.toHaveBeenCalled();
    expect(context.piIdentity).toBeNull();
    expect(context.piResolution).toEqual({
      state: 'ok',
      reason: 'not_requested',
    });
  });

  test('save-time COI context fails closed when applicant account variants cannot be fetched', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    getRecord
      .mockResolvedValueOnce({
        akoya_requestid: REQUEST_ID,
        _akoya_applicantid_value: '22222222-2222-4222-8222-222222222222',
        _akoya_applicantid_value_formatted: 'Applicant University',
      })
      .mockRejectedValueOnce(new Error('account read failed'))
      .mockRejectedValueOnce(new Error('account read failed'));

    await expect(loadCoiContext(REQUEST_ID)).rejects.toMatchObject({
      httpStatus: 503,
      code: 'applicant_institution_context_unavailable',
      body: expect.objectContaining({
        code: 'applicant_institution_context_unavailable',
        requestId: REQUEST_ID,
      }),
    });
    expect(resolveProposalPI).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  test('request not found → 404', async () => {
    getRecord.mockResolvedValue(null);
    await expect(loadReviewerRequestContext(REQUEST_ID)).rejects.toMatchObject({
      statusCode: 404,
      message: `Request ${REQUEST_ID} was not found`,
    });
    expect(fetchCoPIs).not.toHaveBeenCalled();
  });

  test('omits program area from the trusted prompt block', () => {
    const block = formatTrustedRequestMetadata({
      title: 'Request title',
      programArea: 'Science and Engineering Research',
      principalInvestigator: 'Dr. PI',
      coInvestigators: 'None',
      coInvestigatorCount: '0',
      authorInstitution: 'University',
    });

    expect(block).toContain('TITLE: Request title');
    expect(block).not.toContain('PROGRAM_AREA');
    expect(block).not.toContain('Science and Engineering Research');
  });
});
