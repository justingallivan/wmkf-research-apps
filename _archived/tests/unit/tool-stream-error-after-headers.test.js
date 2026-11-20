/**
 * Literature analyzer and multi-perspective evaluator routes: a failure after
 * progress frames have been written ends the stream with an `event: 'error'`
 * frame instead of attempting a JSON 500 that can no longer be sent.
 */
jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn(async () => ({ profileId: 'staff' })) }));
jest.mock('../../shared/api/middleware/rateLimiter', () => ({ nextRateLimiter: () => async () => true }));
jest.mock('../../lib/services/model-override-loader', () => ({ loadModelOverrides: async () => {} }));
// Each file's fetch fails; both routes catch that per file and keep going.
jest.mock('../../lib/utils/public-blob-fetch', () => ({ fetchPublicBlob: async () => ({ ok: false, statusText: 'Not Found' }) }));
jest.mock('../../lib/utils/usage-logger', () => ({ logUsage: jest.fn() }));
// analyze-literature resolves its prompt rows before streaming; return the bundled rows.
jest.mock('../../lib/services/tool-prompt-resolver', () => ({
  ...jest.requireActual('../../lib/services/tool-prompt-resolver'),
  resolveToolPrompt: async (_name, def) => ({ ...def, source: 'bundled' }),
}));
jest.mock('../../lib/services/llm-client', () => ({ LLMClient: jest.fn(() => ({ complete: jest.fn() })) }));

import analyzeLiterature from '../../pages/api/analyze-literature';
import evaluateMultiPerspective from '../../pages/api/evaluate-multi-perspective';

// One file, then the iteration itself throws: a failure outside the per-file
// catch that happens after the first progress frame was written.
function filesThatFailAfterFirst() {
  return {
    length: 1,
    *[Symbol.iterator]() {
      yield { filename: 'one.pdf', url: 'https://test.public.blob.vercel-storage.com/one.pdf' };
      throw new Error('unexpected failure');
    },
  };
}

function streamingRes() {
  const res = {
    headersSent: false,
    statusCode: 200,
    setHeader: jest.fn(),
    write: jest.fn(() => { res.headersSent = true; }),
    end: jest.fn(),
    status: jest.fn(() => {
      if (res.headersSent) throw new Error('ERR_HTTP_HEADERS_SENT');
      return res;
    }),
    json: jest.fn(),
  };
  return res;
}

function frames(res) {
  return res.write.mock.calls.map(([chunk]) => JSON.parse(chunk.replace(/^data: /, '').trim()));
}

beforeEach(() => {
  process.env.CLAUDE_API_KEY = 'sk-ant-test';
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  console.error.mockRestore();
});

test.each([
  ['analyze-literature', analyzeLiterature],
  ['evaluate-multi-perspective', evaluateMultiPerspective],
])('%s ends the stream with an error event', async (_name, handler) => {
  const res = streamingRes();

  await handler({ method: 'POST', body: { files: filesThatFailAfterFirst() } }, res);

  expect(res.status).not.toHaveBeenCalled();
  const last = frames(res).at(-1);
  expect(last).toEqual({ event: 'error', message: 'Failed to process document' });
  expect(res.end).toHaveBeenCalled();
});
