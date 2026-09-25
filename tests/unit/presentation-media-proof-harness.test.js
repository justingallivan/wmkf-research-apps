/** @jest-environment jsdom */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PresentationMediaProofHarness from '../../shared/components/meeting-tracker/PresentationMediaProofHarness';
import { requestJson } from '../../shared/utils/api-request';
import { fingerprintPresentationMediaProofFile } from '../../shared/utils/presentation-media-proof-upload';
import { uploadBrowserDirectGraphFile, withGraphBrowserUploadLock } from '../../shared/utils/graph-browser-upload';

jest.mock('../../shared/utils/api-request', () => ({ requestJson: jest.fn() }));
jest.mock('../../shared/utils/presentation-media-proof-upload', () => ({
  ...jest.requireActual('../../shared/utils/presentation-media-proof-upload'),
  fingerprintPresentationMediaProofFile: jest.fn(),
}));
jest.mock('../../shared/utils/graph-browser-upload', () => ({
  ...jest.requireActual('../../shared/utils/graph-browser-upload'),
  uploadBrowserDirectGraphFile: jest.fn(),
  withGraphBrowserUploadLock: jest.fn(async (_key, task) => task()),
}));

const STORAGE_KEY = 'wmkf:presentation-media-proof-upload';
const SAVED = {
  permit: 'encrypted-permit',
  requestId: '11111111-1111-4111-8111-111111111111',
  file: { name: 'Zoom recording.mp4', size: 60_000_000, lastModified: 1_790_000_000_000 },
  expiresAt: '2026-09-22T13:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  fingerprintPresentationMediaProofFile.mockResolvedValue('matching-edge-sha256');
  uploadBrowserDirectGraphFile.mockResolvedValue({ complete: false, paused: true, reason: 'requested', nextStart: 10 * 1024 * 1024 });
  withGraphBrowserUploadLock.mockImplementation(async (_key, task) => task());
  window.sessionStorage.clear();
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(SAVED));
});

async function cleanupButton() {
  const button = await screen.findByRole('button', { name: 'Cleanup exact item' });
  await waitFor(() => expect(button).toBeEnabled());
  return button;
}

test('an uncertain cleanup failure keeps the encrypted retry permit in session storage', async () => {
  requestJson.mockRejectedValueOnce(new Error('Microsoft did not confirm cancellation.'));
  render(<PresentationMediaProofHarness />);
  fireEvent.click(await cleanupButton());

  await screen.findByText('Microsoft did not confirm cancellation.');
  expect(JSON.parse(window.sessionStorage.getItem(STORAGE_KEY))).toEqual(SAVED);
  expect(screen.getByRole('button', { name: 'Cleanup exact item' })).toBeEnabled();
});

test('a malformed successful cleanup response also retains retry authority', async () => {
  requestJson.mockResolvedValueOnce({ ok: true, cleaned: true });
  render(<PresentationMediaProofHarness />);
  fireEvent.click(await cleanupButton());

  await screen.findByText('Cleanup did not return a confirmed outcome. The retry permit was retained.');
  expect(JSON.parse(window.sessionStorage.getItem(STORAGE_KEY))).toEqual(SAVED);
});

test.each([
  ['item_deleted', 'The exact disposable SharePoint item was moved to the site recycle bin.'],
  ['placeholder_deleted', 'The terminal upload session left an exact partial SharePoint placeholder; it was moved to the site recycle bin.'],
  ['session_cancelled', 'Microsoft confirmed the upload session was cancelled; no committed item existed.'],
  ['session_gone', 'Microsoft reports the upload session no longer exists; no committed item was found.'],
  ['session_expired', 'Microsoft reports the upload session expired; no committed item was found.'],
])('confirmed %s cleanup clears the permit', async (cleanupOutcome, message) => {
  requestJson.mockResolvedValueOnce({ ok: true, cleaned: true, cleanupOutcome });
  render(<PresentationMediaProofHarness />);
  fireEvent.click(await cleanupButton());

  await screen.findByText(message);
  expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  expect(screen.getByRole('button', { name: 'Cleanup exact item' })).toBeDisabled();
});

const FINGERPRINTED = { ...SAVED, fingerprint: 'matching-edge-sha256' };
const SELECTED_FILE = {
  name: SAVED.file.name,
  size: SAVED.file.size,
  lastModified: SAVED.file.lastModified,
  type: 'video/mp4',
};

async function selectFile() {
  fireEvent.change(screen.getByLabelText('Zoom MP4 (over 50 MB)'), { target: { files: [SELECTED_FILE] } });
}

test('reload and same-file reselection resume only after the edge fingerprint matches', async () => {
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(FINGERPRINTED));
  requestJson.mockResolvedValueOnce({
    complete: false, uploadUrl: 'https://upload.example/session', chunkBytes: 327680,
    nextExpectedRanges: ['655360-'], expiresAt: '2026-09-22T13:30:00.000Z',
  });
  render(<PresentationMediaProofHarness />);
  await screen.findByText(/An unfinished proof upload was found/);
  await selectFile();
  fireEvent.click(screen.getByRole('button', { name: 'Resume' }));

  await waitFor(() => expect(uploadBrowserDirectGraphFile).toHaveBeenCalledWith(expect.objectContaining({
    file: SELECTED_FILE, start: 655360, uploadUrl: 'https://upload.example/session',
  })));
  expect(fingerprintPresentationMediaProofFile).toHaveBeenCalledWith(SELECTED_FILE);
  expect(requestJson).toHaveBeenCalledWith('/api/meeting-tracker/presentation-media-proof', expect.objectContaining({
    body: { action: 'status', permit: SAVED.permit },
  }));
  expect(JSON.parse(window.sessionStorage.getItem(STORAGE_KEY)).expiresAt).toBe('2026-09-22T13:30:00.000Z');
});

test('a malformed authorized resume range fails closed and preserves the permit', async () => {
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(FINGERPRINTED));
  requestJson.mockResolvedValueOnce({
    complete: false, uploadUrl: 'https://upload.example/session', chunkBytes: 10 * 1024 * 1024,
    nextExpectedRanges: [], expiresAt: '2026-09-22T13:30:00.000Z',
  });
  render(<PresentationMediaProofHarness />);
  await screen.findByText(/An unfinished proof upload was found/);
  await selectFile();
  fireEvent.click(screen.getByRole('button', { name: 'Resume' }));

  await screen.findByText(/invalid authorized upload range/);
  expect(uploadBrowserDirectGraphFile).not.toHaveBeenCalled();
  expect(JSON.parse(window.sessionStorage.getItem(STORAGE_KEY))).toMatchObject({ permit: SAVED.permit });
});

test('same metadata with a different edge fingerprint cannot request resume authority', async () => {
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(FINGERPRINTED));
  fingerprintPresentationMediaProofFile.mockResolvedValueOnce('different-sha256');
  render(<PresentationMediaProofHarness />);
  await screen.findByText(/An unfinished proof upload was found/);
  await selectFile();
  fireEvent.click(screen.getByRole('button', { name: 'Resume' }));

  await screen.findByText(/edge fingerprint must match/);
  expect(requestJson).not.toHaveBeenCalled();
  expect(uploadBrowserDirectGraphFile).not.toHaveBeenCalled();
  expect(JSON.parse(window.sessionStorage.getItem(STORAGE_KEY))).toEqual(FINGERPRINTED);
});

test('expired Graph session preserves cleanup authority and explains the new-session sequence', async () => {
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(FINGERPRINTED));
  const error = new Error('expired');
  error.payload = { code: 'presentation_media_proof_session_expired' };
  requestJson.mockRejectedValueOnce(error);
  render(<PresentationMediaProofHarness />);
  await screen.findByText(/An unfinished proof upload was found/);
  await selectFile();
  fireEvent.click(screen.getByRole('button', { name: 'Resume' }));

  await screen.findByText(/after owner-approved Cleanup/);
  expect(JSON.parse(window.sessionStorage.getItem(STORAGE_KEY))).toEqual(FINGERPRINTED);
  expect(uploadBrowserDirectGraphFile).not.toHaveBeenCalled();
});

test('an authorization failure preserves the permit and asks staff to sign in before Resume', async () => {
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(FINGERPRINTED));
  requestJson.mockRejectedValueOnce(Object.assign(new Error('Unauthorized'), { status: 401 }));
  render(<PresentationMediaProofHarness />);
  await screen.findByText(/An unfinished proof upload was found/);
  await selectFile();
  fireEvent.click(screen.getByRole('button', { name: 'Resume' }));

  await screen.findByText(/Sign in again, then use Resume/);
  expect(JSON.parse(window.sessionStorage.getItem(STORAGE_KEY))).toEqual(FINGERPRINTED);
  expect(uploadBrowserDirectGraphFile).not.toHaveBeenCalled();
});

test('unmount aborts an in-flight authorized status request and suppresses a stale upload', async () => {
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(FINGERPRINTED));
  let statusSignal;
  let resolveStatus;
  requestJson.mockImplementationOnce((_url, options) => {
    statusSignal = options.signal;
    return new Promise((resolve) => { resolveStatus = resolve; });
  });
  const view = render(<PresentationMediaProofHarness />);
  await screen.findByText(/An unfinished proof upload was found/);
  await selectFile();
  fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
  await waitFor(() => expect(statusSignal).toBeDefined());

  view.unmount();

  expect(statusSignal.aborted).toBe(true);
  await act(async () => {
    resolveStatus({
      complete: false, uploadUrl: 'https://upload.example/session', chunkBytes: 10 * 1024 * 1024,
      nextExpectedRanges: ['0-'],
    });
  });
  expect(uploadBrowserDirectGraphFile).not.toHaveBeenCalled();
});

test('unmount during fingerprinting suppresses stale mismatch state and authorization', async () => {
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(FINGERPRINTED));
  let resolveFingerprint;
  fingerprintPresentationMediaProofFile.mockImplementationOnce(() => new Promise((resolve) => {
    resolveFingerprint = resolve;
  }));
  const view = render(<PresentationMediaProofHarness />);
  await screen.findByText(/An unfinished proof upload was found/);
  await selectFile();
  fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
  await waitFor(() => expect(resolveFingerprint).toBeDefined());

  view.unmount();
  await act(async () => { resolveFingerprint('different-sha256'); });

  expect(requestJson).not.toHaveBeenCalled();
  expect(uploadBrowserDirectGraphFile).not.toHaveBeenCalled();
});

test('Pause is disabled during status preflight and enabled only for the upload stream', async () => {
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(FINGERPRINTED));
  let resolveStatus;
  requestJson.mockImplementationOnce(() => new Promise((resolve) => { resolveStatus = resolve; }));
  uploadBrowserDirectGraphFile.mockImplementationOnce(async () => new Promise(() => {}));
  render(<PresentationMediaProofHarness />);
  await screen.findByText(/An unfinished proof upload was found/);
  await selectFile();
  fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
  await waitFor(() => expect(requestJson).toHaveBeenCalled());
  expect(screen.getByRole('button', { name: 'Pause after chunk' })).toBeDisabled();

  await act(async () => {
    resolveStatus({
      complete: false, uploadUrl: 'https://upload.example/session', chunkBytes: 10 * 1024 * 1024,
      nextExpectedRanges: ['0-'],
    });
  });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Pause after chunk' })).toBeEnabled());
});

test('a recovered upload clears stale Reconnecting copy when PUT progress resumes', async () => {
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(FINGERPRINTED));
  requestJson.mockResolvedValueOnce({
    complete: false, uploadUrl: 'https://upload.example/session', chunkBytes: 10 * 1024 * 1024,
    nextExpectedRanges: ['0-'], expiresAt: '2026-09-22T13:30:00.000Z',
  });
  let finishUpload;
  uploadBrowserDirectGraphFile.mockImplementationOnce(async ({ onState }) => {
    onState({
      phase: 'reconnecting', reason: 'backoff', confirmedBytes: 0, inFlightBytes: 0,
      totalBytes: 60_000_000, percent: 0, mbps: null, etaSeconds: null,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    onState({
      phase: 'uploading', confirmedBytes: 0, inFlightBytes: 1,
      totalBytes: 60_000_000, percent: 0, mbps: null, etaSeconds: null,
    });
    return new Promise((resolve) => { finishUpload = resolve; });
  });
  render(<PresentationMediaProofHarness />);
  await screen.findByText(/An unfinished proof upload was found/);
  await selectFile();
  fireEvent.click(screen.getByRole('button', { name: 'Resume' }));

  await screen.findByText(/Reconnecting through a fresh authorized Graph status check/);
  await screen.findByText(/Uploading directly from this browser to Microsoft/);
  expect(screen.queryByText(/Reconnecting through a fresh authorized Graph status check/)).not.toBeInTheDocument();
  await act(async () => {
    finishUpload({ complete: false, paused: true, reason: 'requested', nextStart: 0 });
  });
});

test('an older permit without a fingerprint remains available for cleanup but cannot resume', async () => {
  render(<PresentationMediaProofHarness />);
  await screen.findByText(/An unfinished proof upload was found/);
  await selectFile();
  fireEvent.click(screen.getByRole('button', { name: 'Resume' }));

  await screen.findByText(/older proof has no file fingerprint/);
  expect(requestJson).not.toHaveBeenCalled();
  expect(JSON.parse(window.sessionStorage.getItem(STORAGE_KEY))).toEqual(SAVED);
});

test('renders Graph-confirmed and in-flight bytes separately and hides ETA while reconnecting', async () => {
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(FINGERPRINTED));
  requestJson.mockResolvedValueOnce({
    complete: false, uploadUrl: 'https://upload.example/session', chunkBytes: 10 * 1024 * 1024,
    nextExpectedRanges: ['10485760-'], expiresAt: '2026-09-22T13:30:00.000Z',
  });
  uploadBrowserDirectGraphFile.mockImplementationOnce(async ({ onState }) => {
    onState({
      phase: 'uploading', confirmedBytes: 10 * 1024 * 1024, inFlightBytes: 15 * 1024 * 1024,
      totalBytes: 60_000_000, percent: (10 * 1024 * 1024 / 60_000_000) * 100,
      mbps: 12.5, etaSeconds: 20, expiresAt: '2026-09-22T13:30:00.000Z',
    });
    onState({
      phase: 'reconnecting', reason: 'backoff', confirmedBytes: 10 * 1024 * 1024,
      inFlightBytes: 10 * 1024 * 1024, totalBytes: 60_000_000,
      percent: (10 * 1024 * 1024 / 60_000_000) * 100, mbps: 12.5, etaSeconds: null,
      expiresAt: '2026-09-22T14:00:00.000Z',
    });
    onState({
      phase: 'paused', reason: 'retry_exhausted', confirmedBytes: 10 * 1024 * 1024,
      inFlightBytes: 10 * 1024 * 1024, totalBytes: 60_000_000,
      percent: (10 * 1024 * 1024 / 60_000_000) * 100, mbps: 12.5, etaSeconds: null,
      expiresAt: '2026-09-22T14:00:00.000Z',
    });
    return { complete: false, paused: true, reason: 'retry_exhausted', nextStart: 10 * 1024 * 1024 };
  });
  render(<PresentationMediaProofHarness />);
  await screen.findByText(/An unfinished proof upload was found/);
  await selectFile();
  fireEvent.click(screen.getByRole('button', { name: 'Resume' }));

  await screen.findByText(/three attempts without Graph-confirmed progress/);
  expect(screen.getByText(/Confirmed: 10.0 MB/)).toBeInTheDocument();
  expect(screen.getByText(/In flight: 0.0 MB/)).toBeInTheDocument();
  expect(screen.getByText('ETA unavailable while the upload is not advancing')).toBeInTheDocument();
  expect(screen.queryByText(/12.50 Mbps/)).not.toBeInTheDocument();
  expect(screen.getByLabelText(/Graph-confirmed/)).toHaveAttribute('aria-label', expect.stringContaining('17%'));
  expect(screen.getByText(`Last Graph-reported session expiry: ${new Date('2026-09-22T14:00:00.000Z').toLocaleString()}.`)).toBeInTheDocument();
});
