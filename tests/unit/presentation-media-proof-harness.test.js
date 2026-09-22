/** @jest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PresentationMediaProofHarness from '../../shared/components/meeting-tracker/PresentationMediaProofHarness';
import { requestJson } from '../../shared/utils/api-request';

jest.mock('../../shared/utils/api-request', () => ({ requestJson: jest.fn() }));

const STORAGE_KEY = 'wmkf:presentation-media-proof-upload';
const SAVED = {
  permit: 'encrypted-permit',
  requestId: '11111111-1111-4111-8111-111111111111',
  file: { name: 'Zoom recording.mp4', size: 60_000_000, lastModified: 1_790_000_000_000 },
  expiresAt: '2026-09-22T13:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
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
