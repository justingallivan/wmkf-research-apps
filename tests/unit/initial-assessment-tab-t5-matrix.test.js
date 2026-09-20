/**
 * @jest-environment jsdom
 *
 * InitialAssessmentTab — T5 gap-fill (Stage 5a). tests/unit/initial-
 * assessment-tab.test.js already pins 2xx success and request shape for
 * this file's 4 fetch sites (load, poll, generate, createBoardSnapshot),
 * all bare-`.json().catch(() => ({}))` migrated to requestJson with
 * `tolerantBody: true`. This file adds network-rejection and axis-(e)
 * coverage.
 *
 * Parse-error policy: each site's original fallback interpolated the HTTP
 * status (e.g. `Failed to load artifact (${response.status})`). The Stage
 * 5a review (finding 1) restored that suffix by moving these sites onto
 * `requestEnvelope` with an explicit `data.error || \`... (${status})\`
 * throw, matching `RequestListPanel.js`. The status suffix is pinned below
 * with a 500 + `{}` body per site.
 *
 * Test-teeth pass (Stage 5a review finding 2): adds axis (b) — a non-2xx
 * `{error:'X'}` body shows the server message verbatim, no status suffix —
 * and axis (d) — a malformed/empty 2xx body under `tolerantBody: true` is
 * tolerated (today's fallback outcome, the shared `error` banner never
 * appears) — for all 4 fetch sites, plus exact request-bytes (url, method,
 * headers, exact body string) for the 2 POSTs (generate, board-snapshot).
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import InitialAssessmentTab from '../../shared/components/workbench/InitialAssessmentTab';
import { REQUEST_DOCUMENT_OPERATION_STATUS } from '../../shared/config/requestDocument';

const REQUEST_ID = '33333333-3333-3333-3333-333333333333';

function readyArtifact() {
  return {
    artifactId: '44444444-4444-4444-4444-444444444444',
    operationStatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    operationLabel: 'Ready',
    lifecycleLabel: 'Draft',
    attemptCount: 1,
    file: {
      name: '1003001 Initial Assessment.docx',
      webUrl: 'https://example.sharepoint.com/initial-assessment.docx',
      metadataStatus: 'current',
      versionId: '2.0',
      lastModified: '2026-07-30T18:00:00Z',
    },
  };
}

const unparseable = () => Promise.reject(new SyntaxError('Unexpected token <'));

afterEach(() => jest.restoreAllMocks());

test('load: network rejection is never silent', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
  render(<InitialAssessmentTab requestId={REQUEST_ID} />);
  expect(await screen.findByText('offline')).toBeInTheDocument();
});

test('load axis (e): non-2xx unparseable body falls to the fallback text with status suffix, never silent', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 502, json: unparseable });
  render(<InitialAssessmentTab requestId={REQUEST_ID} />);
  expect(await screen.findByText('Failed to load artifact (502)')).toBeInTheDocument();
});

test('load: non-2xx empty body ({}) falls to the fallback text with status suffix (finding 1 parity)', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
  render(<InitialAssessmentTab requestId={REQUEST_ID} />);
  expect(await screen.findByText('Failed to load artifact (500)')).toBeInTheDocument();
});

async function readyPanel() {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ artifacts: [readyArtifact()], latestAttempts: [] }) });
  render(<InitialAssessmentTab requestId={REQUEST_ID} />);
  await screen.findByText(/Current in SharePoint/);
}

test('generate: network rejection is never silent', async () => {
  await readyPanel();
  global.fetch = jest.fn((url, opts) => (
    (opts?.method === 'POST')
      ? Promise.reject(new Error('offline'))
      : Promise.resolve({ ok: true, json: async () => ({ artifacts: [readyArtifact()], latestAttempts: [] }) })
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh from current inputs' }));
  expect(await screen.findByText('offline')).toBeInTheDocument();
});

test('generate axis (e): non-2xx unparseable body falls to the fallback text with status suffix, never silent', async () => {
  await readyPanel();
  global.fetch = jest.fn((url, opts) => (
    (opts?.method === 'POST')
      ? Promise.resolve({ ok: false, status: 502, json: unparseable })
      : Promise.resolve({ ok: true, json: async () => ({ artifacts: [readyArtifact()], latestAttempts: [] }) })
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh from current inputs' }));
  expect(await screen.findByText('Generation failed (502)')).toBeInTheDocument();
});

test('generate: non-2xx empty body ({}) falls to the fallback text with status suffix (finding 1 parity)', async () => {
  await readyPanel();
  global.fetch = jest.fn((url, opts) => (
    (opts?.method === 'POST')
      ? Promise.resolve({ ok: false, status: 500, json: async () => ({}) })
      : Promise.resolve({ ok: true, json: async () => ({ artifacts: [readyArtifact()], latestAttempts: [] }) })
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh from current inputs' }));
  expect(await screen.findByText('Generation failed (500)')).toBeInTheDocument();
});

async function readyPanelSuperuser() {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ artifacts: [readyArtifact()], latestAttempts: [], milestones: [] }) });
  render(<InitialAssessmentTab requestId={REQUEST_ID} isSuperuser />);
  await screen.findByText(/Current in SharePoint/);
  jest.spyOn(window, 'confirm').mockReturnValue(true);
}

test('createBoardSnapshot: network rejection is never silent', async () => {
  await readyPanelSuperuser();
  global.fetch = jest.fn((url) => (
    String(url).includes('board-snapshot')
      ? Promise.reject(new Error('offline'))
      : Promise.resolve({ ok: true, json: async () => ({ artifacts: [readyArtifact()], latestAttempts: [], milestones: [] }) })
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Create Board snapshot' }));
  expect(await screen.findByText('offline')).toBeInTheDocument();
});

test('createBoardSnapshot axis (e): non-2xx unparseable body falls to the fallback text with status suffix, never silent', async () => {
  await readyPanelSuperuser();
  global.fetch = jest.fn((url) => (
    String(url).includes('board-snapshot')
      ? Promise.resolve({ ok: false, status: 502, json: unparseable })
      : Promise.resolve({ ok: true, json: async () => ({ artifacts: [readyArtifact()], latestAttempts: [], milestones: [] }) })
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Create Board snapshot' }));
  expect(await screen.findByText('Board snapshot failed (502)')).toBeInTheDocument();
});

test('createBoardSnapshot: non-2xx empty body ({}) falls to the fallback text with status suffix (finding 1 parity)', async () => {
  await readyPanelSuperuser();
  global.fetch = jest.fn((url) => (
    String(url).includes('board-snapshot')
      ? Promise.resolve({ ok: false, status: 500, json: async () => ({}) })
      : Promise.resolve({ ok: true, json: async () => ({ artifacts: [readyArtifact()], latestAttempts: [], milestones: [] }) })
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Create Board snapshot' }));
  expect(await screen.findByText('Board snapshot failed (500)')).toBeInTheDocument();
});

// ---------------------------------------------------------------------------
// Axis (b): a non-2xx {error:'X'} body shows the server message verbatim.
// ---------------------------------------------------------------------------

test('load axis (b): non-2xx {error} surfaces the server message verbatim', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: 'Forbidden' }) });
  render(<InitialAssessmentTab requestId={REQUEST_ID} />);
  expect(await screen.findByText('Forbidden')).toBeInTheDocument();
});

test('generate axis (b): non-2xx {error} surfaces the server message verbatim', async () => {
  await readyPanel();
  global.fetch = jest.fn((url, opts) => (
    (opts?.method === 'POST')
      ? Promise.resolve({ ok: false, status: 403, json: async () => ({ error: 'Forbidden' }) })
      : Promise.resolve({ ok: true, json: async () => ({ artifacts: [readyArtifact()], latestAttempts: [] }) })
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh from current inputs' }));
  expect(await screen.findByText('Forbidden')).toBeInTheDocument();
});

test('createBoardSnapshot axis (b): non-2xx {error} surfaces the server message verbatim', async () => {
  await readyPanelSuperuser();
  global.fetch = jest.fn((url) => (
    String(url).includes('board-snapshot')
      ? Promise.resolve({ ok: false, status: 403, json: async () => ({ error: 'Forbidden' }) })
      : Promise.resolve({ ok: true, json: async () => ({ artifacts: [readyArtifact()], latestAttempts: [], milestones: [] }) })
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Create Board snapshot' }));
  expect(await screen.findByText('Forbidden')).toBeInTheDocument();
});

// ---------------------------------------------------------------------------
// Axis (d): a malformed or empty 2xx body under tolerantBody:true is
// tolerated (no error banner), never a thrown/visible parse error.
// ---------------------------------------------------------------------------

// `load` fires on mount with no user trigger, and its no-error state is also
// the pre-fetch initial state, so a plain assertion could pass before the
// fetch settles under a tolerantBody mutation. Force the fetch promise chain
// to fully settle first.
async function settleFetch() {
  await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 0); }); });
}

test('load axis (d): malformed 2xx body is tolerated silently (no error banner)', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: unparseable });
  render(<InitialAssessmentTab requestId={REQUEST_ID} />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  await settleFetch();
  expect(screen.queryByText('Unexpected token <')).not.toBeInTheDocument();
});

test('generate axis (d): malformed 2xx body is tolerated silently (no error banner)', async () => {
  await readyPanel();
  global.fetch = jest.fn((url, opts) => (
    (opts?.method === 'POST')
      ? Promise.resolve({ ok: true, status: 200, json: unparseable })
      : Promise.resolve({ ok: true, json: async () => ({ artifacts: [readyArtifact()], latestAttempts: [] }) })
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh from current inputs' }));
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  await settleFetch();
  expect(screen.queryByText('Unexpected token <')).not.toBeInTheDocument();
});

test('createBoardSnapshot axis (d): malformed 2xx body is tolerated silently (no error banner)', async () => {
  await readyPanelSuperuser();
  global.fetch = jest.fn((url) => (
    String(url).includes('board-snapshot')
      ? Promise.resolve({ ok: true, status: 200, json: unparseable })
      : Promise.resolve({ ok: true, json: async () => ({ artifacts: [readyArtifact()], latestAttempts: [], milestones: [] }) })
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Create Board snapshot' }));
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  await settleFetch();
  expect(screen.queryByText('Unexpected token <')).not.toBeInTheDocument();
});

// ---------------------------------------------------------------------------
// Exact request bytes for the 2 POST sites.
// ---------------------------------------------------------------------------

test('generate: request bytes (url, method, headers, exact body) unchanged', async () => {
  await readyPanel();
  let captured;
  global.fetch = jest.fn((url, opts) => {
    if (opts?.method === 'POST') {
      captured = [url, opts];
      return Promise.resolve({ ok: true, json: async () => ({ artifact: readyArtifact() }) });
    }
    return Promise.resolve({ ok: true, json: async () => ({ artifacts: [readyArtifact()], latestAttempts: [] }) });
  });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh from current inputs' }));
  await waitFor(() => expect(captured).toBeDefined());
  const [url, opts] = captured;
  expect(url).toBe('/api/workbench/initial-assessment');
  expect(opts.headers).toEqual({ 'Content-Type': 'application/json' });
  expect(opts.body).toBe(JSON.stringify({ requestId: REQUEST_ID }));
});

test('createBoardSnapshot: request bytes (url, method, headers, exact body) unchanged', async () => {
  await readyPanelSuperuser();
  let captured;
  global.fetch = jest.fn((url, opts) => {
    if (String(url).includes('board-snapshot')) {
      captured = [url, opts];
      return Promise.resolve({ ok: true, json: async () => ({ snapshot: null }) });
    }
    return Promise.resolve({ ok: true, json: async () => ({ artifacts: [readyArtifact()], latestAttempts: [], milestones: [] }) });
  });
  fireEvent.click(screen.getByRole('button', { name: 'Create Board snapshot' }));
  await waitFor(() => expect(captured).toBeDefined());
  const [url, opts] = captured;
  expect(url).toBe('/api/workbench/initial-assessment/board-snapshot');
  expect(opts.headers).toEqual({ 'Content-Type': 'application/json' });
  expect(opts.body).toBe(JSON.stringify({
    requestId: REQUEST_ID,
    expectedArtifactId: readyArtifact().artifactId,
    expectedCurrentVersionId: readyArtifact().file.versionId,
  }));
});
