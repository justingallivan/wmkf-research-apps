/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const DOC = '99999999-9999-4999-8999-999999999999';
const routerState = { query: { request: REQUEST_ID, document: DOC }, isReady: true };
const access = { grants: ['reviewers'], isLoading: false, error: null };

jest.mock('next/router', () => ({ useRouter: () => routerState }));
jest.mock('../../shared/components/Layout', () => ({ __esModule: true, default: ({ children }) => <div>{children}</div> }));
jest.mock('../../shared/context/AppAccessContext', () => ({
  useAppAccess: () => ({
    isLoading: access.isLoading, error: access.error, refreshAccess: jest.fn(),
    hasAccess: (key) => access.grants.includes(key),
  }),
}));

import ReadPage from '../../pages/workbench/read.js';

function reply(status, body) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, headers: { get: () => 'application/json' },
    json: async () => body, text: async () => JSON.stringify(body) });
}

beforeEach(() => {
  access.grants = ['reviewers'];
  access.isLoading = false;
  routerState.query = { request: REQUEST_ID, document: DOC };
  global.fetch = jest.fn();
});

test('a summary renders with its headings, AI-generated label and SharePoint link, from the text route', async () => {
  global.fetch.mockReturnValue(reply(200, {
    ok: true, request: { number: '1003222', title: 'Quantum materials' },
    item: { kind: 'summary', summaryKind: 'discussion', label: 'Staff Discussion Summary', publishedAt: '2026-10-10T15:00:00Z', stale: true },
    text: 'Main points raised\nAims are ambitious.\n\nQuestions and concerns\nIs the budget high?\n\nFollow-ups and decisions\nNone noted.',
    links: { sharePoint: 'https://tenant.sharepoint.com/s.txt' },
  }));
  render(<ReadPage />);
  expect(await screen.findByRole('heading', { level: 1, name: 'Post-presentation discussion summary' })).toBeInTheDocument();
  expect(global.fetch.mock.calls[0][0]).toBe(`/api/workbench/site-visit/presentation-text?requestId=${REQUEST_ID}&documentId=${DOC}`);
  expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent))
    .toEqual(['Main points raised', 'Questions and concerns', 'Follow-ups and decisions']);
  expect(screen.getByText('AI-generated')).toBeInTheDocument();
  expect(screen.getByText('Staff only. Never included on the Board page.')).toBeInTheDocument();
  expect(screen.getByText('Made from an earlier transcript version.')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Request 1003222 · Quantum materials/ })).toHaveAttribute('href', `/workbench/${REQUEST_ID}?tab=staff-deliberations`);
  expect(screen.getByRole('link', { name: /Open in SharePoint/ })).toHaveAttribute('href', 'https://tenant.sharepoint.com/s.txt');
});

test('a transcript renders as timed speaker turns without the AI label', async () => {
  global.fetch.mockReturnValue(reply(200, {
    ok: true, request: { number: '1003222', title: 'Quantum materials' },
    item: { kind: 'transcript', summaryKind: null, label: 'Presentation Transcript', publishedAt: null, stale: false },
    text: '[00:00] Jane Doe: Thank you.\n\n[00:42] A. Smith: A question.', links: { sharePoint: null },
  }));
  render(<ReadPage />);
  expect(await screen.findByText('Jane Doe')).toBeInTheDocument();
  expect(screen.getByText('00:42')).toBeInTheDocument();
  expect(screen.queryByText('AI-generated')).not.toBeInTheDocument();
});

test('a refused file says why, keeps the request identity, and offers SharePoint without Retry', async () => {
  global.fetch.mockReturnValue(reply(415, {
    ok: false, reason: 'unsupported_format', request: { number: '1003222', title: 'Quantum materials' },
    item: { label: 'Transcript' }, links: { sharePoint: 'https://tenant.sharepoint.com/t.pdf' },
  }));
  render(<ReadPage />);
  expect(await screen.findByRole('alert')).toHaveTextContent('can only be opened in SharePoint');
  expect(screen.getByRole('heading', { level: 1, name: 'Transcript' })).toBeInTheDocument();
  expect(screen.getByText(/Request 1003222/)).toBeInTheDocument();
  expect(screen.getAllByRole('link', { name: /Open in SharePoint/ })[0]).toHaveAttribute('href', 'https://tenant.sharepoint.com/t.pdf');
  expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
});

test('an unexpected failure offers Retry, which reloads', async () => {
  global.fetch.mockReturnValueOnce(reply(500, { ok: false, reason: 'server_error' }))
    .mockReturnValueOnce(reply(200, { ok: true, request: null, item: { kind: 'transcript', label: 'Transcript' }, text: 'Words.', links: {} }));
  render(<ReadPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('Words.')).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledTimes(2);
});

test('a malformed link is refused without calling the route', async () => {
  routerState.query = { request: 'nope', document: DOC };
  render(<ReadPage />);
  expect(await screen.findByRole('alert')).toHaveTextContent('This link is incomplete.');
  expect(global.fetch).not.toHaveBeenCalled();
});

test('either grant opens the page; neither shows the access message; the Workbench link needs reviewers', async () => {
  global.fetch.mockImplementation(() => reply(200, { ok: true, request: { number: '1003222', title: 'T' }, item: { kind: 'transcript', label: 'Transcript' }, text: 'Words.', links: {} }));
  access.grants = ['meeting-tracker'];
  const view = render(<ReadPage />);
  expect(await screen.findByText('Words.')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /Request 1003222/ })).not.toBeInTheDocument();
  view.unmount();
  access.grants = [];
  render(<ReadPage />);
  await waitFor(() => expect(screen.queryByText('Words.')).not.toBeInTheDocument());
  expect(screen.getByText(/Access Not Available/i)).toBeInTheDocument();
});

// Labels are translated at the rendering boundary, without changing service metadata or content.
test.each([
  ['Transcript Summary', 'Presentation summary'],
  ['Staff Discussion Transcript', 'Post-presentation discussion transcript'],
  ['Custom saved label', 'Custom saved label'],
  ['Post-presentation discussion summary', 'Post-presentation discussion summary'],
])('renders %s without rewriting supplied content', async (legacy, expected) => {
  const text = 'Original Staff Discussion Summary words remain.';
  global.fetch.mockReturnValue(reply(200, { ok: true, item: { kind: 'transcript', label: legacy }, text, links: {} }));
  render(<ReadPage />);
  expect(await screen.findByRole('heading', { level: 1, name: expected })).toBeInTheDocument();
  expect(screen.getByText(text)).toBeInTheDocument();
});

test.each([[415, 'unsupported_format'], [413, 'too_large'], [503, 'integrity_failed']])('keeps the known label and SharePoint fallback on %s refusal', async (status, reason) => {
  global.fetch.mockReturnValue(reply(status, { ok: false, reason, item: { label: 'Staff Discussion Summary' }, links: { sharePoint: 'https://tenant.sharepoint.com/unchanged.txt' } }));
  render(<ReadPage />);
  expect(await screen.findByRole('heading', { level: 1, name: 'Post-presentation discussion summary' })).toBeInTheDocument();
  expect(screen.getAllByRole('link', { name: /Open in SharePoint/ })[0]).toHaveAttribute('href', 'https://tenant.sharepoint.com/unchanged.txt');
  expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
});
