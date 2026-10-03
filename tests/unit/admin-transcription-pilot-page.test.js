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

test('groups readable transcript by utterance start minute and saves speaker names explicitly', async () => {
  const job = readyJob('speaker-labels', 'staff-interview.m4a', { speaker_names: {} });
  const transcript = {
    text: 'Good morning. Thank you.',
    utterances: [
      { start: 0, end: 900, speaker: 'A', text: 'Good morning.' },
      { start: 59_800, end: 61_100, speaker: 'B', text: 'Thank you.' },
      { start: 61_200, end: 62_000, speaker: 'A', text: 'You are welcome.' },
      { start: 3_600_000, end: 3_600_800, speaker: 'A', text: 'At one hour.' },
    ],
  };
  const requests = [];
  requestEnvelope.mockImplementation(async (url, options = {}) => {
    requests.push({ url, options });
    if (url.endsWith('/jobs?limit=50')) {
      return { ok: true, status: 200, data: { pilotEnabled: true, submissionsEnabled: false, jobs: [job] } };
    }
    if (url.endsWith(`/jobs/${job.id}`) && options.method === 'PATCH') {
      return { ok: true, status: 200, data: { job: { ...job, version: 4, speaker_names: { A: 'Avery' } } } };
    }
    if (url.endsWith(`/jobs/${job.id}`)) {
      return { ok: true, status: 200, data: { job, transcript } };
    }
    throw new Error(`Unexpected request ${url}`);
  });

  render(<TranscriptionPilotPage />);

  expect(await screen.findByText('Good morning.')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Detected speakers (2)' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '0:00' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '1:00' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '60:00' })).toBeInTheDocument();
  expect(screen.getAllByText('Speaker A:').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Speaker B:').length).toBeGreaterThan(0);
  expect(screen.queryByText(/00:00:00\.000–/)).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Speaker A name'), { target: { value: 'Avery' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save speaker names' }));

  expect(await screen.findByRole('status')).toHaveTextContent(/Speaker names saved/);
  const saveRequest = requests.find(({ url, options }) => url.endsWith(`/jobs/${job.id}`) && options.method === 'PATCH');
  expect(saveRequest.options.body).toEqual({ expectedVersion: job.version, speakerNames: { A: 'Avery', B: '' } });
  expect(screen.getAllByText('Avery:').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Speaker B:').length).toBeGreaterThan(0);
});

test('speaker-name version conflicts keep the draft and expose an accessible retry message', async () => {
  const job = readyJob('speaker-conflict', 'conflict.mp3', { speaker_names: {} });
  requestEnvelope.mockImplementation(async (url, options = {}) => {
    if (url.endsWith('/jobs?limit=50')) {
      return { ok: true, status: 200, data: { pilotEnabled: true, submissionsEnabled: false, jobs: [job] } };
    }
    if (url.endsWith(`/jobs/${job.id}`) && options.method === 'PATCH') {
      return { ok: false, status: 409, data: { code: 'transcription_conflict', message: 'This recording changed. Refresh and try again.' } };
    }
    if (url.endsWith(`/jobs/${job.id}`)) {
      return { ok: true, status: 200, data: { job, transcript: { text: 'Hello', utterances: [{ start: 0, end: 1, speaker: 'A', text: 'Hello' }] } } };
    }
    throw new Error(`Unexpected request ${url}`);
  });

  render(<TranscriptionPilotPage />);
  expect(await screen.findByText('Hello')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Speaker A name'), { target: { value: 'Avery' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save speaker names' }));

  expect(await screen.findByRole('alert')).toHaveTextContent(/recording changed/);
  expect(screen.getByLabelText('Speaker A name')).toHaveValue('Avery');
  expect(screen.getByRole('button', { name: 'Save speaker names' })).toBeEnabled();
});

test('speaker-name drafts survive same-job polling without leaking across job selection', async () => {
  jest.useFakeTimers();
  const jobA = readyJob('speaker-draft-a', 'first.mp3', { speaker_names: { A: 'Alice' } });
  const jobB = readyJob('speaker-draft-b', 'second.mp3', { speaker_names: { A: 'Bryn' } });
  let detailCalls = 0;
  requestEnvelope.mockImplementation(async (url) => {
    if (url.endsWith('/jobs?limit=50')) {
      return { ok: true, status: 200, data: { pilotEnabled: true, submissionsEnabled: false, jobs: [jobA, jobB] } };
    }
    if (url.endsWith(`/jobs/${jobA.id}`) || url.endsWith(`/jobs/${jobB.id}`)) {
      detailCalls += 1;
      const job = url.includes(jobB.id) ? jobB : jobA;
      return { ok: true, status: 200, data: { job, transcript: { text: 'Hello', utterances: [{ start: 0, end: 500, speaker: 'A', text: 'Hello' }] } } };
    }
    throw new Error(`Unexpected request ${url}`);
  });

  const view = render(<TranscriptionPilotPage />);
  try {
    expect(await screen.findByLabelText('Speaker A name')).toHaveValue('Alice');
    fireEvent.change(screen.getByLabelText('Speaker A name'), { target: { value: 'Unsaved Alice' } });
    await act(async () => { jest.advanceTimersByTime(5000); });
    await waitFor(() => expect(detailCalls).toBeGreaterThanOrEqual(2));
    expect(screen.getByLabelText('Speaker A name')).toHaveValue('Unsaved Alice');

    fireEvent.click(screen.getByRole('button', { name: /second\.mp3/ }));
    expect(await screen.findByLabelText('Speaker A name')).toHaveValue('Bryn');
    fireEvent.click(screen.getByRole('button', { name: /first\.mp3/ }));
    expect(await screen.findByLabelText('Speaker A name')).toHaveValue('Alice');
  } finally {
    view.unmount();
    jest.useRealTimers();
  }
});

test.each(['success', 'error'])('late speaker-name %s response stays scoped to its job selection', async (outcome) => {
  const jobA = readyJob('speaker-race-a', 'first.mp3', { speaker_names: {} });
  const jobB = readyJob('speaker-race-b', 'second.mp3', { speaker_names: { A: 'Bryn' } });
  let resolveSave;
  requestEnvelope.mockImplementation((url, options = {}) => {
    if (url.endsWith('/jobs?limit=50')) {
      return Promise.resolve({ ok: true, status: 200, data: { pilotEnabled: true, submissionsEnabled: false, jobs: [jobA, jobB] } });
    }
    if (url.endsWith(`/jobs/${jobA.id}`) && options.method === 'PATCH') {
      return new Promise((resolve) => { resolveSave = resolve; });
    }
    if (url.endsWith(`/jobs/${jobA.id}`)) {
      return Promise.resolve({ ok: true, status: 200, data: { job: jobA, transcript: { text: 'A', utterances: [{ start: 0, end: 1, speaker: 'A', text: 'A' }] } } });
    }
    if (url.endsWith(`/jobs/${jobB.id}`)) {
      return Promise.resolve({ ok: true, status: 200, data: { job: jobB, transcript: { text: 'B', utterances: [{ start: 0, end: 1, speaker: 'A', text: 'B' }] } } });
    }
    throw new Error(`Unexpected request ${url}`);
  });

  render(<TranscriptionPilotPage />);
  await screen.findByText('A');
  fireEvent.change(screen.getByLabelText('Speaker A name'), { target: { value: 'Avery' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save speaker names' }));
  await waitFor(() => expect(resolveSave).toBeDefined());
  fireEvent.click(screen.getByRole('button', { name: /second\.mp3/ }));
  expect(await screen.findByLabelText('Speaker A name')).toHaveValue('Bryn');

  await act(async () => {
    if (outcome === 'success') {
      resolveSave({ ok: true, status: 200, data: { job: { ...jobA, version: 4, speaker_names: { A: 'Avery' } } } });
    } else {
      resolveSave({ ok: false, status: 409, data: { code: 'transcription_conflict', message: 'This recording changed. Refresh and try again.' } });
    }
  });

  expect(screen.getByLabelText('Speaker A name')).toHaveValue('Bryn');
  expect(screen.queryByText(/Speaker names saved/)).not.toBeInTheDocument();
  expect(screen.queryByText(/This recording changed/)).not.toBeInTheDocument();
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
        content_purged_at: '2026-09-30T13:05:00.000Z',
        contentDeletionObserved: true,
        lateUploadWatchPending: true,
        cleanupPending: true,
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
  expect(await screen.findByText(/Deletion of the readable content was observed/)).toBeInTheDocument();
  expect(screen.getByText(/temporary upload path is still retained for a late-upload safety watch/)).toBeInTheDocument();
  expect(screen.getByText(/does not confirm that an automatic cleanup worker is running/)).toBeInTheDocument();
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

test('Retry start only redelivers an existing queued job with its current version', async () => {
  const job = readyJob('queued-retry', 'saved-audio.m4a', { status: 'queued', label: 'Queued', version: 8 });
  const requests = [];
  requestEnvelope.mockImplementation(async (url, options = {}) => {
    requests.push({ url, options });
    if (url.endsWith('/jobs?limit=50')) {
      return { ok: true, status: 200, data: { pilotEnabled: true, submissionsEnabled: false, jobs: [job] } };
    }
    if (url.endsWith(`/jobs/${job.id}`)) {
      return { ok: true, status: 200, data: { job, transcript: null } };
    }
    if (url.endsWith(`/jobs/${job.id}/start`)) {
      return { ok: true, status: 202, data: { job: { ...job, version: 9 } } };
    }
    throw new Error(`Unexpected request ${url}`);
  });

  render(<TranscriptionPilotPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Retry start' }));

  await screen.findByText(/Start delivery was accepted for this existing queued job/);
  const startRequests = requests.filter(({ url }) => url.endsWith(`/jobs/${job.id}/start`));
  expect(startRequests).toHaveLength(1);
  expect(startRequests[0].options.body).toEqual({ expectedVersion: 8, acknowledgeNonSensitive: true });
  expect(requests.some(({ url, options }) => url.endsWith('/jobs') && options.method === 'POST')).toBe(false);
  expect(put).not.toHaveBeenCalled();
});

test('a dispatch-pending upload response selects the saved job and offers delivery retry without another upload', async () => {
  const queuedJob = readyJob('saved-after-503', 'approved.m4a', { status: 'queued', label: 'Queued', version: 4 });
  const requests = [];
  let prepared = false;
  Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: () => 'upload-idempotency-key' });
  put.mockResolvedValue({ url: 'private-upload' });
  requestEnvelope.mockImplementation(async (url, options = {}) => {
    requests.push({ url, options });
    if (url.endsWith('/jobs?limit=50')) {
      return { ok: true, status: 200, data: { pilotEnabled: true, submissionsEnabled: true, jobs: prepared ? [queuedJob] : [] } };
    }
    if (url.endsWith('/jobs') && options.method === 'POST') {
      prepared = true;
      return { ok: true, status: 201, data: { job: { id: queuedJob.id, version: 1 }, upload: { pathname: 'opaque-path', token: 'upload-token' } } };
    }
    if (url.endsWith(`/jobs/${queuedJob.id}/start`)) {
      return { ok: false, status: 503, data: { error: 'Start delivery is pending.', code: 'transcription_dispatch_pending', retryable: true, job: queuedJob } };
    }
    if (url.endsWith(`/jobs/${queuedJob.id}`)) {
      return { ok: true, status: 200, data: { job: queuedJob, transcript: null } };
    }
    throw new Error(`Unexpected request ${url}`);
  });

  render(<TranscriptionPilotPage />);
  await screen.findByRole('button', { name: 'Upload and start transcription' });
  fireEvent.change(screen.getByLabelText('Recording'), { target: { files: [new File(['audio'], 'approved.m4a', { type: 'audio/mp4' })] } });
  fireEvent.click(screen.getByLabelText(/non-sensitive and approved/));
  fireEvent.click(screen.getByLabelText(/may consume paid credits/));
  fireEvent.click(screen.getByRole('button', { name: 'Upload and start transcription' }));

  expect(await screen.findByRole('button', { name: 'Retry start' })).toBeInTheDocument();
  expect(screen.getByText(/already queued, but background start delivery is still pending/)).toBeInTheDocument();
  expect(screen.getByText(/Use Retry start below; do not upload it again/)).toBeInTheDocument();
  expect(screen.getByLabelText('Recording')).toHaveValue('');
  expect(screen.getByLabelText(/non-sensitive and approved/)).not.toBeChecked();
  expect(screen.getByLabelText(/may consume paid credits/)).not.toBeChecked();
  expect(put).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByRole('button', { name: 'Retry start' }));
  await screen.findByText(/Start delivery is still pending for this queued job/);
  const startRequests = requests.filter(({ url }) => url.endsWith(`/jobs/${queuedJob.id}/start`));
  expect(startRequests).toHaveLength(2);
  expect(startRequests[1].options.body).toEqual({ expectedVersion: queuedJob.version, acknowledgeNonSensitive: true });
  expect(requests.filter(({ url, options }) => url.endsWith('/jobs') && options.method === 'POST')).toHaveLength(1);
  expect(put).toHaveBeenCalledTimes(1);
});

test('a stale queued-start response is ignored after the owner changes', async () => {
  const queuedJob = readyJob('old-owner-queued', 'old-owner-audio.m4a', { status: 'queued', label: 'Queued' });
  let resolveStart;
  let listingOwner = 73;
  requestEnvelope.mockImplementation((url) => {
    if (url.endsWith('/jobs?limit=50')) {
      return Promise.resolve({ ok: true, status: 200, data: { pilotEnabled: true, submissionsEnabled: false, jobs: listingOwner === 73 ? [queuedJob] : [] } });
    }
    if (url.endsWith(`/jobs/${queuedJob.id}`)) {
      return Promise.resolve({ ok: true, status: 200, data: { job: queuedJob, transcript: null } });
    }
    if (url.endsWith(`/jobs/${queuedJob.id}/start`)) {
      return new Promise((resolve) => { resolveStart = resolve; });
    }
    throw new Error(`Unexpected request ${url}`);
  });

  const view = render(<TranscriptionPilotPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Retry start' }));
  await waitFor(() => expect(resolveStart).toBeDefined());

  listingOwner = 74;
  useProfile.mockReturnValue({ id: 74, status: 'ready', currentProfile: { id: 74 } });
  useSession.mockReturnValue({ data: { user: { profileId: 74 } }, status: 'authenticated' });
  view.rerender(<TranscriptionPilotPage />);
  await screen.findByText(/Select a recording to review its status/);
  await act(async () => {
    resolveStart({ ok: true, status: 202, data: { job: { ...queuedJob, version: queuedJob.version + 1 } } });
  });

  expect(screen.queryAllByText('old-owner-audio.m4a')).toHaveLength(0);
  expect(screen.queryByText(/Start delivery was accepted/)).not.toBeInTheDocument();
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
