/**
 * @jest-environment jsdom
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import TranscriptionPilotPage, {
  formatAudioDuration,
  formatTranscriptTimestamp,
  getEarliestReceiptExportDeadline,
  isCurrentPilotGeneration,
  validateAudioFile,
} from '../../pages/admin/transcription-pilot';
import { requestEnvelope } from '../../shared/utils/api-request';
import { useAppAccess } from '../../shared/context/AppAccessContext';
import { useProfile } from '../../shared/context/ProfileContext';
import { useSession } from 'next-auth/react';
import { put } from '@vercel/blob/client';

jest.mock('../../shared/utils/api-request', () => ({ requestEnvelope: jest.fn() }));
jest.mock('../../shared/context/AppAccessContext', () => ({ useAppAccess: jest.fn() }));
jest.mock('../../shared/context/ProfileContext', () => ({ useProfile: jest.fn() }));
jest.mock('next-auth/react', () => ({ useSession: jest.fn() }));
jest.mock('@vercel/blob/client', () => ({ put: jest.fn() }));
jest.mock('../../shared/components/Layout', () => ({
  __esModule: true,
  default: ({ children }) => <div>{children}</div>,
}));
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, scroll: _scroll, ...props }) => <a href={href} {...props}>{children}</a>,
}));

const authorizedAccess = { isSuperuser: true, isLoading: false, error: false, refreshAccess: jest.fn() };
const ownerProfile = { id: 73, status: 'ready', currentProfile: { id: 73, name: 'Pilot owner' } };

beforeEach(() => {
  jest.clearAllMocks();
  useAppAccess.mockReturnValue(authorizedAccess);
  useProfile.mockReturnValue(ownerProfile);
  useSession.mockReturnValue({ data: { user: { profileId: 73 } }, status: 'authenticated' });
});

function readyJob(id, filename, overrides = {}) {
  return {
    id,
    status: 'ready',
    label: 'Ready',
    version: 3,
    original_filename: filename,
    created_at: '2026-09-30T12:00:00.000Z',
    audio_duration_ms: 30_000,
    requested_model: 'universal-3-pro',
    returned_model: 'universal-3-pro',
    expires_at: '2026-10-07T12:00:00.000Z',
    receipt_expires_at: '2026-10-30T12:00:00.000Z',
    word_accuracy_score: null,
    speaker_accuracy_score: null,
    correction_notes: null,
    cleanup_requested_at: null,
    content_purged_at: null,
    contentAccessAllowed: true,
    failedContentDeleted: false,
    verificationReferenceExpired: false,
    ...overrides,
  };
}

test('validates only bounded M4A/MP3 inputs and formats millisecond timestamps', () => {
  expect(validateAudioFile({ name: 'meeting.m4a', size: 25, type: 'audio/mp4' })).toBeNull();
  expect(validateAudioFile({ name: 'meeting.mp3', size: 25, type: 'audio/mpeg' })).toBeNull();
  expect(validateAudioFile({ name: 'meeting.wav', size: 25, type: 'audio/wav' })).toMatch(/M4A or MP3/);
  expect(validateAudioFile({ name: 'meeting.mp3', size: 50 * 1024 * 1024 + 1, type: 'audio/mpeg' })).toMatch(/50 MiB/);
  expect(formatAudioDuration(65_000)).toBe('1:05');
  expect(formatTranscriptTimestamp(3_723_045)).toBe('01:02:03.045');
  expect(isCurrentPilotGeneration(4, 4, '73', '73')).toBe(true);
  expect(isCurrentPilotGeneration(4, 5, '73', '73')).toBe(false);
  expect(isCurrentPilotGeneration(4, 4, '73', '74')).toBe(false);
  expect(getEarliestReceiptExportDeadline([
    { receipt_expires_at: '2026-10-30T12:00:00.000Z' },
    { receipt_expires_at: '2026-10-05T12:00:00.000Z' },
    { receipt_expires_at: 'not-a-date' },
  ], Date.parse('2026-10-01T00:00:00.000Z')).toISOString()).toBe('2026-10-05T12:00:00.000Z');
  expect(getEarliestReceiptExportDeadline([{ receipt_expires_at: '2026-09-30T00:00:00.000Z' }], Date.parse('2026-10-01T00:00:00.000Z'))).toBeNull();
});

test('shows an explicit disabled state when the server pilot flag is off', async () => {
  requestEnvelope.mockResolvedValue({
    ok: false,
    status: 503,
    data: { code: 'transcription_pilot_disabled', message: 'Pilot disabled.' },
  });

  render(<TranscriptionPilotPage />);

  expect(await screen.findByRole('heading', { name: 'Transcription pilot is disabled' })).toBeInTheDocument();
  expect(screen.queryByLabelText('Recording')).not.toBeInTheDocument();
});

test('does not request or render owner jobs without a real profile', async () => {
  useProfile.mockReturnValue({ id: null, status: 'ready', currentProfile: null });

  render(<TranscriptionPilotPage />);

  expect(await screen.findByText('A real superuser profile is required.')).toBeInTheDocument();
  expect(requestEnvelope).not.toHaveBeenCalled();
});

test('renders transcript strings as text and exposes the owner-safe downloads', async () => {
  const job = {
    id: '4b670710-4202-4121-9b6d-cbf76ad7a743',
    status: 'ready',
    label: 'Ready',
    version: 3,
    original_filename: 'staff-interview.m4a',
    created_at: '2026-09-30T12:00:00.000Z',
    audio_duration_ms: 30_000,
    requested_model: 'universal-3-pro',
    returned_model: 'universal-3-pro',
    expires_at: '2026-10-07T12:00:00.000Z',
    receipt_expires_at: '2026-10-30T12:00:00.000Z',
    word_accuracy_score: null,
    speaker_accuracy_score: null,
    correction_notes: null,
    cleanup_requested_at: null,
    content_purged_at: null,
    contentAccessAllowed: true,
    failedContentDeleted: false,
    verificationReferenceExpired: false,
  };
  requestEnvelope.mockImplementation(async (url) => {
    if (url.endsWith('/jobs?limit=50')) {
      return { ok: true, status: 200, data: { pilotEnabled: true, submissionsEnabled: false, jobs: [job] } };
    }
    if (url.endsWith(`/jobs/${job.id}`)) {
      return { ok: true, status: 200, data: { job, transcript: { text: '<script>do not execute</script>', utterances: [] }, processing_duration_ms: 1200 } };
    }
    throw new Error(`Unexpected request ${url}`);
  });

  render(<TranscriptionPilotPage />);

  expect(await screen.findByText('<script>do not execute</script>')).toBeInTheDocument();
  expect(document.querySelector('script')).toBeNull();
  expect(screen.getByRole('link', { name: 'Download TXT' })).toHaveAttribute('href', `/api/admin/transcription-pilot/jobs/${job.id}/download?format=txt`);
  expect(screen.getByRole('link', { name: 'Download VTT' })).toHaveAttribute('href', `/api/admin/transcription-pilot/jobs/${job.id}/download?format=vtt`);
});

test('clears the previous owner snapshot when the current profile changes', async () => {
  const pendingListRequests = [];
  requestEnvelope.mockImplementation((url) => {
    if (url.endsWith('/jobs?limit=50')) {
      return new Promise((resolve) => { pendingListRequests.push(resolve); });
    }
    return Promise.resolve({ ok: true, status: 200, data: { job: null, transcript: null } });
  });

  const view = render(<TranscriptionPilotPage />);
  useProfile.mockReturnValue({ id: 74, status: 'ready', currentProfile: { id: 74 } });
  useSession.mockReturnValue({ data: { user: { profileId: 74 } }, status: 'authenticated' });
  view.rerender(<TranscriptionPilotPage />);
  const response = {
    ok: true,
    status: 200,
    data: { pilotEnabled: true, submissionsEnabled: true, jobs: [] },
  };
  pendingListRequests[0]?.({
    ...response,
    data: { ...response.data, jobs: [{ id: 'old-owner-job', status: 'ready', original_filename: 'old-owner.m4a' }] },
  });
  pendingListRequests[1]?.(response);

  await waitFor(() => expect(screen.queryByText('old-owner.m4a')).not.toBeInTheDocument());
  expect(screen.queryByText('old-owner-job')).not.toBeInTheDocument();
});

test('a list refresh revokes the active transcript when cleanup starts', async () => {
  const job = readyJob('job-cleanup', 'private-audio.m4a');
  let listCalls = 0;
  requestEnvelope.mockImplementation(async (url) => {
    if (url.endsWith('/jobs?limit=50')) {
      listCalls += 1;
      const latestJob = listCalls === 1 ? job : {
        ...job,
        contentAccessAllowed: false,
        cleanup_requested_at: '2026-09-30T13:00:00.000Z',
        original_filename: null,
      };
      return { ok: true, status: 200, data: { pilotEnabled: true, submissionsEnabled: false, jobs: [latestJob] } };
    }
    if (url.endsWith(`/jobs/${job.id}`)) {
      return { ok: true, status: 200, data: { job, transcript: { text: 'private transcript text', utterances: [] } } };
    }
    throw new Error(`Unexpected request ${url}`);
  });

  render(<TranscriptionPilotPage />);
  expect(await screen.findByText('private transcript text')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

  await waitFor(() => expect(screen.queryByText('private transcript text')).not.toBeInTheDocument());
  expect(screen.queryByRole('link', { name: 'Download TXT' })).not.toBeInTheDocument();
  expect(listCalls).toBe(2);
});

test('selected ready details continue polling and discard transcript after expiry', async () => {
  jest.useFakeTimers();
  const job = readyJob('job-expiring', 'expires-soon.m4a');
  let detailCalls = 0;
  requestEnvelope.mockImplementation(async (url) => {
    if (url.endsWith('/jobs?limit=50')) {
      return { ok: true, status: 200, data: { pilotEnabled: true, submissionsEnabled: false, jobs: [job] } };
    }
    if (url.endsWith(`/jobs/${job.id}`)) {
      detailCalls += 1;
      return detailCalls === 1
        ? { ok: true, status: 200, data: { job, transcript: { text: 'expires with content', utterances: [] } } }
        : { ok: true, status: 200, data: { job: { ...job, status: 'expired', label: 'Expired', contentAccessAllowed: false }, transcript: null } };
    }
    throw new Error(`Unexpected request ${url}`);
  });

  const view = render(<TranscriptionPilotPage />);
  try {
    expect(await screen.findByText('expires with content')).toBeInTheDocument();
    await act(async () => { jest.advanceTimersByTime(5000); });
    await waitFor(() => expect(screen.queryByText('expires with content')).not.toBeInTheDocument());
    expect(detailCalls).toBeGreaterThanOrEqual(2);
    expect(screen.queryByRole('link', { name: 'Download TXT' })).not.toBeInTheDocument();
  } finally {
    view.unmount();
    jest.useRealTimers();
  }
});

test('late pre-cleanup list and detail versions cannot restore a deleted transcript', async () => {
  jest.useFakeTimers();
  const jobV3 = readyJob('job-delete-race', 'race.m4a');
  const jobV4 = {
    ...jobV3,
    version: 4,
    cleanup_requested_at: '2026-09-30T14:00:00.000Z',
    contentAccessAllowed: false,
    original_filename: null,
  };
  let listCalls = 0;
  let detailCalls = 0;
  let resolveOldList;
  let resolveOldDetail;
  const originalConfirm = window.confirm;
  window.confirm = jest.fn(() => true);
  requestEnvelope.mockImplementation((url, options = {}) => {
    if (url.endsWith('/jobs?limit=50')) {
      listCalls += 1;
      if (listCalls === 2) return new Promise((resolve) => { resolveOldList = resolve; });
      const jobs = listCalls >= 4 ? [jobV4] : [jobV3];
      return Promise.resolve({ ok: true, status: 200, data: { pilotEnabled: true, submissionsEnabled: false, jobs } });
    }
    if (url.endsWith(`/jobs/${jobV3.id}`) && options.method === 'DELETE') {
      return Promise.resolve({ ok: true, status: 202, data: { job: jobV4, cleanupRequested: true } });
    }
    if (url.endsWith(`/jobs/${jobV3.id}`)) {
      detailCalls += 1;
      if (detailCalls === 2) return new Promise((resolve) => { resolveOldDetail = resolve; });
      return Promise.resolve({ ok: true, status: 200, data: { job: jobV3, transcript: { text: 'must stay deleted', utterances: [] } } });
    }
    throw new Error(`Unexpected request ${url} ${options.method || 'GET'}`);
  });

  const view = render(<TranscriptionPilotPage />);
  try {
    expect(await screen.findByText('must stay deleted')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(resolveOldList).toBeDefined());
    await act(async () => { jest.advanceTimersByTime(5000); });
    await waitFor(() => expect(resolveOldDetail).toBeDefined());

    fireEvent.click(screen.getByRole('button', { name: 'Request deletion and cleanup' }));
    await waitFor(() => expect(requestEnvelope).toHaveBeenCalledWith(
      `/api/admin/transcription-pilot/jobs/${jobV3.id}`,
      expect.objectContaining({ method: 'DELETE' }),
    ));
    await waitFor(() => expect(screen.getByText(/Cleanup was requested/)).toBeInTheDocument());

    await act(async () => {
      resolveOldList({ ok: true, status: 200, data: { pilotEnabled: true, submissionsEnabled: false, jobs: [jobV3] } });
      resolveOldDetail({ ok: true, status: 200, data: { job: jobV3, transcript: { text: 'must stay deleted', utterances: [] } } });
    });
    expect(screen.queryByText('must stay deleted')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Download TXT' })).not.toBeInTheDocument();
    expect(screen.getByText(/Cleanup was requested/)).toBeInTheDocument();
  } finally {
    view.unmount();
    window.confirm = originalConfirm;
    jest.useRealTimers();
  }
});

test('a late evaluation save for job A does not replace job B draft', async () => {
  const jobA = readyJob('job-a', 'first.mp3');
  const jobB = readyJob('job-b', 'second.mp3', { word_accuracy_score: 2 });
  let resolveSave;
  requestEnvelope.mockImplementation((url, options = {}) => {
    if (url.endsWith('/jobs?limit=50')) {
      return Promise.resolve({ ok: true, status: 200, data: { pilotEnabled: true, submissionsEnabled: false, jobs: [jobA, jobB] } });
    }
    if (url.endsWith(`/jobs/${jobA.id}`)) {
      return Promise.resolve({ ok: true, status: 200, data: { job: jobA, transcript: { text: 'A transcript', utterances: [] } } });
    }
    if (url.endsWith(`/jobs/${jobB.id}`)) {
      return Promise.resolve({ ok: true, status: 200, data: { job: jobB, transcript: { text: 'B transcript', utterances: [] } } });
    }
    if (url.endsWith(`/jobs/${jobA.id}/evaluation`)) {
      return new Promise((resolve) => { resolveSave = resolve; });
    }
    throw new Error(`Unexpected request ${url}`);
  });

  render(<TranscriptionPilotPage />);
  await screen.findByText('A transcript');
  fireEvent.change(screen.getByLabelText('Word accuracy'), { target: { value: '5' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save evaluation' }));
  await waitFor(() => expect(resolveSave).toBeDefined());
  fireEvent.click(screen.getByRole('button', { name: /second\.mp3/ }));
  await screen.findByText('B transcript');
  expect(screen.getByLabelText('Word accuracy')).toHaveValue('2');

  await act(async () => {
    resolveSave({ ok: true, status: 200, data: { job: { ...jobA, word_accuracy_score: 5 }, transcript: null } });
  });
  expect(screen.getByLabelText('Word accuracy')).toHaveValue('2');
  expect(screen.getByText('B transcript')).toBeInTheDocument();
});

test('owner change resets the pending upload controls and busy state', async () => {
  let resolvePut;
  Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: () => 'test-idempotency-key' });
  put.mockImplementation(() => new Promise((resolve) => { resolvePut = resolve; }));
  requestEnvelope.mockImplementation(async (url) => {
    if (url.endsWith('/jobs?limit=50')) {
      return { ok: true, status: 200, data: { pilotEnabled: true, submissionsEnabled: true, jobs: [] } };
    }
    if (url.endsWith('/jobs')) {
      return { ok: true, status: 200, data: { job: { id: 'upload-job', version: 1 }, upload: { pathname: 'server-path', token: 'server-token' } } };
    }
    throw new Error(`Unexpected request ${url}`);
  });

  const view = render(<TranscriptionPilotPage />);
  await screen.findByRole('button', { name: 'Upload and start transcription' });
  fireEvent.change(screen.getByLabelText('Recording'), { target: { files: [new File(['audio'], 'approved.m4a', { type: 'audio/mp4' })] } });
  fireEvent.click(screen.getByLabelText(/non-sensitive and approved/));
  fireEvent.click(screen.getByLabelText(/may consume paid credits/));
  fireEvent.click(screen.getByRole('button', { name: 'Upload and start transcription' }));
  await waitFor(() => expect(put).toHaveBeenCalled());

  useProfile.mockReturnValue({ id: 74, status: 'ready', currentProfile: { id: 74 } });
  useSession.mockReturnValue({ data: { user: { profileId: 74 } }, status: 'authenticated' });
  view.rerender(<TranscriptionPilotPage />);
  const startButton = await screen.findByRole('button', { name: 'Upload and start transcription' });
  expect(startButton).toBeDisabled();
  expect(screen.getByLabelText('Recording')).toHaveValue('');
  expect(screen.getByLabelText(/non-sensitive and approved/)).not.toBeChecked();
  expect(screen.getByLabelText(/may consume paid credits/)).not.toBeChecked();
  expect(screen.queryByLabelText('Audio upload progress')).not.toBeInTheDocument();
  expect(screen.queryByText(/could not be completed/)).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Recording'), { target: { files: [new File(['new audio'], 'new-owner.mp3', { type: 'audio/mpeg' })] } });
  fireEvent.click(screen.getByLabelText(/non-sensitive and approved/));
  fireEvent.click(screen.getByLabelText(/may consume paid credits/));
  expect(screen.getByRole('button', { name: 'Upload and start transcription' })).toBeEnabled();

  await act(async () => { resolvePut?.({ url: 'private' }); });
  expect(requestEnvelope).not.toHaveBeenCalledWith(expect.stringMatching(/\/start$/), expect.anything());
});

test('cleanup-requested uncertain jobs offer verified cleanup without transcript publication', async () => {
  const job = readyJob('uncertain-cleanup', 'uncertain.m4a', {
    status: 'submission_uncertain',
    label: 'Submission uncertain',
    needsAttention: true,
    cleanup_requested_at: '2026-09-30T13:00:00.000Z',
    contentAccessAllowed: false,
    original_filename: null,
    verificationReferenceExpired: false,
  });
  const requests = [];
  requestEnvelope.mockImplementation(async (url, options = {}) => {
    requests.push({ url, options });
    if (url.endsWith('/jobs?limit=50')) {
      return { ok: true, status: 200, data: { pilotEnabled: true, submissionsEnabled: false, jobs: [job] } };
    }
    if (url.endsWith(`/jobs/${job.id}`)) {
      return { ok: true, status: 200, data: { job, transcript: null } };
    }
    if (url.endsWith(`/jobs/${job.id}/reconcile`)) {
      return { ok: true, status: 200, data: { job, cleanupOnly: true, providerDeleted: true } };
    }
    throw new Error(`Unexpected request ${url}`);
  });

  render(<TranscriptionPilotPage />);
  await screen.findByText(/Cleanup has been requested/);
  fireEvent.change(screen.getByLabelText('Provider transcript ID for cleanup'), { target: { value: 'exact-provider-id' } });
  fireEvent.click(screen.getByRole('button', { name: 'Verify and clean up' }));

  await screen.findByText(/No transcript was retrieved or restored/);
  const reconcile = requests.find(({ url }) => url.endsWith(`/jobs/${job.id}/reconcile`));
  expect(reconcile.options.body).toEqual({ expectedVersion: job.version, providerTranscriptId: 'exact-provider-id', mode: 'cleanup' });
  expect(screen.queryByText('Transcript result')).not.toBeInTheDocument();
});
