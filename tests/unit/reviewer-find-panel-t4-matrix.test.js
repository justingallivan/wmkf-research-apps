/**
 * @jest-environment jsdom
 *
 * ReviewerFindPanel — T4 client-request-layer matrix (Stage 4). Pins request
 * bytes and body-level branches for the file's 5 fetch sites ahead of
 * migrating onto shared/utils/api-request.js:
 *   - runIngestion       GET  /api/workbench/applicant-reviewers
 *   - loadProposal       POST /api/reviewer-finder/load-proposal
 *   - lookupReviewer     POST /api/workbench/reviewer-lookup
 *   - lookupOrcid        POST /api/workbench/orcid-lookup   (D1: no !ok guard
 *     today — preserved as-is, not fixed here)
 *   - submitManualReviewer POST /api/workbench/manual-reviewer
 *
 * All five sites already parse with `.json().catch(() => ({}))`.
 */
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react';

jest.mock('../../shared/components/Layout', () => ({
  Card: ({ children }) => <div>{children}</div>,
}));
jest.mock('../../shared/components/reviewers/ReviewerSearchSection', () => function SearchStub({ manualAddSlot, ingestError }) {
  return (
    <div data-testid="search">
      {ingestError ? <div data-testid="ingest-error">{ingestError}</div> : null}
      {manualAddSlot}
    </div>
  );
});

import ReviewerFindPanel from '../../shared/components/reviewers/ReviewerFindPanel';

const REQ = 'aaaaaaaa-1111-1111-1111-111111111111';

function response(data, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => data };
}

function mkFetch({ ingest, proposal, lookup, orcid, manual } = {}) {
  return jest.fn((url, opts = {}) => {
    const target = String(url);
    if (target.includes('/api/workbench/applicant-reviewers')) {
      return Promise.resolve((ingest || (() => response({ success: true, recommended: [], slotsPopulated: 0 })))(opts));
    }
    if (target === '/api/reviewer-finder/load-proposal') {
      return Promise.resolve((proposal || (() => response({ success: true, blobUrl: null, allFiles: [] })))(opts));
    }
    if (target === '/api/workbench/reviewer-lookup') {
      return Promise.resolve((lookup || (() => response({ outcome: 'none' })))(opts));
    }
    if (target === '/api/workbench/orcid-lookup') {
      return Promise.resolve((orcid || (() => response({ found: false, reason: 'no match' })))(opts));
    }
    if (target === '/api/workbench/manual-reviewer') {
      return Promise.resolve((manual || (() => response({ success: true, outcome: 'created', candidate: { name: 'x' } })))(opts));
    }
    throw new Error(`unexpected fetch ${target}`);
  });
}

afterEach(() => { jest.clearAllMocks(); });

test('runIngestion: GET with no body; a 200 + {success:false} body throws the status-embedded fallback', async () => {
  global.fetch = mkFetch({ ingest: () => response({ success: false }) });
  await act(async () => { render(<ReviewerFindPanel requestId={REQ} savedPool={[]} />); });
  const call = global.fetch.mock.calls.find(([u]) => String(u).includes('applicant-reviewers'));
  expect(call[1]?.body).toBeUndefined();
  expect(screen.getByTestId('ingest-error')).toHaveTextContent('Ingestion failed (200)');
});

test('runIngestion: non-2xx unparseable body is tolerated and shows the status-embedded fallback', async () => {
  global.fetch = mkFetch({ ingest: () => ({ ok: false, status: 502, json: async () => { throw new Error('bad'); } }) });
  await act(async () => { render(<ReviewerFindPanel requestId={REQ} savedPool={[]} />); });
  expect(screen.getByTestId('ingest-error')).toHaveTextContent('Ingestion failed (502)');
});

test('loadProposal: POST sends exact body bytes and headers; a 404 + {allFiles} carries allFiles through the throw', async () => {
  let sentOpts = null;
  global.fetch = mkFetch({
    proposal: (opts) => { sentOpts = opts; return response({ error: 'not found', allFiles: [{ key: 'a' }] }, { ok: false, status: 404 }); },
  });
  await act(async () => { render(<ReviewerFindPanel requestId={REQ} savedPool={[]} />); });
  expect(sentOpts.method).toBe('POST');
  expect(sentOpts.headers).toEqual({ 'Content-Type': 'application/json' });
  expect(sentOpts.body).toBe(JSON.stringify({ requestId: REQ }));
  await waitFor(() => expect(screen.getByText(/not found/)).toBeTruthy());
});

test('lookupOrcid: preserves the D1 no-!ok-guard — a non-2xx response is still read for .found/.ambiguous', async () => {
  global.fetch = mkFetch({
    orcid: () => response({ found: false, reason: 'server hiccup' }, { ok: false, status: 500 }),
  });
  await act(async () => { render(<ReviewerFindPanel requestId={REQ} savedPool={[]} />); });
  fireEvent.change(screen.getByLabelText(/^Name$/i), { target: { value: 'Fred Guengerich' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /find orcid/i })); });
  await waitFor(() => expect(screen.getByText('server hiccup')).toBeTruthy());
});

test('lookupOrcid: network rejection surfaces the generic warn message', async () => {
  global.fetch = mkFetch({ orcid: () => Promise.reject(new Error('down')) });
  await act(async () => { render(<ReviewerFindPanel requestId={REQ} savedPool={[]} />); });
  fireEvent.change(screen.getByLabelText(/^Name$/i), { target: { value: 'Fred Guengerich' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /find orcid/i })); });
  await waitFor(() => expect(screen.getByText('ORCID lookup failed. Try again or enter it manually.')).toBeTruthy());
});

test('submitManualReviewer: exact body bytes; 200 + {success:false} throws the status-embedded fallback', async () => {
  let sentOpts = null;
  global.fetch = mkFetch({
    manual: (opts) => { sentOpts = opts; return response({ success: false, error: 'blocked' }); },
  });
  await act(async () => { render(<ReviewerFindPanel requestId={REQ} savedPool={[]} />); });
  fireEvent.change(screen.getByLabelText(/^Name$/i), { target: { value: 'Fred Guengerich' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /add reviewer/i })); });
  expect(sentOpts.method).toBe('POST');
  expect(sentOpts.headers).toEqual({ 'Content-Type': 'application/json' });
  expect(JSON.parse(sentOpts.body)).toMatchObject({ requestId: REQ, name: 'Fred Guengerich' });
  await waitFor(() => expect(screen.getByText('blocked')).toBeTruthy());
});
