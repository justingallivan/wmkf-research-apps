/**
 * Unit tests for the field-primer service.
 * Mocks the Executor so no live Claude/Dataverse call is made.
 */
jest.mock('../../lib/services/execute-prompt.js', () => ({
  executePrompt: jest.fn(),
}));

import { executePrompt } from '../../lib/services/execute-prompt.js';
import {
  generateFieldPrimer,
  renderPrimerMarkdown,
  FIELD_PRIMER_PROMPT_NAME,
  PRIMER_SECTIONS,
} from '../../lib/services/field-primer-service.js';

const SAMPLE_PRIMER = {
  field_overview: 'The field studies microbial gene transfer.',
  subareas: [{ name: 'Phage biology', description: 'Bacteriophage life cycles.' }],
  key_methods: [{ name: 'Comparative genomics', description: 'Sequence comparison.' }],
  frontiers: [{ frontier: 'GTA engineering', why_now: 'New tools.' }],
  communities: [{ name: 'Phage genomics groups', description: 'Academic labs.' }],
  venues: ['Journal of Bacteriology', 'mBio'],
  experts: [{ name: 'Jane Doe', affiliation: 'Example U', why_relevant: 'GTA pioneer.' }],
  proposal_placement: 'Extends prior GTA work into engineering.',
  caveats: 'Knowledge-only; named experts are orienting, not vetted.',
};

const LONG_TEXT = 'A research proposal about microbial viruses. '.repeat(5);

beforeEach(() => {
  executePrompt.mockReset();
});

describe('generateFieldPrimer', () => {
  test('rejects missing / too-short proposal text without calling the Executor', async () => {
    await expect(generateFieldPrimer({ proposalText: '' })).rejects.toThrow(/proposalText/);
    await expect(generateFieldPrimer({ proposalText: 'too short' })).rejects.toThrow(/proposalText/);
    expect(executePrompt).not.toHaveBeenCalled();
  });

  test('calls the Executor with the right prompt name, override vars, and forceOverwrite', async () => {
    executePrompt.mockResolvedValue({ parsed: SAMPLE_PRIMER, runId: 'run-1', meta: { modelUsed: 'claude-opus-x' }, usage: { input_tokens: 10 } });
    const out = await generateFieldPrimer({ proposalText: LONG_TEXT, runSource: 'Vercel Test' });

    expect(executePrompt).toHaveBeenCalledTimes(1);
    const arg = executePrompt.mock.calls[0][0];
    expect(arg.promptName).toBe(FIELD_PRIMER_PROMPT_NAME);
    expect(arg.runSource).toBe('Vercel Test');
    expect(arg.forceOverwrite).toBe(true);
    expect(arg.overrideVariables.proposal_text).toBe(LONG_TEXT);
    expect(arg.overrideVariables.focus_hint).toBe(''); // no focus → empty

    expect(out.primer).toEqual(SAMPLE_PRIMER);
    expect(out.runId).toBe('run-1');
    expect(out.model).toBe('claude-opus-x');
  });

  test('weaves a focus hint into the override variables when provided', async () => {
    executePrompt.mockResolvedValue({ parsed: SAMPLE_PRIMER, runId: 'r', meta: {}, usage: null });
    await generateFieldPrimer({ proposalText: LONG_TEXT, focus: 'the materials angle' });
    const arg = executePrompt.mock.calls[0][0];
    expect(arg.overrideVariables.focus_hint).toContain('the materials angle');
  });

  test('throws if the Executor reports a blocked run', async () => {
    executePrompt.mockResolvedValue({ blocked: true, parsed: null, runId: 'r' });
    await expect(generateFieldPrimer({ proposalText: LONG_TEXT })).rejects.toThrow(/blocked/);
  });
});

describe('renderPrimerMarkdown', () => {
  test('renders the header, the not-vetted disclaimer, and every populated section', () => {
    const md = renderPrimerMarkdown(SAMPLE_PRIMER, { title: 'GTA proposal' });
    expect(md).toContain('# Field Primer: GTA proposal');
    expect(md).toMatch(/not.*vetted reviewer suggestions/i);
    expect(md).toContain('Phage biology');
    expect(md).toContain('Jane Doe');
    expect(md).toContain('Example U');
    expect(md).toContain('Journal of Bacteriology · mBio');
    expect(md).toContain('Caveats');
  });

  test('tolerates an empty / partial primer without throwing', () => {
    expect(() => renderPrimerMarkdown({})).not.toThrow();
    const md = renderPrimerMarkdown({ field_overview: 'only this' });
    expect(md).toContain('# Field Primer');
    expect(md).toContain('only this');
  });
});

describe('exports', () => {
  test('prompt name and section list are stable', () => {
    expect(FIELD_PRIMER_PROMPT_NAME).toBe('field-primer.generate');
    expect(PRIMER_SECTIONS).toEqual(Object.keys(SAMPLE_PRIMER));
  });
});
