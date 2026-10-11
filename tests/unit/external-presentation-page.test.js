/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PresentationMaterialsPage from '../../pages/external/presentation/[token].js';
import { requestJson } from '../../shared/utils/api-request.js';

jest.mock('next/router', () => ({ useRouter: () => ({ query: { token: 'presentation-token' } }) }));
jest.mock('../../shared/utils/api-request', () => ({ requestJson: jest.fn() }));

const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const SLIDES_PDF = { member: 'material:11111111-1111-4111-8111-111111111111', kind: 'slides', label: 'Applicant Slides', filename: '1003222 Site Visit Presentation.pdf', contentType: 'application/pdf', size: 9_000_000, backing: 'file', canWatch: false, canDownload: true };
const SLIDES_PPTX = { member: 'material:22222222-2222-4222-8222-222222222222', kind: 'slides', label: 'Applicant Slides', filename: '1003222 Site Visit Presentation.pptx', contentType: PPTX, size: 35_000_000, backing: 'file', canWatch: false, canDownload: true };
const BIOS = { member: 'material:33333333-3333-4333-8333-333333333333', kind: 'other', label: 'Other Applicant Materials', filename: '1003222 Site Visit Participant Bios.docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 20_633, backing: 'file', canWatch: false, canDownload: true };
const VIDEO = { member: 'material:44444444-4444-4444-8444-444444444444', kind: 'video', label: 'Presentation Video', filename: '1003222-Presentation-Video-d957e094.mp4', contentType: 'video/mp4', size: 448_768_873, backing: 'file', canWatch: true, canDownload: true };
const SUMMARY = { member: 'material:55555555-5555-4555-8555-555555555555', kind: 'summary', label: 'Transcript Summary', filename: '1003222-Presentation-Summary-20261011-003346-v2.txt', contentType: 'text/plain; charset=utf-8', size: 7_981, backing: 'file', canWatch: false, canDownload: true,
  text: 'What was presented\nThe team studies X.\n\nQuestions and answers\nA staff member asked about cost.\n\nOpen points\nSend the budget breakdown.\n' };

function context(materials) {
  return { ok: true, title: 'Example University', proposalTitle: 'A proposal title', expiresAt: '2026-11-24T12:00:00.000Z', materials };
}

beforeEach(() => {
  jest.clearAllMocks();
  HTMLMediaElement.prototype.play = jest.fn(async () => undefined);
  HTMLMediaElement.prototype.load = jest.fn();
  requestJson.mockResolvedValue(context([SLIDES_PDF, BIOS, SLIDES_PPTX, SUMMARY, VIDEO]));
});

test('after the visit: video first, then the formatted summary, then one Slides item and the bios, with no filenames or sizes', async () => {
  render(<PresentationMaterialsPage />);
  expect(await screen.findByRole('heading', { level: 1, name: 'A proposal title' })).toBeInTheDocument();
  expect(screen.getByText('Example University · Research presentation')).toBeInTheDocument();
  const order = ['Watch the presentation', 'Summary', 'Slides and materials'].map((text) => screen.getByText(text));
  for (let i = 1; i < order.length; i += 1) {
    expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
  expect(screen.getByRole('heading', { level: 3, name: 'Questions and answers' })).toBeInTheDocument();
  expect(screen.getByText('Send the budget breakdown.').tagName).toBe('LI');
  expect(screen.getByText('Slides')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'View slides' })).toBeInTheDocument();
  const pptx = screen.getByRole('link', { name: 'Download PowerPoint' });
  expect(pptx.getAttribute('href')).toContain('/api/external/presentation/presentation-token/open?');
  expect(pptx.getAttribute('href')).toContain('mode=download');
  expect(screen.getByText('Site Visit Participant Bios')).toBeInTheDocument();
  const text = document.body.textContent;
  for (const hidden of ['.pdf', '.pptx', '.docx', '.mp4', '.txt', 'MB', 'bytes', '1003222', 'Transcript Summary', 'Applicant Slides']) {
    expect(text).not.toContain(hidden);
  }
  expect(screen.queryByText(/will be added after the site visit/)).not.toBeInTheDocument();
  expect(screen.getByText('This link expires November 24, 2026.')).toBeInTheDocument();
});

test('before the visit: one quiet line where the video goes, then slides and bios', async () => {
  requestJson.mockResolvedValueOnce(context([BIOS, SLIDES_PPTX, SLIDES_PDF]));
  render(<PresentationMaterialsPage />);
  expect(await screen.findByText('The presentation recording and summary will be added after the site visit.')).toBeInTheDocument();
  expect(screen.queryByText('Watch the presentation')).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Summary' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'View slides' })).toBeInTheDocument();
  expect(screen.getByText('Site Visit Participant Bios')).toBeInTheDocument();
});

test('PowerPoint-only slides offer one Download slides action', async () => {
  requestJson.mockResolvedValueOnce(context([SLIDES_PPTX]));
  render(<PresentationMaterialsPage />);
  const link = await screen.findByRole('link', { name: 'Download slides' });
  expect(link.getAttribute('href')).toContain('mode=download');
  expect(screen.queryByRole('button', { name: 'View slides' })).not.toBeInTheDocument();
});

test('a summary the server could not verify offers the file instead of text', async () => {
  requestJson.mockResolvedValueOnce(context([{ ...SUMMARY, text: null }]));
  render(<PresentationMaterialsPage />);
  expect(await screen.findByText(/The summary could not be shown here/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Download the summary' }).getAttribute('href')).toContain('mode=download');
  expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument();
});

test('View slides opens the PDF in a new tab as a local copy (Microsoft serves files as downloads)', async () => {
  const tab = { closed: false, location: { href: '' }, close: jest.fn() };
  window.open = jest.fn(() => tab);
  global.fetch = jest.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) }));
  URL.createObjectURL = jest.fn(() => 'blob:local-slides');
  URL.revokeObjectURL = jest.fn();
  render(<PresentationMaterialsPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'View slides' }));
  expect(window.open).toHaveBeenCalledWith('', '_blank');
  await waitFor(() => expect(tab.location.href).toBe('blob:local-slides'));
  expect(global.fetch.mock.calls[0][0]).toContain('mode=open');
  expect(URL.createObjectURL.mock.calls[0][0].type).toBe('application/pdf');
});

test('a failed slides fetch closes the blank tab and says what to do', async () => {
  const tab = { closed: false, location: { href: '' }, close: jest.fn() };
  window.open = jest.fn(() => tab);
  global.fetch = jest.fn(async () => ({ ok: false, status: 404 }));
  render(<PresentationMaterialsPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'View slides' }));
  expect(await screen.findByText('The slides could not be opened. Try again, or download them.')).toBeInTheDocument();
  expect(tab.close).toHaveBeenCalled();
});

test.each([429, 503])('temporary context status %s asks the holder to retry', async (status) => {
  requestJson.mockRejectedValueOnce(Object.assign(new Error('temporary'), { status }));
  render(<PresentationMaterialsPage />);
  expect(await screen.findByText('Presentation materials are temporarily unavailable. Try again shortly.')).toBeInTheDocument();
  expect(screen.queryByText('This presentation link is unavailable or has expired.')).not.toBeInTheDocument();
});

test('one playback error re-resolves and restores position; a second exposes Resume', async () => {
  render(<PresentationMaterialsPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Watch the presentation' }));
  const video = document.querySelector('video');
  await waitFor(() => expect(video.src).toContain('attempt=1'));
  expect(video.src).toContain('mode=watch');
  expect(screen.getByRole('status')).toHaveTextContent('Loading the video');
  fireEvent.playing(video);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  Object.defineProperty(video, 'duration', { configurable: true, value: 200 });
  video.currentTime = 80;
  fireEvent.timeUpdate(video);
  fireEvent.error(video);
  await waitFor(() => expect(video.src).toContain('attempt=2'));
  fireEvent.loadedMetadata(video);
  expect(video.currentTime).toBe(80);
  fireEvent.playing(video);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  fireEvent.error(video);
  expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
});

test('expired or revoked context fails closed without rendering material names', async () => {
  requestJson.mockRejectedValueOnce(new Error('expired'));
  render(<PresentationMaterialsPage />);
  expect(await screen.findByText('This presentation link is unavailable or has expired.')).toBeInTheDocument();
  expect(screen.queryByText('Slides')).not.toBeInTheDocument();
});
