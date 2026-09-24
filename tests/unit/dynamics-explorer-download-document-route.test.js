/** @jest-environment node */

const requireAppAccess = jest.fn();
const downloadFileByPath = jest.fn();

jest.mock('../../lib/utils/auth', () => ({
  requireAppAccess: (...args) => requireAppAccess(...args),
}));
jest.mock('../../lib/services/graph-service', () => ({
  GraphService: { downloadFileByPath: (...args) => downloadFileByPath(...args) },
}));

const handler = require('../../pages/api/dynamics-explorer/download-document').default;
const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const FOLDER = '1002794_11111111111141118111111111111111';

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

test('encodes quoted, Unicode, and CR/LF characters in the resolved filename', async () => {
  requireAppAccess.mockResolvedValue({ profileId: 7 });
  const bytes = Buffer.from('file bytes');
  downloadFileByPath.mockResolvedValue({
    buffer: bytes,
    mimeType: 'application/pdf',
    filename: 'bad"é\r\nInjected: yes.pdf',
    size: bytes.length,
  });
  const res = response();
  await handler({
    method: 'GET',
    query: { requestId: REQUEST_ID, library: 'akoya_request', folder: FOLDER, filename: 'source.pdf' },
  }, res);

  expect(downloadFileByPath).toHaveBeenCalledWith('akoya_request', FOLDER, 'source.pdf');
  expect(res.headers['Content-Disposition']).toBe(
    `attachment; filename="bad_Injected: yes.pdf"; filename*=UTF-8''bad%22%C3%A9Injected%3A%20yes.pdf`,
  );
  expect(res.headers['Content-Disposition']).not.toMatch(/[\r\n]/);
  expect(res.body).toEqual(bytes);
});
