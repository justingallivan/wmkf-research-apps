/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import IntegrityTab from '../../shared/components/workbench/IntegrityTab';
import { requestEnvelope } from '../../shared/utils/api-request';

jest.mock('../../shared/utils/api-request', () => ({ requestEnvelope: jest.fn() }));
jest.mock('../../shared/components/Layout', () => ({
  Card: ({ children }) => <section>{children}</section>,
  Button: ({ children, loading, ...props }) => <button {...props}>{children}</button>,
}));

const requestId = 'request-a';
const person = { contactId: 'contact-a', name: 'Ada Example', institution: 'North University', role: 'PI' };
const completeResult = {
  name: person.name,
  institution: person.institution,
  matchCount: 0,
  hasConcerns: false,
  sources: {
    retraction_watch: { searched: true, matches: [], error: null },
    pubpeer: { searched: true, summary: 'No relevant results.', hasConcerns: false, error: null },
    news: { searched: true, summary: 'No relevant results.', hasConcerns: false, resultCount: 0, error: null },
  },
};
const savedRun = { id: 'run-a', createdAt: '2026-09-26T18:00:00Z', matchCount: 0, results: [completeResult] };
const loaded = { requestId, people: [person], latestRun: savedRun };
const ok = (data) => ({ ok: true, status: 200, data });

beforeEach(() => {
  requestEnvelope.mockReset();
  window.confirm = jest.fn(() => true);
  requestEnvelope.mockResolvedValue(ok(loaded));
});

test('shows current PI/Co-PI list and latest result, marking errors or unsearched sources incomplete', async () => {
  const incomplete = {
    ...completeResult,
    hasConcerns: false,
    sources: {
      ...completeResult.sources,
      pubpeer: { searched: false, error: 'SERP API key not configured' },
    },
  };
  requestEnvelope.mockResolvedValue(ok({ ...loaded, latestRun: { ...savedRun, results: [incomplete] } }));
  render(<IntegrityTab requestId={requestId} />);
  expect((await screen.findAllByText('Ada Example')).length).toBeGreaterThan(0);
  expect(screen.getByText('North University')).toBeInTheDocument();
  expect(screen.getByText('Incomplete screen')).toBeInTheDocument();
  expect(screen.getByText('Not searched · error')).toBeInTheDocument();
  expect(screen.queryByText('No concerns reported')).toBeNull();
});

test('renders Retraction Watch persisted fields and safe semicolon-separated source links', async () => {
  const match = {
    title: 'A retracted study', authors: 'Ada Example; Coauthor', matchedAuthor: 'Ada Example',
    doi: '10.1000/example', confidence: 92, confidenceLevel: 'high', retractionNature: 'Retraction',
    reasons: ['Data issues', 'Image concern'], urls: 'https://retraction.example/one; javascript:alert(1);https://retraction.example/two',
  };
  const result = {
    ...completeResult,
    isCommonName: true,
    hasConcerns: true,
    matchCount: 1,
    sources: { ...completeResult.sources, retraction_watch: { searched: true, matches: [match], error: null } },
  };
  requestEnvelope.mockResolvedValue(ok({ ...loaded, latestRun: { ...savedRun, matchCount: 1, results: [result] } }));
  render(<IntegrityTab requestId={requestId} />);
  expect(await screen.findByText('A retracted study')).toBeInTheDocument();
  expect(screen.getByText(/Match confidence: high \(92%\)/)).toBeInTheDocument();
  expect(screen.getByText('Matched author: Ada Example')).toBeInTheDocument();
  expect(screen.getByText('Action: Retraction')).toBeInTheDocument();
  expect(screen.getByText('Reasons: Data issues, Image concern')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '10.1000/example' })).toHaveAttribute('href', 'https://doi.org/10.1000/example');
  expect(screen.getByText('Common name — verify identity carefully')).toBeInTheDocument();
  expect(screen.getAllByRole('link', { name: 'View Source' })).toHaveLength(2);
  expect(screen.getByText('1 item for human review')).toBeInTheDocument();
});

test('keeps concerns visible on incomplete results and honors source concerns without a result count', async () => {
  const result = {
    ...completeResult,
    hasConcerns: true,
    matchCount: 2,
    sources: {
      ...completeResult.sources,
      pubpeer: { searched: true, hasConcerns: true, resultCount: 0, summary: 'Review flag', error: null },
      news: { searched: false, hasConcerns: true, error: 'Source unavailable' },
    },
  };
  requestEnvelope.mockResolvedValue(ok({ ...loaded, latestRun: { ...savedRun, results: [result] } }));
  render(<IntegrityTab requestId={requestId} />);
  expect(await screen.findByText('2 items for human review · Incomplete screen')).toBeInTheDocument();
  expect(screen.getByText('Flagged for human review · 0 search results')).toBeInTheDocument();
});

test('empty request people are explained and cannot be screened', async () => {
  requestEnvelope.mockResolvedValue(ok({ requestId, people: [], latestRun: null }));
  render(<IntegrityTab requestId={requestId} />);
  expect(await screen.findByText('No PI or Co-PI contacts were found for this request.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Run screen' })).toBeDisabled();
  expect(screen.getByText('No saved screen yet. Run a screen to see findings here.')).toBeInTheDocument();
});

test('canceling the credit confirmation makes no run request', async () => {
  window.confirm.mockReturnValue(false);
  render(<IntegrityTab requestId={requestId} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Run screen' }));
  expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Claude and SerpAPI credits for each person'));
  expect(requestEnvelope).toHaveBeenCalledTimes(1);
});

test('failed rerun preserves the saved result and exposes an error', async () => {
  requestEnvelope.mockResolvedValueOnce(ok(loaded)).mockResolvedValueOnce({
    ok: false, status: 504, data: { error: 'Gateway timeout' },
  }).mockResolvedValueOnce(ok({ ...loaded, latestRun: savedRun }));
  render(<IntegrityTab requestId={requestId} />);
  expect(await screen.findByText('No concerns reported')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Run screen' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Gateway timeout Completion may be uncertain. The previous saved screen is still shown; reload it before running again.');
  expect(screen.getByText('Latest saved screen')).toBeInTheDocument();
  expect(screen.getByText('No concerns reported')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Run screen' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Reload saved screen' }));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(screen.getByRole('button', { name: 'Run screen' })).toBeEnabled();
});

test('load failure is shown as unknown and can be retried', async () => {
  requestEnvelope.mockRejectedValueOnce(new Error('Network unavailable')).mockResolvedValueOnce(ok(loaded));
  render(<IntegrityTab requestId={requestId} />);
  expect(await screen.findByText(/people list and saved result are unknown/i)).toBeInTheDocument();
  expect(screen.queryByText('No PI or Co-PI contacts were found for this request.')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }));
  expect((await screen.findAllByText('Ada Example')).length).toBeGreaterThan(0);
});

test('a malformed or mismatched successful rerun keeps the previous saved screen', async () => {
  requestEnvelope.mockResolvedValueOnce(ok(loaded)).mockResolvedValueOnce(ok({
    requestId: 'some-other-request', people: [person], run: { ...savedRun },
  }));
  render(<IntegrityTab requestId={requestId} />);
  expect(await screen.findByText('No concerns reported')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Run screen' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Completion may be uncertain. The previous saved screen is still shown');
  expect(screen.getByText('No concerns reported')).toBeInTheDocument();
});

test('a person without a usable name is clearly identified and blocks screening', async () => {
  requestEnvelope.mockResolvedValue(ok({ requestId, people: [{ ...person, name: '   ' }], latestRun: null }));
  render(<IntegrityTab requestId={requestId} />);
  expect(await screen.findByText('Name unavailable')).toBeInTheDocument();
  expect(screen.getByText(/one person has no usable name/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Run screen' })).toBeDisabled();
});

test('a deferred response cannot replace fresh state after A to B to A navigation', async () => {
  let resolveOld;
  let requestACount = 0;
  requestEnvelope.mockImplementation((url) => {
    if (url.includes('request-a') && requestACount++ === 0) return new Promise((resolve) => { resolveOld = resolve; });
    if (url.includes('request-a')) return Promise.resolve(ok({ requestId: 'request-a', people: [{ ...person, name: 'Ari Fresh' }], latestRun: null }));
    return Promise.resolve(ok({ requestId: 'request-b', people: [{ ...person, name: 'Bea Current' }], latestRun: null }));
  });
  const view = render(<IntegrityTab requestId="request-a" />);
  view.rerender(<IntegrityTab requestId="request-b" />);
  expect(await screen.findByText('Bea Current')).toBeInTheDocument();
  view.rerender(<IntegrityTab requestId="request-a" />);
  expect(await screen.findByText('Ari Fresh')).toBeInTheDocument();
  resolveOld(ok({ ...loaded, people: [{ ...person, name: 'Ari Stale' }] }));
  await waitFor(() => expect(screen.queryByText('Ari Stale')).toBeNull());
  expect(screen.getByText('Ari Fresh')).toBeInTheDocument();
});
