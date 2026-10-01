import { safeFetch } from '../../lib/utils/safe-fetch';
import { deleteAssemblyAITranscript, getAssemblyAITranscript, submitAssemblyAITranscription, uploadAssemblyAIAudio } from '../../lib/services/transcription-pilot/provider';

jest.mock('../../lib/utils/safe-fetch', () => ({ safeFetch: jest.fn() }));

function jsonResponse(data, status = 200) {
  const bytes = Buffer.from(JSON.stringify(data));
  let read = false;
  return {
    ok: status >= 200 && status < 300, status,
    headers: { get: name => name === 'content-length' ? String(bytes.length) : 'application/json' },
    body: { cancel: async () => {}, getReader: () => ({ read: async () => read ? { done: true } : (read = true, { done: false, value: bytes }), cancel: async () => {} }) },
  };
}

describe('AssemblyAI transcription provider boundary', () => {
  beforeEach(() => {
    safeFetch.mockReset();
    process.env.ASSEMBLYAI_API_KEY = 'test-server-only-key';
  });

  it('uploads bounded raw audio and accepts only the documented CDN reference', async () => {
    safeFetch.mockResolvedValueOnce(jsonResponse({ upload_url: 'https://cdn.assemblyai.com/upload/opaque-ref' }));
    const ref = await uploadAssemblyAIAudio({ region: 'us', audio: Buffer.from('audio'), contentType: 'audio/mpeg' });
    expect(ref).toBe('https://cdn.assemblyai.com/upload/opaque-ref');
    expect(safeFetch).toHaveBeenCalledWith('https://api.assemblyai.com/v2/upload', expect.objectContaining({
      method: 'POST', headers: expect.objectContaining({ authorization: 'test-server-only-key' }),
      body: Buffer.from('audio'), failOnRedirect: true,
    }));
  });

  it('submits the fixed model, diarization, and attempt HMAC without arbitrary options', async () => {
    safeFetch.mockResolvedValueOnce(jsonResponse({ id: 'provider_123', speech_model_used: 'universal-2' }));
    await submitAssemblyAITranscription({
      region: 'eu', uploadUrl: 'https://cdn.assemblyai.com/upload/opaque-ref',
      model: 'universal-2', callbackUrl: 'https://app.example/api/webhooks/assemblyai?attempt=attempt', webhookAuth: 'a'.repeat(64),
    });
    expect(safeFetch).toHaveBeenCalledWith('https://api.eu.assemblyai.com/v2/transcript', expect.objectContaining({
      method: 'POST', failOnRedirect: true,
      body: JSON.stringify({
        audio_url: 'https://cdn.assemblyai.com/upload/opaque-ref', speech_models: ['universal-2'], speaker_labels: true,
        webhook_url: 'https://app.example/api/webhooks/assemblyai?attempt=attempt',
        webhook_auth_header_name: 'x-transcription-pilot-auth', webhook_auth_header_value: 'a'.repeat(64),
      }),
    }));
  });

  it('refuses arbitrary upload references and invalid transcript IDs before fetch', async () => {
    await expect(submitAssemblyAITranscription({ region: 'us', uploadUrl: 'https://evil.example/upload/a', model: 'universal-2', callbackUrl: 'https://app.example/cb', webhookAuth: 'x' })).rejects.toThrow('invalid_upload_reference');
    await expect(getAssemblyAITranscript({ region: 'us', transcriptId: '../secret' })).rejects.toThrow('invalid_transcript_id');
    await expect(deleteAssemblyAITranscript({ region: 'us', transcriptId: 'bad/id' })).rejects.toThrow('invalid_transcript_id');
    expect(safeFetch).not.toHaveBeenCalled();
  });

  it('bounds provider JSON bodies even without a trustworthy content-length', async () => {
    let read = false;
    const large = {
      ok: true, status: 200, headers: { get: () => null },
      body: { getReader: () => ({ read: async () => read ? { done: true } : (read = true, { done: false, value: new Uint8Array(33 * 1024 * 1024) }), cancel: async () => {} }) },
    };
    safeFetch.mockResolvedValueOnce(large);
    await expect(getAssemblyAITranscript({ region: 'us', transcriptId: 'provider_123' })).rejects.toThrow('provider_response_too_large');
  });

  it('treats exact absent DELETE as resolved but retains other remote failures', async () => {
    safeFetch.mockResolvedValueOnce(jsonResponse({}, 404));
    await expect(deleteAssemblyAITranscript({ region: 'us', transcriptId: 'known-id' })).resolves.toEqual({ alreadyAbsent: true });
    safeFetch.mockResolvedValueOnce(jsonResponse({}, 500));
    await expect(deleteAssemblyAITranscript({ region: 'us', transcriptId: 'known-id' })).rejects.toMatchObject({ code: 'provider_http_500' });
  });
});
