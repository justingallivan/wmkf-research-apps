/**
 * pages/external/briefing/[token].js — fail-closed reasons, writeup placeholder,
 * empty reviews, unscheduled session, and the https-only meeting link.
 *
 * @jest-environment jsdom
 */
import { render, screen, waitFor } from '@testing-library/react';
import BriefingPage from '../../pages/external/briefing/[token]';

jest.mock('next/router', () => ({ useRouter: () => ({ query: { token: 'tok' } }) }));
jest.mock('next/head', () => ({ __esModule: true, default: ({ children }) => <>{children}</> }));

function response(body, status = 200) {
  return { ok: status < 300, status, json: async () => body };
}

afterEach(() => jest.restoreAllMocks());

test('a revoked link shows the replacement message', async () => {
  global.fetch = jest.fn().mockResolvedValue(response({ ok: false, reason: 'revoked' }, 401));
  render(<BriefingPage />);
  await screen.findByText(/This link was replaced/);
  expect(global.fetch).toHaveBeenCalledWith('/api/external/briefing/tok/context');
});

test('renders the placeholder states before any share, review, or schedule exists', async () => {
  global.fetch = jest.fn().mockResolvedValue(response({
    ok: true, title: 'Example University', proposalTitle: 'Quantum Widgets', expiresAt: '2026-10-08T20:00:00Z',
    session: null, siteVisit: null, writeup: null, reviews: [], proposal: null,
  }));
  render(<BriefingPage />);
  await screen.findByText('Example University');
  expect(screen.getByText('Quantum Widgets')).toBeInTheDocument();
  expect(screen.getAllByText('Not yet scheduled')).toHaveLength(2);
  expect(screen.getByText(/The writeup will appear here once staff share it/)).toBeInTheDocument();
  expect(screen.getByText(/No completed reviews yet/)).toBeInTheDocument();
  expect(screen.getByText(/The proposal is not available/)).toBeInTheDocument();
  expect(screen.queryByText('Join meeting')).toBeNull();
});

test.each(['http://zoom.example/j/1', '//zoom.example/j/1', 'javascript:alert(1)', 'ftp://x', 'not a url'])('never renders a meeting link for %s', async (meetingLink) => {
  global.fetch = jest.fn().mockResolvedValue(response({
    ok: true, title: 'Example University', proposalTitle: null, expiresAt: null,
    session: { scheduledStart: '2026-09-16T17:00:00Z', timeZone: 'America/Los_Angeles', meetingLink },
    siteVisit: null, writeup: null, reviews: [], proposal: null,
  }));
  render(<BriefingPage />);
  await screen.findByText('Example University');
  expect(screen.queryByText('Join meeting')).toBeNull();
});

test('renders an https meeting link', async () => {
  global.fetch = jest.fn().mockResolvedValue(response({
    ok: true, title: 'Example University', proposalTitle: null, expiresAt: null,
    session: { scheduledStart: '2026-09-16T17:00:00Z', timeZone: 'America/Los_Angeles', meetingLink: 'https://zoom.example/j/1' },
    siteVisit: null, writeup: null, reviews: [], proposal: null,
  }));
  render(<BriefingPage />);
  await screen.findByText('Join meeting');
  expect(screen.getByText('Join meeting').closest('a')).toHaveAttribute('href', 'https://zoom.example/j/1');
});

test('links every member through the document route and only renders an https meeting link', async () => {
  global.fetch = jest.fn().mockResolvedValue(response({
    ok: true, title: 'Example University', proposalTitle: null, expiresAt: null,
    session: { scheduledStart: '2026-09-16T17:00:00Z', timeZone: 'America/Los_Angeles', meetingLink: 'javascript:alert(1)' },
    siteVisit: { scheduledStart: '2026-10-01T16:00:00Z' },
    writeup: { docx: null, pdf: { member: 'writeup-pdf', filename: 'PreSite_1002379.pdf', size: 4096 }, sharedAt: '2026-09-09T01:00:00Z' },
    reviews: [{ id: 'r1', reviewerName: 'Ada Lovelace', affiliation: 'Analytical Engines', receivedAt: '2026-09-01T10:00:00Z', answers: [{ questionText: 'Strengths?', answerHtml: '<p>Strong</p>' }], file: { member: 'review:r1', filename: 'review.pdf' } }],
    proposal: { member: 'proposal', filename: 'Proposal_1002379.pdf', size: 100 },
  }));
  render(<BriefingPage />);
  await screen.findByText('Ada Lovelace');
  expect(screen.getByText('PreSite_1002379.pdf').closest('a')).toHaveAttribute('href', '/api/external/briefing/tok/document?member=writeup-pdf');
  expect(screen.getByText('Open uploaded review').closest('a')).toHaveAttribute('href', '/api/external/briefing/tok/document?member=review%3Ar1');
  expect(screen.getByText('Proposal_1002379.pdf').closest('a')).toHaveAttribute('href', '/api/external/briefing/tok/document?member=proposal');
  expect(screen.getByText('Strong')).toBeInTheDocument();
  expect(screen.queryByText('Join meeting')).toBeNull();
  await waitFor(() => expect(screen.getByText(/Reviews \(1\)/)).toBeInTheDocument());
});

test('site visit materials list by label; oversize files show without a link', async () => {
  global.fetch = jest.fn().mockResolvedValue(response({
    ok: true, title: 'Example University', proposalTitle: null, expiresAt: null,
    session: null, siteVisit: null, writeup: null, reviews: [], proposal: null,
    materials: [
      { member: 'material:55555555-5555-4555-8555-555555555555', label: 'Applicant Slides', filename: 'Applicant Slides.pdf', size: 2048, available: true },
      { member: 'material:66666666-6666-4666-8666-666666666666', label: 'Recording', filename: 'Visit.mp4', size: 900 * 1024 * 1024, available: false },
    ],
  }));
  render(<BriefingPage />);
  const slides = await screen.findByRole('link', { name: 'Applicant Slides.pdf' });
  expect(slides).toHaveAttribute('href', '/api/external/briefing/tok/document?member=material%3A55555555-5555-4555-8555-555555555555');
  expect(screen.getByText('Applicant Slides:')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Visit.mp4' })).not.toBeInTheDocument();
  expect(screen.getByText(/Visit\.mp4/)).toBeInTheDocument();
  expect(screen.getByText(/too large to open here/)).toBeInTheDocument();
});
