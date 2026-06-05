/**
 * Reviewer-finder service tests for AI payload boundaries.
 *
 * The transport itself is covered by LLMClient tests; this suite checks that
 * high-volume reviewer-finder proposal text is bounded before prompt
 * construction sends it to the model.
 */

// Keep the resolver hermetic: analyzeProposal now resolves the prompt body from
// Dataverse, which would make a network call. Stub it to the code-fallback body.
jest.mock('../../lib/services/reviewer-prompt-resolver.js', () => {
  const { ANALYZE_USER_PROMPT_TEMPLATE } = jest.requireActual('../../shared/config/prompts/reviewer-finder-dynamics.js');
  return {
    REVIEWER_PROMPT_NAMES: { ANALYZE: 'reviewer-finder.analyze', SCORE_CANDIDATES: 'reviewer-finder.score-candidates' },
    resolveReviewerPrompt: jest.fn(async () => ({
      body: ANALYZE_USER_PROMPT_TEMPLATE, source: 'code-fallback', promptId: null,
      version: null, overrideUsed: false, fallbackReason: 'test-stub', staleOverride: null,
    })),
  };
});

import { ClaudeReviewerService } from '../../lib/services/claude-reviewer-service.js';
import { REVIEWER_FINDER_PROPOSAL_MAX_CHARS } from '../../lib/utils/ai-payload-boundary.js';

describe('ClaudeReviewerService.analyzeProposal payload boundary', () => {
  let originalCallLLM;

  beforeEach(() => {
    originalCallLLM = ClaudeReviewerService._callLLM;
  });

  afterEach(() => {
    ClaudeReviewerService._callLLM = originalCallLLM;
  });

  test('caps proposal text before creating the Claude prompt and emits boundary metadata', async () => {
    const overLimit = `${'A'.repeat(REVIEWER_FINDER_PROPOSAL_MAX_CHARS + 500)}UNSENT_TAIL`;
    const progressEvents = [];
    let sentPrompt = '';

    ClaudeReviewerService._callLLM = jest.fn(async ({ prompt }) => {
      sentPrompt = prompt;
      return {
        text: [
          'TITLE: Example',
          'PROGRAM_AREA: Science and Engineering Research Program',
          'PRINCIPAL_INVESTIGATOR: Dr. Ada Lovelace',
          'CO_INVESTIGATORS: None',
          'CO_INVESTIGATOR_COUNT: 0',
          'AUTHOR_INSTITUTION: Example University',
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
          'POTENTIAL_CONCERNS: None identified',
          'SOURCE: Known expert',
          '',
          'PUBMED_QUERIES:',
          '1. cell imaging',
        ].join('\n'),
        usedFallback: false,
        model: 'claude-test',
      };
    });

    const result = await ClaudeReviewerService.analyzeProposal(overLimit, 'sk-ant-test', {
      onProgress: event => progressEvents.push(event),
      userProfileId: 123,
    });

    const boundaryEvent = progressEvents.find(event => event.status === 'payload_boundary');
    expect(boundaryEvent?.data?.aiPayloadBoundary).toEqual(expect.objectContaining({
      source: 'reviewer-finder.analyze.proposalText',
      dataClass: 'proposal_text',
      maxChars: REVIEWER_FINDER_PROPOSAL_MAX_CHARS,
      originalChars: overLimit.length,
      transmittedChars: REVIEWER_FINDER_PROPOSAL_MAX_CHARS,
      truncated: true,
    }));

    expect(sentPrompt).toContain('[...truncated at 100000 chars by AI payload boundary: reviewer-finder.analyze.proposalText...]');
    expect(sentPrompt).not.toContain('UNSENT_TAIL');
    expect(result.success).toBe(true);
  });
});
