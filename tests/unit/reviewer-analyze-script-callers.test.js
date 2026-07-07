/**
 * @jest-environment node
 */

jest.mock('../../lib/services/reviewer-prompt-resolver.js', () => {
  const { ANALYZE_USER_PROMPT_TEMPLATE } = jest.requireActual('../../shared/config/prompts/reviewer-finder-dynamics.js');
  return {
    REVIEWER_PROMPT_NAMES: { ANALYZE: 'reviewer-finder.analyze', SCORE_CANDIDATES: 'reviewer-finder.score-candidates' },
    resolveReviewerPrompt: jest.fn(async () => ({
      body: ANALYZE_USER_PROMPT_TEMPLATE,
      source: 'code-fallback',
      promptId: null,
      version: null,
      overrideUsed: false,
      fallbackReason: 'test-stub',
      staleOverride: null,
    })),
  };
});

import { ClaudeReviewerService } from '../../lib/services/claude-reviewer-service.js';
import { buildOrcidSpineConstrainedAnalyzeOptions } from '../../scripts/eval-orcid-spine-constrained.mjs';
import { buildOrcidSpineSweepAnalyzeOptions } from '../../scripts/eval-orcid-spine-sweep.mjs';
import { buildGroundedOriginationAnalyzeOptions } from '../../scripts/probe-grounded-origination.mjs';
import { buildProbeScoringDeltaAnalyzeOptions } from '../../scripts/probe-scoring-delta.mjs';
import { buildSmokeDiscoverDispositionsAnalyzeOptions } from '../../scripts/smoke-discover-dispositions.mjs';
import { buildTraceAnalyzeOptions } from '../../scripts/trace-reviewer-provenance.mjs';
import { buildValidateAnalyzeOptions } from '../../scripts/validate-reviewer-analyze.mjs';

const REQUEST_CONTEXT = {
  title: 'Dataverse Title',
  programArea: 'Medical Research',
  principalInvestigator: 'Dr. Real PI',
  proposalAuthors: 'Dr. Real PI',
  coInvestigators: 'None',
  coInvestigatorCount: '0',
  authorInstitution: 'Applicant University',
  applicantInstitutionNames: ['Applicant University'],
  abstract: 'Trusted abstract',
};

function analysisResponse() {
  return [
    'TITLE: Dataverse Title',
    'PROGRAM_AREA: Medical Research',
    'PRINCIPAL_INVESTIGATOR: Dr. Real PI',
    'CO_INVESTIGATORS: None',
    'CO_INVESTIGATOR_COUNT: 0',
    'AUTHOR_INSTITUTION: Applicant University',
    'PRIMARY_RESEARCH_AREA: Biology',
    'SECONDARY_AREAS: Chemistry',
    'KEY_METHODOLOGIES: Microscopy',
    'KEYWORDS: cells, imaging',
    'ABSTRACT: Example abstract',
    '',
    'REVIEWER:',
    'NAME: Dr. Grace Hopper',
    'INSTITUTION: Example Institute',
    'EXPERTISE: systems biology, imaging',
    'SENIORITY: Senior',
    'REASONING: Relevant expertise for this proposal.',
    'SOURCE: Known expert',
    '',
    'PUBMED_QUERIES:',
    '1. cell imaging',
  ].join('\n');
}

describe('reviewer analyze script callers', () => {
  let originalCallLLM;

  beforeEach(() => {
    originalCallLLM = ClaudeReviewerService._callLLM;
    ClaudeReviewerService._callLLM = jest.fn(async () => ({
      text: analysisResponse(),
      usedFallback: false,
      model: 'test-model',
      stopReason: 'end_turn',
    }));
  });

  afterEach(() => {
    ClaudeReviewerService._callLLM = originalCallLLM;
  });

  test.each([
    ['eval-orcid-spine-constrained', buildOrcidSpineConstrainedAnalyzeOptions({ args: { reviewerCount: 1 }, requestContext: REQUEST_CONTEXT })],
    ['eval-orcid-spine-sweep', buildOrcidSpineSweepAnalyzeOptions({ args: { reviewerCount: 1 }, requestContext: REQUEST_CONTEXT })],
    ['probe-grounded-origination', buildGroundedOriginationAnalyzeOptions({ args: { reviewerCount: 1 }, requestContext: REQUEST_CONTEXT })],
    ['probe-scoring-delta', buildProbeScoringDeltaAnalyzeOptions({ args: { reviewerCount: 1, temperature: 0.3 }, requestContext: REQUEST_CONTEXT })],
    ['smoke-discover-dispositions', buildSmokeDiscoverDispositionsAnalyzeOptions({ args: { reviewerCount: 1 }, requestContext: REQUEST_CONTEXT })],
    ['trace-reviewer-provenance', buildTraceAnalyzeOptions({ args: { reviewerCount: 1 }, requestContext: REQUEST_CONTEXT })],
    ['validate-reviewer-analyze', buildValidateAnalyzeOptions({ args: { reviewerCount: 1, temperature: 0.3, excluded: [] }, requestContext: REQUEST_CONTEXT })],
  ])('%s passes requestContext through direct analyzeProposal calls', async (_scriptName, options) => {
    await expect(ClaudeReviewerService.analyzeProposal(
      'A useful proposal body. '.repeat(40),
      'sk-ant-test',
      options,
    )).resolves.toMatchObject({ success: true });

    expect(ClaudeReviewerService._callLLM).toHaveBeenCalledTimes(1);
  });
});
