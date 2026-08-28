/**
 * @jest-environment jsdom
 *
 * Merged suite (S466): ports every behavioral scenario from the retired
 * pre-site-visit-tab.test.js and site-visit-tab.test.js into the merged
 * Staff Deliberations workspace, plus the new stage-rail/Wrap Up derivation.
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import StaffDeliberationsTab from '../../shared/components/workbench/StaffDeliberationsTab';
import { PRE_SITE_REOPEN_REASON } from '../../shared/config/requestDocument';

jest.mock('../../shared/components/Layout', () => ({
  Card: ({ children }) => <div>{children}</div>,
}));

let distributionHistoryFeed = null;
jest.mock('../../shared/components/workbench/PreSiteDistributionPanel', () => {
  const { useEffect } = require('react');
  function MockDistributionPanel(props) {
    useEffect(() => {
      if (distributionHistoryFeed) props.onHistory?.(distributionHistoryFeed);
    }, [props]);
    return <div>Frozen distribution panel</div>;
  }
  return { __esModule: true, default: MockDistributionPanel };
});
jest.mock('../../shared/components/workbench/SiteVisitLogisticsPanel', () => ({
  __esModule: true,
  default: () => <div>Site Visit logistics panel</div>,
}));

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const ARTIFACT_ID = '22222222-2222-4222-8222-222222222222';

function readyArtifact(lifecycleState = 100000000) {
  return {
    artifactId: ARTIFACT_ID,
    operationStatus: 100000001,
    lifecycleState,
    file: {
      name: '1002379 Pre-Site Visit.docx',
      webUrl: 'https://sharepoint.test/pre-site.docx',
    },
    milestone: lifecycleState === 100000001 ? {
      versionId: '2.0',
      contentHash: 'gdc1:handoff',
      createdAt: '2026-08-17T21:05:00Z',
    } : null,
  };
}

function statusResponse({ currentArtifact = null, pendingArtifact = null, reopenHistory = [] } = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ success: true, currentArtifact, pendingArtifact, reopenHistory }),
  };
}

function successResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({ success: true, artifact: readyArtifact() }),
  };
}

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  distributionHistoryFeed = null;
  global.fetch = jest.fn(async (_url, options = {}) => (
    options.method === 'POST' ? successResponse() : statusResponse()
  ));
});
afterEach(() => {
  jest.restoreAllMocks();
});

// ── Generation (ported from pre-site-visit-tab) ──────────────────────────────

test('shows compact actions and keeps generation details behind help', async () => {
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);

  expect(screen.queryByText(/current published Admin prompt/i)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'About the site visit writeup' }));
  expect(screen.getByText(/current published Admin prompt/i)).toBeInTheDocument();
  expect(screen.getByText(/saved in SharePoint/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Generate Word Draft' }));

  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    '/api/workbench/pre-site-visit',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ requestId: REQUEST_ID }),
      signal: expect.any(AbortSignal),
    }),
  ));
  const edit = await screen.findByRole('link', { name: 'Edit' });
  expect(edit).toHaveAttribute('href', 'https://sharepoint.test/pre-site.docx');
  expect(edit).toHaveAttribute('target', '_blank');
  expect(screen.getByRole('link', { name: 'Download' }))
    .toHaveAttribute('href', 'https://sharepoint.test/pre-site.docx?download=1');
  expect(screen.getByRole('button', { name: 'Regenerate Word Draft' })).toBeEnabled();
  expect(screen.getByText('Latest draft:')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '1002379 Pre-Site Visit.docx' }))
    .toHaveAttribute('href', 'https://sharepoint.test/pre-site.docx');
  expect(screen.getByRole('button', { name: 'Start sharing' })).toBeInTheDocument();
  expect(screen.getByTestId('stage-rail')).toHaveTextContent('● Draft ready');
});

test('loads existing Ready actions without another generation request', async () => {
  global.fetch.mockResolvedValueOnce(statusResponse({ currentArtifact: readyArtifact() }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);

  const link = await screen.findByRole('link', { name: 'Edit' });
  expect(link).toHaveAttribute('href', 'https://sharepoint.test/pre-site.docx');
  expect(screen.getByRole('link', { name: 'Download' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Regenerate Word Draft' })).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(global.fetch).toHaveBeenCalledWith(
    `/api/workbench/pre-site-visit?requestId=${REQUEST_ID}`,
    expect.objectContaining({ method: 'GET', signal: expect.any(AbortSignal) }),
  );
});

test('shows durable Ready warnings beside the Word link', async () => {
  global.fetch.mockResolvedValueOnce(statusResponse({
    currentArtifact: {
      ...readyArtifact(),
      warnings: [{
        code: 'section_over_target',
        message: 'A generated section is longer than suggested and may need editing.',
      }],
    },
  }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);

  expect(await screen.findByRole('heading', { name: 'Draft needs a quick edit check' }))
    .toBeInTheDocument();
  expect(screen.getByText(/longer than suggested/i)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Edit' })).toBeInTheDocument();
});

test('recovers a Ready Word link after the generation connection is interrupted', async () => {
  let getCount = 0;
  global.fetch.mockImplementation(async (_url, options = {}) => {
    if (options.method === 'POST') throw new TypeError('Failed to fetch');
    getCount += 1;
    return getCount === 1
      ? statusResponse()
      : statusResponse({ currentArtifact: readyArtifact() });
  });
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

  fireEvent.click(screen.getByRole('button', { name: 'Generate Word Draft' }));

  const link = await screen.findByRole('link', { name: 'Edit' });
  expect(link).toHaveAttribute('href', 'https://sharepoint.test/pre-site.docx');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(global.fetch.mock.calls.filter(([, options = {}]) => options.method === 'POST')).toHaveLength(1);
  expect(global.fetch.mock.calls.filter(([, options = {}]) => options.method === 'GET')).toHaveLength(2);
});

test('shows a server error without creating a Word link', async () => {
  global.fetch.mockImplementation(async (_url, options = {}) => {
    if (options.method !== 'POST') return statusResponse();
    return response({ error: 'No usable AI proposal narrative was found.' }, 409);
  });
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);

  fireEvent.click(screen.getByRole('button', { name: 'Generate Word Draft' }));

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'No usable AI proposal narrative was found.',
  );
  expect(screen.queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument();
  expect(global.fetch.mock.calls.filter(([, options = {}]) => options.method === 'POST')).toHaveLength(1);
  expect(global.fetch.mock.calls.filter(([, options = {}]) => options.method === 'GET')).toHaveLength(2);
});

test('refreshes durable failure state once and shows its support reference', async () => {
  let getCount = 0;
  global.fetch.mockImplementation(async (_url, options = {}) => {
    if (options.method === 'POST') {
      return response({ error: 'Pre-Site Visit generation did not complete.', runId: 'run-from-post' }, 502);
    }
    getCount += 1;
    return getCount === 1 ? statusResponse() : statusResponse({
      pendingArtifact: {
        artifactId: 'failed-artifact',
        operationStatus: 100000002,
        retryable: false,
        lastError: {
          message: 'The governed output was invalid.',
          supportReference: 'durable-run-id',
        },
      },
    });
  });
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

  fireEvent.click(screen.getByRole('button', { name: 'Generate Word Draft' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('The governed output was invalid.');
  expect(screen.getByRole('alert')).toHaveTextContent('Support reference: durable-run-id');
  expect(screen.getByText(/needs a prompt or application change/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Generate Word Draft' })).toBeDisabled();
  expect(global.fetch.mock.calls.filter(([, options = {}]) => options.method === 'POST')).toHaveLength(1);
  expect(global.fetch.mock.calls.filter(([, options = {}]) => options.method === 'GET')).toHaveLength(2);
});

test('regenerate opens a confirmation dialog and cancel performs no generation', async () => {
  global.fetch.mockResolvedValueOnce(statusResponse({ currentArtifact: readyArtifact() }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Regenerate Word Draft' }));

  const dialog = screen.getByRole('dialog', { name: 'Regenerate this draft?' });
  expect(dialog).toHaveTextContent('starts a new Claude call');
  expect(dialog).toHaveTextContent('will not be carried into the new draft');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('confirming regenerate starts one generation request', async () => {
  global.fetch
    .mockResolvedValueOnce(statusResponse({ currentArtifact: readyArtifact() }))
    .mockResolvedValueOnce(successResponse());
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Regenerate Word Draft' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Regenerate' }));

  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    '/api/workbench/pre-site-visit',
    expect.objectContaining({ method: 'POST' }),
  ));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('a late response for a prior request cannot publish a stale Word link', async () => {
  let resolveFirst;
  global.fetch.mockImplementation((_url, options = {}) => {
    if (options.method !== 'POST') return Promise.resolve(statusResponse());
    return new Promise((resolve) => { resolveFirst = resolve; });
  });
  const { rerender } = render(<StaffDeliberationsTab requestId={REQUEST_ID} />);

  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: 'Generate Word Draft' }));
  rerender(<StaffDeliberationsTab requestId={OTHER_REQUEST_ID} />);
  await act(async () => { resolveFirst(successResponse()); });

  await waitFor(() => expect(screen.getByRole('button', { name: 'Generate Word Draft' })).toBeEnabled());
  expect(screen.queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument();
});

// ── Share hand-off (ported from both retired suites; single modal now) ───────

test('opens an explanatory share modal and cancel performs no transition', async () => {
  global.fetch.mockResolvedValueOnce(statusResponse({ currentArtifact: readyArtifact() }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Start sharing' }));

  const dialog = screen.getByRole('dialog', { name: 'Start sharing this draft?' });
  expect(dialog).toHaveTextContent('This exact Word document will become the Site Visit workspace.');
  expect(dialog).toHaveTextContent('current SharePoint version will be recorded in Dataverse');
  expect(dialog).toHaveTextContent('Staff can continue editing this same document in Word.');
  expect(dialog).toHaveTextContent('can no longer be regenerated after this change');
  expect(within(dialog).getByRole('button', { name: 'Start sharing' })).toHaveFocus();
  fireEvent.keyDown(document, { key: 'Tab' });
  expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
  fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
  expect(within(dialog).getByRole('button', { name: 'Start sharing' })).toHaveFocus();

  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('confirms the displayed artifact through the guarded route and enters the Share stage', async () => {
  global.fetch
    .mockResolvedValueOnce(statusResponse({ currentArtifact: readyArtifact() }))
    .mockResolvedValueOnce(response({
      success: true,
      artifact: readyArtifact(100000001),
      reused: false,
    }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} requestNumber="1002379" />);

  fireEvent.click(await screen.findByRole('button', { name: 'Start sharing' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Start sharing' }));

  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    '/api/workbench/pre-site-visit/start-site-visit',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        requestId: REQUEST_ID,
        expectedArtifactId: ARTIFACT_ID,
      }),
      signal: expect.any(AbortSignal),
    }),
  ));
  expect(await screen.findByText('Working document:')).toBeInTheDocument();
  expect(screen.getByTestId('stage-rail')).toHaveTextContent('● Share');
  expect(screen.getByText('Site Visit logistics panel')).toBeInTheDocument();
  expect(screen.getByText('Frozen distribution panel')).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Regenerate Word Draft' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Start sharing' })).not.toBeInTheDocument();
});

test('keeps the modal open and shows a transition failure for retry', async () => {
  global.fetch
    .mockResolvedValueOnce(statusResponse({ currentArtifact: readyArtifact() }))
    .mockResolvedValueOnce(response({ error: 'The Word draft changed. Reload and retry.' }, 409));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Start sharing' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Start sharing' }));

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'The Word draft changed. Reload and retry.',
  );
  const dialog = screen.getByRole('dialog');
  expect(dialog).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Start sharing' })).toBeEnabled();
});

test('a late share transition cannot publish workspace state after the request changes', async () => {
  let resolvePromotion;
  global.fetch.mockImplementation((_url, options = {}) => {
    if (options.method !== 'POST') {
      return Promise.resolve(statusResponse({ currentArtifact: readyArtifact() }));
    }
    return new Promise((resolve) => { resolvePromotion = resolve; });
  });
  const { rerender } = render(<StaffDeliberationsTab requestId={REQUEST_ID} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Start sharing' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Start sharing' }));
  rerender(<StaffDeliberationsTab requestId={OTHER_REQUEST_ID} />);
  await act(async () => {
    resolvePromotion(response({
      success: true,
      artifact: readyArtifact(100000001),
      reused: false,
    }));
  });

  await waitFor(() => expect(screen.getByRole('button', { name: 'Start sharing' })).toBeEnabled());
  expect(screen.queryByText('Working document:')).not.toBeInTheDocument();
});

// ── Share stage and Wrap Up derivation ───────────────────────────────────────

test('a shared document shows the working workspace with logistics and distribution', async () => {
  global.fetch.mockResolvedValueOnce(statusResponse({
    currentArtifact: {
      ...readyArtifact(100000001),
      warnings: [{
        code: 'section_over_target',
        message: 'A generated section is longer than suggested and may need editing.',
      }],
    },
  }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} requestNumber="1002379" />);

  expect(await screen.findByText('Working document:')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Edit' }))
    .toHaveAttribute('href', 'https://sharepoint.test/pre-site.docx');
  expect(screen.getByRole('link', { name: 'Download' }))
    .toHaveAttribute('href', 'https://sharepoint.test/pre-site.docx?download=1');
  expect(screen.getByRole('link', { name: '1002379 Pre-Site Visit.docx' })).toBeInTheDocument();
  expect(screen.getByText(/Sharing began/)).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Working document needs a quick edit check' }))
    .toBeInTheDocument();
  expect(screen.getByText(/longer than suggested/i)).toBeInTheDocument();
  expect(screen.getByTestId('stage-rail')).toHaveTextContent('✓ Draft');
  expect(screen.getByTestId('stage-rail')).toHaveTextContent('● Share');
  expect(screen.getByText('Site Visit logistics panel')).toBeInTheDocument();
  expect(screen.getByText('Frozen distribution panel')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Regenerate Word Draft' })).not.toBeInTheDocument();
});

test('a transport-accepted send for the current document promotes the rail to Wrap Up', async () => {
  distributionHistoryFeed = {
    attempts: [{ operationId: 'op-1', transportAccepted: true }],
    currentSourceEverSent: true,
  };
  global.fetch.mockResolvedValueOnce(statusResponse({
    currentArtifact: readyArtifact(100000001),
  }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} requestNumber="1002379" />);

  expect(await screen.findByRole('heading', { name: 'Wrap Up' })).toBeInTheDocument();
  expect(screen.getByText(/starting draft for the final writeup/i)).toBeInTheDocument();
  expect(screen.getByTestId('stage-rail')).toHaveTextContent('✓ Share');
  expect(screen.getByTestId('stage-rail')).toHaveTextContent('● Wrap Up');
  // The hand-off into Final Writeup is deliberately not built yet (open question 4b).
  expect(screen.queryByRole('button', { name: /Move to Final Writeup/ })).not.toBeInTheDocument();
});

test('sends for a superseded source document do not promote the current document to Wrap Up', async () => {
  // Server flag is authoritative: attempts exist (from the pre-reopen document)
  // but none belong to the CURRENT source, so the rail stays in Share.
  distributionHistoryFeed = {
    attempts: [{ operationId: 'op-old', transportAccepted: true }],
    currentSourceEverSent: false,
  };
  global.fetch.mockResolvedValueOnce(statusResponse({
    currentArtifact: readyArtifact(100000001),
  }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} requestNumber="1002379" />);

  await screen.findByText('Working document:');
  expect(screen.getByTestId('stage-rail')).toHaveTextContent('● Share');
  expect(screen.queryByRole('heading', { name: 'Wrap Up' })).not.toBeInTheDocument();
});

// ── Fail-closed states (ported) ──────────────────────────────────────────────

test.each([
  ['Board Ready', 100000002],
  ['Superseded', 100000003],
  ['Final', 100000004],
  ['unknown', 999999999],
])('a Ready %s artifact fails closed as read-only', async (_label, lifecycleState) => {
  global.fetch.mockResolvedValueOnce(statusResponse({
    currentArtifact: { ...readyArtifact(), lifecycleState },
  }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);

  expect(await screen.findByRole('heading', { name: 'Site visit writeup is read-only' }))
    .toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Download' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Regenerate Word Draft' })).not.toBeInTheDocument();
  expect(screen.getByText(/cannot be edited, downloaded, or regenerated from this tab/i))
    .toBeInTheDocument();
});

test('a shared artifact without a current Word URL fails closed with an explanation', async () => {
  global.fetch.mockResolvedValueOnce(statusResponse({
    currentArtifact: {
      ...readyArtifact(100000001),
      file: { name: '1002379 Pre-Site Visit.docx', webUrl: null },
    },
  }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);

  expect(await screen.findByRole('heading', { name: 'Site visit writeup is read-only' }))
    .toBeInTheDocument();
  expect(screen.getByText(/No current Word link was returned/i)).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Generate Word Draft' })).not.toBeInTheDocument();
  expect(screen.queryByText('Site Visit logistics panel')).not.toBeInTheDocument();
});

// ── Guarded reopen (ported from site-visit-tab; now in the admin section) ────

test('only superusers can see the administration section and reopen control', async () => {
  global.fetch.mockResolvedValueOnce(statusResponse({
    currentArtifact: readyArtifact(100000001),
  }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} requestNumber="1002379" isSuperuser={false} />);
  expect(await screen.findByText('Working document:')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Reopen Pre-Site Draft' })).not.toBeInTheDocument();
  expect(screen.queryByText(/Administration — guarded reopen/)).not.toBeInTheDocument();
});

test('validates confirmation and submits one guarded reopen, returning the workspace to Draft', async () => {
  global.fetch
    .mockResolvedValueOnce(statusResponse({
      currentArtifact: readyArtifact(100000001),
    }))
    .mockResolvedValueOnce(response({
      success: true,
      artifact: readyArtifact(100000000),
      reused: false,
      recovered: false,
      inProgress: false,
    }))
    .mockResolvedValueOnce(statusResponse({
      currentArtifact: readyArtifact(100000000),
      reopenHistory: [{
        artifactId: ARTIFACT_ID,
        correction: {
          cycleId: '33333333-3333-4333-8333-333333333333',
          reasonCode: PRE_SITE_REOPEN_REASON.ACCIDENTAL_HANDOFF,
          reasonNote: 'The handoff was started too early.',
          actorName: 'Test Admin',
          createdAt: '2026-08-22T12:00:00Z',
        },
        source: { milestone: { versionId: '2.0' } },
      }],
    }));
  render(
    <StaffDeliberationsTab requestId={REQUEST_ID} requestNumber="1002379" isSuperuser />,
  );

  await screen.findByText('Working document:');
  fireEvent.click(screen.getByText(/Administration — guarded reopen/));
  fireEvent.click(screen.getByRole('button', { name: 'Reopen Pre-Site Draft' }));
  const submit = screen.getByRole('button', { name: 'Create Draft Successor' });
  expect(submit).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Reason'), {
    target: { value: PRE_SITE_REOPEN_REASON.ACCIDENTAL_HANDOFF },
  });
  fireEvent.change(screen.getByLabelText('Correction note'), {
    target: { value: 'The handoff was started too early.' },
  });
  fireEvent.change(screen.getByLabelText('Type request number 1002379 to confirm'), {
    target: { value: '1002379' },
  });
  expect(submit).toBeEnabled();
  fireEvent.click(submit);

  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    '/api/workbench/pre-site-visit/reopen',
    expect.objectContaining({
      method: 'POST',
      body: expect.any(String),
      signal: expect.any(AbortSignal),
    }),
  ));
  const reopenCall = global.fetch.mock.calls.find(([url]) => url.endsWith('/reopen'));
  expect(JSON.parse(reopenCall[1].body)).toMatchObject({
    requestId: REQUEST_ID,
    expectedArtifactId: ARTIFACT_ID,
    requestNumber: '1002379',
    reasonCode: PRE_SITE_REOPEN_REASON.ACCIDENTAL_HANDOFF,
    reasonNote: 'The handoff was started too early.',
    clientOperationId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
  });
  // The workspace returns to Draft in place — no tab navigation exists anymore.
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Guarded reopen' })).not.toBeInTheDocument());
  expect(await screen.findByRole('button', { name: 'Start sharing' })).toBeInTheDocument();
  expect(screen.getByTestId('stage-rail')).toHaveTextContent('● Draft ready');
  expect(screen.getByTestId('stage-rail')).toHaveTextContent('reopened');
});

test('a failed submit keeps one operation id and immutable audit inputs for safe retry', async () => {
  global.fetch
    .mockResolvedValueOnce(statusResponse({
      currentArtifact: readyArtifact(100000001),
    }))
    .mockResolvedValueOnce(response({
      error: 'The first attempt failed.',
      code: 'pre_site_reopen_copy_verification_failed',
    }, 409))
    .mockResolvedValueOnce(response({
      success: true,
      artifact: readyArtifact(100000000),
      reused: false,
      recovered: false,
      inProgress: false,
    }))
    .mockResolvedValueOnce(statusResponse({
      currentArtifact: readyArtifact(100000000),
    }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} requestNumber="1002379" isSuperuser />);

  await screen.findByText('Working document:');
  fireEvent.click(screen.getByText(/Administration — guarded reopen/));
  fireEvent.click(screen.getByRole('button', { name: 'Reopen Pre-Site Draft' }));
  fireEvent.change(screen.getByLabelText('Reason'), {
    target: { value: PRE_SITE_REOPEN_REASON.ACCIDENTAL_HANDOFF },
  });
  fireEvent.change(screen.getByLabelText('Correction note'), {
    target: { value: 'The handoff was started too early.' },
  });
  fireEvent.change(screen.getByLabelText('Type request number 1002379 to confirm'), {
    target: { value: '1002379' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Create Draft Successor' }));
  expect(await screen.findByText('The first attempt failed.')).toBeInTheDocument();

  const firstCall = global.fetch.mock.calls.find(([url]) => url.endsWith('/reopen'));
  const firstOperationId = JSON.parse(firstCall[1].body).clientOperationId;
  expect(screen.getByLabelText('Reason')).toBeDisabled();
  expect(screen.getByLabelText('Correction note')).toBeDisabled();
  expect(screen.getByLabelText('Type request number 1002379 to confirm')).toBeDisabled();
  expect(screen.getByText(/keeps its original reason and confirmation/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Create Draft Successor' }));

  await waitFor(() => expect(
    global.fetch.mock.calls.filter(([url]) => url.endsWith('/reopen')),
  ).toHaveLength(2));
  const secondCall = global.fetch.mock.calls.filter(([url]) => url.endsWith('/reopen'))[1];
  expect(JSON.parse(secondCall[1].body).clientOperationId).toBe(firstOperationId);
});

test('renders append-only guarded reopen history from the status contract', async () => {
  global.fetch.mockResolvedValueOnce(statusResponse({
    currentArtifact: readyArtifact(100000001),
    reopenHistory: [{
      artifactId: '77777777-7777-4777-8777-777777777777',
      outcome: 'needs_reconciliation',
      correction: {
        cycleId: '88888888-8888-4888-8888-888888888888',
        reasonCode: PRE_SITE_REOPEN_REASON.WRONG_GOVERNED_INPUTS,
        reasonNote: 'The governed inputs were corrected after handoff.',
        actorName: 'Test Admin',
        createdAt: '2026-08-22T12:00:00Z',
      },
      source: { milestone: { versionId: '2.0' } },
      cleanupRequired: [{
        driveId: 'retained-drive',
        itemId: 'retained-item',
        reason: 'abandoned_failed_reopen_copy_retained',
      }],
    }],
  }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} requestNumber="1002379" isSuperuser />);

  await screen.findByText('Working document:');
  fireEvent.click(screen.getByText(/Administration — guarded reopen/));
  expect(screen.getByText('Guarded reopen attempts')).toBeInTheDocument();
  expect(screen.getByText('Needs reconciliation')).toBeInTheDocument();
  expect(screen.getByText('Wrong governed inputs')).toBeInTheDocument();
  expect(screen.getByText('The governed inputs were corrected after handoff.')).toBeInTheDocument();
  expect(screen.getByText(/source version 2.0/)).toBeInTheDocument();
  expect(screen.getByText('A retained SharePoint copy requires reconciliation.')).toBeInTheDocument();
});
