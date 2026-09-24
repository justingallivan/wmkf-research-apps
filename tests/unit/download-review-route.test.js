/** @jest-environment node */

const requireAppAccess = jest.fn();
const downloadReview = jest.fn();

jest.mock('../../lib/utils/auth', () => ({
  requireAppAccess: (...args) => requireAppAccess(...args),
}));
jest.mock('../../lib/dataverse/core/context', () => ({
  withDalContext: (_label, fn) => Promise.resolve().then(fn),
}));
jest.mock('../../lib/services/review-manager/download-review-service', () => ({
  downloadReview: (...args) => downloadReview(...args),
}));

const handler = require('../../pages/api/review-manager/download-review').default;
const SUGGESTION_ID = '11111111-1111-4111-8111-111111111111';

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; },
    setHeader(name, value) { this.headers[name] = value; return this; },
  };
}

test('encodes quoted, Unicode, and CR/LF characters in the review filename', async () => {
  requireAppAccess.mockResolvedValue({ profileId: 7 });
  const bytes = Buffer.from('review bytes');
  downloadReview.mockResolvedValue({
    buffer: bytes,
    mimeType: 'application/pdf',
    filename: 'bad"é\r\nInjected: yes.pdf',
    size: bytes.length,
  });
  const res = response();
  await handler({ method: 'GET', query: { suggestionId: SUGGESTION_ID } }, res);

  expect(downloadReview).toHaveBeenCalledWith({ suggestionId: SUGGESTION_ID, requestedFilename: undefined });
  expect(res.headers['Content-Disposition']).toBe(
    `attachment; filename="bad_Injected: yes.pdf"; filename*=UTF-8''bad%22%C3%A9Injected%3A%20yes.pdf`,
  );
  expect(res.headers['Content-Disposition']).not.toMatch(/[\r\n]/);
  expect(res.body).toEqual(bytes);
});
