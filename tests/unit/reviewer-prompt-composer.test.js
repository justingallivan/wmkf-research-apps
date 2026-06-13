/**
 * Composer tests (S222). The headline guard: composeAnalyzePrompt over the
 * in-repo dynamics template is BYTE-IDENTICAL to the legacy createAnalysisPrompt
 * for the same inputs (proof the Dataverse-resolved path doesn't change what
 * Claude sees). Both take a pre-wrapped proposal + explicit nonces, so the
 * comparison is deterministic. The score composer is checked structurally
 * (proposal_summary is now wrapped — a deliberate divergence from the old
 * score output).
 */
import {
  composeAnalyzePrompt,
  composeScorePrompt,
  buildAnalyzeBlockVars,
} from '../../lib/services/reviewer-prompt-composer.js';
import { createAnalysisPrompt } from '../../shared/config/prompts/reviewer-finder.js';
import {
  ANALYZE_USER_PROMPT_TEMPLATE,
  SCORE_CANDIDATES_USER_PROMPT_TEMPLATE,
} from '../../shared/config/prompts/reviewer-finder-dynamics.js';
import { DEFAULT_REVIEWER_COUNT } from '../../shared/config/reviewerFinderPreferences.js';

const WRAPPED = '[[WMKF-UNTRUSTED-CONTENT nonce=deadbeef]]\nProposal body here.\n[[/WMKF-UNTRUSTED-CONTENT nonce=deadbeef]]';
const NONCE = 'deadbeef';

describe('composeAnalyzePrompt byte-parity with createAnalysisPrompt', () => {
  const cases = [
    { name: 'no notes / no excluded', notes: '', excluded: [], count: 12 },
    { name: 'with notes', notes: 'Focus on RNA folding.', excluded: [], count: 10 },
    { name: 'with excluded names', notes: '', excluded: ['Dr. A', 'Dr. B'], count: 8 },
    { name: 'with both', notes: 'Notes here.', excluded: ['Dr. C'], count: 15 },
  ];
  for (const c of cases) {
    it(`matches for: ${c.name}`, () => {
      const fromCode = createAnalysisPrompt(WRAPPED, c.notes, c.excluded, c.count, [NONCE]);
      const fromComposer = composeAnalyzePrompt({
        body: ANALYZE_USER_PROMPT_TEMPLATE,
        proposalText: WRAPPED,
        nonces: [NONCE],
        additionalNotes: c.notes,
        excludedNames: c.excluded,
        reviewerCount: c.count,
      });
      expect(fromComposer).toBe(fromCode);
    });
  }
});

describe('buildAnalyzeBlockVars matches legacy conditional layout', () => {
  it('empty when absent', () => {
    const v = buildAnalyzeBlockVars({ additionalNotes: '', excludedNames: [], reviewerCount: 12 });
    expect(v).toEqual({ additional_notes_block: '', excluded_names_block: '', reviewer_count: '12' });
  });
  it('formats notes + excluded', () => {
    const v = buildAnalyzeBlockVars({ additionalNotes: 'X', excludedNames: ['A', 'B'], reviewerCount: 9 });
    expect(v.additional_notes_block).toBe('**ADDITIONAL CONTEXT FROM USER:**\nX\n');
    expect(v.excluded_names_block).toBe('\n**EXCLUDED NAMES (conflicts of interest - do NOT suggest these):**\nA, B\n');
    expect(v.reviewer_count).toBe('9');
  });
});

describe('default reviewer count is the single shared constant (S249: 12→15)', () => {
  it('DEFAULT_REVIEWER_COUNT is 15 (recall lever)', () => {
    expect(DEFAULT_REVIEWER_COUNT).toBe(15);
  });
  it('buildAnalyzeBlockVars falls back to DEFAULT_REVIEWER_COUNT when count omitted', () => {
    const v = buildAnalyzeBlockVars({ additionalNotes: '', excludedNames: [] });
    expect(v.reviewer_count).toBe(String(DEFAULT_REVIEWER_COUNT));
  });
  it('createAnalysisPrompt and composeAnalyzePrompt agree on the omitted-count default', () => {
    const fromCode = createAnalysisPrompt(WRAPPED, '', [], undefined, [NONCE]);
    const fromComposer = composeAnalyzePrompt({
      body: ANALYZE_USER_PROMPT_TEMPLATE,
      proposalText: WRAPPED,
      nonces: [NONCE],
    });
    expect(fromComposer).toBe(fromCode);
    expect(fromCode).toContain(`Suggest ${DEFAULT_REVIEWER_COUNT} potential expert reviewers`);
  });
});

describe('composeScorePrompt — A7 boundary for both summary and candidates', () => {
  it('prepends a preamble naming both nonces and interpolates wrapped text', () => {
    const out = composeScorePrompt({
      body: SCORE_CANDIDATES_USER_PROMPT_TEMPLATE,
      proposalSummaryText: '[[WMKF-UNTRUSTED-CONTENT nonce=sum]]summary[[/WMKF-UNTRUSTED-CONTENT nonce=sum]]',
      candidatesText: '[[WMKF-UNTRUSTED-CONTENT nonce=cand]]candidates[[/WMKF-UNTRUSTED-CONTENT nonce=cand]]',
      nonces: ['sum', 'cand'],
    });
    expect(out.startsWith('UNTRUSTED CONTENT RULES:')).toBe(true);
    expect(out).toContain('sum, cand'); // both nonces named in the preamble
    expect(out).toContain('nonce=sum'); // wrapped summary present
    expect(out).toContain('nonce=cand'); // wrapped candidates present
    expect(out).not.toContain('{{proposal_summary}}');
    expect(out).not.toContain('{{candidates_list}}');
  });
});
