jest.mock('../../lib/services/execute-prompt.js', () => ({ executePrompt: jest.fn() }));
jest.mock('../../lib/services/workbench-proposal-documents.js', () => ({ getAiProposalNarrativeText: jest.fn() }));
jest.mock('../../lib/dataverse/adapters/grant-request.js', () => ({ getById: jest.fn() }));
jest.mock('../../lib/services/prompt-store.js', () => ({ fetchCurrentPrompt: jest.fn() }));
jest.mock('../../lib/services/openalex-service.js', () => ({ OpenAlexService: { searchWorks: jest.fn() } }));
jest.mock('../../lib/services/pubmed-service.js', () => ({ PubMedService: { search: jest.fn() } }));

import { executePrompt } from '../../lib/services/execute-prompt.js';
import { getAiProposalNarrativeText } from '../../lib/services/workbench-proposal-documents.js';
import * as requests from '../../lib/dataverse/adapters/grant-request.js';
import { fetchCurrentPrompt } from '../../lib/services/prompt-store.js';
import { OpenAlexService } from '../../lib/services/openalex-service.js';
import { PubMedService } from '../../lib/services/pubmed-service.js';
import * as researchDefinition from '../../shared/config/prompts/cycle-dossier-research-plan.js';
import * as entryDefinition from '../../shared/config/prompts/cycle-dossier-entry.js';
import {
  prepareRequestInput, snapshotConfiguration, generateResearch, generateEntry,
  estimateGenerationCost, RESEARCH_PROMPT_NAME, ENTRY_PROMPT_NAME,
} from '../../lib/services/cycle-dossier-generation.js';

const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ID2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ROW = { akoya_requestid: ID, akoya_requestnum: 'D26-001', akoya_title: 'A proposal', wmkf_organizationname: 'Example U', _wmkf_projectleader_value_formatted: 'Dr PI', _wmkf_programdirector_value_formatted: 'PD', wmkf_ai_summary: 'summary' };
const narrative = { filename: 'ProposalNarrative_D26-001.pdf', siteId: 'site', driveId: 'drive', itemId: 'item', versionId: 'v1', contentHash: 'abc123', text: 'A'.repeat(200) };
const rowFor = (name, id) => {
  const definition = name === RESEARCH_PROMPT_NAME ? researchDefinition : entryDefinition;
  return { wmkf_ai_promptid: id, wmkf_ai_promptname: name, wmkf_promptversion: 4, wmkf_ai_systemprompt: definition.SYSTEM_PROMPT, wmkf_ai_promptbody: definition.USER_PROMPT_TEMPLATE, wmkf_ai_promptvariables: JSON.stringify(definition.VARIABLES), wmkf_ai_promptoutputschema: JSON.stringify(definition.OUTPUT_SCHEMA), wmkf_ai_model: 'claude-haiku-4-5', wmkf_ai_maxtokens: 1000 };
};
const config = { prompts: { researchPlan: rowFor(RESEARCH_PROMPT_NAME, ID2), entry: rowFor(ENTRY_PROMPT_NAME, ID) }, pricing: null };

beforeEach(() => {
  jest.clearAllMocks();
  requests.getById.mockResolvedValue(ROW);
  getAiProposalNarrativeText.mockResolvedValue(narrative);
  fetchCurrentPrompt.mockImplementation(async (name) => rowFor(name, name === RESEARCH_PROMPT_NAME ? ID2 : ID));
  OpenAlexService.searchWorks.mockResolvedValue({ records: [{ openAlexId: 'oa-1', title: 'OpenAlex study', url: 'https://openalex.org/W1', abstract: 'An adequate abstract '.repeat(10), year: 2026 }] });
  PubMedService.search.mockResolvedValue([{ pmid: '123', title: 'PubMed study', doi: '10.1/x', abstract: 'A second adequate abstract '.repeat(10), year: 2025 }]);
});

test('prepareRequestInput freezes exact source identity and preserves allowlisted context', async () => {
  const input = await prepareRequestInput(ID);
  expect(input.narrative).toMatchObject({ filename: narrative.filename, contentHash: 'abc123', text: narrative.text });
  expect(Object.isFrozen(input)).toBe(true);
  expect(Object.isFrozen(input.narrative)).toBe(true);
  expect(input.priorAiContext.summary).toBe('summary');
});

test('snapshotConfiguration pins both published rows', async () => {
  const configSnapshot = await snapshotConfiguration();
  expect(configSnapshot.prompts.researchPlan.wmkf_promptversion).toBe(4);
  expect(configSnapshot.prompts.entry.wmkf_ai_model).toBe('claude-haiku-4-5');
  expect(Object.isFrozen(configSnapshot.prompts.entry)).toBe(true);
});

test.each(['missing-model', 'live-source', 'unwrapped', 'missing-placeholder', 'persistent-output'])('snapshot fails closed for edited %s contract', async (change) => {
  fetchCurrentPrompt.mockImplementation(async name => {
    const row = rowFor(name, ID);
    if (change === 'missing-model') row.wmkf_ai_model = '';
    if (change === 'missing-placeholder') row.wmkf_ai_promptbody = 'No inputs';
    if (change === 'persistent-output') row.wmkf_ai_promptoutputschema = JSON.stringify({ outputs: [{ target: { kind: 'requestField' } }] });
    if (change === 'live-source' || change === 'unwrapped') {
      const vars = JSON.parse(row.wmkf_ai_promptvariables);
      if (change === 'live-source') vars.variables[0].source.kind = 'request';
      else vars.variables[0].untrusted = false;
      row.wmkf_ai_promptvariables = JSON.stringify(vars);
    }
    return row;
  });
  await expect(snapshotConfiguration()).rejects.toMatchObject({ code: 'cycle_dossier_prompt_invalid' });
});

test('cost ceiling counts repeated placeholders and cannot reduce transport retry reserve', () => {
  const priced = { ...config, pricing: { inputUsdPer1k: 1, outputUsdPer1k: 2 } };
  const input = { narrative: { text: 'α'.repeat(10000) } };
  const baseline = estimateGenerationCost(input, priced);
  const repeated = { ...priced, budget: { llmMaxRetries: 0 }, prompts: { ...priced.prompts, entry: { ...priced.prompts.entry, wmkf_ai_promptbody: priced.prompts.entry.wmkf_ai_promptbody + '{{proposal_narrative}}' } } };
  expect(estimateGenerationCost(input, repeated).highUsd).toBeGreaterThan(baseline.highUsd);
  expect(estimateGenerationCost(input, repeated).maxAttempts).toBe(5);
});

test('literature adapters keep static this binding and get abort signals', async () => {
  executePrompt.mockResolvedValue({ parsed: { queries: [{ query: 'topic', reason: 'field' }] } });
  PubMedService.search.mockImplementation(async function(_query, _limit, options) {
    expect(this).toBe(PubMedService);
    expect(options.signal).toBeDefined();
    return [];
  });
  const result = await generateResearch(await prepareRequestInput(ID), config);
  expect(result.research.evidence).toHaveLength(1);
  expect(OpenAlexService.searchWorks.mock.calls[0][1].signal).toBeDefined();
});

test('generateResearch bounds plan, retains source contexts, and calls guard before each provider', async () => {
  const input = await prepareRequestInput(ID);
  executePrompt.mockResolvedValue({ parsed: { queries: [{ query: 'topic one', reason: 'field' }, { query: 'topic two', reason: 'method' }, { query: 'topic three', reason: 'mechanism' }, { query: 'ignored' }] }, runId: 'plan', usage: { output_tokens: 10 } });
  const guards = [];
  const result = await generateResearch(input, config, { beforePaidCall: async (details) => guards.push(details) });
  expect(result.research.queries).toHaveLength(3);
  expect(result.research.evidence).toHaveLength(2); // duplicate records are retained once across query results
  expect(OpenAlexService.searchWorks).toHaveBeenCalledTimes(3);
  expect(PubMedService.search).toHaveBeenCalledTimes(3);
  expect(guards.filter((g) => g.stage === 'research-search')).toHaveLength(6);
  expect(Object.isFrozen(result.research)).toBe(true);
});

test('generateResearch fails closed when all source contexts are unavailable', async () => {
  const input = await prepareRequestInput(ID);
  executePrompt.mockResolvedValue({ parsed: { queries: [{ query: 'topic', reason: 'field' }] } });
  OpenAlexService.searchWorks.mockRejectedValue(new Error('offline'));
  PubMedService.search.mockResolvedValue([{ pmid: '1', title: 'No abstract', abstract: '' }]);
  await expect(generateResearch(input, config)).rejects.toMatchObject({ code: 'cycle_dossier_research_empty' });
});

test('generateResearch discloses a source with no results when the other source has evidence', async () => {
  const input = await prepareRequestInput(ID);
  executePrompt.mockResolvedValue({ parsed: { queries: [{ query: 'topic', reason: 'field' }] } });
  PubMedService.search.mockResolvedValue([]);
  const result = await generateResearch(input, config);
  expect(result.research.partial).toBe(true);
  expect(result.research.failures).toEqual(expect.arrayContaining([expect.objectContaining({ source: 'pubmed', reason: 'no results' })]));
});

test('generateEntry validates references and returns provenance plus stable source hash', async () => {
  const input = await prepareRequestInput(ID);
  const research = { schema: 'cycle-dossier-research/v1', evidence: [{ sourceId: 'oa-1', title: 'Study', url: 'https://example.test/study', abstract: 'context', retrievedAt: '2026-09-07T00:00:00.000Z' }], coverage: 'one source', partial: false };
  executePrompt.mockResolvedValue({ parsed: { projectAtAGlance: 'glance', whyItMatters: 'matters', fieldAroundIt: 'field', backgroundForOutsideField: 'background', references: [{ sourceId: 'oa-1', ignored: 'field' }] }, runId: 'entry-run', usage: { input_tokens: 1 } });
  const result = await generateEntry(input, research, config, { beforePaidCall: jest.fn() });
  expect(result.payload.entry.references).toEqual([{ sourceId: 'oa-1', title: 'Study', url: 'https://example.test/study', retrievedAt: '2026-09-07T00:00:00.000Z' }]);
  expect(result.payload.source.narrativeHash).toBe('abc123');
  expect(result.payload.provenance.promptVersion).toBe(4);
  expect(Object.isFrozen(result.payload)).toBe(true);
});

test('estimateGenerationCost is conservative and unknown when no model pricing is pinned', () => {
  expect(estimateGenerationCost({ narrative: { text: 'x'.repeat(100) } }, config)).toMatchObject({ lowUsd: null, highUsd: null, calls: 2 });
  expect(estimateGenerationCost({ narrative: { text: 'x'.repeat(100) } }, { ...config, pricing: { inputUsdPer1k: 1, outputUsdPer1k: 2 } }).highUsd).toBeGreaterThan(0);
});
