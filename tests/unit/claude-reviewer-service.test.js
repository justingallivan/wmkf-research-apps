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
import { validateReviewerAnalysis } from '../../shared/config/prompts/reviewer-finder.js';

function analysisResponse({ title = 'Example', reviewers = [], queries = ['cell imaging'] } = {}) {
  const metadata = [
    `TITLE: ${title}`,
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
  ];
  const reviewerBlocks = reviewers.flatMap((reviewer, index) => [
    'REVIEWER:',
    `NAME: ${reviewer.name || `Dr. Reviewer ${index + 1}`}`,
    reviewer.institutionLine === false ? null : `INSTITUTION: ${reviewer.institution || 'Example Institute'}`,
    reviewer.expertiseLine === false ? null : `EXPERTISE: ${reviewer.expertise || 'systems biology, imaging'}`,
    reviewer.seniorityLine === false ? null : `SENIORITY: ${reviewer.seniority || 'Mid-career'}`,
    reviewer.reasoningLine === false ? null : `REASONING: ${reviewer.reasoning || 'Relevant expertise for this proposal.'}`,
    reviewer.concernsLine === false ? null : `POTENTIAL_CONCERNS: ${reviewer.concerns || 'None identified'}`,
    reviewer.sourceLine === false ? null : `SOURCE: ${reviewer.source || 'Known expert'}`,
    '',
  ].filter(Boolean));
  const queryLines = queries.length > 0
    ? ['PUBMED_QUERIES:', ...queries.map((query, index) => `${index + 1}. ${query}`)]
    : [];
  return [...metadata, ...reviewerBlocks, ...queryLines].join('\n');
}

const reviewer = (name) => ({ name });

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
      reviewerCount: 1,
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

  test('empty response retries once then returns typed analysis_invalid failure', async () => {
    ClaudeReviewerService._callLLM = jest.fn(async () => ({
      text: '',
      usedFallback: false,
      model: 'claude-test',
      stopReason: 'end_turn',
    }));

    const result = await ClaudeReviewerService.analyzeProposal('A useful proposal body'.repeat(20), 'sk-ant-test', {
      reviewerCount: 6,
    });

    expect(ClaudeReviewerService._callLLM).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      success: false,
      status: 'analysis_invalid',
      attempt: 2,
      maxTokens: ClaudeReviewerService.MAX_TOKENS,
    });
    expect(result.validation.issues.map(i => i.code)).toContain('empty_parse_failure');
  });

  test('below-floor response retries and succeeds when repaired response is valid', async () => {
    ClaudeReviewerService._callLLM = jest
      .fn()
      .mockResolvedValueOnce({
        text: analysisResponse({ reviewers: [reviewer('Dr. One Reviewer')] }),
        usedFallback: false,
        model: 'claude-test',
        stopReason: 'end_turn',
      })
      .mockResolvedValueOnce({
        text: analysisResponse({ reviewers: [reviewer('Dr. One Reviewer'), reviewer('Dr. Two Reviewer'), reviewer('Dr. Three Reviewer')] }),
        usedFallback: false,
        model: 'claude-test',
        stopReason: 'end_turn',
      });

    const result = await ClaudeReviewerService.analyzeProposal('A useful proposal body'.repeat(20), 'sk-ant-test', {
      reviewerCount: 6,
    });

    expect(ClaudeReviewerService._callLLM).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(true);
    expect(result.reviewerSuggestions).toHaveLength(3);
    expect(ClaudeReviewerService._callLLM.mock.calls[1][0].prompt).toContain('REPAIR INSTRUCTIONS');
  });

  test('truncation stop reason retries with higher maxTokens', async () => {
    ClaudeReviewerService._callLLM = jest
      .fn()
      .mockResolvedValueOnce({
        text: analysisResponse({ reviewers: [reviewer('Dr. One Reviewer'), reviewer('Dr. Two Reviewer'), reviewer('Dr. Three Reviewer')], queries: [] }),
        usedFallback: false,
        model: 'claude-test',
        stopReason: 'max_tokens',
      })
      .mockResolvedValueOnce({
        text: analysisResponse({ reviewers: [reviewer('Dr. One Reviewer'), reviewer('Dr. Two Reviewer'), reviewer('Dr. Three Reviewer')] }),
        usedFallback: false,
        model: 'claude-test',
        stopReason: 'end_turn',
      });

    const result = await ClaudeReviewerService.analyzeProposal('A useful proposal body'.repeat(20), 'sk-ant-test', {
      reviewerCount: 6,
    });

    expect(result.success).toBe(true);
    expect(ClaudeReviewerService._callLLM.mock.calls[0][0].maxTokens).toBe(ClaudeReviewerService.MAX_TOKENS);
    expect(ClaudeReviewerService._callLLM.mock.calls[1][0].maxTokens).toBe(8192);
  });

  test('valid first attempt succeeds with one call', async () => {
    ClaudeReviewerService._callLLM = jest.fn(async () => ({
      text: analysisResponse({ reviewers: [reviewer('Dr. One Reviewer')] }),
      usedFallback: false,
      model: 'claude-test',
      stopReason: 'end_turn',
    }));

    const result = await ClaudeReviewerService.analyzeProposal('A useful proposal body'.repeat(20), 'sk-ant-test', {
      reviewerCount: 1,
    });

    expect(result.success).toBe(true);
    expect(ClaudeReviewerService._callLLM).toHaveBeenCalledTimes(1);
  });

  test('duplicate reviewer names are flagged via the shared normalizer', () => {
    const validation = validateReviewerAnalysis({
      proposalInfo: { title: 'Example' },
      reviewerSuggestions: [
        reviewer('Dr. Jens Hör'),
        reviewer('Prof. Jens Hor'),
        reviewer('Dr. Unique Name'),
      ],
      searchQueries: { pubmed: ['cell imaging'] },
    }, { reviewerCount: 3 });

    expect(validation.valid).toBe(false);
    expect(validation.issues.map(i => i.code)).toContain('duplicate_reviewer_name');
  });

  test('a duplicate/excluded entry is sanitized as a warning, not a hard failure, when enough usable remain', () => {
    const complete = (name) => ({ name, suggestedInstitution: 'Some University', reasoning: 'Active expert on the proposal topic.' });
    const validation = validateReviewerAnalysis({
      proposalInfo: { title: 'Example' },
      reviewerSuggestions: [
        complete('Dr. Aaa One'),
        complete('Dr. Bbb Two'),
        complete('Dr. Ccc Three'),
        complete('Dr. Aaa One'),       // duplicate -> dropped (warning)
        complete('Excluded Person'),   // excluded -> dropped (warning)
      ],
      searchQueries: { pubmed: ['topic query'] },
    }, { reviewerCount: 3, excludedNames: ['Excluded Person'] });

    expect(validation.valid).toBe(true);
    expect(validation.sanitizedResult.reviewerSuggestions).toHaveLength(3);
    const codes = validation.issues.map(i => i.code);
    expect(codes).toContain('duplicate_reviewer_name');
    expect(codes).toContain('excluded_reviewer_name');
    expect(validation.issues.filter(i => i.severity !== 'warning')).toHaveLength(0);
  });

  test('an incomplete reviewer is a warning excluded from the floor, not a hard failure', () => {
    const complete = (name) => ({ name, suggestedInstitution: 'Some University', reasoning: 'Active expert on the proposal topic.' });
    const validation = validateReviewerAnalysis({
      proposalInfo: { title: 'Example' },
      reviewerSuggestions: [
        complete('Dr. Aaa One'),
        complete('Dr. Bbb Two'),
        complete('Dr. Ccc Three'),
        { name: 'Dr. Bare Name' },     // incomplete -> kept, not counted toward floor
      ],
      searchQueries: { pubmed: ['topic query'] },
    }, { reviewerCount: 3 });

    expect(validation.valid).toBe(true);
    expect(validation.issues.find(i => i.code === 'incomplete_reviewer')?.severity).toBe('warning');
  });

  test('placeholder suggestions are stripped from successful payloads', async () => {
    ClaudeReviewerService._callLLM = jest.fn(async () => ({
      text: analysisResponse({
        reviewers: [
          reviewer('Dr. One Reviewer'),
          reviewer('Dr. Two Reviewer'),
          reviewer('Dr. Three Reviewer'),
          reviewer('Dr. Four Reviewer'),
          { name: '[Replacement reviewer]', institution: 'N/A', reasoning: 'Insufficient certainty' },
        ],
      }),
      usedFallback: false,
      model: 'claude-test',
      stopReason: 'end_turn',
    }));

    const result = await ClaudeReviewerService.analyzeProposal('A useful proposal body'.repeat(20), 'sk-ant-test', {
      reviewerCount: 5,
    });

    expect(result.success).toBe(true);
    expect(result.reviewerSuggestions.map(r => r.name)).not.toContain('[Replacement reviewer]');
    expect(result.reviewerSuggestions).toHaveLength(4);
  });

  test('proposal_info mode returns parsed proposalInfo despite suggestion-floor failure', async () => {
    ClaudeReviewerService._callLLM = jest.fn(async () => ({
      text: analysisResponse({ reviewers: [], queries: [] }),
      usedFallback: false,
      model: 'claude-test',
      stopReason: 'end_turn',
    }));

    const result = await ClaudeReviewerService.analyzeProposal('A useful proposal body'.repeat(20), 'sk-ant-test', {
      reviewerCount: 1,
      analysisPurpose: 'proposal_info',
    });

    expect(result.success).toBe(true);
    expect(result.proposalInfo.title).toBe('Example');
    expect(ClaudeReviewerService._callLLM).toHaveBeenCalledTimes(1);
  });

  test('budget preflight skips repair attempt when deadline is near', async () => {
    ClaudeReviewerService._callLLM = jest.fn(async () => ({
      text: analysisResponse({ reviewers: [reviewer('Dr. One Reviewer')] }),
      usedFallback: false,
      model: 'claude-test',
      stopReason: 'end_turn',
    }));

    const result = await ClaudeReviewerService.analyzeProposal('A useful proposal body'.repeat(20), 'sk-ant-test', {
      reviewerCount: 6,
      deadlineAt: Date.now() + 1000,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe('analysis_invalid');
    expect(result.attempt).toBe(1);
    expect(ClaudeReviewerService._callLLM).toHaveBeenCalledTimes(1);
  });
});
