/** @jest-environment node */
import {
  LITERATURE_EXTRACT_PAPER_ROW,
  LITERATURE_SYNTHESIZE_ROW,
  LITERATURE_COMPARE_ROW,
  TOOL_PROMPT_ROWS,
  buildLiteratureExtractVariables,
  buildLiteratureSynthesisVariables,
  buildLiteratureCompareVariables,
} from '../../../shared/config/prompts/literature-analyzer-dynamics';
import { composeToolPromptPair } from '../../../lib/services/tool-prompt-composer';
import { validatePromptTemplatePair } from '../../../lib/utils/prompt-validators';
import { withDeterministicNonces } from '../../helpers/prompt-parity';
import { expectGolden } from '../../helpers/golden';

const FULL = {
  title: 'Full Paper',
  authors: ['A One', 'B Two', 'C Three', 'D Four'],
  year: 2021,
  abstract: 'Abstract with {{x}} and ${dollar} and $& and `ticks`',
  methods: { approach: 'Approach $1 {{a7_preamble}}' },
  findings: { main: ['f1', 'f2'] },
  conclusions: { summary: 'Concluded.' },
  keywords: ['k1', 'k2'],
};
const SPARSE = { title: '', authors: [], methods: {}, findings: { main: [] } };
const EMPTY = {};

const PAPER_SETS = {
  'full + sparse + empty': [FULL, SPARSE, EMPTY],
  'two full': [FULL, { ...FULL, title: 'Second', authors: ['Solo'] }],
  'no papers': [],
};
const FOCI = { absent: null, undefined: undefined, empty: '', present: 'CRISPR delivery', 'template-looking': 'x {{y}} ${z} $& "q"' };

const compose = (row, { variables, nonces }) =>
  composeToolPromptPair({ systemPrompt: row.systemPrompt, body: row.body }, variables, { nonces });

describe('literature-analyzer.extract-paper parity', () => {
  test('byte-equal', () => {
    const out = compose(LITERATURE_EXTRACT_PAPER_ROW, buildLiteratureExtractVariables());
    expect(out.systemPrompt).toBe('');
    expectGolden('literature-analyzer', out.body);
  });
});

describe('literature-analyzer.synthesize parity', () => {
  for (const [pname, papers] of Object.entries(PAPER_SETS)) {
    for (const [fname, focus] of Object.entries(FOCI)) {
      test(`byte-equal: ${pname} / focus ${fname}`, () => {
        const out = withDeterministicNonces(['n1'], () =>
          compose(LITERATURE_SYNTHESIZE_ROW, buildLiteratureSynthesisVariables(papers, focus)));
        expect(out.systemPrompt).toBe('');
        expectGolden('literature-analyzer', out.body);
      });
    }
  }
  test('default focus argument matches', () => {
    const out = withDeterministicNonces(['n1'], () =>
      compose(LITERATURE_SYNTHESIZE_ROW, buildLiteratureSynthesisVariables(PAPER_SETS['two full'])));
    expectGolden('literature-analyzer', out.body);
  });
});

describe('literature-analyzer.compare parity', () => {
  for (const [pname, papers] of Object.entries(PAPER_SETS)) {
    for (const type of ['methods', 'findings', undefined, 'other']) {
      test(`byte-equal: ${pname} / ${String(type)}`, () => {
        const out = withDeterministicNonces(['n2'], () =>
          compose(LITERATURE_COMPARE_ROW, buildLiteratureCompareVariables(papers, type)));
        expect(out.systemPrompt).toBe('');
        expectGolden('literature-analyzer', out.body);
      });
    }
  }
});

describe('row validity', () => {
  test.each(TOOL_PROMPT_ROWS.map((r) => [r.promptName, r]))(
    '%s passes validation; removing the slot fails',
    (_n, ROW) => {
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
    expect(TOOL_PROMPT_ROWS.map((r) => r.promptName)).toEqual([
      'literature-analyzer.extract-paper', 'literature-analyzer.synthesize', 'literature-analyzer.compare',
    ]);
    expect(TOOL_PROMPT_ROWS.map((r) => [r.model, r.maxTokens])).toEqual([['sonnet', 4000], ['sonnet', 6000], ['sonnet', 4000]]);
  });
});
