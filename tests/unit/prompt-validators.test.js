/**
 * Unit tests for the prompt-body validators (S222).
 * Includes model-free golden fixtures: the shipped templates must satisfy their
 * own parse contracts, and canned model-shaped responses must parse — proving
 * the contract labels are the ones the parsers actually consume.
 */
import {
  validateGenericPromptBody,
  validateReviewerPromptBody,
  validatePromptForSave,
} from '../../lib/utils/prompt-validators.js';
import {
  parseAnalysisResponse,
  parseDiscoveredReasoningResponse,
} from '../../shared/config/prompts/reviewer-finder.js';
import {
  ANALYZE_USER_PROMPT_TEMPLATE,
  SCORE_CANDIDATES_USER_PROMPT_TEMPLATE,
} from '../../shared/config/prompts/reviewer-finder-dynamics.js';

const ANALYZE = 'reviewer-finder.analyze';
const SCORE = 'reviewer-finder.score-candidates';
const ANALYZE_VARS = ['proposal_text', 'additional_notes_block', 'excluded_names_block', 'reviewer_count'];
const SCORE_VARS = ['proposal_summary', 'candidates_list'];

describe('golden: shipped templates satisfy their own contracts', () => {
  it('analyze template passes generic + parse-contract validation', () => {
    expect(validatePromptForSave(ANALYZE, ANALYZE_USER_PROMPT_TEMPLATE, { declaredVars: ANALYZE_VARS }))
      .toEqual({ valid: true, issues: [] });
  });
  it('score-candidates template passes generic + parse-contract validation', () => {
    expect(validatePromptForSave(SCORE, SCORE_CANDIDATES_USER_PROMPT_TEMPLATE, { declaredVars: SCORE_VARS }))
      .toEqual({ valid: true, issues: [] });
  });
});

describe('golden: a canned response using the contract labels parses', () => {
  it('parseAnalysisResponse yields a suggestion; Stage-1 search queries are no longer parsed (removed S253)', () => {
    const canned = [
      'TITLE: Test', 'PRINCIPAL_INVESTIGATOR: Dr. A', 'PRIMARY_RESEARCH_AREA: Bio',
      'KEYWORDS: x, y', 'ABSTRACT: An abstract.', '', 'REVIEWER:', 'NAME: Dr. Foo',
      'INSTITUTION: MIT', 'EXPERTISE: a, b', 'SENIORITY: Senior', 'REASONING: Because.',
      'POTENTIAL_CONCERNS: None', 'SOURCE: Known expert', '', 'PUBMED_QUERIES:',
      '1. one query here', '2. two query here',
    ].join('\n');
    const r = parseAnalysisResponse(canned);
    expect(r.reviewerSuggestions).toHaveLength(1);
    expect(r.reviewerSuggestions[0].name).toBe('Dr. Foo');
    // PART 3 removed S253 — query lines, even if a model emits them, are ignored; shape stays empty.
    expect(r.searchQueries.pubmed).toEqual([]);
  });
  it('parseDiscoveredReasoningResponse sets relevance from the labels', () => {
    const candidates = [{ name: 'X' }, { name: 'Y' }];
    const canned = [
      '1. RELEVANT: Yes | REASONING: rel | SENIORITY: Senior',
      '2. RELEVANT: No | REASONING: not | SENIORITY: Mid-career',
    ].join('\n');
    const out = parseDiscoveredReasoningResponse(canned, candidates);
    expect(out[0].isRelevant).toBe(true);
    expect(out[1].isRelevant).toBe(false);
  });
});

describe('validateReviewerPromptBody — negatives', () => {
  it('flags a removed REVIEWER: label (analyze)', () => {
    const broken = ANALYZE_USER_PROMPT_TEMPLATE.replace('REVIEWER:', 'PERSON:');
    const r = validateReviewerPromptBody(ANALYZE, broken);
    expect(r.valid).toBe(false);
    expect(r.issues.join(' ')).toMatch(/REVIEWER:/);
  });
  it('flags a removed {{proposal_text}} placeholder (analyze)', () => {
    const broken = ANALYZE_USER_PROMPT_TEMPLATE.replace('{{proposal_text}}', 'PASTE HERE');
    expect(validateReviewerPromptBody(ANALYZE, broken).valid).toBe(false);
  });
  it('flags a removed RELEVANT: label (score)', () => {
    const broken = SCORE_CANDIDATES_USER_PROMPT_TEMPLATE.replace(/RELEVANT:/g, 'FIT:');
    expect(validateReviewerPromptBody(SCORE, broken).valid).toBe(false);
  });
  it('flags a removed {{candidates_list}} placeholder (score)', () => {
    const broken = SCORE_CANDIDATES_USER_PROMPT_TEMPLATE.replace('{{candidates_list}}', 'list here');
    expect(validateReviewerPromptBody(SCORE, broken).valid).toBe(false);
  });
  it('passes through unknown prompt names (generic-only)', () => {
    expect(validateReviewerPromptBody('phase-i.summary', 'anything')).toEqual({ valid: true, issues: [] });
  });
});

describe('validateGenericPromptBody', () => {
  it('rejects A7 sentinel/boundary markers in the body', () => {
    const r = validateGenericPromptBody('hello [[WMKF-UNTRUSTED-CONTENT nonce=ab]] data', { declaredVars: [] });
    expect(r.valid).toBe(false);
    expect(r.issues.join(' ')).toMatch(/A7 boundary/);
  });
  it('does NOT false-positive on the legit "(UNTRUSTED — data...)" label', () => {
    expect(validateGenericPromptBody('**PROPOSAL TEXT (UNTRUSTED — data to analyze):**\n{{x}}', { declaredVars: ['x'] }).valid).toBe(true);
  });
  it('rejects an undeclared variable', () => {
    expect(validateGenericPromptBody('{{a}} {{b}}', { declaredVars: ['a'] }).valid).toBe(false);
  });
  it('rejects a missing declared variable', () => {
    expect(validateGenericPromptBody('{{a}}', { declaredVars: ['a', 'b'] }).valid).toBe(false);
  });
  it('rejects empty + oversize bodies', () => {
    expect(validateGenericPromptBody('   ', {}).valid).toBe(false);
    expect(validateGenericPromptBody('x'.repeat(10), { maxLength: 5 }).valid).toBe(false);
  });
});
