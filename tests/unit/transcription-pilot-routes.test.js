jest.mock('../../lib/utils/auth', () => ({ requireSuperuser: jest.fn() }));
jest.mock('../../lib/services/transcription-pilot/runtime', () => {
  class TranscriptionPilotError extends Error { constructor(code, status = 400) { super(code); this.code = code; this.status = status; } }
  return {
    createOwnerUpload: jest.fn(),
    listOwnerJobs: jest.fn(),
    getOwnerJob: jest.fn(),
    requirePilotEnabled: jest.fn(),
    TranscriptionPilotError,
    validateOwnerProfile: jest.fn((profileId) => {
      if (!Number.isSafeInteger(profileId) || profileId <= 0) throw new TranscriptionPilotError('profile_required', 401);
    }),
  };
});
jest.mock('../../lib/services/transcription-pilot/store', () => ({
  claimUncertainTranscriptionJobForReconcile: jest.fn(),
  getLeasedTranscriptionJob: jest.fn(),
  getOwnerTranscriptionJob: jest.fn(),
  markTranscriptionProviderDeletionCompleted: jest.fn(),
  reconcileVerifiedTranscriptionProviderId: jest.fn(),
  releaseTranscriptionLease: jest.fn(),
}));
jest.mock('../../lib/services/transcription-pilot/provider', () => ({
  deleteAssemblyAITranscript: jest.fn(), getAssemblyAITranscript: jest.fn(),
}));

import { requireSuperuser } from '../../lib/utils/auth';
import { createOwnerUpload, listOwnerJobs, requirePilotEnabled, TranscriptionPilotError } from '../../lib/services/transcription-pilot/runtime';
import * as store from '../../lib/services/transcription-pilot/store';
import * as provider from '../../lib/services/transcription-pilot/provider';
import jobsHandler from '../../pages/api/admin/transcription-pilot/jobs/index';
import reconcileHandler from '../../pages/api/admin/transcription-pilot/jobs/[id]/reconcile';

function response() {
  return {
    statusCode: 200, headers: {}, body: undefined,
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name] = value; },
    json(body) { this.body = body; return this; },
  };
}

describe('transcription pilot owner routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    requireSuperuser.mockResolvedValue({ profileId: 42 });
    listOwnerJobs.mockResolvedValue([]);
  });

  it('rejects a null profile even if the admin auth helper returned a gate object', async () => {
    requireSuperuser.mockResolvedValue({ profileId: null });
    const res = response();
    await jobsHandler({ method: 'POST', body: { filename: 'x.mp3' }, query: {} }, res);
    expect(res.statusCode).toBe(401);
    expect(createOwnerUpload).not.toHaveBeenCalled();
  });

  it('fails closed when the pilot switch is not literal true', async () => {
    const original = process.env.TRANSCRIPTION_PILOT_ENABLED;
    delete process.env.TRANSCRIPTION_PILOT_ENABLED;
    createOwnerUpload.mockRejectedValue(new TranscriptionPilotError('transcription_pilot_disabled', 503));
    const res = response();
    await jobsHandler({ method: 'POST', body: { filename: 'x.mp3' }, query: {} }, res);
    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe('transcription_pilot_disabled');
    if (original === undefined) delete process.env.TRANSCRIPTION_PILOT_ENABLED;
    else process.env.TRANSCRIPTION_PILOT_ENABLED = original;
  });

  it('returns only owner-projected job rows and exposes submission switch state', async () => {
    const res = response();
    process.env.TRANSCRIPTION_SUBMISSIONS_ENABLED = 'TRUE';
    await jobsHandler({ method: 'GET', query: { limit: '10' } }, res);
    expect(listOwnerJobs).toHaveBeenCalledWith({ ownerProfileId: 42, limit: 10 });
    expect(res.body).toEqual({ jobs: [], pilotEnabled: true, submissionsEnabled: false });
    expect(res.headers['Cache-Control']).toBe('private, no-store');
    delete process.env.TRANSCRIPTION_SUBMISSIONS_ENABLED;
  });

  it('blocks reconcile before any store mutation or provider IO when the pilot switch is off', async () => {
    requirePilotEnabled.mockImplementation(() => { throw new TranscriptionPilotError('transcription_pilot_disabled', 503); });
    const res = response();
    await reconcileHandler({ method: 'POST', body: { providerTranscriptId: 'provider-1', expectedVersion: 1 }, query: { id: 'job-1' } }, res);
    expect(res.statusCode).toBe(503);
    expect(store.claimUncertainTranscriptionJobForReconcile).not.toHaveBeenCalled();
    expect(provider.getAssemblyAITranscript).not.toHaveBeenCalled();
    expect(provider.deleteAssemblyAITranscript).not.toHaveBeenCalled();
  });
});
