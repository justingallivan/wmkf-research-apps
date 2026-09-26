/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PresentationMaterialsPage from '../../pages/external/presentation/[token].js';
import { requestJson } from '../../shared/utils/api-request.js';

jest.mock('next/router', () => ({ useRouter: () => ({ query: { token: 'presentation-token' } }) }));
jest.mock('../../shared/utils/api-request', () => ({ requestJson: jest.fn() }));

beforeEach(() => {
  jest.clearAllMocks();
  HTMLMediaElement.prototype.play = jest.fn(async () => undefined);
  HTMLMediaElement.prototype.load = jest.fn();
  requestJson.mockResolvedValue({
    ok: true,
    title: 'Example University',
    proposalTitle: 'A proposal title',
    expiresAt: '2026-11-24T12:00:00.000Z',
    materials: [
      { member: 'material:11111111-1111-4111-8111-111111111111', label: 'Applicant Slides', filename: 'slides.pdf', backing: 'file', canWatch: false, canDownload: true },
      { member: 'material:22222222-2222-4222-8222-222222222222', label: 'Recording', filename: 'recording.mp4', backing: 'file', canWatch: true, canDownload: true, size: 90_000_000 },
    ],
  });
});

test('renders only the minimal materials model with token-checked Download links', async () => {
  render(<PresentationMaterialsPage />);
  expect(await screen.findByRole('heading', { name: 'Research presentation materials' })).toBeInTheDocument();
  expect(screen.getByText('Example University')).toBeInTheDocument();
  const download = screen.getAllByRole('link', { name: 'Download' })[0];
  expect(download.getAttribute('href')).toContain('/api/external/presentation/presentation-token/open?');
  expect(download.getAttribute('href')).toContain('mode=download');
  expect(screen.queryByRole('link', { name: 'Open' })).not.toBeInTheDocument();
  expect(document.body.textContent).not.toContain('request number');
  expect(document.body.textContent).not.toContain('Staff Brief');
  expect(document.body.textContent).not.toContain('Consultant feedback');
});

test.each([429, 503])('temporary context status %s asks the holder to retry', async (status) => {
  requestJson.mockRejectedValueOnce(Object.assign(new Error('temporary'), { status }));
  render(<PresentationMaterialsPage />);
  expect(await screen.findByText('Presentation materials are temporarily unavailable. Try again shortly.')).toBeInTheDocument();
  expect(screen.queryByText('This presentation link is unavailable or has expired.')).not.toBeInTheDocument();
});

test('one playback error re-resolves and restores position; a second exposes manual Resume watch', async () => {
  render(<PresentationMaterialsPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Watch recording' }));
  const video = document.querySelector('video');
  await waitFor(() => expect(video.src).toContain('attempt=1'));
  Object.defineProperty(video, 'duration', { configurable: true, value: 200 });
  video.currentTime = 80;
  fireEvent.timeUpdate(video);
  fireEvent.error(video);
  await waitFor(() => expect(video.src).toContain('attempt=2'));
  fireEvent.loadedMetadata(video);
  expect(video.currentTime).toBe(80);
  fireEvent.error(video);
  expect(screen.getByRole('button', { name: 'Resume watch' })).toBeInTheDocument();
});

test('expired or revoked context fails closed without rendering material names', async () => {
  requestJson.mockRejectedValueOnce(new Error('expired'));
  render(<PresentationMaterialsPage />);
  expect(await screen.findByText('This presentation link is unavailable or has expired.')).toBeInTheDocument();
  expect(screen.queryByText('slides.pdf')).not.toBeInTheDocument();
});
