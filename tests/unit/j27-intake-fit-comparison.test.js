/** @jest-environment node */
jest.mock('../../lib/dataverse/adapters/grant-request', () => ({
  getById: jest.fn(),
  updateById: jest.fn(),
}));
jest.mock('../../lib/services/execute-prompt', () => ({ executePrompt: jest.fn() }));
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: { checkRestriction: jest.fn() },
}));

import { getById, updateById } from '../../lib/dataverse/adapters/grant-request';
import { executePrompt } from '../../lib/services/execute-prompt';
import { recordJ27IntakeFitComparison } from '../../lib/services/workbench/j27-intake-fit-comparison';
import { J27_FIT_CONCERNS, J27_INTAKE_FIT_COMPARISON_FIELD as COLUMN } from '../../shared/config/j27FitComparison';

const requestId = '11111111-1111-1111-1111-111111111111';
const materialsVersion = 'mock-intake-v1';
const ternary = {
  assessment: 682090000,
  rationale: 'The proposal poses a fundamental research question.',
  runId: '22222222-2222-2222-2222-222222222222',
  materialsVersion,
};
const request = {
  _etag: 'W/"5"',
  wmkf_GrantCycle: { wmkf_cyclecode: 'J27' },
  wmkf_ai_fitassessment: ternary.assessment,
  wmkf_ai_fitrationale: ternary.rationale,
};
const inputs = {
  proposal_text: '[page 1] The main experiment tests how fungal cells exchange signals.',
  summary_fields: 'Scientific Question: How do fungal cells exchange signals?',
  keck_abstracts: 'Fungal Networks (2024)\nThis award measured signaling in a related system.\n\nSoil Systems (2025)\nThis award measured soil moisture.',
};

function flags() {
  return Object.keys(J27_FIT_CONCERNS).map((id) => ({
    id, level: 'green', reason: '', evidence: [],
    ...(id === 'funding_overlap' && { level: 'gray', reason: 'Other Support is unavailable.' }),
    ...(id === 'keck_overlap' && {
      level: 'yellow',
      reason: 'A recent Keck award measured signaling in a related system.',
      evidence: [{ source: 'keck_abstracts', quote: 'This award measured signaling in a related system.', page: null, section: 'Fungal Networks (2024)' }],
    }),
  }));
}

function providerResult(resultFlags) {
  return {
    parsed: { flags: resultFlags },
    runId: '33333333-3333-3333-3333-333333333333',
    meta: { promptVersion: 1, modelUsed: 'claude-test' },
  };
}

beforeEach(() => {
  jest.resetAllMocks();
  getById.mockResolvedValue(request);
  executePrompt.mockResolvedValue(providerResult(flags()));
});

test('saves one paired intake snapshot and leaves the live ternary fields alone', async () => {
  const { snapshot } = await recordJ27IntakeFitComparison({ requestId, materialsVersion, ternary, inputs });
  expect(snapshot.ternary).toEqual({
    assessment: ternary.assessment, rationale: ternary.rationale, runId: ternary.runId,
  });
  expect(snapshot.p6.flags).toEqual(flags());
  expect(executePrompt).toHaveBeenCalledWith(expect.objectContaining({
    promptName: 'j27.fit-concerns.generate', requireNoPersistence: true,
  }));
  expect(updateById).toHaveBeenCalledWith(requestId, { [COLUMN]: JSON.stringify(snapshot) }, expect.objectContaining({
    ifMatch: request._etag,
  }));
});

test('retries return the saved baseline even if the live ternary fields changed', async () => {
  const { snapshot } = await recordJ27IntakeFitComparison({ requestId, materialsVersion, ternary, inputs });
  getById.mockResolvedValue({ ...request, wmkf_ai_fitassessment: 682090002, [COLUMN]: JSON.stringify(snapshot) });
  await expect(recordJ27IntakeFitComparison({ requestId, materialsVersion, ternary, inputs }))
    .resolves.toEqual({ snapshot, reused: true });
  expect(executePrompt).toHaveBeenCalledTimes(1);
  expect(updateById).toHaveBeenCalledTimes(1);
});

test('rejects an unpaired ternary receipt before generation', async () => {
  await expect(recordJ27IntakeFitComparison({
    requestId, materialsVersion, ternary: { ...ternary, materialsVersion: 'different' }, inputs,
  })).rejects.toThrow(/independent ternary result/);
  expect(executePrompt).not.toHaveBeenCalled();
});

test.each([
  ['duplicate concern', (output) => { output[1] = output[0]; }, /exactly once/],
  ['red Keck overlap', (output) => { output[5].level = 'red'; }, /invalid level/],
  ['fabricated award quote', (output) => { output[5].evidence[0].quote = 'Invented quote.'; }, /unverifiable evidence/],
  ['quote from a different award', (output) => { output[5].evidence[0].section = 'Soil Systems (2025)'; }, /unverifiable evidence/],
  ['clear flag with missing Other Support', (output) => { output[4].level = 'green'; output[4].reason = ''; }, /Other Support/],
])('rejects %s before the request write', async (_name, change, error) => {
  const output = flags();
  change(output);
  executePrompt.mockResolvedValue(providerResult(output));
  await expect(recordJ27IntakeFitComparison({ requestId, materialsVersion, ternary, inputs })).rejects.toThrow(error);
  expect(updateById).not.toHaveBeenCalled();
});

test('does not report a saved comparison after a concurrent request update', async () => {
  updateById.mockRejectedValueOnce(Object.assign(new Error('Request changed'), { status: 412 }));
  await expect(recordJ27IntakeFitComparison({ requestId, materialsVersion, ternary, inputs })).rejects.toMatchObject({
    status: 412,
  });
  expect(updateById).toHaveBeenCalledTimes(1);
});
