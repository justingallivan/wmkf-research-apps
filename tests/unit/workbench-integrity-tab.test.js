/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import IntegrityTab from '../../shared/components/workbench/IntegrityTab';
import { requestEnvelope } from '../../shared/utils/api-request';

jest.mock('../../shared/utils/api-request', () => ({ requestEnvelope: jest.fn() }));
jest.mock('../../shared/components/Layout', () => ({
  Card: ({ children }) => <section>{children}</section>,
  Button: ({ children, loading, ...props }) => <button {...props} disabled={props.disabled || loading}>{children}</button>,
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
const savedRun = { id: 74, createdAt: '2026-09-26T18:00:00Z', matchCount: 0, results: [completeResult] };
const review = { status: 'needs_review', canReview: true, canApprove: true, reason: null, latestDecision: null };
const loaded = { requestId, people: [person], latestRun: savedRun, history: [savedRun], historyHasMore: false, historyNextBeforeId: null, review };
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
  requestEnvelope.mockResolvedValue(ok({ requestId, people: [], latestRun: null, history: [], historyHasMore: false, historyNextBeforeId: null, review: { status: 'not_screened', canReview: false, canApprove: false, reason: null, latestDecision: null } }));
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
  requestEnvelope.mockResolvedValue(ok({ ...loaded, people: [{ ...person, name: '   ' }], latestRun: null, history: [], review: { status: 'not_screened', canReview: false, canApprove: false, reason: null, latestDecision: null } }));
  render(<IntegrityTab requestId={requestId} />);
  expect(await screen.findByText('Name unavailable')).toBeInTheDocument();
  expect(screen.getByText(/one person has no usable name/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Run screen' })).toBeDisabled();
});

test('a named person whose contact record is gone blocks screening like a missing name', async () => {
  requestEnvelope.mockResolvedValue(ok({ ...loaded, people: [{ ...person, identityUnavailable: true }], latestRun: null, history: [], review: { status: 'identity_unavailable', canReview: false, canApprove: false, reason: null, latestDecision: null } }));
  render(<IntegrityTab requestId={requestId} />);
  expect(await screen.findByText(/one person has no usable name or Dataverse contact record/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Run screen' })).toBeDisabled();
});

test('shows the approved PD decision with its actor, timestamp, and staff-only note', async () => {
  const decision = { id: 92, screeningId: 74, decision: 'approved', notes: 'Reviewed the source context.', createdAt: '2026-09-26T19:00:00Z', reviewerProfileId: 1, reviewerName: 'Lead PD', reviewerSystemId: 'staff-a' };
  const approved = { ...loaded, latestRun: { ...savedRun, id: 74 }, history: [{ ...savedRun, id: 74, reviews: [decision] }], review: { status: 'approved', canReview: false, canApprove: false, reason: null, latestDecision: decision } };
  requestEnvelope.mockResolvedValue(ok(approved));
  render(<IntegrityTab requestId={requestId} />);
  expect(await screen.findByText('Integrity review complete')).toBeInTheDocument();
  expect(screen.getByText('Integrity review approved')).toBeInTheDocument();
  expect(screen.getByText(/Recorded by Lead PD/)).toBeInTheDocument();
  expect(screen.getByText('Reviewed the source context.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Record approval' })).toBeNull();
});

test('keeps earlier decisions for the latest screen visible as read-only audit history', async () => {
  const approved = { id: 92, screeningId: 74, decision: 'approved', notes: 'Reviewed.', createdAt: '2026-09-26T19:00:00Z', reviewerProfileId: 1, reviewerName: 'Lead PD', reviewerSystemId: 'staff-a' };
  const earlierHold = { id: 91, screeningId: 74, decision: 'hold', notes: 'Needed more context.', createdAt: '2026-09-26T18:30:00Z', reviewerProfileId: 1, reviewerName: 'Lead PD', reviewerSystemId: 'staff-a' };
  const context = { ...loaded, latestRun: { ...savedRun, id: 74 }, history: [{ ...savedRun, id: 74, reviews: [approved, earlierHold] }], review: { status: 'approved', canReview: false, canApprove: false, reason: null, latestDecision: approved } };
  requestEnvelope.mockResolvedValue(ok(context));
  render(<IntegrityTab requestId={requestId} />);
  expect(await screen.findByText('Integrity review complete')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Earlier decisions for this screen (1)'));
  expect(screen.getByText('Integrity review placed on hold')).toBeInTheDocument();
  expect(screen.getByText('Needed more context.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Place on hold' })).toBeNull();
});

test('approval sends the latest screening id and refreshes to the returned full review context', async () => {
  const decision = { id: 92, screeningId: 74, decision: 'approved', notes: '', createdAt: '2026-09-26T19:00:00Z', reviewerProfileId: 1, reviewerName: 'Lead PD', reviewerSystemId: 'staff-a' };
  const approved = { ...loaded, latestRun: { ...savedRun, id: 74 }, history: [{ ...savedRun, id: 74, reviews: [decision] }], review: { status: 'approved', canReview: false, canApprove: false, reason: null, latestDecision: decision } };
  requestEnvelope.mockResolvedValueOnce(ok({ ...loaded, latestRun: { ...savedRun, id: 74 } })).mockResolvedValueOnce(ok(approved));
  render(<IntegrityTab requestId={requestId} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Record approval' }));
  await screen.findByText('Integrity review complete');
  expect(requestEnvelope.mock.calls[1][0]).toBe(`/api/workbench/integrity/${requestId}/review`);
  expect(requestEnvelope.mock.calls[1][1]).toMatchObject({ method: 'POST', body: { screeningId: 74, decision: 'approved', notes: '' } });
});

test('stale roster or incomplete status blocks approval, and hold requires staff notes', async () => {
  const held = { id: 93, screeningId: 74, decision: 'hold', notes: 'Resolve changed roster first.', createdAt: '2026-09-26T19:15:00Z', reviewerProfileId: 1, reviewerName: 'Lead PD', reviewerSystemId: 'staff-a' };
  const response = { ...loaded, latestRun: { ...savedRun, id: 74 }, history: [{ ...savedRun, id: 74, reviews: [held] }], review: { status: 'hold', canReview: true, canApprove: false, reason: 'The people roster changed after this screen.', latestDecision: held } };
  requestEnvelope.mockResolvedValueOnce(ok({ ...loaded, latestRun: { ...savedRun, id: 74 }, review: { status: 'roster_changed', canReview: true, canApprove: false, reason: 'The people roster changed after this screen.', latestDecision: null } })).mockResolvedValueOnce(ok(response));
  render(<IntegrityTab requestId={requestId} />);
  expect(await screen.findByText('People roster changed')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Record approval' })).toBeDisabled();
  const holdButton = screen.getByRole('button', { name: 'Place on hold' });
  expect(holdButton).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Staff-only review notes'), { target: { value: 'Resolve changed roster first.' } });
  expect(holdButton).toBeEnabled();
  fireEvent.click(holdButton);
  await screen.findByText('Review on hold');
  expect(requestEnvelope.mock.calls[1][1].body).toEqual({ screeningId: 74, decision: 'hold', notes: 'Resolve changed roster first.' });
});

test('unauthorized viewer gets the backend reason without decision controls', async () => {
  requestEnvelope.mockResolvedValue(ok({ ...loaded, review: { status: 'needs_review', canReview: false, canApprove: false, reason: 'Only the lead Program Director can record this review.', latestDecision: null } }));
  render(<IntegrityTab requestId={requestId} />);
  expect(await screen.findByText('Only the lead Program Director can record this review.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Record approval' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Place on hold' })).toBeNull();
});

test('history paging appends older runs with read-only prior decisions', async () => {
  const priorDecision = { id: 81, screeningId: 55, decision: 'hold', notes: 'Earlier review note.', createdAt: '2026-08-26T19:00:00Z', reviewerProfileId: 1, reviewerName: 'Previous PD', reviewerSystemId: 'staff-old' };
  const prior = { id: 55, createdAt: '2026-08-26T18:00:00Z', matchCount: 1, results: [{ ...completeResult, name: 'Earlier Person' }], reviews: [priorDecision] };
  const older = { id: 2, createdAt: '2026-07-26T18:00:00Z', matchCount: 0, results: [{ ...completeResult, name: 'Oldest Person' }], reviews: [] };
  requestEnvelope.mockResolvedValueOnce(ok({ ...loaded, history: [savedRun, prior], historyHasMore: true, historyNextBeforeId: 2 })).mockResolvedValueOnce(ok({ ...loaded, history: [older], historyHasMore: false, historyNextBeforeId: null }));
  render(<IntegrityTab requestId={requestId} />);
  await screen.findByText('Latest saved screen');
  fireEvent.click(screen.getByText('Earlier screens (1+)'));
  fireEvent.click(screen.getByRole('button', { name: 'Load earlier screens' }));
  expect(await screen.findByText('Earlier screens (2)')).toBeInTheDocument();
  expect(requestEnvelope.mock.calls[1][0]).toContain('?beforeRunId=2');
  fireEvent.click(screen.getAllByText(/Screen from/)[0]);
  expect(await screen.findByText('Earlier Person')).toBeInTheDocument();
  expect(screen.getByText('Earlier review note.')).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'Record approval' })).toHaveLength(1);
  expect(screen.getByText('Oldest Person')).toBeInTheDocument();
});

test('a deferred approval response cannot restore approval after request navigation', async () => {
  let resolveApproval;
  const approved = { ...loaded, review: { status: 'approved', canReview: false, canApprove: false, reason: null, latestDecision: { id: 92, screeningId: 74, decision: 'approved', notes: '', createdAt: '2026-09-26T19:00:00Z', reviewerProfileId: 1, reviewerName: 'Lead PD', reviewerSystemId: 'staff-a' } } };
  requestEnvelope.mockImplementation((url, options) => {
    if (options?.method === 'POST') return new Promise((resolve) => { resolveApproval = resolve; });
    if (url.includes('request-b')) return Promise.resolve(ok({ ...loaded, requestId: 'request-b', latestRun: null, history: [], review: { status: 'not_screened', canReview: false, canApprove: false, reason: null, latestDecision: null } }));
    return Promise.resolve(ok({ ...loaded, latestRun: { ...savedRun, id: 74 } }));
  });
  const view = render(<IntegrityTab requestId="request-a" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Record approval' }));
  view.rerender(<IntegrityTab requestId="request-b" />);
  expect(await screen.findByText('No saved screen yet. Run a screen to see findings here.')).toBeInTheDocument();
  resolveApproval(ok(approved));
  await waitFor(() => expect(screen.queryByText('Integrity review complete')).toBeNull());
  expect(screen.queryByRole('button', { name: 'Record approval' })).toBeNull();
});

test('a new run never keeps an old approval visible when review-context refresh fails', async () => {
  const approved = { ...loaded, review: { status: 'approved', canReview: false, canApprove: false, reason: null, latestDecision: { id: 92, screeningId: 74, decision: 'approved', notes: '', createdAt: '2026-09-26T19:00:00Z', reviewerProfileId: 1, reviewerName: 'Lead PD', reviewerSystemId: 'staff-a' } } };
  const newRun = { ...savedRun, id: 75, createdAt: '2026-09-27T18:00:00Z' };
  requestEnvelope.mockResolvedValueOnce(ok(approved)).mockResolvedValueOnce(ok({ requestId, people: [person], run: newRun })).mockResolvedValueOnce({ ok: false, status: 504, data: { error: 'Review refresh timed out' } });
  render(<IntegrityTab requestId={requestId} />);
  expect(await screen.findByText('Integrity review complete')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Run screen' }));
  expect(await screen.findByText(/staff review status is unknown/i)).toBeInTheDocument();
  expect(screen.queryByText('Integrity review complete')).toBeNull();
  expect(screen.getByText(/Run .* · 0 items reported/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Reload review context' })).toBeInTheDocument();
});

test('while review is pending, run and reload are blocked; while run is pending, review actions are hidden', async () => {
  let resolveReview;
  requestEnvelope.mockImplementation((url, options) => {
    if (options?.method === 'POST' && url.endsWith('/review')) return new Promise((resolve) => { resolveReview = resolve; });
    return Promise.resolve(ok(loaded));
  });
  const first = render(<IntegrityTab requestId={requestId} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Record approval' }));
  expect(screen.getByRole('button', { name: 'Run screen' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Reload review context' })).toBeDisabled();
  expect(requestEnvelope).toHaveBeenCalledTimes(2);
  first.unmount();
  resolveReview(ok(loaded));

  let resolveRun;
  requestEnvelope.mockReset();
  requestEnvelope.mockResolvedValueOnce(ok(loaded)).mockImplementationOnce(() => new Promise((resolve) => { resolveRun = resolve; }));
  render(<IntegrityTab requestId={requestId} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Run screen' }));
  expect(screen.getByRole('button', { name: 'Screening…' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Record approval' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Place on hold' })).toBeNull();
  resolveRun(ok({ requestId, people: [person], run: savedRun }));
});

test('a deferred response cannot replace fresh state after A to B to A navigation', async () => {
  let resolveOld;
  let requestACount = 0;
  requestEnvelope.mockImplementation((url) => {
    if (url.includes('request-a') && requestACount++ === 0) return new Promise((resolve) => { resolveOld = resolve; });
    if (url.includes('request-a')) return Promise.resolve(ok({ ...loaded, requestId: 'request-a', people: [{ ...person, name: 'Ari Fresh' }] }));
    return Promise.resolve(ok({ ...loaded, requestId: 'request-b', people: [{ ...person, name: 'Bea Current' }] }));
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
