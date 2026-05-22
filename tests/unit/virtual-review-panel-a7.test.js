/**
 * A7 follow-up tests for Virtual Review Panel prompt builders (Codex review).
 *
 * Codex found that every stage after claim extraction re-fed untrusted data
 * (U-EXT search results, or prior-stage LLM output) with only the preamble,
 * no sentinel wrapping — and that createPanelSynthesisPrompt had no preamble
 * at all. These tests pin the fix.
 */

import {
  createSearchCollationPrompt,
  createIntelligenceSynthesisPrompt,
  createClaimVerificationPrompt,
  createStructuredReviewPrompt,
  createDevilsAdvocatePrompt,
  createPanelSynthesisPrompt,
} from '../../shared/config/prompts/virtual-review-panel';

const SENTINEL_OPEN = /\[\[WMKF-UNTRUSTED-CONTENT nonce=([0-9a-f]{24})/g;

function nonces(prompt) {
  return [...prompt.matchAll(SENTINEL_OPEN)].map((m) => m[1]);
}
function assertHardened(prompt, minBlocks) {
  expect(prompt).toContain('UNTRUSTED CONTENT RULES:');
  const ns = nonces(prompt);
  expect(new Set(ns).size).toBeGreaterThanOrEqual(minBlocks);
  for (const n of ns) expect(prompt).toContain(`[[/WMKF-UNTRUSTED-CONTENT nonce=${n}]]`);
}

const claimData = { field: 'biology', piNames: ['Dr. X'], noveltySearchStrings: ['a'] };
const intel = { mostRelevantPapers: [], landscapeSummary: 'x', piPublicationSummary: [] };

describe('VRP A7 — re-fed data is wrapped', () => {
  test('search collation wraps claim data + raw search results', () => {
    // proposalText arrives already wrapped; claimData + rawSearchResults add 2 more.
    assertHardened(createSearchCollationPrompt('[[WMKF-UNTRUSTED-CONTENT nonce=' + 'a'.repeat(24) + ']]x[[/WMKF-UNTRUSTED-CONTENT nonce=' + 'a'.repeat(24) + ']]', claimData, { pubmed: [] }), 2);
  });

  test('intelligence synthesis wraps claim data + collated results', () => {
    assertHardened(createIntelligenceSynthesisPrompt('proposal', claimData, { searchGaps: '' }), 2);
  });

  test('claim verification wraps the intelligence block', () => {
    assertHardened(createClaimVerificationPrompt('proposal', intel), 1);
  });

  test('structured review wraps claim verification + intelligence', () => {
    assertHardened(createStructuredReviewPrompt('proposal', { claims: [] }, intel), 2);
  });

  test("devil's advocate wraps prior reviews + intelligence", () => {
    assertHardened(createDevilsAdvocatePrompt('proposal', 'a prior review summary', intel), 2);
  });

  test('panel synthesis now carries the preamble AND wraps every re-fed output', () => {
    const prompt = createPanelSynthesisPrompt(
      [{ providerName: 'Claude', model: 'm', parsedResponse: { overallRating: 'Good' } }],
      [{ providerName: 'GPT', parsedResponse: { claims: [] } }],
      { providerName: 'Gemini', model: 'm', parsedResponse: { primaryConcern: 'x' } },
    );
    // reviews + claimVerifications + devilsAdvocate = 3 wrapped blocks.
    assertHardened(prompt, 3);
  });
});
