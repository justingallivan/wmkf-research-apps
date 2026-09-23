/** @jest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PresentationMediaProofHarness from '../../shared/components/meeting-tracker/PresentationMediaProofHarness';
import { requestJson } from '../../shared/utils/api-request';
import { fingerprintPresentationMediaProofFile, uploadPresentationMediaProofFile } from '../../shared/utils/presentation-media-proof-upload';

jest.mock('../../shared/utils/api-request', () => ({ requestJson: jest.fn() }));
jest.mock('../../shared/utils/presentation-media-proof-upload', () => ({
  ...jest.requireActual('../../shared/utils/presentation-media-proof-upload'),
  fingerprintPresentationMediaProofFile: jest.fn(),
  uploadPresentationMediaProofFile: jest.fn(),
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
  uploadPresentationMediaProofFile.mockResolvedValue({ complete: false, nextStart: 655360 });
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

  await waitFor(() => expect(uploadPresentationMediaProofFile).toHaveBeenCalledWith(expect.objectContaining({
    file: SELECTED_FILE, start: 655360, uploadUrl: 'https://upload.example/session',
  })));
  expect(fingerprintPresentationMediaProofFile).toHaveBeenCalledWith(SELECTED_FILE);
  expect(requestJson).toHaveBeenCalledWith('/api/meeting-tracker/presentation-media-proof', expect.objectContaining({
    body: { action: 'status', permit: SAVED.permit },
  }));
  expect(JSON.parse(window.sessionStorage.getItem(STORAGE_KEY)).expiresAt).toBe('2026-09-22T13:30:00.000Z');
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
  expect(uploadPresentationMediaProofFile).not.toHaveBeenCalled();
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
  expect(uploadPresentationMediaProofFile).not.toHaveBeenCalled();
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
