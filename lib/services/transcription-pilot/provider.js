import { safeFetch } from '../../utils/safe-fetch';

const MAX_PROVIDER_JSON_BYTES = 32 * 1024 * 1024;
const API_ROOTS = Object.freeze({ us: 'https://api.assemblyai.com/v2', eu: 'https://api.eu.assemblyai.com/v2' });

function apiKey() {
  const key = process.env.ASSEMBLYAI_API_KEY;
  if (!key) throw Object.assign(new Error('provider_not_configured'), { code: 'provider_not_configured' });
  return key;
}

function providerUrl(region, path) {
  if (!Object.hasOwn(API_ROOTS, region) || !path.startsWith('/')) throw new Error('invalid_provider_request');
  return `${API_ROOTS[region]}${path}`;
}

async function readBoundedJson(response) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_PROVIDER_JSON_BYTES) throw new Error('provider_response_too_large');
  const reader = response.body?.getReader();
  if (!reader) return {};
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_PROVIDER_JSON_BYTES) {
      await reader.cancel().catch(() => {});
      throw new Error('provider_response_too_large');
    }
    chunks.push(Buffer.from(value));
  }
  try { return JSON.parse(Buffer.concat(chunks, total).toString('utf8')); }
  catch { throw new Error('provider_invalid_json'); }
}

async function request(region, path, { method = 'GET', body, headers = {}, timeoutMs = 20_000 } = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 90_000) throw new Error('invalid_provider_timeout');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await safeFetch(providerUrl(region, path), {
      method,
      headers: { authorization: apiKey(), ...headers },
      body,
      signal: controller.signal,
      failOnRedirect: true,
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw Object.assign(new Error('provider_request_failed'), {
        code: `provider_http_${response.status}`,
        retryable: response.status === 408 || response.status === 429 || response.status >= 500,
      });
    }
    if (response.status === 204) return {};
    return await readBoundedJson(response);
  } finally { clearTimeout(timer); }
}

export async function uploadAssemblyAIAudio({ region, audio, contentType, timeoutMs = 90_000 }) {
  if (!Buffer.isBuffer(audio) || audio.length < 1 || audio.length > 50 * 1024 * 1024) throw new Error('invalid_audio_buffer');
  if (!['audio/mpeg', 'audio/mp4', 'audio/x-m4a'].includes(contentType)) throw new Error('unsupported_audio_type');
  const result = await request(region, '/upload', {
    method: 'POST', body: audio, timeoutMs: Math.min(90_000, timeoutMs),
    headers: { 'content-type': 'application/octet-stream' },
  });
  if (typeof result.upload_url !== 'string' || result.upload_url.length > 2048) throw new Error('provider_invalid_upload_reference');
  const parsed = new URL(result.upload_url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'cdn.assemblyai.com' || parsed.username || parsed.password || parsed.port || !parsed.pathname.startsWith('/upload/')) {
    throw new Error('provider_invalid_upload_reference');
  }
  return result.upload_url;
}

export async function submitAssemblyAITranscription({ region, uploadUrl, model, callbackUrl, webhookAuth, timeoutMs = 20_000 }) {
  const parsed = new URL(uploadUrl);
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'cdn.assemblyai.com' || parsed.username || parsed.password || parsed.port || !parsed.pathname.startsWith('/upload/')) throw new Error('invalid_upload_reference');
  const payload = {
    audio_url: uploadUrl,
    speech_models: [model],
    speaker_labels: true,
    webhook_url: callbackUrl,
    webhook_auth_header_name: 'x-transcription-pilot-auth',
    webhook_auth_header_value: webhookAuth,
  };
  const result = await request(region, '/transcript', { method: 'POST', body: JSON.stringify(payload), timeoutMs: Math.min(20_000, timeoutMs), headers: { 'content-type': 'application/json' } });
  if (typeof result.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(result.id)) throw new Error('provider_invalid_transcript_id');
  return result;
}

export async function getAssemblyAITranscript({ region, transcriptId, timeoutMs = 20_000 }) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(String(transcriptId || ''))) throw new Error('invalid_transcript_id');
  return request(region, `/transcript/${encodeURIComponent(transcriptId)}`, { timeoutMs: Math.min(20_000, timeoutMs) });
}

export async function deleteAssemblyAITranscript({ region, transcriptId, timeoutMs = 20_000 }) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(String(transcriptId || ''))) throw new Error('invalid_transcript_id');
  try {
    return await request(region, `/transcript/${encodeURIComponent(transcriptId)}`, { method: 'DELETE', timeoutMs: Math.min(20_000, timeoutMs) });
  } catch (error) {
    // Exact authenticated lookup says the resource is already unavailable.
    if (['provider_http_404', 'provider_http_410'].includes(error.code)) return { alreadyAbsent: true };
    throw error;
  }
}

export const TRANSCRIPTION_PROVIDER_LIMITS = Object.freeze({ maxJsonBytes: MAX_PROVIDER_JSON_BYTES });
