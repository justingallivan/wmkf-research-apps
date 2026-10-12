/** @jest-environment node */
import { createFundingExtractionPrompt, createFundingAnalysisPrompt } from '../../../shared/config/prompts/funding-gap-analyzer';
import {
  FUNDING_GAP_EXTRACT_ROW,
  FUNDING_GAP_ANALYZE_ROW,
  TOOL_PROMPT_ROWS,
  buildFundingExtractVariables,
  buildFundingAnalyzeVariables,
} from '../../../shared/config/prompts/funding-gap-dynamics';
import { composeToolPromptPair } from '../../../lib/services/tool-prompt-composer';
import { validatePromptTemplatePair } from '../../../lib/utils/prompt-validators';
import { DATA_CLASSES, wrapUntrustedContent } from '../../../lib/utils/ai-payload-boundary';
import { withDeterministicNonces } from '../../helpers/prompt-parity';

const wrapProposal = (text) => wrapUntrustedContent({
  text,
  source: 'funding-gap.extraction.proposalText',
  dataClass: DATA_CLASSES.PROPOSAL_TEXT,
  maxChars: 100000,
  label: 'research proposal',
});

const PROPOSALS = {
  plain: 'A proposal about quantum materials.',
  'template-looking text': 'Has {{pi}} and {{a7_preamble}} and ${dollar} and $& and `ticks`',
};

describe('funding-gap.extract parity', () => {
  for (const [name, text] of Object.entries(PROPOSALS)) {
    test(`byte-equal: ${name}`, () => {
      const oldOut = withDeterministicNonces(['x1'], () => {
        const p = wrapProposal(text);
        return createFundingExtractionPrompt(p.text, [p.nonce]);
      });
      const newOut = withDeterministicNonces(['x1'], () => {
        const p = wrapProposal(text);
        const { variables, nonces } = buildFundingExtractVariables({ wrappedProposal: p.text, nonces: [p.nonce] });
        return composeToolPromptPair(
          { systemPrompt: FUNDING_GAP_EXTRACT_ROW.systemPrompt, body: FUNDING_GAP_EXTRACT_ROW.body },
          variables,
          { nonces },
        );
      });
      expect(newOut.systemPrompt).toBe('');
      expect(newOut.body).toBe(oldOut);
    });
  }
});

const nsf = { piAwards: { awards: [{ id: '1', title: 'T {{x}}' }], totalCount: 1, totalFunding: 5 }, keywordResults: { kw: { totalCount: 2 } } };
const nih = { piProjects: { projects: [], totalCount: 0, totalFunding: 0 }, keywordResults: {} };
const usaOn = { awards: [{ award_id: 'A' }], totalCount: 1, totalFunding: 9, byAgency: { DOE: { count: 1 } } };
const usaOff = { awards: [], totalCount: 0, totalFunding: 0, byAgency: {}, disabled: true };
const base = { pi: 'Jane Q. Researcher', institution: 'Example University', searchYears: 5 };

const FIXTURES = {
  'usa enabled, multiple keywords': { ...base, keywords: ['a', 'b c', 'd'], nsfData: nsf, nihData: nih, usaSpendingData: usaOn },
  'usa disabled, multiple keywords': { ...base, keywords: ['a', 'b c', 'd'], nsfData: nsf, nihData: nih, usaSpendingData: usaOff },
  'usa enabled, single keyword': { ...base, keywords: ['only'], nsfData: nsf, nihData: nih, usaSpendingData: usaOn },
  'usa disabled, empty keywords': { ...base, keywords: [], nsfData: nsf, nihData: nih, usaSpendingData: usaOff },
  'usa enabled, empty keywords': { ...base, keywords: [], nsfData: nsf, nihData: nih, usaSpendingData: usaOn },
  'missing NSF/NIH data (undefined)': { ...base, keywords: ['k'], nsfData: undefined, nihData: undefined, usaSpendingData: usaOff },
  'null NSF/NIH data, usa enabled': { ...base, keywords: ['k'], nsfData: null, nihData: null, usaSpendingData: usaOn },
  'template-looking and $-pattern values': {
    pi: 'P {{institution}} $& $1', institution: 'I ${x} {{pi}}', searchYears: 3,
    keywords: ['{{k}}', '$`', "it's"], nsfData: nsf, nihData: nih, usaSpendingData: usaOn,
  },
  'string searchYears': { ...base, searchYears: '10', keywords: ['k'], nsfData: nsf, nihData: nih, usaSpendingData: usaOff },
};

const SEEDS = ['nsf', 'nih', 'usa'];
const composeAnalyze = (data) => withDeterministicNonces(SEEDS, () => {
  const { variables, nonces } = buildFundingAnalyzeVariables(data);
  return composeToolPromptPair(
    { systemPrompt: FUNDING_GAP_ANALYZE_ROW.systemPrompt, body: FUNDING_GAP_ANALYZE_ROW.body },
    variables,
    { nonces },
  );
});

describe('funding-gap.analyze parity', () => {
  test.each(Object.entries(FIXTURES))('byte-equal: %s', (_n, data) => {
    const oldOut = withDeterministicNonces(SEEDS, () => createFundingAnalysisPrompt(data));
    const out = composeAnalyze(data);
    expect(out.systemPrompt).toBe('');
    expect(out.body).toBe(oldOut);
  });

  test('the usa-disabled and usa-enabled outputs differ (branches are exercised)', () => {
    const a = composeAnalyze(FIXTURES['usa enabled, multiple keywords']).body;
    const b = composeAnalyze(FIXTURES['usa disabled, multiple keywords']).body;
    expect(a).not.toBe(b);
    expect(b).toContain('NOT QUERIED (disabled by user)');
  });
});

describe('row definitions', () => {
  test.each([[FUNDING_GAP_EXTRACT_ROW, 'funding-gap.extract', 1000], [FUNDING_GAP_ANALYZE_ROW, 'funding-gap.analyze', 4000]])(
    '%# metadata, validator, slot, no A7 text',
    (ROW, name, maxTokens) => {
      expect(ROW).toMatchObject({ promptName: name, model: 'sonnet', maxTokens });
      expect(ROW.temperature).toBeUndefined();
      const declared = ROW.variables.variables.map((v) => v.name);
      expect(declared).toContain('a7_preamble');
      expect(validatePromptTemplatePair(ROW.promptName, { systemPrompt: ROW.systemPrompt, body: ROW.body, declaredVars: declared }))
        .toEqual({ valid: true, issues: [] });
      const stripped = ROW.body.replace('{{a7_preamble}}', '');
      const r = validatePromptTemplatePair(ROW.promptName, { systemPrompt: ROW.systemPrompt, body: stripped, declaredVars: declared });
      expect(r.valid).toBe(false);
      expect(r.issues.join(' ')).toMatch(/a7_preamble/);
      for (const t of [ROW.systemPrompt, ROW.body]) {
        expect(t).not.toMatch(/UNTRUSTED CONTENT RULES:|WMKF-UNTRUSTED-CONTENT|\[\[WMKF-/);
      }
    },
  );
  test('manifest rows', () => {
    expect(TOOL_PROMPT_ROWS).toEqual([FUNDING_GAP_EXTRACT_ROW, FUNDING_GAP_ANALYZE_ROW]);
  });
});
