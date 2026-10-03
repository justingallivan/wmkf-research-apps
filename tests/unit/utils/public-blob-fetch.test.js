/** @jest-environment node */
import fs from 'node:fs';
import path from 'node:path';
import { fetchPublicBlob, isPublicBlobUrl } from '../../../lib/utils/public-blob-fetch';

beforeEach(() => {
  fetch.mockReset();
  fetch.mockResolvedValue({ ok: true, status: 200 });
});

describe('public Blob destination boundary', () => {
  it.each([
    'https://api.anthropic.com/v1/messages',
    'https://api.openai.com/v1/files',
    'https://graph.microsoft.com/v1.0/me',
    'https://appriver3651007194.sharepoint.com/file.pdf',
    'https://api.assemblyai.com/v2/transcript',
    'https://169.254.169.254/latest/meta-data',
    'https://localhost/file.pdf',
    'http://store.public.blob.vercel-storage.com/a.pdf',
    'https://store.private.blob.vercel-storage.com/a.pdf',
    'https://store.public.blob.vercel-storage.com.evil.test/a.pdf',
    'https://evil.test/store.public.blob.vercel-storage.com/a.pdf',
    'https://nested.store.public.blob.vercel-storage.com/a.pdf',
    'https://store.public.blob.vercel-storage.com./a.pdf',
    'https://user:secret@store.public.blob.vercel-storage.com/a.pdf',
    'https://store.public.blob.vercel-storage.com:8443/a.pdf',
    'not a URL', null, ['https://store.public.blob.vercel-storage.com/a.pdf'],
  ])('rejects %j before any network request', async value => {
    expect(isPublicBlobUrl(value)).toBe(false);
    await expect(fetchPublicBlob(value)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['https://store.public.blob.vercel-storage.com/a.pdf', 'https://store.public.blob.vercel-storage.com/a.pdf'],
    ['https://STORE.public.blob.vercel-storage.com:443/folder/a%20b.pdf', 'https://store.public.blob.vercel-storage.com/folder/a%20b.pdf'],
    ['https://store.public.blob.vercel-storage.com/folder/a%2Fb%25.pdf?download=1&name=a%2Bb#ignored', 'https://store.public.blob.vercel-storage.com/folder/a%2Fb%25.pdf?download=1&name=a%2Bb'],
    ['https://store.public.blob.vercel-storage.com/caf%C3%A9.pdf', 'https://store.public.blob.vercel-storage.com/caf%C3%A9.pdf'],
    ['https://store.public.blob.vercel-storage.com/%21%27%28%29%2a.pdf', 'https://store.public.blob.vercel-storage.com/%21%27%28%29%2a.pdf'],
    ['https://store.public.blob.vercel-storage.com//api.anthropic.com/file.pdf?next=https://evil.test/', 'https://store.public.blob.vercel-storage.com//api.anthropic.com/file.pdf?next=https://evil.test/'],
  ])('preserves supported public file URLs: %s', async (value, expected) => {
    const response = { ok: true, status: 200, marker: 'original-response' };
    fetch.mockResolvedValue(response);
    expect(isPublicBlobUrl(value)).toBe(true);
    expect(await fetchPublicBlob(value)).toBe(response);
    expect(fetch).toHaveBeenCalledWith(expected, { method: 'GET', redirect: 'manual', credentials: 'omit' });
    expect(new URL(expected).pathname).toBe(new URL(value).pathname);
    expect(new URL(expected).search).toBe(new URL(value).search);
  });

  it.each([301, 302, 303, 307, 308])('rejects a %i without following even a storage redirect', async status => {
    const cancel = jest.fn(async () => {});
    fetch.mockResolvedValue({ status, headers: new Headers({ location: 'https://other.public.blob.vercel-storage.com/next' }), body: { cancel } });
    await expect(fetchPublicBlob('https://store.public.blob.vercel-storage.com/a.pdf')).rejects.toThrow('redirects are not allowed');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('does not forward extra caller options and leaves non-redirect HTTP handling to callers', async () => {
    const response = { ok: false, status: 404 };
    fetch.mockResolvedValue(response);
    expect(await fetchPublicBlob('https://store.public.blob.vercel-storage.com/missing', {
      headers: { authorization: 'fixture' }, method: 'POST', body: 'fixture', redirect: 'follow',
    })).toBe(response);
    expect(fetch).toHaveBeenCalledWith(expect.any(String), { method: 'GET', redirect: 'manual', credentials: 'omit' });
  });
});

// Pin the complete CodeQL input-source fanout, including the shared public
// branch used by private-upload-aware routes. These wiring assertions
// complement (not replace) the real helper rejection tests above.
const read = file => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
const directReaders = [
  'pages/api/analyze-literature.js', 'pages/api/analyze-funding-gap.js',
  'pages/api/expertise-finder/match.js', 'pages/api/evaluate-multi-perspective.js',
  'pages/api/process-phase-i-writeup.js', 'pages/api/process-peer-reviews.js',
  'pages/api/process-phase-i.js', 'pages/api/process.js',
  'pages/api/reviewer-finder/analyze.js', 'pages/api/virtual-review-panel.js',
  'lib/services/workbench/enrich-recommended-service.js',
  'lib/services/review-manager/send-emails-service.js',
  'lib/utils/uploaded-blob.js', 'pages/api/blob-proxy.js',
];
it.each(directReaders)('%s uses only the public storage transport for public files', file => {
  const source = read(file);
  expect(source).toMatch(/from ['"].*public-blob-fetch(?:\.js)?['"]/);
  expect(source).toMatch(/fetchPublicBlob\(/);
  expect(source).not.toMatch(/\bsafeFetch\(/);
});

it('keeps the remaining four input routes on the private-aware uploaded-file chain', () => {
  expect(read('pages/api/process-expenses.js')).toMatch(/readUploadedBlobBuffer\(/);
  expect(read('pages/api/phase-i-dynamics/summarize-v2.js')).toMatch(/loadFile\(/);
  expect(read('lib/services/phase-i-dynamics/summarize-service.js')).toMatch(/loadFile\(/);
  expect(read('lib/services/grant-reporting/extract-service.js')).toMatch(/loadFile\(/);
  expect(read('lib/utils/file-loader.js')).toMatch(/readUploadedBlobBuffer\(/);
});
