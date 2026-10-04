jest.mock('@vercel/blob', () => ({ del: jest.fn(), get: jest.fn(), put: jest.fn() }));
jest.mock('@vercel/blob/client', () => ({ generateClientTokenFromReadWriteToken: jest.fn() }));
jest.mock('../../lib/services/transcription-pilot/crypto', () => ({
  createAssemblyAIWebhookAuth: jest.fn(), openProviderUploadReference: jest.fn(), sealProviderUploadReference: jest.fn(),
}));
jest.mock('../../lib/services/transcription-pilot/media-inspector', () => ({ inspectAudioBuffer: jest.fn() }));
jest.mock('../../lib/services/transcription-pilot/model', () => ({ projectOwnerTranscriptionJob: jest.fn(row => ({
  id: row.id, status: row.status,
  contentDeletionObserved: row.content_purged_at != null,
  speaker_alignment: row.speaker_alignment ?? null,
  lateUploadWatchPending: row.input_cleanup_pathname != null && row.upload_valid_until != null
    && (row.cleanup_requested_at != null || row.content_purged_at != null),
})) }));
jest.mock('../../lib/services/transcription-pilot/store', () => ({
  claimNextTranscriptionJob: jest.fn(), createTranscriptionJob: jest.fn(), getOwnerTranscriptionJob: jest.fn(),
  listOwnerTranscriptionJobs: jest.fn(), mutateLeasedTranscriptionJob: jest.fn(), queueTranscriptionJob: jest.fn(),
  reserveTranscriptionUploadWindow: jest.fn(),
  createMeetingTranscriptionJob: jest.fn(), getMeetingTranscriptionJob: jest.fn(),
  reserveMeetingTranscriptionUploadWindow: jest.fn(), queueMeetingTranscriptionJob: jest.fn(),
}));
jest.mock('../../lib/services/meeting-tracker-transcription/policy', () => ({
  requireMeetingTranscriptionEnabled: jest.fn(), getMeetingTranscriptionControls: jest.fn(),
}));

import { ReadableStream } from 'node:stream/web';
import { del, get, put } from '@vercel/blob';
import { generateClientTokenFromReadWriteToken } from '@vercel/blob/client';
import * as store from '../../lib/services/transcription-pilot/store';
import { inspectAudioBuffer } from '../../lib/services/transcription-pilot/media-inspector';
import { createMeetingTranscriptionUpload, queueMeetingTranscription, createOwnerUpload, deletePrivatePath, projectMeetingTranscriptionJob, readPrivateContentIfPresent, writePrivateContent, __private } from '../../lib/services/transcription-pilot/runtime';

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

  it('forwards only safe content-deletion and upload-watch state to the Meeting Tracker DTO', () => {
    const projected = projectMeetingTranscriptionJob({
      id: 'meeting-job', status: 'expired', content_purged_at: new Date(),
      input_cleanup_pathname: 'private/path', upload_valid_until: new Date(),
      provider_transcript_id: 'provider-secret', provider_upload_ref_ciphertext: 'ciphertext',
    });
    expect(projected).toMatchObject({ contentDeletionObserved: true, lateUploadWatchPending: true });
    expect(projected).not.toHaveProperty('input_cleanup_pathname');
    expect(projected).not.toHaveProperty('upload_valid_until');
    expect(projected).not.toHaveProperty('provider_transcript_id');
    expect(projected).not.toHaveProperty('provider_upload_ref_ciphertext');
  });

  it('exposes alignment status and a Zoom-attached boolean but never the Zoom pathnames', () => {
    const projected = projectMeetingTranscriptionJob({
      id: 'meeting-job', status: 'ready', output_pathname: 'private/output.json',
      expires_at: new Date(Date.now() + 86_400_000),
      zoom_transcript_cleanup_pathname: 'private/zoom-transcript.vtt',
      zoom_transcript_pathname: 'private/zoom-transcript.vtt', zoom_transcript_sha256: 'a'.repeat(64),
      speaker_alignment: { status: 'pending', attempts: 0 },
    });
    expect(projected).toMatchObject({ zoomTranscriptAttached: true, speaker_alignment: { status: 'pending', attempts: 0 } });
    for (const field of ['zoom_transcript_pathname', 'zoom_transcript_cleanup_pathname', 'zoom_transcript_sha256']) {
      expect(projected).not.toHaveProperty(field);
    }
    expect(JSON.stringify(projected)).not.toContain('zoom-transcript.vtt');
    expect(projectMeetingTranscriptionJob({ id: 'j', status: 'ready', expires_at: new Date(Date.now() + 1e6) }))
      .toMatchObject({ zoomTranscriptAttached: false });
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
    expect(store.createTranscriptionJob).toHaveBeenCalledWith(expect.objectContaining({ requestedModel: 'universal-3-5-pro' }));
    expect(result.upload.token).toBe('client-capability');
  });

  it('keeps new-job model selection server-owned and rejects a client override', async () => {
    await expect(createOwnerUpload({ ownerProfileId: 42, body: {
      filename: 'voice.mp3', contentType: 'audio/mpeg', bytes: 100,
      idempotencyKey: 'model-override', requestedModel: 'universal-2',
    } })).rejects.toMatchObject({ code: 'unsupported_model' });
    expect(store.createTranscriptionJob).not.toHaveBeenCalled();
    expect(generateClientTokenFromReadWriteToken).not.toHaveBeenCalled();
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

describe('Meeting Tracker Zoom transcript upload and start', () => {
  const requestId = '33333333-3333-4333-8333-333333333333';
  const siteVisitActivityId = '44444444-4444-4444-8444-444444444444';
  const jobId = '11111111-1111-4111-8111-111111111111';
  const audioPath = `transcription-pilot/42/${jobId}/input/audio.mp3`;
  const zoomPath = `transcription-pilot/42/${jobId}/input/zoom-transcript.vtt`;
  const body = (extra = {}) => ({
    filename: 'meeting.mp3', contentType: 'audio/mpeg', bytes: 4,
    idempotencyKey: '55555555-5555-4555-8555-555555555555', providerRegion: 'us', ...extra,
  });
  const vtt = 'WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.000\nAlice Example: hello there everyone\n';
  const row = (extra = {}) => ({
    ...job, input_cleanup_pathname: audioPath, declared_bytes: 4, declared_content_type: 'audio/mpeg',
    zoom_transcript_cleanup_pathname: zoomPath, options_snapshot: { zoomTranscript: { bytes: Buffer.byteLength(vtt) } },
    ...extra,
  });
  const blobResult = (buffer, contentType, pathname) => ({ statusCode: 200, stream: readable(buffer), blob: { pathname, contentType, etag: 'e' } });
  const queueArgs = { ownerProfileId: 42, requestId, siteVisitActivityId, jobId, expectedVersion: 1, acknowledged: true };

  beforeEach(() => {
    process.env.TRANSCRIPTION_PILOT_ENABLED = 'true';
    process.env.UPLOADS_BLOB_RW_TOKEN = 'private-test-token';
    jest.clearAllMocks();
    generateClientTokenFromReadWriteToken.mockImplementation(async ({ pathname }) => `token:${pathname}`);
    store.reserveMeetingTranscriptionUploadWindow.mockResolvedValue({ ...job, version: 2 });
    store.createMeetingTranscriptionJob.mockImplementation(async (input) => ({
      created: true, job: { ...job, id: input.id, input_cleanup_pathname: input.inputPathname,
        zoom_transcript_cleanup_pathname: input.zoomTranscriptCleanupPathname ?? null },
    }));
    store.queueMeetingTranscriptionJob.mockResolvedValue({ ...job, status: 'queued' });
    inspectAudioBuffer.mockResolvedValue({ container: 'MPEG', durationSeconds: 5 });
  });

  it('mints a second text/vtt-only token on a server-chosen path and snapshots bytes only', async () => {
    const result = await createMeetingTranscriptionUpload({ ownerProfileId: 42, requestId, siteVisitActivityId,
      body: body({ zoomTranscript: { contentType: 'text/vtt', bytes: 1234 } }) });
    const input = store.createMeetingTranscriptionJob.mock.calls[0][0];
    expect(input.zoomTranscriptCleanupPathname).toBe(`transcription-pilot/42/${input.id}/input/zoom-transcript.vtt`);
    expect(input.optionsSnapshot).toEqual({ zoomTranscript: { bytes: 1234 } });
    expect(generateClientTokenFromReadWriteToken).toHaveBeenCalledTimes(2);
    const zoomCall = generateClientTokenFromReadWriteToken.mock.calls[1][0];
    expect(zoomCall).toMatchObject({ pathname: input.zoomTranscriptCleanupPathname, maximumSizeInBytes: 1234,
      allowedContentTypes: ['text/vtt'], addRandomSuffix: false });
    expect(zoomCall.validUntil).toBe(generateClientTokenFromReadWriteToken.mock.calls[0][0].validUntil);
    expect(result.upload.zoomTranscript).toEqual({ pathname: input.zoomTranscriptCleanupPathname,
      token: `token:${input.zoomTranscriptCleanupPathname}`, maximumSizeInBytes: 1234, contentType: 'text/vtt' });
  });

  it('without a Zoom transcript mints one token and returns zoomTranscript null', async () => {
    const result = await createMeetingTranscriptionUpload({ ownerProfileId: 42, requestId, siteVisitActivityId, body: body() });
    expect(generateClientTokenFromReadWriteToken).toHaveBeenCalledTimes(1);
    expect(store.createMeetingTranscriptionJob.mock.calls[0][0].optionsSnapshot).toEqual({});
    expect(result.upload.zoomTranscript).toBeNull();
  });

  it.each([
    ['another content type', { contentType: 'text/plain', bytes: 10 }],
    ['a filename', { contentType: 'text/vtt', bytes: 10, filename: 'x.vtt' }],
    ['zero bytes', { contentType: 'text/vtt', bytes: 0 }],
    ['too many bytes', { contentType: 'text/vtt', bytes: 4_000_001 }],
    ['fractional bytes', { contentType: 'text/vtt', bytes: 1.5 }],
  ])('rejects a zoomTranscript with %s before creating a row', async (_label, zoomTranscript) => {
    await expect(createMeetingTranscriptionUpload({ ownerProfileId: 42, requestId, siteVisitActivityId, body: body({ zoomTranscript }) }))
      .rejects.toMatchObject({ code: 'invalid_zoom_transcript_metadata' });
    expect(store.createMeetingTranscriptionJob).not.toHaveBeenCalled();
    expect(generateClientTokenFromReadWriteToken).not.toHaveBeenCalled();
  });

  function arrangeStart({ zoom, zoomRow = row() }) {
    store.getMeetingTranscriptionJob.mockResolvedValue(zoomRow);
    get.mockImplementation(async (pathname) => {
      if (pathname === audioPath) return blobResult(Buffer.from('abcd'), 'audio/mpeg', audioPath);
      return zoom === null ? null : zoom;
    });
  }

  it('start with a valid VTT passes its sha256 and no alignment marker', async () => {
    arrangeStart({ zoom: blobResult(Buffer.from(vtt), 'text/vtt', zoomPath) });
    await queueMeetingTranscription(queueArgs);
    const call = store.queueMeetingTranscriptionJob.mock.calls[0][0];
    expect(call.zoomTranscriptSha256).toBe(require('node:crypto').createHash('sha256').update(vtt).digest('hex'));
    expect(call.speakerAlignment).toBeNull();
  });

  it('start with a speaker-less VTT records no_speakers', async () => {
    const plain = 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nno speaker prefix here at all\n';
    arrangeStart({ zoom: blobResult(Buffer.from(plain), 'text/vtt', zoomPath),
      zoomRow: row({ options_snapshot: { zoomTranscript: { bytes: Buffer.byteLength(plain) } } }) });
    await queueMeetingTranscription(queueArgs);
    expect(store.queueMeetingTranscriptionJob.mock.calls[0][0].speakerAlignment).toEqual({ status: 'no_speakers', attempts: 0 });
    expect(store.queueMeetingTranscriptionJob.mock.calls[0][0].zoomTranscriptSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('start without a Zoom attachment does not read or hash one', async () => {
    arrangeStart({ zoom: null, zoomRow: row({ zoom_transcript_cleanup_pathname: null }) });
    await queueMeetingTranscription(queueArgs);
    expect(get).toHaveBeenCalledTimes(1);
    expect(store.queueMeetingTranscriptionJob.mock.calls[0][0]).toMatchObject({ zoomTranscriptSha256: null, speakerAlignment: null });
  });

  it('a missing VTT blob is 410 zoom_transcript_missing and nothing is queued', async () => {
    arrangeStart({ zoom: null });
    await expect(queueMeetingTranscription(queueArgs)).rejects.toMatchObject({ code: 'zoom_transcript_missing', status: 410 });
    expect(store.queueMeetingTranscriptionJob).not.toHaveBeenCalled();
  });

  it.each([
    ['size mismatch', () => blobResult(Buffer.from(`${vtt}extra`), 'text/vtt', zoomPath)],
    ['wrong content type', () => blobResult(Buffer.from(vtt), 'text/plain', zoomPath)],
    ['pathname mismatch', () => blobResult(Buffer.from(vtt), 'text/vtt', `${zoomPath}.other`)],
    ['missing WEBVTT header', () => blobResult(Buffer.from(vtt.replace('WEBVTT', 'NOTVTT')), 'text/vtt', zoomPath)],
  ])('a VTT with %s is 422 zoom_transcript_invalid and nothing is queued', async (_label, make) => {
    arrangeStart({ zoom: make() });
    await expect(queueMeetingTranscription(queueArgs)).rejects.toMatchObject({ code: 'zoom_transcript_invalid', status: 422 });
    expect(store.queueMeetingTranscriptionJob).not.toHaveBeenCalled();
  });
});

describe('getMeetingTranscriptionJobContent applies recorded short-utterance reassignments', () => {
  const crypto = require('node:crypto');
  const runtime = require('../../lib/services/transcription-pilot/runtime');

  it('rewrites the reassigned utterance speaker for every consumer without touching the stored bytes', async () => {
    const raw = JSON.stringify({ text: '', utterances: [
      { speaker: 'A', start: 0, end: 5000, text: 'first' }, { speaker: 'D', start: 5000, end: 5400, text: 'Right.' }, { speaker: 'A', start: 5500, end: 9000, text: 'third' },
    ] });
    const buffer = Buffer.from(raw);
    const row = { id: 'job-1', status: 'ready', output_pathname: 'private/output.json', expires_at: new Date(Date.now() + 86_400_000),
      output_sha256: crypto.createHash('sha256').update(buffer).digest('hex'), speaker_alignment: { status: 'applied', reassigned: { 1: 'A' }, reassignedCount: 1 } };
    store.getMeetingTranscriptionJob.mockResolvedValue(row);
    process.env.UPLOADS_BLOB_RW_TOKEN = 'token';
    get.mockResolvedValueOnce({ statusCode: 200, stream: ReadableStream.from([buffer]), blob: {} });
    const { content } = await runtime.getMeetingTranscriptionJobContent({ requestId: 'r', siteVisitActivityId: 's', jobId: 'job-1' });
    expect(content.utterances.map((u) => u.speaker)).toEqual(['A', 'A', 'A']);
    expect(JSON.parse(raw).utterances[1].speaker).toBe('D');
  });
});
