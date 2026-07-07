/**
 * Trust-boundary chokepoint regression: executePrompt validates requestId as a
 * GUID before it can reach grantRequestAdapter.getById/updateById → the raw
 * `akoya_requests(${id})` Dataverse key predicate. A route that forwards a
 * client-supplied id without its own isGuid check (the summarize-v2 class) must
 * not be able to reach the selector with a crafted value. See
 * lib/services/execute-prompt.js and scripts/check-trust-boundary-guid.js
 * (executePrompt object-arg sink).
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
const grantRequestAdapter = require('../../lib/dataverse/adapters/grant-request');
const { executePrompt } = require('../../lib/services/execute-prompt.js');

const VALID_GUID = '00000000-0000-0000-0000-000000000001';

describe('executePrompt requestId GUID validation (trust-boundary chokepoint)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('rejects a non-GUID requestId before any Dataverse read', async () => {
    await expect(
      executePrompt({ promptName: 'p', runSource: 'Vercel Test', requestId: 'not-a-guid' }),
    ).rejects.toThrow(/requestId must be a valid GUID/);
    // Threw before reaching the prompt fetch / selector — the whole point.
    expect(fetchCurrentPrompt).not.toHaveBeenCalled();
    expect(grantRequestAdapter.getById).not.toHaveBeenCalled();
  });

  test('rejects a key-predicate breakout attempt (crafted id)', async () => {
    await expect(
      executePrompt({ promptName: 'p', runSource: 'Vercel Test', requestId: `${VALID_GUID})/akoya_owningteam` }),
    ).rejects.toThrow(/requestId must be a valid GUID/);
    expect(grantRequestAdapter.getById).not.toHaveBeenCalled();
  });

  test('a valid GUID passes validation and proceeds to the prompt fetch', async () => {
    const probe = new Error('probe-stop');
    fetchCurrentPrompt.mockImplementation(async () => { throw probe; });
    await expect(
      executePrompt({ promptName: 'p', runSource: 'Vercel Test', requestId: VALID_GUID }),
    ).rejects.toThrow('probe-stop'); // got PAST the GUID guard
  });

  test('omitting requestId is allowed (no-requestId callers unaffected)', async () => {
    const probe = new Error('probe-stop');
    fetchCurrentPrompt.mockImplementation(async () => { throw probe; });
    await expect(
      executePrompt({ promptName: 'p', runSource: 'Vercel Test' }),
    ).rejects.toThrow('probe-stop'); // reached the fetch, i.e. not blocked by the GUID guard
  });
});
