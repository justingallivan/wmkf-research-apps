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
  const { useState } = require('react');
  function MockDistributionPanel(props) {
    const [lockError, setLockError] = useState(null);
    useEffect(() => {
      if (distributionHistoryFeed) props.onHistory?.(distributionHistoryFeed);
    }, [props]);
    return (
      <div>
        <span>{`Distribution panel: ${props.composer}${props.record ? ' (record)' : ''}${props.needsLock ? ' (lock required)' : ''}`}</span>
        <span data-testid="mock-suggested-to">{(props.suggestedTo || []).join(',')}</span>
        <span data-testid="mock-suggested-cc">{(props.suggestedCc || []).join(',')}</span>
        <span data-testid="mock-session">{props.session?.scheduledStartIso || 'none'}</span>
        {props.composer === 'dialog' && (
          <>
            <button type="button" onClick={() => props.onCloseComposer?.()}>mock-close</button>
            <button
              type="button"
              onClick={async () => {
                setLockError(null);
                try { await props.beforePrepare?.(); } catch (error) { setLockError(error.message); }
              }}
            >
              mock-prepare
            </button>
            {lockError && <p role="alert">{`mock-error: ${lockError}`}</p>}
          </>
        )}
      </div>
    );
  }
  return { __esModule: true, default: MockDistributionPanel };
});
let siteVisitContextFeed = null;
const siteVisitContextMock = jest.fn(() => siteVisitContextFeed);
jest.mock('../../shared/components/workbench/useSiteVisitContext', () => ({
  __esModule: true,
  default: (...args) => siteVisitContextMock(...args),
}));

let visitExpectedFeed = true;
jest.mock('../../shared/utils/deliberation-stage', () => ({
  ...jest.requireActual('../../shared/utils/deliberation-stage'),
  visitExpected: () => visitExpectedFeed,
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

function statusResponse({
  currentArtifact = null,
  pendingArtifact = null,
  reopenHistory = [],
  stageLabels = null,
  materials = null,
} = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      success: true,
      currentArtifact,
      pendingArtifact,
      reopenHistory,
      ...(stageLabels ? { stageLabels } : {}),
      ...(materials ? { materials } : {}),
    }),
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
  siteVisitContextFeed = null;
  visitExpectedFeed = true;
  global.fetch = jest.fn(async (_url, options = {}) => (
    options.method === 'POST' ? successResponse() : statusResponse()
  ));
});
afterEach(() => {
  jest.restoreAllMocks();
});

// ── Generation (ported from pre-site-visit-tab) ──────────────────────────────

test('draft stage: one sentence, Edit in Word primary, Share… secondary, Download and Regenerate under More', async () => {
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);

  // The help popover is gone; the sentence carries what a PD needs.
  expect(screen.queryByRole('button', { name: 'About Staff Deliberations' })).not.toBeInTheDocument();
  expect(await screen.findByTestId('deliberations-stage-sentence'))
    .toHaveTextContent('Generate the AI draft in Word to start staff deliberations for this proposal.');
  expect(screen.getByTestId('deliberations-session-line')).toHaveTextContent('Deliberation session: not yet scheduled.');
  fireEvent.click(screen.getByRole('button', { name: 'Generate Word Draft' }));

  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    '/api/workbench/pre-site-visit',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ requestId: REQUEST_ID }),
      signal: expect.any(AbortSignal),
    }),
  ));
  const edit = await screen.findByRole('link', { name: 'Edit in Word' });
  expect(edit).toHaveAttribute('href', 'https://sharepoint.test/pre-site.docx');
  expect(edit).toHaveAttribute('target', '_blank');
  expect(screen.getByRole('button', { name: 'Share…' })).toBeInTheDocument();
  expect(screen.getByTestId('deliberations-stage-sentence'))
    .toHaveTextContent('Review and edit the AI draft in Word, then share it for the deliberation session. The draft leaves the recommendation, referee comments, and presentation for you to complete.');
  // Download and Regenerate are tucked under More, not in the action row.
  expect(screen.queryByRole('link', { name: 'Download' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Regenerate Word Draft' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
  expect(screen.getByRole('menuitem', { name: 'Download' }))
    .toHaveAttribute('href', 'https://sharepoint.test/pre-site.docx?download=1');
  expect(screen.getByRole('menuitem', { name: 'Regenerate Word Draft' })).toBeEnabled();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  expect(screen.getByText('Latest draft:')).toBeInTheDocument();
  // Display label, not the raw SharePoint filename; identity in tooltip + details.
  const draftLink = screen.getByRole('link', { name: 'Word draft' });
  expect(draftLink).toHaveAttribute('href', 'https://sharepoint.test/pre-site.docx');
  expect(draftLink).toHaveAttribute('title', '1002379 Pre-Site Visit.docx');
  expect(screen.getByText('File details')).toBeInTheDocument();
  expect(screen.getByText(/1002379 Pre-Site Visit\.docx/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Start sharing' })).not.toBeInTheDocument();
  expect(screen.getByTestId('stage-rail')).toHaveTextContent('● AI draft ready');
  // The composer is mounted hidden at the draft stage so Share… can open it; the
  // briefing-link card and history stay out of the way until the draft is shared.
  expect(screen.getByText('Distribution panel: hidden (lock required)')).toBeInTheDocument();
});

test('loads existing Ready actions without another generation request', async () => {
  global.fetch.mockResolvedValueOnce(statusResponse({ currentArtifact: readyArtifact() }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);

  const link = await screen.findByRole('link', { name: 'Edit in Word' });
  expect(link).toHaveAttribute('href', 'https://sharepoint.test/pre-site.docx');
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
  expect(screen.getByRole('menuitem', { name: 'Download' })).toBeInTheDocument();
  expect(screen.getByRole('menuitem', { name: 'Regenerate Word Draft' })).toBeInTheDocument();
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
  expect(screen.getByRole('link', { name: 'Edit in Word' })).toBeInTheDocument();
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

  const link = await screen.findByRole('link', { name: 'Edit in Word' });
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

  fireEvent.click(await screen.findByRole('button', { name: 'More actions' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Regenerate Word Draft' }));

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

  fireEvent.click(await screen.findByRole('button', { name: 'More actions' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Regenerate Word Draft' }));
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
  expect(screen.queryByRole('link', { name: 'Edit in Word' })).not.toBeInTheDocument();
});

// ── Share hand-off (tab redesign: Share… opens the composer; lock at preview) ─

test('Share… opens the composer as a dialog with the lock required, and Close performs no transition', async () => {
  global.fetch.mockResolvedValueOnce(statusResponse({ currentArtifact: readyArtifact() }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Share…' }));
  expect(screen.getByText('Distribution panel: dialog (lock required)')).toBeInTheDocument();
  expect(screen.queryByRole('dialog', { name: 'Start sharing this draft?' })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'mock-close' }));
  expect(screen.getByText('Distribution panel: hidden (lock required)')).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('stage-rail')).toHaveTextContent('● AI draft ready');
});

test('the composer locks the displayed artifact through the guarded route before preview and enters Shared', async () => {
  global.fetch
    .mockResolvedValueOnce(statusResponse({ currentArtifact: readyArtifact() }))
    .mockResolvedValueOnce(response({
      success: true,
      artifact: readyArtifact(100000001),
      reused: false,
    }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} requestNumber="1002379" />);

  fireEvent.click(await screen.findByRole('button', { name: 'Share…' }));
  fireEvent.click(screen.getByRole('button', { name: 'mock-prepare' }));

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
  expect(screen.getByTestId('stage-rail')).toHaveTextContent('● Shared');
  expect(screen.getByTestId('deliberations-stage-sentence'))
    .toHaveTextContent(`Shared on ${new Date('2026-08-17T21:05:00Z').toLocaleDateString()}. This exact version is locked as the working document. Send the deliberation email when you are ready.`);
  // The composer stays open (still a dialog) but no longer needs a lock; the
  // record (briefing link, history) now shows below the card.
  expect(screen.getByText('Distribution panel: dialog (record)')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Regenerate Word Draft' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Start sharing' })).not.toBeInTheDocument();
});

test('a lock failure is thrown to the composer and the tab stays at the draft stage for retry', async () => {
  global.fetch
    .mockResolvedValueOnce(statusResponse({ currentArtifact: readyArtifact() }))
    .mockResolvedValueOnce(response({ error: 'The Word draft changed. Reload and retry.' }, 409));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Share…' }));
  fireEvent.click(screen.getByRole('button', { name: 'mock-prepare' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('mock-error: The Word draft changed. Reload and retry.');
  expect(screen.getByText('Distribution panel: dialog (lock required)')).toBeInTheDocument();
  expect(screen.getByTestId('stage-rail')).toHaveTextContent('● AI draft ready');
  expect(screen.getByRole('link', { name: 'Edit in Word' })).toBeInTheDocument();
});

test('a late lock response cannot publish workspace state after the request changes', async () => {
  let resolvePromotion;
  global.fetch.mockImplementation((_url, options = {}) => {
    if (options.method !== 'POST') {
      return Promise.resolve(statusResponse({ currentArtifact: readyArtifact() }));
    }
    return new Promise((resolve) => { resolvePromotion = resolve; });
  });
  const { rerender } = render(<StaffDeliberationsTab requestId={REQUEST_ID} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Share…' }));
  fireEvent.click(screen.getByRole('button', { name: 'mock-prepare' }));
  rerender(<StaffDeliberationsTab requestId={OTHER_REQUEST_ID} />);
  await act(async () => {
    resolvePromotion(response({
      success: true,
      artifact: readyArtifact(100000001),
      reused: false,
    }));
  });

  await waitFor(() => expect(screen.getByRole('button', { name: 'Share…' })).toBeEnabled());
  expect(screen.queryByText('Working document:')).not.toBeInTheDocument();
  expect(screen.getByTestId('stage-rail')).toHaveTextContent('● AI draft ready');
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
  // Locked but not yet sent: Share… stays the primary action.
  expect(screen.getByRole('button', { name: 'Share…' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open working document' }))
    .toHaveAttribute('href', 'https://sharepoint.test/pre-site.docx');
  const docLink = screen.getByRole('link', { name: 'Word document' });
  expect(docLink).toHaveAttribute('title', '1002379 Pre-Site Visit.docx');
  expect(screen.getByTestId('deliberations-stage-sentence'))
    .toHaveTextContent(`Shared on ${new Date('2026-08-17T21:05:00Z').toLocaleDateString()}.`);
  expect(screen.getByRole('heading', { name: 'Working document needs a quick edit check' }))
    .toBeInTheDocument();
  expect(screen.getByText(/longer than suggested/i)).toBeInTheDocument();
  expect(screen.getByTestId('stage-rail')).toHaveTextContent('✓ AI draft ready');
  expect(screen.getByTestId('stage-rail')).toHaveTextContent('● Shared');
  expect(screen.getByText('Distribution panel: hidden (record)')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
  expect(screen.getByRole('menuitem', { name: 'Download' }))
    .toHaveAttribute('href', 'https://sharepoint.test/pre-site.docx?download=1');
  expect(screen.queryByRole('menuitem', { name: 'Regenerate Word Draft' })).not.toBeInTheDocument();
});

test('a transport-accepted send for the current document sets substate sent (rail stays on Shared)', async () => {
  distributionHistoryFeed = {
    attempts: [{ operationId: 'op-1', transportAccepted: true }],
    currentSourceEverSent: true,
  };
  global.fetch.mockResolvedValueOnce(statusResponse({
    currentArtifact: readyArtifact(100000001),
  }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} requestNumber="1002379" />);

  await waitFor(() => expect(screen.getByTestId('deliberations-stage-sentence'))
    .toHaveTextContent('The deliberation email has gone out; keep editing the working document in Word.'));
  // D5: "Shared" means locked, not "first email sent" — the rail stays on the
  // Shared stop; sent/not-sent is a substate shown in the sentence, not a fifth stop.
  expect(screen.getByTestId('stage-rail')).toHaveTextContent('● Shared');
  expect(screen.getByRole('link', { name: 'Open working document' })).toBeInTheDocument();
  // No Resend without a failure; sending again is secondary, under More.
  expect(screen.queryByRole('button', { name: 'Resend' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Share…' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
  expect(screen.getByRole('menuitem', { name: 'Send the deliberation email again…' })).toBeInTheDocument();
  // The Final Writeup tab owns the handoff; Staff Deliberations never duplicates it.
  expect(screen.queryByRole('button', { name: /Move to Final Writeup/ })).not.toBeInTheDocument();
});

test('a failed latest send shows a red line and a Resend action that opens the composer', async () => {
  distributionHistoryFeed = {
    attempts: [{ operationId: 'op-2', transportAccepted: false, lastError: 'Dynamics refused the send.' }],
    currentSourceEverSent: true,
    latestSendFailure: { operationId: 'op-2', message: 'Dynamics refused the send.' },
  };
  global.fetch.mockResolvedValueOnce(statusResponse({ currentArtifact: readyArtifact(100000001) }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} requestNumber="1002379" />);

  expect(await screen.findByTestId('deliberations-send-failure'))
    .toHaveTextContent('The last send failed: Dynamics refused the send.');
  fireEvent.click(screen.getByRole('button', { name: 'Resend' }));
  expect(screen.getByText('Distribution panel: dialog (record)')).toBeInTheDocument();
});

test('the session line reads the status payload once the tracker supplies a slot', async () => {
  global.fetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({
      success: true,
      currentArtifact: readyArtifact(100000001),
      pendingArtifact: null,
      reopenHistory: [],
      session: { scheduledStartIso: '2026-12-01T18:00:00Z', scheduledEndIso: null, ianaTimeZone: 'America/Los_Angeles', meetingLink: null, location: null },
    }),
  });
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);

  await waitFor(() => expect(screen.getByTestId('deliberations-session-line'))
    .toHaveTextContent(/^Deliberation session: .*Dec 1, 2026.*10:00.*AM\.$/));
});

test('a Final document offers one action, Open Final Writeup, and no More menu', async () => {
  const onSelectTab = jest.fn();
  global.fetch.mockResolvedValueOnce(statusResponse({
    currentArtifact: { ...readyArtifact(), lifecycleState: 100000004 },
  }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} onSelectTab={onSelectTab} />);

  await waitFor(() => expect(screen.getByTestId('deliberations-stage-sentence')).toHaveTextContent('This proposal moved to Final Writeup.'));
  fireEvent.click(screen.getByRole('button', { name: 'Open Final Writeup' }));
  expect(onSelectTab).toHaveBeenCalledWith('final-writeup');
  expect(screen.queryByRole('button', { name: 'More actions' })).not.toBeInTheDocument();
  expect(screen.queryByTestId('deliberations-session-line')).not.toBeInTheDocument();
});

test('sends for a superseded source document do not set the current document to sent', async () => {
  // Server flag is authoritative: attempts exist (from the pre-reopen document)
  // but none belong to the CURRENT source, so the rail stays "not yet sent".
  distributionHistoryFeed = {
    attempts: [{ operationId: 'op-old', transportAccepted: true }],
    currentSourceEverSent: false,
  };
  global.fetch.mockResolvedValueOnce(statusResponse({
    currentArtifact: readyArtifact(100000001),
  }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} requestNumber="1002379" />);

  await screen.findByText('Working document:');
  expect(screen.getByTestId('stage-rail')).toHaveTextContent('● Shared');
  expect(screen.getByTestId('deliberations-stage-sentence')).toHaveTextContent('Send the deliberation email when you are ready.');
  expect(screen.getByRole('button', { name: 'Share…' })).toBeInTheDocument();
});

// ── Fail-closed states (ported) ──────────────────────────────────────────────

test.each([
  ['Board Ready', 100000002],
  ['Superseded', 100000003],
  ['unknown', 999999999],
])('a Ready %s artifact fails closed as read-only', async (_label, lifecycleState) => {
  global.fetch.mockResolvedValueOnce(statusResponse({
    currentArtifact: { ...readyArtifact(), lifecycleState },
  }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);

  expect(await screen.findByRole('heading', { name: 'Staff Deliberations is read-only' }))
    .toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Download' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Regenerate Word Draft' })).not.toBeInTheDocument();
  expect(screen.getByText(/cannot be edited, downloaded, or regenerated from this tab/i))
    .toBeInTheDocument();
});

test('a Final artifact becomes a read-only receipt that points staff to Final Writeup', async () => {
  global.fetch.mockResolvedValueOnce(statusResponse({
    currentArtifact: { ...readyArtifact(), lifecycleState: 100000004 },
  }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);

  expect(await screen.findByRole('heading', { name: 'Moved to Final Writeup' }))
    .toBeInTheDocument();
  expect(screen.getByText(/Open the Final Writeup tab to continue in Word/i)).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Download' })).not.toBeInTheDocument();
});

test('a shared artifact without a current Word URL fails closed with an explanation', async () => {
  global.fetch.mockResolvedValueOnce(statusResponse({
    currentArtifact: {
      ...readyArtifact(100000001),
      file: { name: '1002379 Pre-Site Visit.docx', webUrl: null },
    },
  }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);

  expect(await screen.findByRole('heading', { name: 'Staff Deliberations is read-only' }))
    .toBeInTheDocument();
  expect(screen.getByText(/No current Word link was returned/i)).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Generate Word Draft' })).not.toBeInTheDocument();
  expect(screen.queryByText('Frozen distribution panel')).not.toBeInTheDocument();
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
  expect(await screen.findByRole('button', { name: 'Share…' })).toBeInTheDocument();
  expect(screen.getByTestId('stage-rail')).toHaveTextContent('● AI draft ready');
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

test('labels a guarded reopen without an explicit actor as Not captured', async () => {
  global.fetch.mockResolvedValueOnce(statusResponse({
    currentArtifact: readyArtifact(100000001),
    reopenHistory: [{
      artifactId: '77777777-7777-4777-8777-777777777777',
      outcome: 'completed',
      correction: {
        cycleId: '88888888-8888-4888-8888-888888888888',
        reasonCode: PRE_SITE_REOPEN_REASON.WRONG_GOVERNED_INPUTS,
        reasonNote: 'The governed inputs were corrected after handoff.',
        actorName: null,
        createdAt: null,
      },
      source: { milestone: { versionId: '2.0' } },
      cleanupRequired: [],
    }],
  }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} requestNumber="1002379" isSuperuser />);

  await screen.findByText('Working document:');
  fireEvent.click(screen.getByText(/Administration — guarded reopen/));
  expect(screen.getByText(/Not captured/)).toBeInTheDocument();
  expect(screen.queryByText('Recorded staff actor')).not.toBeInTheDocument();
});

// ── PC Meeting Tracker slice 3: the visit stop and admin-editable labels ─────

test('a draft-stage request with no scheduled visit shows "Visit not scheduled"', async () => {
  siteVisitContextFeed = null;
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);

  expect(await screen.findByText('Visit not scheduled.')).toBeInTheDocument();
});

test('when visitExpected() is false, the visit line is not rendered at the draft stage (discriminating fixture)', async () => {
  visitExpectedFeed = false;
  siteVisitContextFeed = null;
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);

  await screen.findByTestId('stage-rail');
  expect(screen.queryByTestId('deliberations-visit-line')).not.toBeInTheDocument();
  expect(screen.queryByText('Visit not scheduled.')).not.toBeInTheDocument();
});

test('the site-visit hook is consulted with the requestId even at the draft stage (fail-open, unconditional per §5.4)', async () => {
  siteVisitContextFeed = { siteVisit: { startIso: '2099-01-01T00:00:00Z' } };
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);

  // A future visit line shows up before the document is ever shared, proving
  // the hook's result was used for a plain draft-stage render.
  expect(await screen.findByText(`Visit ${new Date('2099-01-01T00:00:00Z').toLocaleDateString()}.`)).toBeInTheDocument();
  expect(screen.getByTestId('stage-rail')).toHaveTextContent('● No draft yet');
  // Not decorative: the mock actually receives the real requestId, not a
  // stage-gated null (restoring the old `shared && readyFile ? requestId :
  // null` gate would make this assertion fail even though every other
  // assertion above stays green).
  expect(siteVisitContextMock).toHaveBeenCalledWith(REQUEST_ID);
  expect(siteVisitContextMock).not.toHaveBeenCalledWith(null);
});

test('a shared document with a future scheduled visit shows the visit date, not yet visited', async () => {
  siteVisitContextFeed = { siteVisit: { startIso: '2099-06-15T00:00:00Z' } };
  global.fetch.mockResolvedValueOnce(statusResponse({ currentArtifact: readyArtifact(100000001) }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);

  await screen.findByText('Working document:');
  expect(screen.getByTestId('stage-rail')).toHaveTextContent('● Shared');
  expect(screen.getByTestId('deliberations-visit-line'))
    .toHaveTextContent(`Visit ${new Date('2099-06-15T00:00:00Z').toLocaleDateString()}.`);
});

test('a shared document with a past scheduled visit moves the rail to Visit and offers Continue in Final Writeup', async () => {
  const onSelectTab = jest.fn();
  siteVisitContextFeed = { siteVisit: { startIso: '2020-01-01T00:00:00Z' } };
  global.fetch.mockResolvedValueOnce(statusResponse({ currentArtifact: readyArtifact(100000001) }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} onSelectTab={onSelectTab} />);

  await screen.findByText('Working document:');
  expect(screen.getByTestId('stage-rail')).toHaveTextContent('✓ AI draft ready');
  expect(screen.getByTestId('stage-rail')).toHaveTextContent('✓ Shared');
  expect(screen.getByTestId('stage-rail')).toHaveTextContent('● Visit');
  expect(screen.getByTestId('deliberations-stage-sentence'))
    .toHaveTextContent(`Visited ${new Date('2020-01-01T00:00:00Z').toLocaleDateString()}. Add your site-visit edits to the working document in Word, then continue in Final Writeup to start group review.`);
  // The visit date lives in the sentence at this stage; no duplicate line.
  expect(screen.queryByTestId('deliberations-visit-line')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Add site-visit edits in Word' }))
    .toHaveAttribute('href', 'https://sharepoint.test/pre-site.docx');

  fireEvent.click(screen.getByRole('button', { name: 'Continue in Final Writeup' }));
  expect(onSelectTab).toHaveBeenCalledWith('final-writeup');
});

test('admin-editable stageLabels override the code-owned defaults on the rail', async () => {
  global.fetch.mockResolvedValueOnce(statusResponse({
    currentArtifact: readyArtifact(),
    stageLabels: { draft: 'Draft in progress', shared: 'Shared', visit: 'Visit', final: 'Final' },
  }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);

  await waitFor(() => expect(screen.getByTestId('stage-rail')).toHaveTextContent('● Draft in progress'));
});

test('with no draft at all the first stop reads "No draft yet", not the admin label (S503)', async () => {
  global.fetch.mockResolvedValueOnce(statusResponse({
    currentArtifact: null,
    stageLabels: { draft: 'Draft in progress', shared: 'Shared', visit: 'Visit', final: 'Final' },
  }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);

  await waitFor(() => expect(screen.getByTestId('stage-rail')).toHaveTextContent('● No draft yet'));
  expect(screen.getByTestId('stage-rail')).not.toHaveTextContent('Draft in progress');
  expect(screen.getByTestId('stage-rail')).not.toHaveTextContent('AI draft ready');
});

test('a pending generation with no current draft reads "Generating draft" on the first stop', async () => {
  global.fetch.mockResolvedValueOnce(statusResponse({
    currentArtifact: null,
    pendingArtifact: { artifactId: 'pending-artifact', operationStatus: 100000000 },
  }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);

  await waitFor(() => expect(screen.getByTestId('stage-rail')).toHaveTextContent('● Generating draft'));
});

test('a failed generation with no current draft reads "Draft failed" on the first stop', async () => {
  global.fetch.mockResolvedValueOnce(statusResponse({
    currentArtifact: null,
    pendingArtifact: { artifactId: 'failed-artifact', operationStatus: 100000002, retryable: true },
  }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);

  await waitFor(() => expect(screen.getByTestId('stage-rail')).toHaveTextContent('● Draft failed'));
});

test('a ready draft keeps "AI draft ready" even while a regeneration is pending', async () => {
  global.fetch.mockResolvedValueOnce(statusResponse({
    currentArtifact: readyArtifact(),
    pendingArtifact: { artifactId: 'pending-artifact', operationStatus: 100000000 },
  }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);

  await waitFor(() => expect(screen.getByTestId('stage-rail')).toHaveTextContent('● AI draft ready'));
});

test('the session\'s attendees become the composer\'s default To (tracker §5.6); without a session the site-visit party stays the default', async () => {
  siteVisitContextFeed = { siteVisit: { startIso: null }, suggestedTo: ['visit-organizer@example.org'], suggestedCc: ['visit-optional@example.org'] };
  global.fetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({
      success: true,
      currentArtifact: readyArtifact(100000001),
      pendingArtifact: null,
      reopenHistory: [],
      session: { scheduledStartIso: '2026-12-01T18:00:00Z', scheduledEndIso: null, ianaTimeZone: 'America/Los_Angeles', meetingLink: null, location: null },
      sessionAttendees: [{ name: 'A', email: 'a@example.org' }, { name: 'B', email: 'b@example.org' }],
    }),
  });
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);
  await waitFor(() => expect(screen.getByTestId('mock-suggested-to')).toHaveTextContent('a@example.org,b@example.org'));
  expect(screen.getByTestId('mock-suggested-cc')).toHaveTextContent('');
  expect(screen.getByTestId('mock-session')).toHaveTextContent('2026-12-01T18:00:00Z');
});

test('without session attendees the site-visit party remains the default recipients', async () => {
  siteVisitContextFeed = { siteVisit: { startIso: null }, suggestedTo: ['visit-organizer@example.org'], suggestedCc: ['visit-optional@example.org'] };
  global.fetch.mockResolvedValueOnce(statusResponse({ currentArtifact: readyArtifact(100000001) }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);
  await waitFor(() => expect(screen.getByTestId('mock-suggested-to')).toHaveTextContent('visit-organizer@example.org'));
  expect(screen.getByTestId('mock-suggested-cc')).toHaveTextContent('visit-optional@example.org');
  expect(screen.getByTestId('mock-session')).toHaveTextContent('none');
});

test('the applicant-materials line renders from the status payload at draft and shared stages, and not without a collection (plan §16.3, PR 3)', async () => {
  const materials = { state: 'missing', receivedCount: 1, requiredCount: 3, otherCount: 0, dueAt: '2026-10-05T19:00:00Z', closesAt: '2026-10-14T19:00:00Z', overdue: false, invited: true };
  global.fetch.mockResolvedValueOnce(statusResponse({ currentArtifact: readyArtifact(100000001), materials }));
  const { unmount } = render(<StaffDeliberationsTab requestId={REQUEST_ID} />);
  await screen.findByText('Working document:');
  expect(screen.getByTestId('deliberations-materials-line')).toHaveTextContent(/^Materials: 1 of 3 received · due /);
  unmount();

  global.fetch.mockResolvedValueOnce(statusResponse({ currentArtifact: readyArtifact(100000001) }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);
  await screen.findByText('Working document:');
  expect(screen.queryByTestId('deliberations-materials-line')).not.toBeInTheDocument();
});
