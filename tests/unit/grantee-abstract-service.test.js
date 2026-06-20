/**
 * Grantee abstract service — wraps the Executor (parseMode:raw) to rewrite an
 * applicant abstract into house style. Covers input guard, extraction from
 * result.parsed.abstract_formatted, defensive fence strip, short-output guard,
 * blocked guard, and the untrusted source_abstract override wiring.
 *
 * @jest-environment node
 */
jest.mock('../../lib/services/execute-prompt', () => ({
  executePrompt: jest.fn(),
}));

import { executePrompt } from '../../lib/services/execute-prompt';
import { generateGranteeAbstract, GRANTEE_ABSTRACT_PROMPT_NAME } from '../../lib/services/grantee-abstract-service';

const SOURCE = 'We will measure the thing. We believe our approach is novel and our team has prior data showing it works in mice.';

function execResult(text, extra = {}) {
  return {
    parsed: { abstract_formatted: text },
    runId: 'run-1',
    blocked: false,
    meta: { modelUsed: 'claude-sonnet-x', promptName: GRANTEE_ABSTRACT_PROMPT_NAME, promptVersion: 1 },
    usage: { input_tokens: 10, output_tokens: 20 },
    ...extra,
  };
}

beforeEach(() => {
  executePrompt.mockReset();
});

test('happy path returns the rewritten abstract + meta', async () => {
  const REWRITTEN = 'The team will measure the thing. They hypothesize that their approach is novel; prior data showed it works in mice.';
  executePrompt.mockResolvedValue(execResult(REWRITTEN));

  const out = await generateGranteeAbstract({ sourceAbstract: SOURCE });
  expect(out.abstractFormatted).toBe(REWRITTEN);
  expect(out.runId).toBe('run-1');
  expect(out.model).toBe('claude-sonnet-x');
  expect(out.promptName).toBe(GRANTEE_ABSTRACT_PROMPT_NAME);
});

test('passes source_abstract as an override variable + forceOverwrite', async () => {
  executePrompt.mockResolvedValue(execResult('a'.repeat(40)));
  await generateGranteeAbstract({ sourceAbstract: SOURCE });
  expect(executePrompt).toHaveBeenCalledWith(expect.objectContaining({
    promptName: GRANTEE_ABSTRACT_PROMPT_NAME,
    overrideVariables: { source_abstract: SOURCE },
    forceOverwrite: true,
  }));
});

test('passes a custom (valid) runSource through to the Executor', async () => {
  // 'Vercel Test' is a real RUN_SOURCE picklist value; executePrompt throws on
  // unknown values, so a caller must pass a valid one (not e.g. "Cron").
  executePrompt.mockResolvedValue(execResult('a'.repeat(40)));
  await generateGranteeAbstract({ sourceAbstract: SOURCE, runSource: 'Vercel Test' });
  expect(executePrompt).toHaveBeenCalledWith(expect.objectContaining({ runSource: 'Vercel Test' }));
});

test('strips a language-tagged code fence (```text)', async () => {
  const fenced = '```text\n' + 'The team will measure the thing in a long enough sentence.' + '\n```';
  executePrompt.mockResolvedValue(execResult(fenced));
  const out = await generateGranteeAbstract({ sourceAbstract: SOURCE });
  expect(out.abstractFormatted).toBe('The team will measure the thing in a long enough sentence.');
});

test('throws (does not stringify) when the model output is not a string', async () => {
  executePrompt.mockResolvedValue(execResult({ unexpected: 'object' }));
  await expect(generateGranteeAbstract({ sourceAbstract: SOURCE }))
    .rejects.toThrow(/was not text/);
});

test('defensively strips a stray code fence', async () => {
  const fenced = '```\n' + 'The team will measure the thing in a long enough sentence.' + '\n```';
  executePrompt.mockResolvedValue(execResult(fenced));
  const out = await generateGranteeAbstract({ sourceAbstract: SOURCE });
  expect(out.abstractFormatted).toBe('The team will measure the thing in a long enough sentence.');
  expect(out.abstractFormatted).not.toContain('```');
});

test('rejects empty / too-short source WITHOUT calling the Executor (no paid call)', async () => {
  await expect(generateGranteeAbstract({ sourceAbstract: '' })).rejects.toThrow(/sourceAbstract is required/);
  await expect(generateGranteeAbstract({ sourceAbstract: 'too short' })).rejects.toThrow(/sourceAbstract is required/);
  await expect(generateGranteeAbstract({})).rejects.toThrow(/sourceAbstract is required/);
  expect(executePrompt).not.toHaveBeenCalled();
});

test('re-surfaces an Executor short-output throw with context', async () => {
  executePrompt.mockRejectedValue(new Error('Claude returned empty/short text (3 chars)'));
  await expect(generateGranteeAbstract({ sourceAbstract: SOURCE }))
    .rejects.toThrow(/generation failed — Claude returned empty\/short text/);
});

test('throws if the model returns an empty/too-short abstract', async () => {
  executePrompt.mockResolvedValue(execResult('short'));
  await expect(generateGranteeAbstract({ sourceAbstract: SOURCE }))
    .rejects.toThrow(/empty\/too-short/);
});

test('throws if the run is unexpectedly blocked', async () => {
  executePrompt.mockResolvedValue(execResult('x'.repeat(40), { blocked: true }));
  await expect(generateGranteeAbstract({ sourceAbstract: SOURCE }))
    .rejects.toThrow(/blocked unexpectedly/);
});
