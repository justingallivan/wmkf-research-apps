/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import DiscussionSentimentView from '../../shared/components/meeting-tracker/DiscussionSentimentView';
import { sortSentimentRows } from '../../shared/utils/discussion-sentiment-order';

jest.mock('../../shared/components/Layout', () => ({
  __esModule: true,
  default: ({ children }) => <div>{children}</div>,
  PageHeader: ({ title }) => <h1>{title}</h1>,
}));
jest.mock('next/link', () => function MockLink({ children, href }) { return <a href={href}>{children}</a>; });

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const proposals = [
  { requestId: A, requestNumber: '1001', title: 'Alpha tissue repair', siteVisit: { scheduledStartIso: '2026-09-10T16:00:00.000Z' } },
  { requestId: B, requestNumber: '1002', title: 'Beta imaging', siteVisit: { scheduledStartIso: '2026-09-20T16:00:00.000Z' } },
  { requestId: '33333333-3333-4333-8333-333333333333', requestNumber: '1003', title: 'Gamma no visit', siteVisit: null },
];
const ev = (time, quote, speaker = null) => ({ time, quote, speaker, speakerLabel: speaker || 'Speaker 3' });
const record = (overrides = {}) => ({
  schemaVersion: 1, reception: 'positive', enthusiasm: 'high', headline: 'Staff were excited.',
  supportPoints: [ev('00:03', 'This team is excellent', 'Dr. Lee')], concernPoints: [ev('00:10', 'the budget is far too large')],
  disagreements: [{ topic: 'Budget', sides: [ev('00:10', 'budget is too large', 'Pat Kim'), ev('00:20', 'budget is fine', 'Dr. Lee')] }],
  uncertainties: [], ...overrides,
});
const status = (overrides = {}) => ({
  state: 'current', runCurrent: true, lastRunFailed: false, accepted: null,
  run: { id: '99999999-9999-4999-8999-999999999999', status: 'ready', record: record() }, ...overrides,
});

const json = (data, ok = true, httpStatus = ok ? 200 : 409) => ({ ok, status: httpStatus, json: async () => data });
let pending; let handlers;
function deferred() { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; }
beforeEach(() => {
  pending = {}; handlers = {};
  global.fetch = jest.fn(async (url, options = {}) => {
    const path = String(url);
    if (path.includes('/discussion-sentiment/candidates')) {
      if (handlers.candidates) return handlers.candidates(path);
      return json({ requestIds: [A, B], capped: false });
    }
    if (path.includes('/api/meeting-tracker/dashboard')) {
      return json(path.includes('cycleCode=')
        ? { proposals } : { programs: [{ programId: 'p1', name: 'Program One' }], programId: 'p1', cycles: [{ code: 'D26', label: 'Dec 2026' }, { code: 'J27', label: 'Jun 2027' }], defaultCycleCode: 'D26' });
    }
    const key = `${options.method || 'GET'} ${path}`;
    if (handlers[key]) return handlers[key]();
    throw new Error(`unhandled ${key}`);
  });
});

const url = (id, suffix = '') => `/api/meeting-tracker/visits/${id}/discussion-sentiment${suffix}`;
const tick = (name) => fireEvent.click(screen.getByLabelText(new RegExp(name)));

test('lists only proposals with a bound staff discussion transcript, from the schedule dashboard and the candidates route, with no internal ids', async () => {
  handlers.candidates = async () => json({ requestIds: [A.toUpperCase()], capped: false });
  render(<DiscussionSentimentView />);
  expect(await screen.findByLabelText(/Alpha tissue repair/)).toBeInTheDocument();
  expect(screen.queryByLabelText(/Beta imaging/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Gamma no visit/)).not.toBeInTheDocument();
  expect(screen.getByText('Showing proposals with a staff discussion transcript.')).toBeInTheDocument();
  expect(screen.queryByText(/may be incomplete/)).not.toBeInTheDocument();
  const urls = global.fetch.mock.calls.map(([u]) => String(u));
  expect(urls.filter((u) => u.includes('/dashboard')).every((u) => u.includes('projection=schedule') && u.includes('scope=all'))).toBe(true);
  expect(urls.some((u) => u.includes('/discussion-sentiment/candidates?cycleCode=D26'))).toBe(true);
  expect(document.body.textContent).not.toContain(A);
});

test('a candidate with no site visit is still listed (the transcript, not the visit, decides)', async () => {
  handlers.candidates = async () => json({ requestIds: ['33333333-3333-4333-8333-333333333333'], capped: false });
  render(<DiscussionSentimentView />);
  expect(await screen.findByLabelText(/Gamma no visit/)).toBeInTheDocument();
});

test('a capped candidate list says it may be incomplete', async () => {
  handlers.candidates = async () => json({ requestIds: [A], capped: true });
  render(<DiscussionSentimentView />);
  await screen.findByLabelText(/Alpha/);
  expect(screen.getByRole('status')).toHaveTextContent('may be incomplete');
});

test('a failed candidates call shows an error with Try again and never lists every proposal', async () => {
  let calls = 0;
  handlers.candidates = async () => { calls += 1; return calls === 1 ? json({ error: 'The proposal list could not be loaded.' }, false, 502) : json({ requestIds: [B], capped: false }); };
  render(<DiscussionSentimentView />);
  expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');
  expect(screen.queryByLabelText(/Alpha/)).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/Beta/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByLabelText(/Beta imaging/)).toBeInTheDocument();
  expect(screen.queryByLabelText(/Alpha/)).not.toBeInTheDocument();
});

test('the program and cycle selects are populated from the first response and keep their options after the default cycle loads', async () => {
  render(<DiscussionSentimentView />);
  await screen.findByLabelText(/Alpha/);
  expect(screen.getByLabelText('Grant program')).toHaveValue('p1');
  expect(screen.getByLabelText('Grant cycle')).toHaveValue('D26');
  expect(within(screen.getByLabelText('Grant cycle')).getAllByRole('option').map((o) => o.value)).toEqual(['D26', 'J27']);
});

test('an empty candidate list shows no proposals rather than every proposal', async () => {
  handlers.candidates = async () => json({ requestIds: [], capped: false });
  render(<DiscussionSentimentView />);
  expect(await screen.findByText(/No proposals with a staff discussion transcript match/)).toBeInTheDocument();
  expect(screen.queryByLabelText(/Alpha/)).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/Beta/)).not.toBeInTheDocument();
});

test('a slow candidates response for a previous cycle is ignored after the cycle changes back', async () => {
  const slow = deferred();
  let slowAsked = false;
  handlers.candidates = (path) => {
    if (path.includes('cycleCode=D26')) return Promise.resolve(json({ requestIds: [A], capped: false }));
    slowAsked = true;
    return slow.promise;
  };
  render(<DiscussionSentimentView />);
  await screen.findByLabelText(/Alpha/);
  const cycleSelect = screen.getByLabelText('Grant cycle');
  fireEvent.change(cycleSelect, { target: { value: 'J27' } });
  await waitFor(() => expect(slowAsked).toBe(true)); // the J27 load is now waiting on its candidates
  fireEvent.change(cycleSelect, { target: { value: 'D26' } });
  expect(await screen.findByLabelText(/Alpha/)).toBeInTheDocument();
  await act(async () => { slow.resolve(json({ requestIds: [B], capped: true })); });
  expect(screen.queryByLabelText(/Beta/)).not.toBeInTheDocument();
  expect(screen.getByLabelText(/Alpha/)).toBeInTheDocument();
  expect(screen.queryByText(/may be incomplete/)).not.toBeInTheDocument();
});

test('choosing a proposal reads only that proposal, and shows each status label', async () => {
  const cases = [
    [{ state: 'no_transcript', run: null, runCurrent: false }, 'No staff discussion transcript'],
    [{ state: 'not_analyzed', run: null, runCurrent: false }, 'Not analyzed'],
    [{ state: 'analyzing', run: null, runCurrent: false, accepted: null }, 'Analyzing…'],
    [status(), 'Current'],
    [status({ state: 'out_of_date', runCurrent: false }), 'Out of date'],
  ];
  for (const [data, text] of cases) {
    handlers[`GET ${url(A)}`] = async () => json(data);
    const { unmount } = render(<DiscussionSentimentView />);
    await screen.findByLabelText(/Alpha tissue repair/);
    expect(global.fetch.mock.calls.some(([u]) => String(u).includes('/visits/'))).toBe(false);
    tick('Alpha');
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(global.fetch.mock.calls.filter(([u]) => String(u).includes('/visits/'))).toHaveLength(1);
    unmount();
    global.fetch.mockClear();
  }
});

test('an out-of-date result shows no comparable values and offers Re-analyze', async () => {
  handlers[`GET ${url(A)}`] = async () => json(status({ state: 'out_of_date', runCurrent: false }));
  render(<DiscussionSentimentView />);
  await screen.findByLabelText(/Alpha/); tick('Alpha');
  expect(await screen.findByRole('button', { name: 'Re-analyze' })).toBeInTheDocument();
  expect(screen.queryByText('Staff were excited.')).not.toBeInTheDocument();
});

test('a current unaccepted result is labelled, shows counts, expands to speaker and time, and can be accepted', async () => {
  handlers[`GET ${url(A)}`] = async () => json(status());
  handlers[`POST ${url(A, '/accept')}`] = async () => json({ run: {} });
  render(<DiscussionSentimentView />);
  await screen.findByLabelText(/Alpha/); tick('Alpha');
  expect(await screen.findByText('Staff were excited.')).toBeInTheDocument();
  expect(screen.getByText('AI analysis; check the quotes')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Show evidence' }));
  expect(screen.getByText(/Dr. Lee · 00:03/)).toBeInTheDocument();
  expect(screen.getByText(/Speaker 3 · 00:10/)).toBeInTheDocument();
  handlers[`GET ${url(A)}`] = async () => json(status({ accepted: { id: status().run.id, acceptedAt: '2026-10-13T18:00:00Z', acceptedByName: 'Alex Staff', current: true } }));
  fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
  expect(await screen.findByText(/Accepted by Alex Staff/)).toBeInTheDocument();
  expect(screen.queryByText('AI analysis; check the quotes')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Withdraw' })).toBeInTheDocument();
  const accept = global.fetch.mock.calls.find(([u]) => String(u).endsWith('/accept'));
  expect(JSON.parse(accept[1].body)).toEqual({ runId: status().run.id });
});

test('analyze disables the button while running, sends an empty body, then reloads the status', async () => {
  handlers[`GET ${url(A)}`] = async () => json({ state: 'not_analyzed', run: null, runCurrent: false });
  const gate = deferred();
  handlers[`POST ${url(A)}`] = () => gate.promise;
  render(<DiscussionSentimentView />);
  await screen.findByLabelText(/Alpha/); tick('Alpha');
  fireEvent.click(await screen.findByRole('button', { name: 'Analyze' }));
  expect(await screen.findByText(/Keep this page open/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Analyze|Re-analyze/ })).toBeDisabled();
  handlers[`GET ${url(A)}`] = async () => json(status());
  await act(async () => { gate.resolve(json({ run: {} })); });
  expect(await screen.findByText('Staff were excited.')).toBeInTheDocument();
  const post = global.fetch.mock.calls.find(([u, o]) => String(u) === url(A) && o?.method === 'POST');
  expect(JSON.parse(post[1].body)).toEqual({});
});

test('an analysis error shows the server sentence in the row', async () => {
  handlers[`GET ${url(A)}`] = async () => json({ state: 'not_analyzed', run: null, runCurrent: false });
  handlers[`POST ${url(A)}`] = async () => json({ error: "Couldn't verify the analysis. Try again.", code: 'sentiment_evidence_unverified' }, false, 502);
  render(<DiscussionSentimentView />);
  await screen.findByLabelText(/Alpha/); tick('Alpha');
  fireEvent.click(await screen.findByRole('button', { name: 'Analyze' }));
  expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't verify the analysis. Try again.");
});

test('stale response guard: a read that returns after the proposal was unticked is ignored, even if re-ticked', async () => {
  const first = deferred(); const second = deferred();
  let calls = 0;
  handlers[`GET ${url(A)}`] = () => { calls += 1; return calls === 1 ? first.promise : second.promise; };
  render(<DiscussionSentimentView />);
  await screen.findByLabelText(/Alpha/);
  tick('Alpha'); // read 1 pending
  tick('Alpha'); // unticked
  tick('Alpha'); // re-ticked: read 2 pending
  await act(async () => { first.resolve(json(status({ run: { id: 'x', status: 'ready', record: record({ headline: 'STALE FIRST RESPONSE' }) } }))); });
  expect(screen.queryByText('STALE FIRST RESPONSE')).not.toBeInTheDocument();
  await act(async () => { second.resolve(json(status({ run: { id: 'y', status: 'ready', record: record({ headline: 'FRESH SECOND RESPONSE' }) } }))); });
  expect(await screen.findByText('FRESH SECOND RESPONSE')).toBeInTheDocument();
  expect(screen.queryByText('STALE FIRST RESPONSE')).not.toBeInTheDocument();
});

test('stale response guard: a read that returns after unticking leaves no row, and nothing after unmount throws', async () => {
  const gate = deferred();
  handlers[`GET ${url(A)}`] = () => gate.promise;
  const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
  const { unmount } = render(<DiscussionSentimentView />);
  await screen.findByLabelText(/Alpha/);
  tick('Alpha'); tick('Alpha');
  await act(async () => { gate.resolve(json(status())); });
  expect(screen.queryByText('Staff were excited.')).not.toBeInTheDocument();
  expect(screen.getByText(/Tick proposals above/)).toBeInTheDocument();
  const gate2 = deferred();
  handlers[`GET ${url(B)}`] = () => gate2.promise;
  tick('Beta');
  unmount();
  await act(async () => { gate2.resolve(json(status())); });
  expect(errors).not.toHaveBeenCalled();
  errors.mockRestore();
});

test('stale response guard: an analysis that finishes after the page unmounted starts no reload and updates nothing', async () => {
  handlers[`GET ${url(A)}`] = async () => json({ state: 'not_analyzed', run: null, runCurrent: false });
  const gate = deferred();
  handlers[`POST ${url(A)}`] = () => gate.promise;
  const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
  const { unmount } = render(<DiscussionSentimentView />);
  await screen.findByLabelText(/Alpha/); tick('Alpha');
  fireEvent.click(await screen.findByRole('button', { name: 'Analyze' }));
  await screen.findByText(/Keep this page open/);
  const readsBefore = global.fetch.mock.calls.filter(([u, o]) => String(u) === url(A) && o?.method !== 'POST').length;
  unmount();
  await act(async () => { gate.resolve(json({ run: {} })); });
  expect(global.fetch.mock.calls.filter(([u, o]) => String(u) === url(A) && o?.method !== 'POST')).toHaveLength(readsBefore);
  expect(errors).not.toHaveBeenCalled();
  errors.mockRestore();
});

test('stale response guard: an analysis that fails after the proposal was unticked and re-ticked writes nothing to the new row', async () => {
  handlers[`GET ${url(A)}`] = async () => json({ state: 'not_analyzed', run: null, runCurrent: false });
  const gate = deferred();
  handlers[`POST ${url(A)}`] = () => gate.promise;
  render(<DiscussionSentimentView />);
  await screen.findByLabelText(/Alpha/); tick('Alpha');
  fireEvent.click(await screen.findByRole('button', { name: 'Analyze' }));
  await screen.findByText(/Keep this page open/);
  tick('Alpha'); // unticked while the analysis is running
  tick('Alpha'); // re-ticked: a fresh row with its own read
  expect(await screen.findByRole('button', { name: 'Analyze' })).toBeEnabled();
  const readsBefore = global.fetch.mock.calls.filter(([u, o]) => String(u) === url(A) && o?.method !== 'POST').length;
  await act(async () => { gate.resolve(json({ error: 'STALE ANALYSIS ERROR', code: 'sentiment_generation_failed' }, false, 502)); });
  expect(screen.queryByText('STALE ANALYSIS ERROR')).not.toBeInTheDocument();
  expect(global.fetch.mock.calls.filter(([u, o]) => String(u) === url(A) && o?.method !== 'POST')).toHaveLength(readsBefore);
  expect(screen.getByRole('button', { name: 'Analyze' })).toBeEnabled();
});

test('a row whose read failed offers Try again, which reloads it; no action is offered until it is ready', async () => {
  let calls = 0;
  handlers[`GET ${url(A)}`] = async () => { calls += 1; return calls === 1 ? json({ error: 'The analysis could not be loaded. Try again.' }, false, 502) : json(status()); };
  render(<DiscussionSentimentView />);
  await screen.findByLabelText(/Alpha/); tick('Alpha');
  expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');
  expect(screen.queryByRole('button', { name: /Analyze|Accept|Withdraw/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('Staff were excited.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
});

test('Accept and Withdraw are not offered while the row is reloading', async () => {
  const acceptedStatus = status({ accepted: { id: 'a1', acceptedAt: '2026-10-13T18:00:00Z', acceptedByName: 'Alex Staff', current: true } });
  let calls = 0;
  const gate = deferred();
  handlers[`GET ${url(A)}`] = () => { calls += 1; return calls === 1 ? Promise.resolve(json(acceptedStatus)) : gate.promise; };
  render(<DiscussionSentimentView />);
  await screen.findByLabelText(/Alpha/); tick('Alpha');
  expect(await screen.findByRole('button', { name: 'Withdraw' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Accept' })).toBeInTheDocument();
  handlers[`POST ${url(A, '/accept')}`] = async () => json({ run: {} });
  fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
  await screen.findByText('Checking…');
  expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Withdraw' })).not.toBeInTheDocument();
  await act(async () => { gate.resolve(json(acceptedStatus)); });
});

test('an accepted result can be withdrawn when the transcript is no longer bound', async () => {
  handlers[`GET ${url(A)}`] = async () => json({ state: 'no_transcript', run: null, runCurrent: false, lastRunFailed: false,
    accepted: { id: 'a1', acceptedAt: '2026-10-13T18:00:00Z', acceptedByName: 'Alex Staff', current: false } });
  handlers[`POST ${url(A, '/withdraw')}`] = async () => json({ run: {} });
  render(<DiscussionSentimentView />);
  await screen.findByLabelText(/Alpha/); tick('Alpha');
  expect(await screen.findByText('No staff discussion transcript')).toBeInTheDocument();
  expect(screen.getByText(/Accepted by Alex Staff/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Analyze/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
  await waitFor(() => expect(global.fetch.mock.calls.some(([u]) => String(u).endsWith('/withdraw'))).toBe(true));
  const call = global.fetch.mock.calls.find(([u]) => String(u).endsWith('/withdraw'));
  expect(JSON.parse(call[1].body)).toEqual({ runId: 'a1' });
});

test('a withdrawn result offers Re-analyze, not Accept, and says why (accept, withdraw, reload)', async () => {
  const run = { ...status().run, acceptedAt: '2026-10-13T18:00:00Z', withdrawnAt: '2026-10-13T19:00:00Z' };
  handlers[`GET ${url(A)}`] = async () => json(status({ run, accepted: null }));
  render(<DiscussionSentimentView />);
  await screen.findByLabelText(/Alpha/); tick('Alpha');
  expect(await screen.findByText('Withdrawn. Re-analyze to accept a new result.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Re-analyze' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Withdraw' })).not.toBeInTheDocument();
});

test('the date filter narrows the picker by site visit date', async () => {
  render(<DiscussionSentimentView />);
  await screen.findByLabelText(/Alpha/);
  fireEvent.change(screen.getByLabelText('Visit on or after'), { target: { value: '2026-09-15' } });
  expect(screen.queryByLabelText(/Alpha/)).not.toBeInTheDocument();
  expect(screen.getByLabelText(/Beta/)).toBeInTheDocument();
});

describe('sortSentimentRows', () => {
  const r = (id, reception, enthusiasm, disagreements = 0, uncertainties = 0) => ({ id, record: { reception, enthusiasm,
    disagreements: Array(disagreements).fill({}), uncertainties: Array(uncertainties).fill({}) } });
  const none = (id) => ({ id, record: null });

  test('orders by reception, then enthusiasm, then disagreements, then uncertainties; no-result rows last in selection order', () => {
    const rows = [none('n1'), r('neg', 'negative', 'high'), r('pos-low', 'positive', 'low'), r('pos-high-2d', 'positive', 'high', 2),
      none('n2'), r('pos-high-0d-1u', 'positive', 'high', 0, 1), r('pos-high-0d-0u', 'positive', 'high'), r('unc', 'unclear', 'high'), r('mixed', 'mixed', 'unclear')];
    expect(sortSentimentRows(rows).map((x) => x.id)).toEqual(
      ['pos-high-0d-0u', 'pos-high-0d-1u', 'pos-high-2d', 'pos-low', 'mixed', 'neg', 'unc', 'n1', 'n2']);
  });

  test('is stable and does not mutate its input', () => {
    const rows = [r('a', 'mixed', 'low'), r('b', 'mixed', 'low')];
    const copy = [...rows];
    expect(sortSentimentRows(rows).map((x) => x.id)).toEqual(['a', 'b']);
    expect(rows).toEqual(copy);
  });
});
