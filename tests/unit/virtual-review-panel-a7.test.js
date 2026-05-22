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

// ---------------------------------------------------------------------------
// A7 follow-up step 2c — VRP output-schema validation
// ---------------------------------------------------------------------------
describe('VRP A7 step 2c — output-schema validation', () => {
  let validateAiJson, VRP_OUTPUT_SCHEMAS, S;

  beforeAll(async () => {
    ({ validateAiJson } = await import('../../lib/utils/ai-output-schema'));
    S = await import('../../shared/config/virtual-review-panel-output-schema');
    ({ VRP_OUTPUT_SCHEMAS } = S);
  });

  test('every stage key in VRP_OUTPUT_SCHEMAS resolves to an object schema', () => {
    const keys = ['claimExtraction', 'searchCollation', 'intelligenceSynthesis',
      'claimVerification', 'structuredReview', 'devilsAdvocate', 'synthesis'];
    for (const k of keys) {
      expect(VRP_OUTPUT_SCHEMAS[k]).toBeDefined();
      expect(VRP_OUTPUT_SCHEMAS[k].type).toBe('object');
    }
  });

  test('structured review drops an injected top-level key', () => {
    const r = validateAiJson(
      { overallRating: 'Excellent', impactNarrative: 'good', injectedKey: 'rm -rf /' },
      S.STRUCTURED_REVIEW_SCHEMA,
    );
    expect(r.ok).toBe(true);
    expect(r.value.injectedKey).toBeUndefined();
    expect(r.value.overallRating).toBe('Excellent');
  });

  test('claim verification keeps optional Perplexity `sources` and drops extras', () => {
    const r = validateAiJson(
      { claims: [{ claim: 'c', category: 'novelty', assessment: 'supported',
        reasoning: 'r', sources: ['http://x'], confidence: 'high', smuggled: 'y' }] },
      S.CLAIM_VERIFICATION_SCHEMA,
    );
    expect(r.ok).toBe(true);
    expect(r.value.claims[0].sources).toEqual(['http://x']);
    expect(r.value.claims[0].smuggled).toBeUndefined();
  });

  test('claim extraction leaves an absent noveltySearchStrings undefined (no default)', () => {
    const r = validateAiJson({ field: 'biology' }, S.CLAIM_EXTRACTION_SCHEMA);
    expect(r.ok).toBe(true);
    // The service tests `claimData.noveltySearchStrings` to decide whether to
    // skip the intelligence pass — it must stay undefined, not become [].
    expect(r.value.noveltySearchStrings).toBeUndefined();
  });

  test('synthesis ratingMatrix / positions validate as dynamic reviewer-keyed records', () => {
    const r = validateAiJson(
      {
        ratingMatrix: {
          impactRating: { Claude: 'Will rewrite textbooks', GPT: 'broad interest' },
          overallRating: { Claude: 'Excellent' },
        },
        disagreements: [{ topic: 't', positions: { Claude: 'for', GPT: 'against' }, significance: 's' }],
        panelRecommendation: 'fund',
      },
      S.PANEL_SYNTHESIS_SCHEMA,
    );
    expect(r.ok).toBe(true);
    expect(r.value.ratingMatrix.impactRating.Claude).toBe('Will rewrite textbooks');
    expect(r.value.disagreements[0].positions.GPT).toBe('against');
  });

  test('synthesis record rejects a prototype-pollution reviewer key', () => {
    // JSON.parse (what parseJSONResponse uses) creates a real own `__proto__`
    // key — an object literal would not. This is the realistic injection shape.
    const parsed = JSON.parse('{"ratingMatrix":{"impactRating":{"__proto__":"Excellent"}}}');
    const r = validateAiJson(parsed, S.PANEL_SYNTHESIS_SCHEMA);
    expect(r.ok).toBe(false);
  });

  // Invalid-but-parseable JSON — the failure path that returns null / marks the
  // provider failed. Not just happy-path wrapping (Codex review).
  test('invalid-but-parseable output fails validation (wrong field types)', () => {
    // claims must be an array, not a string.
    const r1 = validateAiJson({ claims: 'not-an-array' }, S.CLAIM_VERIFICATION_SCHEMA);
    expect(r1.ok).toBe(false);
    // ratingMatrix.impactRating must be a record (object), not an array.
    const r2 = validateAiJson({ ratingMatrix: { impactRating: [] } }, S.PANEL_SYNTHESIS_SCHEMA);
    expect(r2.ok).toBe(false);
    // top-level must be an object.
    const r3 = validateAiJson('a bare string', S.DEVILS_ADVOCATE_SCHEMA);
    expect(r3.ok).toBe(false);
  });
});
