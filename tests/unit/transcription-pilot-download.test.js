jest.mock('../../lib/utils/auth', () => ({ requireSuperuser: jest.fn() }));
jest.mock('../../lib/services/transcription-pilot/runtime', () => {
  class TranscriptionPilotError extends Error { constructor(code, status = 400) { super(code); this.code = code; this.status = status; } }
  return { getOwnerJobContent: jest.fn(), TranscriptionPilotError, validateOwnerProfile: jest.fn() };
});

import { requireSuperuser } from '../../lib/utils/auth';
import { getOwnerJobContent } from '../../lib/services/transcription-pilot/runtime';
import downloadHandler from '../../pages/api/admin/transcription-pilot/jobs/[id]/download';

function response() {
  return {
    statusCode: 200, headers: {}, body: undefined,
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name] = value; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; },
  };
}

beforeEach(() => {
  jest.resetAllMocks();
  requireSuperuser.mockResolvedValue({ profileId: 7 });
  getOwnerJobContent.mockResolvedValue({
    job: { id: 'job-1', speaker_names: { A: 'Chair' } },
    content: { text: 'Hello there.', utterances: [
      { start: 62_000, end: 63_500, speaker: 'A', text: 'Hello there.' },
    ] },
  });
});

it('exports TXT as one paragraph per speaker turn with saved display names (formatter v3)', async () => {
  const res = response();
  await downloadHandler({ method: 'GET', query: { id: 'job-1', format: 'txt' } }, res);
  expect(res.statusCode).toBe(200);
  expect(res.body).toBe('[01:02] Chair: Hello there.\n');
  expect(getOwnerJobContent).toHaveBeenCalledWith({ ownerProfileId: 7, jobId: 'job-1' });
});

it('exports VTT with saved names and provider millisecond timing', async () => {
  const res = response();
  await downloadHandler({ method: 'GET', query: { id: 'job-1', format: 'vtt' } }, res);
  expect(res.statusCode).toBe(200);
  expect(res.body).toBe('WEBVTT\n\n00:01:02.000 --> 00:01:03.500\nChair: Hello there.\n');
  expect(res.headers['Cache-Control']).toBe('private, no-store');
});
