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

import {
  formatTrustedRequestMetadata,
  loadReviewerRequestContext,
  mergeRequestContextIntoAnalysisResult,
  projectReviewerRequestContext,
} from '../../lib/services/reviewer-request-context.js';

const REQUEST_ID = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  jest.clearAllMocks();
  fetchCoPIs.mockResolvedValue([]);
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
