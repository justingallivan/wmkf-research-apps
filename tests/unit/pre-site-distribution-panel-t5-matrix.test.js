/**
 * @jest-environment jsdom
 *
 * PreSiteDistributionPanel — T5 gap-fill (Stage 5a). tests/unit/pre-site-
 * distribution-panel.test.js already pins 2xx success, non-2xx body-code
 * branches, and exact request bytes for the send site (and structural bytes
 * for prepare/reissue) across the file's 4 fetch sites:
 *   - loadHistory   GET  /api/workbench/pre-site-visit/distribution/history
 *   - prepare       POST /api/workbench/pre-site-visit/distribution/prepare
 *   - reissueBriefingLink POST /api/workbench/pre-site-visit/briefing-link
 *   - send          POST /api/workbench/pre-site-visit/distribution/send
 *
 * This matrix covers network and malformed-body outcomes for those four legacy
 * sites. The dedicated preference URL is independently stubbed; its contract
 * and concurrency cases live in distribution-defaults-panel.test.js.
 * Under the reviewed distribution-defaults contract, malformed or empty send
 * receipts now retain the exact frozen operation and visibly report uncertainty.
 * History/prepare/reissue retain their existing tolerant-body behavior.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PreSiteDistributionPanel from '../../shared/components/workbench/PreSiteDistributionPanel';
import {
  DELIBERATION_SHARE_SEED_BODY,
  DELIBERATION_SHARE_SEED_SUBJECT,
  renderDeliberationShareSubject,
} from '../../shared/config/deliberationShareEmail';

jest.mock('../../shared/components/Layout', () => ({
  Button: jest.requireActual('../../shared/components/Layout').Button,
  Card: ({ children }) => <div>{children}</div>,
}));

jest.mock('next/router', () => ({ useRouter: () => ({ events: { on: jest.fn(), off: jest.fn(), emit: jest.fn() }, beforePopState: jest.fn() }) }));

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const ARTIFACT_ID = '22222222-2222-4222-8222-222222222222';

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}
const unparseable = () => Promise.reject(new SyntaxError('Unexpected token <'));
const emptyBody = () => Promise.reject(new SyntaxError('Unexpected end of JSON input'));

function preparedAttempt() {
  return {
    from: 'sender@example.org',
    operationId: '33333333-3333-4333-8333-333333333333',
    requestId: REQUEST_ID,
    previewHash: 'a'.repeat(64),
    attachmentMode: 'none',
    briefingLinkId: '12121212-1212-4212-8212-121212121212',
    to: ['staff@example.org'],
    cc: [],
    subject: 'Subject',
    bodyText: 'Body',
    state: 'prepared',
    transportAccepted: false,
    attachments: [],
  };
}

let preferencePair = null;
let backingFetch = global.fetch;
Object.defineProperty(global, 'fetch', { configurable: true, get: () => backingFetch, set: target => {
  backingFetch = new Proxy(target, { apply(fn, thisArg, args) {
    if (String(args[0]).includes('/email-preferences')) return Promise.resolve(response({ ok: true,
      effective: preferencePair || { subject: 'Site Visit materials — {{requestNumber}}', body: 'The deliberation briefing page linked below has the Pre-Research Presentation Brief, every completed review, the proposal, and the research presentation materials.' },
      ownStatus: 'absent', source: 'built_in', canSave: true, canClear: false }));
    return Reflect.apply(fn, thisArg, args);
  } });
} });
beforeEach(() => { preferencePair = null; });

beforeEach(() => {
  jest.clearAllMocks();
});
afterEach(() => jest.restoreAllMocks());

function renderPanel() {
  return render(
    <PreSiteDistributionPanel
      requestId={REQUEST_ID}
      requestNumber="1002379"
      sourceArtifact={{ artifactId: ARTIFACT_ID }}
    />,
  );
}

test('loadHistory: network rejection is never silent', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
  renderPanel();
  expect(await screen.findByText('offline')).toBeInTheDocument();
});

test('loadHistory axis (e): non-2xx unparseable body falls to the fallback message, never silent', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 502, json: unparseable });
  renderPanel();
  expect(await screen.findByText('Email history could not be loaded.')).toBeInTheDocument();
});

async function readyPanel() {
  global.fetch = jest.fn().mockResolvedValue(response({ success: true, attempts: [] }));
  renderPanel();
  await screen.findByText(/No email previews/);
  fireEvent.change(screen.getByLabelText('To'), { target: { value: 'staff@example.org' } });
}

test('prepare: network rejection is never silent', async () => {
  await readyPanel();
  global.fetch = jest.fn((url) => (
    String(url).includes('/prepare') ? Promise.reject(new Error('offline')) : Promise.resolve(response({ success: true, attempts: [] }))
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Create preview' }));
  expect(await screen.findByText('offline')).toBeInTheDocument();
});

test('prepare axis (e): non-2xx unparseable body is never silent (falls to the status fallback)', async () => {
  await readyPanel();
  global.fetch = jest.fn((url) => (
    String(url).includes('/prepare') ? Promise.resolve({ ok: false, status: 502, json: unparseable }) : Promise.resolve(response({ success: true, attempts: [] }))
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Create preview' }));
  expect(await screen.findByText('Preview preparation failed (502)')).toBeInTheDocument();
});

async function withPreparedPreview() {
  global.fetch = jest.fn().mockResolvedValue(response({ success: true, attempts: [] }));
  renderPanel();
  await screen.findByText(/No email previews/);
  fireEvent.change(screen.getByLabelText('To'), { target: { value: 'staff@example.org' } });
  global.fetch = jest.fn().mockResolvedValueOnce(response({ success: true, attempt: preparedAttempt() }));
  fireEvent.click(screen.getByRole('button', { name: 'Create preview' }));
  await screen.findByText('Email preview');
}

test('send: network rejection is never silent', async () => {
  await withPreparedPreview();
  global.fetch = jest.fn((url) => (
    String(url).includes('/send') ? Promise.reject(new Error('offline')) : Promise.resolve(response({ success: true, attempts: [] }))
  ));
  fireEvent.click(screen.getByLabelText(/I reviewed the recipients/));
  fireEvent.click(screen.getByRole('button', { name: 'Send email' }));
  expect(await screen.findByText('offline')).toBeInTheDocument();
});

test('send axis (e): non-2xx unparseable body is never silent (falls to the status fallback)', async () => {
  await withPreparedPreview();
  global.fetch = jest.fn((url) => (
    String(url).includes('/send') ? Promise.resolve({ ok: false, status: 502, json: unparseable }) : Promise.resolve(response({ success: true, attempts: [] }))
  ));
  fireEvent.click(screen.getByLabelText(/I reviewed the recipients/));
  fireEvent.click(screen.getByRole('button', { name: 'Send email' }));
  expect(await screen.findByTestId('distribution-send-feedback')).toHaveTextContent('unconfirmed');
});

async function withBriefingLink() {
  global.fetch = jest.fn().mockResolvedValueOnce(response({
    success: true, attempts: [], briefingLink: { id: 'l', url: 'https://apps.test/external/briefing/old', expiresAt: null },
  }));
  renderPanel();
  await screen.findByText('https://apps.test/external/briefing/old');
  fireEvent.click(screen.getByText('Issue new link'));
  await screen.findByText(/stops the current one immediately/);
}

test('reissueBriefingLink: network rejection is never silent', async () => {
  await withBriefingLink();
  global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
  fireEvent.click(screen.getByText('Issue new link'));
  expect(await screen.findByText('offline')).toBeInTheDocument();
});

test('reissueBriefingLink axis (e): non-2xx unparseable body falls to the status fallback, never silent', async () => {
  await withBriefingLink();
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 502, json: unparseable });
  fireEvent.click(screen.getByText('Issue new link'));
  expect(await screen.findByText('The new link could not be issued (502)')).toBeInTheDocument();
});

// ---------------------------------------------------------------------------
// Axis (d): a malformed or empty 2xx body under tolerantBody:true is tolerated
// (today's fallback outcome), never a thrown/visible parse error.
// ---------------------------------------------------------------------------

// loadHistory fires on mount with no user trigger, and its "No email
// previews" empty-state text is also the INITIAL pre-fetch state (history=[],
// historyError=null), so a plain findByText would match before the fetch
// even settles — a false pass under a tolerantBody mutation. Force the fetch
// promise chain to fully settle (a macrotask boundary lets every pending
// microtask, including the parse rejection and its .catch() handler, run)
// before asserting.
async function settleFetch() {
  await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 0); }); });
}

test('loadHistory axis (d): malformed 2xx body is tolerated silently (no error, empty-state copy)', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: unparseable });
  renderPanel();
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  await settleFetch();
  expect(screen.getByText(/No email previews/)).toBeInTheDocument();
  expect(screen.queryByText('Unexpected token <')).not.toBeInTheDocument();
});

test('loadHistory axis (d): empty 2xx body is tolerated silently (no error, empty-state copy)', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: emptyBody });
  renderPanel();
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  await settleFetch();
  expect(screen.getByText(/No email previews/)).toBeInTheDocument();
  expect(screen.queryByText('Unexpected end of JSON input')).not.toBeInTheDocument();
});

test('prepare axis (d): malformed 2xx body is tolerated silently (no error, no preview panel)', async () => {
  await readyPanel();
  global.fetch = jest.fn((url) => (
    String(url).includes('/prepare')
      ? Promise.resolve({ ok: true, status: 200, json: unparseable })
      : Promise.resolve(response({ success: true, attempts: [] }))
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Create preview' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Create preview' })).toBeEnabled());
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.queryByText('Email preview')).not.toBeInTheDocument();
});

test('prepare axis (d): empty 2xx body is tolerated silently (no error, no preview panel)', async () => {
  await readyPanel();
  global.fetch = jest.fn((url) => (
    String(url).includes('/prepare')
      ? Promise.resolve({ ok: true, status: 200, json: emptyBody })
      : Promise.resolve(response({ success: true, attempts: [] }))
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Create preview' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Create preview' })).toBeEnabled());
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.queryByText('Email preview')).not.toBeInTheDocument();
});

test('send axis (d): malformed 2xx retains preview and reports uncertain outcome', async () => {
  await withPreparedPreview();
  global.fetch = jest.fn((url) => (
    String(url).includes('/send')
      ? Promise.resolve({ ok: true, status: 200, json: unparseable })
      : Promise.resolve(response({ success: true, attempts: [] }))
  ));
  fireEvent.click(screen.getByLabelText(/I reviewed the recipients/));
  fireEvent.click(screen.getByRole('button', { name: 'Send email' }));
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  await settleFetch();
  expect(screen.getByTestId('distribution-send-feedback')).toHaveTextContent('uncertain');
  expect(screen.getByText('Email preview')).toBeInTheDocument();
  expect(screen.getByLabelText('Subject')).toBeDisabled();
});

test('send axis (d): empty 2xx retains preview and reports uncertain outcome', async () => {
  await withPreparedPreview();
  global.fetch = jest.fn((url) => (
    String(url).includes('/send')
      ? Promise.resolve({ ok: true, status: 200, json: emptyBody })
      : Promise.resolve(response({ success: true, attempts: [] }))
  ));
  fireEvent.click(screen.getByLabelText(/I reviewed the recipients/));
  fireEvent.click(screen.getByRole('button', { name: 'Send email' }));
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  await settleFetch();
  expect(screen.getByTestId('distribution-send-feedback')).toHaveTextContent('uncertain');
  expect(screen.getByText('Email preview')).toBeInTheDocument();
  expect(screen.getByLabelText('Subject')).toBeDisabled();
});

test('reissueBriefingLink axis (d): malformed 2xx body is tolerated silently (link card unmounts, no error)', async () => {
  await withBriefingLink();
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: unparseable });
  fireEvent.click(screen.getByText('Issue new link'));
  await waitFor(() => expect(screen.queryByText('https://apps.test/external/briefing/old')).not.toBeInTheDocument());
  expect(screen.queryByText('Unexpected token <')).not.toBeInTheDocument();
});

test('reissueBriefingLink axis (d): empty 2xx body is tolerated silently (link card unmounts, no error)', async () => {
  await withBriefingLink();
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: emptyBody });
  fireEvent.click(screen.getByText('Issue new link'));
  await waitFor(() => expect(screen.queryByText('https://apps.test/external/briefing/old')).not.toBeInTheDocument());
  expect(screen.queryByText('Unexpected end of JSON input')).not.toBeInTheDocument();
});

// ---------------------------------------------------------------------------
// Exact request bytes (URL, method, headers, exact body string) for the 3
// POST sites.
// ---------------------------------------------------------------------------

test('prepare: request bytes (url, method, headers, exact body) unchanged', async () => {
  const originalRandomUUID = globalThis.crypto.randomUUID;
  globalThis.crypto.randomUUID = jest.fn().mockReturnValue('44444444-4444-4444-8444-444444444444');
  try {
  await readyPanel();
  let captured;
  global.fetch = jest.fn((url, opts) => {
    if (String(url).includes('/prepare')) {
      captured = [url, opts];
      return Promise.resolve(response({ success: true, attempt: preparedAttempt() }));
    }
    return Promise.resolve(response({ success: true, attempts: [] }));
  });
  fireEvent.click(screen.getByRole('button', { name: 'Create preview' }));
  await waitFor(() => expect(captured).toBeDefined());
  const [url, opts] = captured;
  expect(url).toBe('/api/workbench/pre-site-visit/distribution/prepare');
  expect(opts.method).toBe('POST');
  expect(opts.headers).toEqual({ 'Content-Type': 'application/json' });
  expect(opts.body).toBe(JSON.stringify({
    requestId: REQUEST_ID,
    expectedArtifactId: ARTIFACT_ID,
    operationId: '44444444-4444-4444-8444-444444444444',
    to: 'staff@example.org',
    cc: '',
    subject: renderDeliberationShareSubject(DELIBERATION_SHARE_SEED_SUBJECT, '1002379'),
    bodyText: DELIBERATION_SHARE_SEED_BODY,
    includeCalendar: false,
    siteVisitId: null,
  }));
  } finally {
    globalThis.crypto.randomUUID = originalRandomUUID;
  }
});

test('reissueBriefingLink (briefing-link): request bytes (url, method, headers, exact body) unchanged', async () => {
  await withBriefingLink();
  let captured;
  global.fetch = jest.fn((url, opts) => {
    captured = [url, opts];
    return Promise.resolve(response({ success: true, link: { id: 'l2', url: 'https://apps.test/external/briefing/new', expiresAt: null } }));
  });
  fireEvent.click(screen.getByText('Issue new link'));
  await waitFor(() => expect(captured).toBeDefined());
  const [url, opts] = captured;
  expect(url).toBe('/api/workbench/pre-site-visit/briefing-link');
  expect(opts.method).toBe('POST');
  expect(opts.headers).toEqual({ 'Content-Type': 'application/json' });
  expect(opts.body).toBe(JSON.stringify({ requestId: REQUEST_ID, action: 'reissue', expectedLinkId: 'l' }));
});

test('send: request bytes (url, method, headers, exact body) unchanged', async () => {
  await withPreparedPreview();
  let captured;
  global.fetch = jest.fn((url, opts) => {
    if (String(url).includes('/send')) {
      captured = [url, opts];
      return Promise.resolve(response({ success: true, attempt: preparedAttempt() }));
    }
    return Promise.resolve(response({ success: true, attempts: [] }));
  });
  fireEvent.click(screen.getByLabelText(/I reviewed the recipients/));
  fireEvent.click(screen.getByRole('button', { name: 'Send email' }));
  await waitFor(() => expect(captured).toBeDefined());
  const [url, opts] = captured;
  expect(url).toBe('/api/workbench/pre-site-visit/distribution/send');
  expect(opts.method).toBe('POST');
  expect(opts.headers).toEqual({ 'Content-Type': 'application/json' });
  expect(opts.body).toBe(JSON.stringify({
    requestId: REQUEST_ID,
    operationId: preparedAttempt().operationId,
    previewHash: preparedAttempt().previewHash,
  }));
});
