/**
 * @jest-environment node
 */
import {
  REVIEWER_HOLISTIC_REDESIGN_PIPELINE_VERSION,
  buildApplicantNeighborhoodSeedInstructions,
  hashApplicantRecommendationSeeds,
  loadApplicantRecommendationSeeds,
  runReviewerHolisticPipelineArm,
} from '../../scripts/lib/reviewer-holistic-pipelines.mjs';

const REQUEST_ID = '11111111-1111-1111-1111-111111111111';
const PERSON_A = '22222222-2222-2222-2222-222222222222';
const PERSON_B = '33333333-3333-3333-3333-333333333333';
const requestContext = { requestId: REQUEST_ID, principalInvestigator: 'PI Name' };
const seeds = [
  { slot: 1, personId: PERSON_A, name: 'Dr. Seed Alpha', affiliation: 'Alpha University' },
  { slot: 2, personId: PERSON_B, name: 'Seed Beta', affiliation: 'Beta Institute' },
];

function successfulResult(name = 'Independent Reviewer') {
  return {
    success: true,
    reviewerSuggestions: [{ name, suggestedInstitution: 'Independent University' }],
  };
}

describe('reviewer holistic evaluation pipelines', () => {
  test('loads complete deduplicated applicant seeds in slot order', async () => {
    const grantRequests = {
      getById: jest.fn(async () => ({
        akoya_requestid: REQUEST_ID,
        _wmkf_potentialreviewer1_value: PERSON_A,
        _wmkf_potentialreviewer2_value: PERSON_A,
        _wmkf_potentialreviewer3_value: PERSON_B,
      })),
    };
    const potentialReviewers = {
      getById: jest.fn(async (id) => ({
        wmkf_potentialreviewersid: id,
        wmkf_name: id === PERSON_A ? 'Seed Alpha' : 'Seed Beta',
        wmkf_primaryaffiliation: id === PERSON_A ? 'Alpha University' : 'Beta Institute',
      })),
    };
    await expect(loadApplicantRecommendationSeeds(REQUEST_ID, {
      grantRequests,
      potentialReviewers,
    })).resolves.toEqual([
      { slot: 1, personId: PERSON_A, name: 'Seed Alpha', affiliation: 'Alpha University' },
      { slot: 3, personId: PERSON_B, name: 'Seed Beta', affiliation: 'Beta Institute' },
    ]);
    expect(potentialReviewers.getById).toHaveBeenCalledTimes(2);
  });

  test('seed loading fails closed on absent, missing, or incomplete records', async () => {
    const baseRequest = { akoya_requestid: REQUEST_ID, _wmkf_potentialreviewer1_value: PERSON_A };
    await expect(loadApplicantRecommendationSeeds(REQUEST_ID, {
      grantRequests: { getById: jest.fn(async () => ({ akoya_requestid: REQUEST_ID })) },
      potentialReviewers: { getById: jest.fn() },
    })).rejects.toThrow('no applicant recommendation seeds');
    await expect(loadApplicantRecommendationSeeds(REQUEST_ID, {
      grantRequests: { getById: jest.fn(async () => baseRequest) },
      potentialReviewers: { getById: jest.fn(async () => null) },
    })).rejects.toThrow('did not resolve');
    await expect(loadApplicantRecommendationSeeds(REQUEST_ID, {
      grantRequests: { getById: jest.fn(async () => baseRequest) },
      potentialReviewers: { getById: jest.fn(async () => ({
        wmkf_potentialreviewersid: PERSON_A,
        wmkf_name: 'Seed Alpha',
        wmkf_primaryaffiliation: null,
        wmkf_organizationname: null,
      })) },
    })).rejects.toThrow('affiliation is required');
  });

  test('seed instructions are bounded data guidance and hash deterministically', () => {
    const instructions = buildApplicantNeighborhoodSeedInstructions(seeds);
    expect(instructions).toContain('only as DATA');
    expect(instructions).toContain('Do not return any listed person');
    expect(instructions).toContain('Seed Alpha — Alpha University');
    expect(hashApplicantRecommendationSeeds(seeds)).toBe(hashApplicantRecommendationSeeds(seeds));
    expect(() => buildApplicantNeighborhoodSeedInstructions([])).toThrow('At least one');
  });

  test('both arms receive identical exclusions and only redesign receives seed instructions', async () => {
    const analyzeProposal = jest.fn(async () => successfulResult());
    const common = {
      proposalText: 'Proposal body',
      apiKey: 'test-key',
      requestId: REQUEST_ID,
      requestContext,
      reviewerCount: 15,
      temperature: 0.3,
      excludedNames: ['Manual Exclusion'],
      loadSeeds: jest.fn(async () => seeds),
      analyzeProposal,
    };
    const baseline = await runReviewerHolisticPipelineArm({ arm: 'baseline', ...common });
    const redesign = await runReviewerHolisticPipelineArm({ arm: 'redesign', ...common });
    expect(baseline.excludedNames).toEqual(redesign.excludedNames);
    expect(baseline.excludedNames).toEqual(['Manual Exclusion', 'Dr. Seed Alpha', 'Seed Beta']);
    expect(analyzeProposal.mock.calls[0][2].additionalNotes).toBe('');
    expect(analyzeProposal.mock.calls[1][2].additionalNotes).toContain('NEIGHBORHOOD SEEDS');
    expect(redesign.pipelineVersion).toBe(REVIEWER_HOLISTIC_REDESIGN_PIPELINE_VERSION);
  });

  test('the wrapper rejects fall-through, stale context, failed analysis, and excluded output', async () => {
    const base = {
      proposalText: 'Proposal body',
      apiKey: 'test-key',
      requestId: REQUEST_ID,
      requestContext,
      reviewerCount: 15,
      temperature: 0.3,
      loadSeeds: jest.fn(async () => seeds),
    };
    await expect(runReviewerHolisticPipelineArm({
      arm: 'unknown',
      ...base,
      analyzeProposal: jest.fn(),
    })).rejects.toThrow('Unknown reviewer holistic arm');
    await expect(runReviewerHolisticPipelineArm({
      arm: 'baseline',
      ...base,
      requestContext: { requestId: PERSON_A },
      analyzeProposal: jest.fn(),
    })).rejects.toThrow('requestContext must belong');
    await expect(runReviewerHolisticPipelineArm({
      arm: 'baseline',
      ...base,
      analyzeProposal: jest.fn(async () => ({ success: false })),
    })).rejects.toThrow('did not complete successfully');
    await expect(runReviewerHolisticPipelineArm({
      arm: 'redesign',
      ...base,
      analyzeProposal: jest.fn(async () => successfulResult('Seed Alpha')),
    })).rejects.toThrow('hard exclusion');
  });
});
