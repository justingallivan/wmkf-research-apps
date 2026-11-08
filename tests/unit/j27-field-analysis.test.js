/** @jest-environment node */
jest.mock('../../lib/services/execute-prompt', () => ({ executePrompt: jest.fn() }));
jest.mock('../../lib/services/openalex-service', () => ({ OpenAlexService: { searchWorks: jest.fn() } }));
jest.mock('../../lib/services/pubmed-service', () => ({ PubMedService: { searchWithCount: jest.fn() } }));

import { executePrompt } from '../../lib/services/execute-prompt';
import { OpenAlexService } from '../../lib/services/openalex-service';
import { PubMedService } from '../../lib/services/pubmed-service';
import {
  generateJ27FieldAnalysis, searchJ27FieldAnalysisLiterature,
} from '../../lib/services/workbench/j27-field-analysis';

const source = {
  sourceId: 'pmid:123', title: 'Cell signaling', firstAuthor: 'Ng',
  url: 'https://pubmed.ncbi.nlm.nih.gov/123/', firstPublicDate: '2026-01-10',
  type: 'article', evidenceLevel: 'full_text', passage: 'The method detects a signaling response.',
};
const inputs = {
  requestId: '11111111-1111-1111-1111-111111111111',
  proposalText: '[page 1] The proposal tests a cellular signaling mechanism.',
  bibliography: 'Ng, Cell signaling.',
  summaryFields: 'Scientific Question: How do cells signal?',
  submissionDate: '2026-02-01',
  intakeOpenQuestions: [],
  checkedSources: [source],
};
const draft = {
  state_of_play: 'A cell signaling response has been detected [1].',
  novelty: 'The proposal tests how the response is triggered.',
  claims_checked: '',
  reference_source_ids: [source.sourceId],
  open_questions: [{ type: 'numbers_check', detail: 'The detection threshold needs checking.', page: 1, section: 'Methods' }],
  pd_notes: [{ type: 'source_unavailable', detail: 'A cited conference abstract was unavailable.', page: null, section: '' }],
};

beforeEach(() => {
  jest.resetAllMocks();
  executePrompt.mockResolvedValue({ parsed: draft, writeResults: { allOk: true }, runId: 'run', meta: { promptVersion: 1 } });
});

test('resolves bibliography from checked sources and returns separate review signals', async () => {
  const result = await generateJ27FieldAnalysis(inputs);
  expect(result.fieldAnalysis.references).toEqual([{ ...source, n: 1 }]);
  expect(result.fieldAnalysis).not.toHaveProperty('openQuestions');
  expect(result.openQuestions).toEqual(draft.open_questions);
  expect(result.pdNotes).toEqual(draft.pd_notes);
  expect(executePrompt).toHaveBeenCalledWith(expect.objectContaining({
    promptName: 'j27.field-analysis.generate',
    requireNoPersistence: true,
    overrideVariables: expect.objectContaining({ intake_open_questions: '[]', submission_date: '2026-02-01' }),
  }));
});

test.each([
  { reference_source_ids: ['invented'] },
  { state_of_play: 'The field has two approaches [2].' },
  { state_of_play: `${'word '.repeat(600)}[1]` },
])('rejects a brief with invalid references or length', async (change) => {
  executePrompt.mockResolvedValue({ parsed: { ...draft, ...change }, writeResults: { allOk: true } });
  await expect(generateJ27FieldAnalysis(inputs)).rejects.toThrow(/oversized brief or invalid source citations/);
});

test('rejects an impossible submission date before executing', async () => {
  await expect(generateJ27FieldAnalysis({ ...inputs, submissionDate: '2026-02-30' })).rejects.toThrow(/verified submission date/);
  expect(executePrompt).not.toHaveBeenCalled();
});

test('preserves search leads and distinguishes a provider failure from no results', async () => {
  OpenAlexService.searchWorks.mockResolvedValue({ totalCount: 8, records: [{ title: 'Paper', doi: '10.1234/test' }] });
  PubMedService.searchWithCount.mockRejectedValue(new Error('Timed out'));
  const searches = await searchJ27FieldAnalysisLiterature(['cell signaling', 'cell signaling']);
  expect(searches).toMatchObject([
    { provider: 'openalex', status: 'found', totalCount: 8, records: [{ title: 'Paper' }] },
    { provider: 'pubmed', status: 'unavailable', records: [] },
  ]);
  expect(OpenAlexService.searchWorks).toHaveBeenCalledTimes(1);
  PubMedService.searchWithCount.mockResolvedValue({ totalCount: 0, records: [] });
  await expect(searchJ27FieldAnalysisLiterature(['cell signaling']))
    .resolves.toContainEqual(expect.objectContaining({ provider: 'pubmed', status: 'no_results' }));
});
