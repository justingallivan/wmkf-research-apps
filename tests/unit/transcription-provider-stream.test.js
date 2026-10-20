/** @jest-environment node */
import crypto from 'node:crypto';
import http from 'node:http';
import { once } from 'node:events';
import { fetch as nativeFetch } from 'undici';
import { safeFetch } from '../../lib/utils/safe-fetch';
import { uploadAssemblyAIAudio, getAssemblyAITranscript } from '../../lib/services/transcription-pilot/provider';

const receipt = 'https://cdn.assemblyai.com/upload/test-receipt';
// The production provider AND safeFetch run unchanged; only the physical fetch transport
// maps the validated AssemblyAI HTTPS destination onto the owned loopback receiver.
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
let server, origin, fetchSpy;
beforeEach(async () => {
  process.env.ASSEMBLYAI_API_KEY = 'synthetic-local-key';
  server = http.createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  origin = `http://127.0.0.1:${server.address().port}`;
  fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((url, init) => {
    expect(new URL(url).hostname).toBe('api.assemblyai.com');
    expect(init.redirect).toBe('manual');
    return nativeFetch(`${origin}${new URL(url).pathname}`, init);
  });
});
afterEach(async () => {
  fetchSpy.mockRestore(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  delete process.env.ASSEMBLYAI_API_KEY;
});
const upload = (audio, over = {}) => uploadAssemblyAIAudio({ region: 'us', audio, contentType: 'audio/mp4', ...over });

test('real wire carries exact hash/length without chunked framing; slow sink preserves the source buffer', async () => {
  const audio = crypto.randomBytes(3 * 1024 * 1024 + 13); const before = hash(audio);
  server.on('request', async (req, res) => {
    expect(req.headers['content-length']).toBe(String(audio.length));
    expect(req.headers['transfer-encoding']).toBeUndefined();
    const h = crypto.createHash('sha256'); let n = 0;
    for await (const b of req) { n += b.length; h.update(b); await new Promise(r => setTimeout(r, 1)); }
    expect(n).toBe(audio.length); expect(h.digest('hex')).toBe(before);
    res.end(JSON.stringify({ upload_url: receipt }));
  });
  await expect(upload(audio)).resolves.toBe(receipt);
  expect(audio.byteLength).toBe(3 * 1024 * 1024 + 13); expect(hash(audio)).toBe(before);
  const body = fetchSpy.mock.calls[0][1].body;
  expect(body.destroyed).toBe(true); expect(body.closed).toBe(true);
});

test.each([200, 413])('early wire response %s settles the request without an upload reference', async status => {
  server.on('request', (_req, res) => { res.writeHead(status); res.end(JSON.stringify({ upload_url: receipt })); });
  await expect(upload(Buffer.alloc(24 * 1024 * 1024))).rejects.toThrow();
  expect(fetchSpy.mock.calls[0][1].body.destroyed).toBe(true);
});

test('disconnect and timeout both destroy the owned upload stream', async () => {
  server.on('request', (req) => req.socket.destroy());
  await expect(upload(Buffer.alloc(1024 * 1024))).rejects.toThrow();
  expect(fetchSpy.mock.calls[0][1].body.destroyed).toBe(true);
  server.removeAllListeners('request'); server.on('request', () => {});
  await expect(upload(Buffer.alloc(24 * 1024 * 1024), { timeoutMs: 30 })).rejects.toThrow();
  expect(fetchSpy.mock.calls[1][1].body.destroyed).toBe(true);
});

test('a stalled provider JSON body cannot outlive the upload timeout', async () => {
  server.on('request', async (req, res) => {
    for await (const _ of req) { /* consume before the stalled response */ }
    res.writeHead(200); res.write('{');
  });
  await expect(upload(Buffer.from('audio'), { timeoutMs: 40 })).rejects.toThrow();
  expect(fetchSpy.mock.calls[0][1].body.destroyed).toBe(true);
});

test.each([
  ['oversized JSON', () => new Response('{}', { headers: { 'content-length': String(33 * 1024 * 1024) } }), 'provider_response_too_large'],
  ['malformed JSON', () => new Response('{'), 'provider_invalid_json'],
  ['invalid CDN', () => Response.json({ upload_url: 'https://evil.example/upload/a' }), 'provider_invalid_upload_reference'],
])('%s never yields a reference', async (_label, response, message) => {
  fetchSpy.mockImplementationOnce(async (_url, { body }) => { for await (const _ of body) { /* consume */ } return response(); });
  await expect(upload(Buffer.from('audio'))).rejects.toThrow(message);
  expect(fetchSpy.mock.calls[0][1].body.destroyed).toBe(true);
});

test('early 200 with all bytes pushed but the final high-water mark buffered fails', async () => {
  fetchSpy.mockImplementationOnce(async (_url, { body }) => {
    body.read(0); // pushes all bytes, while the consumer has taken none
    expect(body.readableLength).toBe(5);
    return Response.json({ upload_url: receipt });
  });
  await expect(upload(Buffer.from('audio'))).rejects.toThrow('provider_request_failed');
});

test('complete body succeeds without waiting for a final iterator-done pull', async () => {
  fetchSpy.mockImplementationOnce(async (_url, { body }) => {
    // Consume the known body length, deliberately never ask for iterator.done.
    expect(body.read(5).toString()).toBe('audio');
    return Response.json({ upload_url: receipt });
  });
  await expect(upload(Buffer.from('audio'))).resolves.toBe(receipt);
});

test('JSON-only calls retain their body/options and use the same safeFetch seam', async () => {
  expect(typeof safeFetch).toBe('function');
  fetchSpy.mockResolvedValueOnce(Response.json({ id: 'id' }));
  await getAssemblyAITranscript({ region: 'us', transcriptId: 'id' });
  expect(fetchSpy.mock.calls[0][1].duplex).toBeUndefined();
  expect(fetchSpy.mock.calls[0][1].body).toBeUndefined();
});
