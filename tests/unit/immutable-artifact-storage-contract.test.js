/** @jest-environment node */
jest.mock('@vercel/blob', () => ({ get: jest.fn(), put: jest.fn() }));
jest.mock('../../lib/services/cycle-dossier-store', () => ({
  dossierError: (message, httpStatus = 409) => Object.assign(new Error(message), { httpStatus, domain: 'dossier' }),
}));
jest.mock('../../lib/services/review-panel-store', () => ({
  reviewPanelError: (message, httpStatus = 409) => Object.assign(new Error(message), { httpStatus, domain: 'panel' }),
}));
const { get, put } = require('@vercel/blob');
const dossier = require('../../lib/services/cycle-dossier-storage');
const panel = require('../../lib/services/review-panel-storage');
const cases = [
  ['dossier', 'cycle-dossier/file.pdf', 'DOSSIER_BLOB_READ_WRITE_TOKEN', dossier.readDossierFile, dossier.storeDossierFile, dossier.dossierDigest],
  ['panel', 'review-panel/file.pdf', 'REVIEW_PANEL_BLOB_READ_WRITE_TOKEN', panel.readReviewPanelFile, panel.storeReviewPanelFile, panel.reviewPanelDigest],
];
const envKeys = ['DOSSIER_BLOB_READ_WRITE_TOKEN', 'REVIEW_PANEL_BLOB_READ_WRITE_TOKEN', 'REVIEW_PANEL_BLOB_STORE_ID', 'BLOB_READ_WRITE_TOKEN', 'INTAKE_BLOB_RW_TOKEN', 'UPLOADS_BLOB_RW_TOKEN'];
let savedEnv;
beforeEach(() => {
  savedEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  envKeys.forEach(key => { delete process.env[key]; });
  process.env.DOSSIER_BLOB_READ_WRITE_TOKEN = 'dossier-fixture';
  process.env.REVIEW_PANEL_BLOB_READ_WRITE_TOKEN = 'panel-fixture';
  process.env.REVIEW_PANEL_BLOB_STORE_ID = 'panel-store-fixture';
  jest.resetAllMocks();
});
afterEach(() => envKeys.forEach(key => {
  if (savedEnv[key] === undefined) delete process.env[key];
  else process.env[key] = savedEnv[key];
}));
function response(bytes) {
  const reader = {
    read: jest.fn().mockResolvedValueOnce({ done: false, value: bytes }).mockResolvedValue({ done: true }),
    cancel: jest.fn().mockResolvedValue(undefined),
    releaseLock: jest.fn(),
  };
  return { reader, stream: { getReader: () => reader } };
}
describe.each(cases)('%s byte transport compatibility', (domain, pathname, tokenKey, read, write, digest) => {
  const bytes = Buffer.from('artifact');
  const ref = () => ({ pathname, sha256: digest(bytes), size: bytes.length, contentType: 'application/pdf' });
  test('invalid input wins over missing configuration and never reaches Blob', async () => {
    delete process.env[tokenKey];
    await expect(read({ ...ref(), pathname: 'wrong/file' })).rejects.toMatchObject({ domain, httpStatus: 409 });
    await expect(write('wrong/file', bytes, 'application/pdf')).rejects.toMatchObject({ domain, httpStatus: 413 });
    expect(get).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled();
  });
  test('missing stream retains domain 404', async () => {
    get.mockResolvedValue(null);
    await expect(read(ref())).rejects.toMatchObject({ domain, httpStatus: 404 });
  });
  test('size alone is verified and reader released', async () => {
    const r = response(bytes); get.mockResolvedValue(r);
    await expect(read({ ...ref(), size: bytes.length + 1 })).rejects.toMatchObject({ domain, httpStatus: 502 });
    expect(r.reader.releaseLock).toHaveBeenCalledTimes(1);
  });
  test('reader failure is propagated by identity after cleanup', async () => {
    const original = new Error('stream failure'); const r = response(bytes);
    r.reader.read.mockReset().mockRejectedValue(original); get.mockResolvedValue(r);
    await expect(read(ref())).rejects.toBe(original);
    expect(r.reader.releaseLock).toHaveBeenCalledTimes(1);
  });
  test('overflow cancels, releases, and retains domain 413', async () => {
    const r = response(new Uint8Array(30 * 1024 * 1024 + 1)); get.mockResolvedValue(r);
    await expect(read(ref())).rejects.toMatchObject({ domain, httpStatus: 413 });
    expect(r.reader.cancel).toHaveBeenCalledTimes(1); expect(r.reader.releaseLock).toHaveBeenCalledTimes(1);
  });
  test('cancel rejection keeps its original identity and still releases', async () => {
    const original = new Error('cancel failed');
    const r = response(new Uint8Array(30 * 1024 * 1024 + 1));
    r.reader.cancel.mockRejectedValue(original); get.mockResolvedValue(r);
    await expect(read(ref())).rejects.toBe(original);
    expect(r.reader.releaseLock).toHaveBeenCalledTimes(1);
  });
  test('successful put keeps exact private create-only options and reference', async () => {
    put.mockResolvedValue({ pathname });
    await expect(write(pathname, bytes, 'application/pdf')).resolves.toEqual(ref());
    expect(put).toHaveBeenCalledWith(pathname, bytes, {
      access: 'private', token: process.env[tokenKey], contentType: 'application/pdf', addRandomSuffix: false, allowOverwrite: false,
    });
    expect(get).not.toHaveBeenCalled();
  });
  test.each(['missing', 'different'])('failed recovery (%s) preserves original write error object', async failure => {
    const original = Object.assign(new Error('write failed'), { httpStatus: 403 }); put.mockRejectedValue(original);
    get.mockResolvedValue(failure === 'missing' ? null : response(Buffer.from('different')));
    await expect(write(pathname, bytes, 'application/pdf')).rejects.toBe(original);
  });
  test.each([{ pathname: 'unexpected/file' }, undefined])('unexpected put result recovers only through exact bytes: %p', async result => {
    put.mockResolvedValue(result); get.mockResolvedValue(response(bytes));
    await expect(write(pathname, bytes, 'application/pdf')).resolves.toEqual(ref());
    expect(get).toHaveBeenCalledWith(pathname, { access: 'private', token: process.env[tokenKey], useCache: false });
  });
  test('unexpected path with failed recovery retains domain 502', async () => {
    put.mockResolvedValue({ pathname: 'unexpected/file' }); get.mockResolvedValue(null);
    await expect(write(pathname, bytes, 'application/pdf')).rejects.toMatchObject({ domain, httpStatus: 502 });
  });
  test('undefined put result with failed recovery retains TypeError', async () => {
    put.mockResolvedValue(undefined); get.mockResolvedValue(null);
    await expect(write(pathname, bytes, 'application/pdf')).rejects.toBeInstanceOf(TypeError);
  });
  test('recovery rechecks current configuration instead of captured credentials', async () => {
    const original = new Error('response lost');
    put.mockImplementation(async () => { delete process.env[tokenKey]; throw original; });
    get.mockResolvedValue(response(bytes));
    await expect(write(pathname, bytes, 'application/pdf')).rejects.toBe(original);
    expect(get).not.toHaveBeenCalled();
  });
});
test('panel public readers and writers reject a reused dossier token', async () => {
  process.env.REVIEW_PANEL_BLOB_READ_WRITE_TOKEN = process.env.DOSSIER_BLOB_READ_WRITE_TOKEN;
  const bytes = Buffer.from('artifact');
  await expect(panel.readReviewPanelFile({ pathname: 'review-panel/file', sha256: panel.reviewPanelDigest(bytes), size: bytes.length }))
    .rejects.toMatchObject({ domain: 'panel', httpStatus: 503 });
  await expect(panel.storeReviewPanelFile('review-panel/file', bytes, 'application/pdf'))
    .rejects.toMatchObject({ domain: 'panel', httpStatus: 503 });
  expect(get).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled();
});
