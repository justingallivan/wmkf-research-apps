/** @jest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PresentationMediaProofPage from '../../pages/external/presentation-media-proof/[token]';
import { requestJson } from '../../shared/utils/api-request';

jest.mock('next/router', () => ({ useRouter: () => ({ query: { token: 'signed-proof' } }) }));
jest.mock('../../shared/utils/api-request', () => ({ requestJson: jest.fn() }));

beforeEach(() => {
  jest.clearAllMocks();
  HTMLMediaElement.prototype.play = jest.fn(async () => undefined);
  HTMLMediaElement.prototype.load = jest.fn();
  requestJson.mockResolvedValue({
    ok: true, filename: 'Recording.mp4', size: 60_000_000,
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
  });
});

test('one media error re-resolves the 302 and restores the last confirmed seek position', async () => {
  render(<PresentationMediaProofPage />);
  await screen.findByText('Recording.mp4');
  fireEvent.click(screen.getByRole('button', { name: 'Watch' }));
  const video = document.querySelector('video');
  Object.defineProperty(video, 'duration', { configurable: true, value: 200 });
  video.currentTime = 90;
  fireEvent.timeUpdate(video);
  fireEvent.error(video);

  await waitFor(() => expect(video.src).toContain('attempt=2'));
  fireEvent.loadedMetadata(video);
  expect(video.currentTime).toBe(90);
  expect(screen.getByText(/Application resolver actions from this page: 2/)).toBeInTheDocument();
  fireEvent.error(video);
  expect(screen.getByRole('button', { name: 'Resume Watch' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Resume Watch' }));
  await waitFor(() => expect(video.src).toContain('attempt=3'));
});

test('expired proof token fails closed and directs staff to mint a fresh link', async () => {
  requestJson.mockResolvedValueOnce({
    ok: true, filename: 'Recording.mp4', size: 60_000_000,
    expiresAt: new Date(Date.now() - 1_000).toISOString(),
  });
  render(<PresentationMediaProofPage />);
  await screen.findByText('Recording.mp4');
  fireEvent.click(screen.getByRole('button', { name: 'Watch' }));
  expect(await screen.findByText(/five-minute proof token expired/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Staff proof harness/ })).toHaveAttribute('href', '/meeting-tracker/presentation-media-proof');
  expect(requestJson).toHaveBeenCalledTimes(1);
});
