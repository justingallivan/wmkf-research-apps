/**
 * A7 prompt-injection hardening tests for Part 6 composed prompts (bundled row + variables helper + composer).
 *
 * Covers the Literature Analyzer (#9) and Funding Gap Analyzer (#10) prompts.
 * The #14/#21/#24 surfaces wrap in their service/route call sites (verified by
 * the check:prompt-injection-tagging gate); these unit tests exercise the
 * builders whose hardening is observable without mocking heavy deps.
 */

import {
  LITERATURE_EXTRACT_PAPER_ROW,
  LITERATURE_SYNTHESIZE_ROW,
  LITERATURE_COMPARE_ROW,
  buildLiteratureExtractVariables,
  buildLiteratureSynthesisVariables,
  buildLiteratureCompareVariables,
} from '../../shared/config/prompts/literature-analyzer-dynamics';
import {
  FUNDING_GAP_EXTRACT_ROW,
  FUNDING_GAP_ANALYZE_ROW,
  buildFundingExtractVariables,
  buildFundingAnalyzeVariables,
} from '../../shared/config/prompts/funding-gap-dynamics';
import { composeToolPromptPair } from '../../lib/services/tool-prompt-composer';
import { wrapUntrustedContent, DATA_CLASSES } from '../../lib/utils/ai-payload-boundary';

const compose = (row, { variables, nonces }) =>
  composeToolPromptPair({ systemPrompt: row.systemPrompt, body: row.body }, variables, { nonces }).body;

// Composed-prompt equivalents of the retired builders.
const createPaperExtractionPrompt = () =>
  compose(LITERATURE_EXTRACT_PAPER_ROW, buildLiteratureExtractVariables());
const createSynthesisPrompt = (papers, focus) =>
  compose(LITERATURE_SYNTHESIZE_ROW, buildLiteratureSynthesisVariables(papers, focus));
const createComparisonPrompt = (papers, type) =>
  compose(LITERATURE_COMPARE_ROW, buildLiteratureCompareVariables(papers, type));
const createFundingExtractionPrompt = (wrappedText, nonces) =>
  compose(FUNDING_GAP_EXTRACT_ROW, buildFundingExtractVariables({ wrappedProposal: wrappedText, nonces }));
const createFundingAnalysisPrompt = (data) =>
  compose(FUNDING_GAP_ANALYZE_ROW, buildFundingAnalyzeVariables(data));

const SENTINEL_RE = /\[\[WMKF-UNTRUSTED-CONTENT nonce=([0-9a-f]{24})/;

function assertWrappedAndPreambled(prompt) {
  expect(prompt).toContain('UNTRUSTED CONTENT RULES:');
  const open = prompt.match(SENTINEL_RE);
  expect(open).not.toBeNull();
  expect(prompt).toContain(`[[/WMKF-UNTRUSTED-CONTENT nonce=${open[1]}]]`);
}

describe('Literature Analyzer A7 hardening (#9)', () => {
  test('Stage 1 extraction prompt carries the multimodal preamble', () => {
    const p = createPaperExtractionPrompt();
    expect(p).toContain('UNTRUSTED CONTENT RULES:');
    expect(p).toContain('ATTACHED research paper');
  });

  test('synthesis + comparison wrap the re-fed paper summaries', () => {
    const papers = [{ title: 'Paper A', abstract: 'abstract text', authors: ['X'] }];
    assertWrappedAndPreambled(createSynthesisPrompt(papers, 'focus topic'));
    assertWrappedAndPreambled(createComparisonPrompt(papers, 'methods'));
  });
});

describe('Funding Gap Analyzer A7 hardening (#10)', () => {
  test('extraction prompt carries the preamble and the wrapped proposal block', () => {
    const wrapped = wrapUntrustedContent({
      text: 'proposal body',
      source: 'test',
      dataClass: DATA_CLASSES.PROPOSAL_TEXT,
      maxChars: 1_000,
    });
    const p = createFundingExtractionPrompt(wrapped.text, [wrapped.nonce]);
    expect(p).toContain('UNTRUSTED CONTENT RULES:');
    expect(p).toContain(`[[WMKF-UNTRUSTED-CONTENT nonce=${wrapped.nonce}`);
  });

  test('analysis prompt wraps the three federal-API data blocks', () => {
    const p = createFundingAnalysisPrompt({
      pi: 'Dr. X', institution: 'Univ', keywords: ['k1'], searchYears: 5,
      nsfData: { awards: [] }, nihData: { projects: [] },
      usaSpendingData: { disabled: false, totalFunding: 0 },
    });
    expect(p).toContain('UNTRUSTED CONTENT RULES:');
    // Three distinct wrapped blocks → three distinct nonces.
    const nonces = [...p.matchAll(/\[\[WMKF-UNTRUSTED-CONTENT nonce=([0-9a-f]{24})/g)].map((m) => m[1]);
    expect(new Set(nonces).size).toBe(3);
  });
});
