/**
 * Grantee title service — wraps the Executor (parseMode:raw) to distill an
 * applicant title + abstract into a one-line house-style objective. Covers input
 * guards, extraction from result.parsed.edited_title, one-line + quote + trailing
 * period cleanup, defensive fence strip, short-output guard, blocked guard, and
 * the untrusted source_title/source_abstract override wiring.
 *
 * @jest-environment node
 */
jest.mock('../../lib/services/execute-prompt', () => ({
  executePrompt: jest.fn(),
}));

import { executePrompt } from '../../lib/services/execute-prompt';
import { generateGranteeTitle, GRANTEE_TITLE_PROMPT_NAME } from '../../lib/services/grantee-title-service';

const TITLE = 'Visualizing Electrical Communication in Fungal Networks';
const ABSTRACT =
  'Fungi form extensive underground networks. We will implement genetically encoded voltage indicators ' +
  'in Neurospora crassa to visualize membrane potential changes during growth and stress.';

function execResult(text, extra = {}) {
  return {
    parsed: { edited_title: text },
    runId: 'run-1',
    blocked: false,
    meta: { modelUsed: 'claude-sonnet-x', promptName: GRANTEE_TITLE_PROMPT_NAME, promptVersion: 1 },
    usage: { input_tokens: 10, output_tokens: 12 },
    ...extra,
  };
}

beforeEach(() => {
  executePrompt.mockReset();
});

test('happy path returns the one-line objective + meta', async () => {
  const TITLE_OUT = 'To visualize electrical communication in fungal networks';
  executePrompt.mockResolvedValue(execResult(TITLE_OUT));

  const out = await generateGranteeTitle({ sourceTitle: TITLE, sourceAbstract: ABSTRACT });
  expect(out.editedTitle).toBe(TITLE_OUT);
  expect(out.runId).toBe('run-1');
  expect(out.model).toBe('claude-sonnet-x');
  expect(out.promptName).toBe(GRANTEE_TITLE_PROMPT_NAME);
});

test('passes BOTH untrusted override variables + forceOverwrite', async () => {
  executePrompt.mockResolvedValue(execResult('To investigate non-reciprocal matter'));
  await generateGranteeTitle({ sourceTitle: TITLE, sourceAbstract: ABSTRACT });
  expect(executePrompt).toHaveBeenCalledWith(expect.objectContaining({
    promptName: GRANTEE_TITLE_PROMPT_NAME,
    overrideVariables: { source_title: TITLE, source_abstract: ABSTRACT },
    forceOverwrite: true,
  }));
});

test('passes a custom runSource through to the Executor', async () => {
  executePrompt.mockResolvedValue(execResult('To investigate non-reciprocal matter'));
  await generateGranteeTitle({ sourceTitle: TITLE, sourceAbstract: ABSTRACT, runSource: 'Cron' });
  expect(executePrompt).toHaveBeenCalledWith(expect.objectContaining({ runSource: 'Cron' }));
});

test('strips a language-tagged code fence (```text)', async () => {
  const fenced = '```text\nTo visualize electrical communication in fungal networks\n```';
  executePrompt.mockResolvedValue(execResult(fenced));
  const out = await generateGranteeTitle({ sourceTitle: TITLE, sourceAbstract: ABSTRACT });
  expect(out.editedTitle).toBe('To visualize electrical communication in fungal networks');
});

test('takes the first non-empty line and strips wrapping quotes + a trailing period', async () => {
  executePrompt.mockResolvedValue(execResult('  "To measure the mind of a metazoan."  \n\nsome stray trailer'));
  const out = await generateGranteeTitle({ sourceTitle: TITLE, sourceAbstract: ABSTRACT });
  expect(out.editedTitle).toBe('To measure the mind of a metazoan');
});

test('throws (does not stringify) when the model output is not a string', async () => {
  executePrompt.mockResolvedValue(execResult({ unexpected: 'object' }));
  await expect(generateGranteeTitle({ sourceTitle: TITLE, sourceAbstract: ABSTRACT }))
    .rejects.toThrow(/was not text/);
});

test('rejects empty / too-short inputs WITHOUT calling the Executor (no paid call)', async () => {
  await expect(generateGranteeTitle({ sourceTitle: '', sourceAbstract: ABSTRACT })).rejects.toThrow(/sourceTitle is required/);
  await expect(generateGranteeTitle({ sourceTitle: 'x', sourceAbstract: ABSTRACT })).rejects.toThrow(/sourceTitle is required/);
  await expect(generateGranteeTitle({ sourceTitle: TITLE, sourceAbstract: 'too short' })).rejects.toThrow(/sourceAbstract is required/);
  await expect(generateGranteeTitle({ sourceTitle: TITLE })).rejects.toThrow(/sourceAbstract is required/);
  expect(executePrompt).not.toHaveBeenCalled();
});

test('re-surfaces an Executor short-output throw with context', async () => {
  executePrompt.mockRejectedValue(new Error('Claude returned empty/short text (3 chars)'));
  await expect(generateGranteeTitle({ sourceTitle: TITLE, sourceAbstract: ABSTRACT }))
    .rejects.toThrow(/generation failed — Claude returned empty\/short text/);
});

test('throws if the model returns an empty/too-short title', async () => {
  executePrompt.mockResolvedValue(execResult('To x'));
  await expect(generateGranteeTitle({ sourceTitle: TITLE, sourceAbstract: ABSTRACT }))
    .rejects.toThrow(/empty\/too-short/);
});

test('throws if the run is unexpectedly blocked', async () => {
  executePrompt.mockResolvedValue(execResult('To investigate non-reciprocal matter', { blocked: true }));
  await expect(generateGranteeTitle({ sourceTitle: TITLE, sourceAbstract: ABSTRACT }))
    .rejects.toThrow(/blocked unexpectedly/);
});
