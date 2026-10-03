/** @jest-environment node */
jest.mock('../../lib/utils/auth', () => ({ requireAuth: jest.fn() }));
import { requireAuth } from '../../lib/utils/auth';
import handler from '../../pages/api/blob-proxy';

const response = () => ({
  statusCode: 200, headers: {}, body: undefined,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
  send(body) { this.body = body; return this; },
  setHeader(name, value) { this.headers[name] = value; },
});
beforeEach(() => {
  jest.clearAllMocks();
  requireAuth.mockResolvedValue({ user: { email: 'staff@example.test' } });
  fetch.mockReset();
});

it('keeps authentication ahead of the real public-file fetch boundary', async () => {
  requireAuth.mockResolvedValue(null);
  await handler({ method: 'GET', query: { url: 'https://store.public.blob.vercel-storage.com/a.pdf' } }, response());
  expect(fetch).not.toHaveBeenCalled();
});

it.each([
  'https://graph.microsoft.com/v1.0/me',
  'https://api.anthropic.com/v1/messages',
  'https://store.public.blob.vercel-storage.com:8443/a.pdf',
  'https://user:pass@store.public.blob.vercel-storage.com/a.pdf',
])('rejects %s through the actual route and helper', async url => {
  const res = response();
  await handler({ method: 'GET', query: { url } }, res);
  expect(res.statusCode).toBe(400);
  expect(fetch).not.toHaveBeenCalled();
});

it('preserves file bytes, authenticated caching and active-content protections', async () => {
  fetch.mockResolvedValue(new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } }));
  const res = response();
  await handler({ method: 'GET', query: { url: 'https://store.public.blob.vercel-storage.com/a.svg' } }, res);
  expect(res.statusCode).toBe(200);
  expect(res.body.toString()).toBe('<svg/>');
  expect(res.headers).toMatchObject({ 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'attachment', 'Cache-Control': 'private, max-age=300' });
  expect(fetch).toHaveBeenCalledWith(expect.any(String), { method: 'GET', redirect: 'manual', credentials: 'omit' });
});

it('does not follow a public storage redirect to an otherwise allowlisted service', async () => {
  const error = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    fetch.mockResolvedValue(new Response(null, { status: 302, headers: { location: 'https://graph.microsoft.com/v1.0/me' } }));
    const res = response();
    await handler({ method: 'GET', query: { url: 'https://store.public.blob.vercel-storage.com/a.pdf' } }, res);
    expect(res.statusCode).toBe(502);
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally { error.mockRestore(); }
});
