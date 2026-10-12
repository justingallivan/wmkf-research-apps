/** @jest-environment node */
import * as OLD from '../../../shared/config/prompts/multi-perspective-evaluator';
import {
  MULTI_PERSPECTIVE_INITIAL_ANALYSIS_ROW as INITIAL_ROW,
  MULTI_PERSPECTIVE_PROPOSAL_SUMMARY_ROW as SUMMARY_ROW,
  MULTI_PERSPECTIVE_OPTIMIST_ROW as OPTIMIST_ROW,
  MULTI_PERSPECTIVE_SKEPTIC_ROW as SKEPTIC_ROW,
  MULTI_PERSPECTIVE_NEUTRAL_ROW as NEUTRAL_ROW,
  MULTI_PERSPECTIVE_INTEGRATOR_ROW as INTEGRATOR_ROW,
  TOOL_PROMPT_ROWS,
  KECK_FUNDING_GUIDELINES,
  EVALUATION_FRAMEWORKS,
  buildMultiPerspectiveInitialVariables,
  buildMultiPerspectiveSummaryVariables,
  buildMultiPerspectiveVariables,
  buildMultiPerspectiveIntegratorVariables,
} from '../../../shared/config/prompts/multi-perspective-dynamics';
import { composeToolPromptPair } from '../../../lib/services/tool-prompt-composer';
import { validatePromptTemplatePair } from '../../../lib/utils/prompt-validators';
import { withDeterministicNonces } from '../../helpers/prompt-parity';

const SEEDS = ['n1', 'n2', 'n3', 'n4'];

const FULL = {
  title: 'Concept {{x}} ${dollar} $& $1',
  piName: 'Dr. {{a7_preamble}}',
  institution: 'Univ',
  researchArea: 'biology',
  summary: 'Summary with `ticks`',
  initialObservations: { innovativeAspects: 'inn', technicalApproach: 'tech', potentialChallenges: 'chal' },
  keyMethodologies: ['m1', 'm2'],
};
const ANALYSES = {
  full: FULL,
  sparse: { title: '', keyMethodologies: [], initialObservations: {} },
  empty: {},
  'only methodologies': { keyMethodologies: ['solo'] },
};
const PUBS = (n, source) => Array.from({ length: n }, (_, i) => ({
  title: `Paper ${i} {{y}}`, source, year: i % 2 ? 2024 : undefined, publicationDate: i % 2 ? undefined : '2023-05-01',
  authors: i % 3 === 0 ? ['A', 'B', 'C', 'D'] : i % 3 === 1 ? ['Solo'] : undefined,
}));
const LITS = {
  undefined: undefined,
  empty: [],
  'one source, 2': PUBS(2, 'PubMed'),
  'two sources, 7 + 1 + unknown': [...PUBS(7, 'arXiv'), ...PUBS(1, 'PubMed'), { title: 'No source' }],
  'template-looking': [{ title: '${x} {{a7_preamble}} $&', source: 'PubMed', authors: ['$1'] }],
};
const FRAMEWORKS = [...Object.keys(OLD.EVALUATION_FRAMEWORKS), 'unknown-framework', undefined];
const RESULTS = {
  optimist: { perspective: 'optimist', overallImpression: 'good {{x}}', keyStrengths: ['a', '${b}'] },
  skeptic: { perspective: 'skeptic', error: 'Failed to parse response', rawResponse: '$& {{a7_preamble}}' },
  neutral: undefined,
};

const compose = (row, { variables, nonces }) =>
  composeToolPromptPair({ systemPrompt: row.systemPrompt, body: row.body }, variables, { nonces });
const both = (oldFn, row, newFn) => {
  const oldOut = withDeterministicNonces(SEEDS, oldFn);
  const out = withDeterministicNonces(SEEDS, () => compose(row, newFn()));
  expect(out.systemPrompt).toBe('');
  expect(out.body).toBe(oldOut);
};

describe('multi-perspective rows mirror the oracle data', () => {
  test('guidelines and frameworks are deep-equal to the old module', () => {
    expect(KECK_FUNDING_GUIDELINES).toEqual(OLD.KECK_FUNDING_GUIDELINES);
    expect(EVALUATION_FRAMEWORKS).toEqual(OLD.EVALUATION_FRAMEWORKS);
  });
});

describe('multi-perspective.initial-analysis parity', () => {
  test('byte-equal', () => both(() => OLD.createInitialAnalysisPrompt(), INITIAL_ROW, () => buildMultiPerspectiveInitialVariables()));
});

describe('multi-perspective.proposal-summary parity', () => {
  for (const [an, a] of Object.entries(ANALYSES)) {
    for (const [ln, l] of Object.entries(LITS)) {
      test(`byte-equal: ${an} / lit ${ln}`, () =>
        both(() => OLD.createProposalSummaryPrompt(a, l), SUMMARY_ROW, () => buildMultiPerspectiveSummaryVariables(a, l)));
    }
  }
});

describe.each([
  ['optimist', OLD.createOptimistPrompt, OPTIMIST_ROW],
  ['skeptic', OLD.createSkepticPrompt, SKEPTIC_ROW],
  ['neutral', OLD.createNeutralPrompt, NEUTRAL_ROW],
])('multi-perspective.%s parity', (_name, oldFn, row) => {
  for (const fw of FRAMEWORKS) {
    for (const [an, a] of Object.entries(ANALYSES)) {
      for (const [ln, l] of Object.entries(LITS)) {
        test(`byte-equal: framework ${String(fw)} / ${an} / lit ${ln}`, () =>
          both(() => oldFn(a, l, fw), row, () => buildMultiPerspectiveVariables(a, l, fw)));
      }
    }
  }
});

describe('multi-perspective.integrator parity', () => {
  for (const fw of FRAMEWORKS) {
    for (const [an, a] of Object.entries(ANALYSES)) {
      test(`byte-equal: framework ${String(fw)} / ${an}`, () =>
        both(
          () => OLD.createIntegratorPrompt(a, RESULTS.optimist, RESULTS.skeptic, RESULTS.neutral, fw),
          INTEGRATOR_ROW,
          () => buildMultiPerspectiveIntegratorVariables(a, RESULTS.optimist, RESULTS.skeptic, RESULTS.neutral, fw),
        ));
    }
  }
  test('byte-equal with all-undefined results', () =>
    both(() => OLD.createIntegratorPrompt(FULL, undefined, undefined, undefined, 'nsf'), INTEGRATOR_ROW,
      () => buildMultiPerspectiveIntegratorVariables(FULL, undefined, undefined, undefined, 'nsf')));
});

describe('nonce order', () => {
  test('integrator nonces are concept, optimist, skeptic, neutral', () => {
    const { nonces } = withDeterministicNonces(SEEDS, () =>
      buildMultiPerspectiveIntegratorVariables(FULL, {}, {}, {}, 'keck'));
    expect(nonces).toHaveLength(4);
    expect(new Set(nonces).size).toBe(4);
  });
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
  test('manifest rows, models and max tokens', () => {
    expect(TOOL_PROMPT_ROWS.map((r) => r.promptName)).toEqual([
      'multi-perspective.initial-analysis', 'multi-perspective.proposal-summary', 'multi-perspective.optimist',
      'multi-perspective.skeptic', 'multi-perspective.neutral', 'multi-perspective.integrator',
    ]);
    expect(TOOL_PROMPT_ROWS.map((r) => [r.model, r.maxTokens])).toEqual([
      ['sonnet', 2000], ['sonnet', 1500], ['sonnet', 2500], ['sonnet', 2500], ['sonnet', 2500], ['sonnet', 3500],
    ]);
  });
});
