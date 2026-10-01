jest.mock('@vercel/blob', () => ({ del: jest.fn(), get: jest.fn(), put: jest.fn() }));
jest.mock('@vercel/blob/client', () => ({ generateClientTokenFromReadWriteToken: jest.fn() }));
jest.mock('../../lib/services/transcription-pilot/crypto', () => ({
  createAssemblyAIWebhookAuth: jest.fn(), openProviderUploadReference: jest.fn(), sealProviderUploadReference: jest.fn(),
}));
jest.mock('../../lib/services/transcription-pilot/media-inspector', () => ({ inspectAudioBuffer: jest.fn() }));
jest.mock('../../lib/services/transcription-pilot/model', () => ({ projectOwnerTranscriptionJob: jest.fn(row => ({ id: row.id, status: row.status })) }));
jest.mock('../../lib/services/transcription-pilot/store', () => ({
  claimNextTranscriptionJob: jest.fn(), createTranscriptionJob: jest.fn(), getOwnerTranscriptionJob: jest.fn(),
  listOwnerTranscriptionJobs: jest.fn(), mutateLeasedTranscriptionJob: jest.fn(), queueTranscriptionJob: jest.fn(),
  reserveTranscriptionUploadWindow: jest.fn(),
}));

import { ReadableStream } from 'node:stream/web';
import { del, get, put } from '@vercel/blob';
import { generateClientTokenFromReadWriteToken } from '@vercel/blob/client';
import * as store from '../../lib/services/transcription-pilot/store';
import { createOwnerUpload, deletePrivatePath, readPrivateContentIfPresent, writePrivateContent, __private } from '../../lib/services/transcription-pilot/runtime';

const job = {
  id: '11111111-1111-4111-8111-111111111111', owner_profile_id: 42, status: 'uploading', version: 1,
  input_cleanup_pathname: 'transcription-pilot/42/11111111-1111-4111-8111-111111111111/input/audio.mp3',
  expires_at: new Date(Date.now() + 24 * 60 * 60_000), receipt_expires_at: new Date(Date.now() + 30 * 24 * 60 * 60_000),
  cleanup_requested_at: null,
};

function readable(bytes = Buffer.from('test')) {
  return new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } });
}

describe('transcription pilot private Blob runtime', () => {
  const envBefore = {};
  beforeEach(() => {
    for (const name of ['TRANSCRIPTION_PILOT_ENABLED', 'TRANSCRIPTION_SUBMISSIONS_ENABLED', 'UPLOADS_BLOB_RW_TOKEN']) envBefore[name] = process.env[name];
    process.env.TRANSCRIPTION_PILOT_ENABLED = 'true';
    process.env.TRANSCRIPTION_SUBMISSIONS_ENABLED = 'true';
    process.env.UPLOADS_BLOB_RW_TOKEN = 'private-test-token';
    jest.clearAllMocks();
    store.createTranscriptionJob.mockResolvedValue({ job, created: true });
    store.reserveTranscriptionUploadWindow.mockResolvedValue({ ...job, version: 2 });
    generateClientTokenFromReadWriteToken.mockResolvedValue('client-capability');
  });
  afterEach(() => {
    for (const name of Object.keys(envBefore)) {
      if (envBefore[name] === undefined) delete process.env[name];
      else process.env[name] = envBefore[name];
    }
  });

  it('persists a bounded upload window before minting the client capability', async () => {
    const order = [];
    store.reserveTranscriptionUploadWindow.mockImplementation(async args => { order.push(['reserve', args]); return { ...job, version: 2 }; });
    generateClientTokenFromReadWriteToken.mockImplementation(async args => { order.push(['mint', args]); return 'client-capability'; });
    const result = await createOwnerUpload({ ownerProfileId: 42, body: {
      filename: 'voice.mp3', contentType: 'audio/mpeg', bytes: 100, idempotencyKey: 'upload-key',
    } });
    expect(order.map(entry => entry[0])).toEqual(['reserve', 'mint']);
    expect(order[0][1]).toEqual(expect.objectContaining({ jobId: job.id, ownerProfileId: 42, validUntil: expect.any(Date) }));
    expect(order[1][1]).toEqual(expect.objectContaining({ pathname: job.input_cleanup_pathname, validUntil: order[0][1].validUntil.getTime() }));
    expect(result.upload.token).toBe('client-capability');
  });

  it('does not issue capabilities for expired or cleanup-requested jobs', async () => {
    store.createTranscriptionJob.mockResolvedValueOnce({ job: { ...job, expires_at: new Date(Date.now() - 1) }, created: true });
    await expect(createOwnerUpload({ ownerProfileId: 42, body: {
      filename: 'voice.mp3', contentType: 'audio/mpeg', bytes: 100, idempotencyKey: 'expired',
    } })).rejects.toMatchObject({ code: 'job_upload_window_closed' });
    store.createTranscriptionJob.mockResolvedValueOnce({ job: { ...job, cleanup_requested_at: new Date() }, created: true });
    await expect(createOwnerUpload({ ownerProfileId: 42, body: {
      filename: 'voice.mp3', contentType: 'audio/mpeg', bytes: 100, idempotencyKey: 'cleanup',
    } })).rejects.toMatchObject({ code: 'job_upload_window_closed' });
    expect(store.reserveTranscriptionUploadWindow).not.toHaveBeenCalled();
    expect(generateClientTokenFromReadWriteToken).not.toHaveBeenCalled();
  });

  it('does not mint when the durable upload-window reservation loses a race', async () => {
    store.reserveTranscriptionUploadWindow.mockResolvedValue(null);
    await expect(createOwnerUpload({ ownerProfileId: 42, body: {
      filename: 'voice.mp3', contentType: 'audio/mpeg', bytes: 100, idempotencyKey: 'race',
    } })).rejects.toMatchObject({ code: 'job_upload_window_closed' });
    expect(generateClientTokenFromReadWriteToken).not.toHaveBeenCalled();
  });

  it('treats only a true 404 as an absent optional output', async () => {
    get.mockResolvedValueOnce(null);
    await expect(readPrivateContentIfPresent('transcription-pilot/output.json')).resolves.toBeNull();
    get.mockResolvedValueOnce({ statusCode: 404 });
    await expect(readPrivateContentIfPresent('transcription-pilot/output.json')).resolves.toBeNull();
    get.mockResolvedValueOnce({ statusCode: 503 });
    await expect(readPrivateContentIfPresent('transcription-pilot/output.json')).rejects.toMatchObject({ code: 'blob_read_failed' });
  });

  it('passes abortable deadlines through streamed reads, writes, and deletes', async () => {
    get.mockImplementationOnce((_path, options) => new Promise((_resolve, reject) => {
      options.abortSignal.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    await expect(readPrivateContentIfPresent('transcription-pilot/content.json', 100, Date.now() + 15))
      .rejects.toMatchObject({ code: 'blob_deadline_exhausted' });
    expect(get.mock.calls[0][1].abortSignal).toBeInstanceOf(AbortSignal);

    get.mockImplementationOnce((_path, options) => Promise.resolve({ statusCode: 200, blob: { size: 0 }, stream: new ReadableStream({
      start(controller) { options.abortSignal.addEventListener('abort', () => controller.error(new Error('aborted'))); },
    }) }));
    await expect(readPrivateContentIfPresent('transcription-pilot/hanging.json', 100, Date.now() + 15))
      .rejects.toMatchObject({ code: 'blob_deadline_exhausted' });

    put.mockResolvedValue({ pathname: 'transcription-pilot/output.json', size: 4 });
    await writePrivateContent('transcription-pilot/output.json', 'application/json', Buffer.from('data'), Date.now() + 1000);
    expect(put.mock.calls[0][2]).toEqual(expect.objectContaining({ allowOverwrite: false, abortSignal: expect.any(AbortSignal) }));

    del.mockResolvedValue(undefined);
    await deletePrivatePath('transcription-pilot/input/audio.mp3', Date.now() + 1000);
    expect(del.mock.calls[0][1].abortSignal).toBeInstanceOf(AbortSignal);
  });

  it('rejects already-expired deadlines before starting a Blob operation', async () => {
    await expect(__private.readPrivateBlob('transcription-pilot/input/audio.mp3', 100, Date.now() - 1))
      .rejects.toMatchObject({ code: 'blob_deadline_exhausted' });
    expect(get).not.toHaveBeenCalled();
  });

  it('aborts stalled writes and deletions without reporting completion', async () => {
    put.mockImplementationOnce((_path, _body, options) => new Promise((_resolve, reject) => {
      options.abortSignal.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    await expect(writePrivateContent('transcription-pilot/output.json', 'application/json', Buffer.from('data'), Date.now() + 15))
      .rejects.toMatchObject({ code: 'blob_deadline_exhausted' });
    del.mockImplementationOnce((_path, options) => new Promise((_resolve, reject) => {
      options.abortSignal.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    await expect(deletePrivatePath('transcription-pilot/input.mp3', Date.now() + 15))
      .rejects.toMatchObject({ code: 'blob_deadline_exhausted' });
  });

  it('does not create a row or upload capability while submissions are disabled', async () => {
    process.env.TRANSCRIPTION_SUBMISSIONS_ENABLED = 'false';
    await expect(createOwnerUpload({ ownerProfileId: 42, body: {} })).rejects.toMatchObject({ code: 'transcription_submissions_disabled' });
    expect(store.createTranscriptionJob).not.toHaveBeenCalled();
    expect(generateClientTokenFromReadWriteToken).not.toHaveBeenCalled();
  });
});
