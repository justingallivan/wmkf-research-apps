/**
 * S333 bypass-strip Stage 0 characterization (BYPASS_STRIP_PLAN.md site 36,
 * lib/services/execute-prompt.js). MIXED: nested under 4 routes that already
 * establish withDalContext, but reached as an entry-seam via
 * phase-i-dynamics/summarize-v2.js with no upstream context. Drives the real
 * dynamics-context machinery (no dynamics-context mock) via the drain-test
 * pattern: intercept the first Dataverse read (fetchCurrentPrompt), record
 * hasTrustedDalContext(), then throw a terminal probe error so the run stops
 * immediately (the failure-logging write in the same catch block still runs
 * inside the trusted context, since it is nested inside the bypass callback).
 *
 * @jest-environment node
 */

jest.mock('../../lib/services/prompt-store', () => ({
  fetchCurrentPrompt: jest.fn(),
  interpolate: jest.fn((s) => s),
}));
jest.mock('../../lib/dataverse/adapters/ai-run', () => ({
  create: jest.fn().mockResolvedValue({ wmkf_ai_runid: 'run-1' }),
}));
jest.mock('../../lib/dataverse/adapters/grant-request', () => ({
  getById: jest.fn(),
}));

const { fetchCurrentPrompt } = require('../../lib/services/prompt-store');
const aiRunAdapter = require('../../lib/dataverse/adapters/ai-run');
const { hasTrustedDalContext } = require('../../lib/dataverse/core/context');
const { executePrompt } = require('../../lib/services/execute-prompt.js');

describe('execute-prompt DAL context (S333 characterization, site 36)', () => {
  test('negative control: no trusted context exists before the call', () => {
    expect(hasTrustedDalContext()).toBe(false);
  });

  test('executePrompt establishes a trusted context around the prompt fetch (entry-seam path)', async () => {
    const seen = { inside: null };
    const probeErr = new Error('probe-stop');
    fetchCurrentPrompt.mockImplementation(async () => {
      seen.inside = hasTrustedDalContext();
      throw probeErr;
    });

    await expect(
      executePrompt({ promptName: 'test-prompt', runSource: 'Vercel Test' }),
    ).rejects.toThrow('probe-stop');

    expect(seen.inside).toBe(true);
    expect(aiRunAdapter.create).toHaveBeenCalled();
    expect(hasTrustedDalContext()).toBe(false);
  });
});
