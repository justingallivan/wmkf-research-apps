/**
 * @jest-environment jsdom
 *
 * Merged suite (S466), rebuilt for slice 5 of
 * docs/plans/PRE_RESEARCH_PRESENTATION_BRIEF_PLAN_2026-09-16.md: the tab now
 * carries two independent governed artifacts (brief + legacy Pre-Site
 * writeup) fetched from two GET endpoints, with Share locking and
 * distributing the BRIEF (never start-site-visit) and an explicit Start
 * Site Visit action on the Pre-Site card (B11).
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import StaffDeliberationsTab from '../../shared/components/workbench/StaffDeliberationsTab';
import { PRE_SITE_REOPEN_REASON } from '../../shared/config/requestDocument';

jest.mock('../../shared/components/Layout', () => ({
  Card: ({ children }) => <div>{children}</div>,
}));

let distributionHistoryFeed = null;
let lastDistributionProps = null;
// Codex adversarial review finding 3 (2026-09-16 round 2): records the
// sourceArtifact id seen on each MOUNT (empty deps -- a real component
// mount, not merely a re-render with new props) of the mocked panel. The
// real panel's own history-load effect only re-runs on `requestId` change
// (never on `sourceArtifact` alone -- lib/services is not in play here, this
// mirrors PreSiteDistributionPanel.js's own effect dependency array), so
// proving the tab actually forces a fresh mount for a new brief artifact id
// (via the `key` on <PreSiteDistributionPanel>) is what proves history gets
// reloaded rather than silently keeping the predecessor's cached state.
let mountedSourceArtifactIds = [];
jest.mock('../../shared/components/workbench/PreSiteDistributionPanel', () => {
  const { useEffect } = require('react');
  const { useState } = require('react');
  function MockDistributionPanel(props) {
    const [lockError, setLockError] = useState(null);
    lastDistributionProps = props;
    useEffect(() => {
      mountedSourceArtifactIds.push(props.sourceArtifact?.artifactId || 'none');
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    useEffect(() => {
      if (distributionHistoryFeed) props.onHistory?.(distributionHistoryFeed);
    }, [props]);
    return (
      <div>
        <span>{`Distribution panel: ${props.composer}${props.record ? ' (record)' : ''}${props.needsLock ? ' (lock required)' : ''}`}</span>
        <span data-testid="mock-source-artifact-id">{props.sourceArtifact?.artifactId || 'none'}</span>
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
const PRESITE_ARTIFACT_ID = '22222222-2222-4222-8222-222222222222';
const BRIEF_ARTIFACT_ID = '44444444-4444-4444-8444-444444444444';
const REOPENED_BRIEF_ARTIFACT_ID = '66666666-6666-4666-8666-666666666666';

const DRAFT = 100000000;
const REVIEW = 100000001;
const FINAL = 100000004;
const READY = 100000001;
const GENERATING = 100000000;
const FAILED = 100000002;

function preSiteArtifact(lifecycleState = DRAFT) {
  return {
    artifactId: PRESITE_ARTIFACT_ID,
    operationStatus: READY,
    lifecycleState,
    file: {
      name: '1002379 Pre-Site Visit.docx',
      webUrl: 'https://sharepoint.test/pre-site.docx',
    },
    milestone: lifecycleState === REVIEW ? {
      versionId: '2.0',
      contentHash: 'gdc1:handoff',
      createdAt: '2026-08-17T21:05:00Z',
    } : null,
  };
}

function briefArtifact(lifecycleState = DRAFT, { receivedReviewCount = 1, artifactId = BRIEF_ARTIFACT_ID } = {}) {
  return {
    artifactId,
    operationStatus: READY,
    lifecycleState,
    file: {
      name: '1002379 Pre-RP Brief.docx',
      webUrl: 'https://sharepoint.test/brief.docx',
    },
    milestone: lifecycleState === REVIEW ? {
      versionId: '3.0',
      contentHash: 'gdc1:brief-lock',
      createdAt: '2026-09-01T15:00:00Z',
    } : null,
    receivedReviewCount,
  };
}

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function statusResponse({
  currentArtifact = null,
  pendingArtifact = null,
  reopenHistory = [],
  stageLabels = null,
  materials = null,
  session = null,
  sessionAttendees = null,
  hasBriefRows = undefined,
} = {}) {
  return response({
    success: true,
    currentArtifact,
    pendingArtifact,
    reopenHistory,
    ...(stageLabels ? { stageLabels } : {}),
    ...(materials ? { materials } : {}),
    ...(session ? { session } : {}),
    ...(sessionAttendees ? { sessionAttendees } : {}),
    ...(hasBriefRows === undefined ? {} : { hasBriefRows }),
  });
}

// ── URL-routed fetch mock: two independent GET endpoints (Pre-Site writeup,
// brief) plus per-route POST endpoints. Each route has its own FIFO queue;
// draining it falls back to an empty/successful default so tests only queue
// the responses they care about.
const ROUTE_DEFS = [
  { key: 'briefLock', test: (u, m) => m === 'POST' && u.includes('/pre-rp-brief/lock-for-share') },
  { key: 'briefReopen', test: (u, m) => m === 'POST' && u.includes('/pre-rp-brief/reopen') },
  { key: 'startSiteVisit', test: (u, m) => m === 'POST' && u.includes('/pre-site-visit/start-site-visit') },
  { key: 'reopen', test: (u, m) => m === 'POST' && u.includes('/pre-site-visit/reopen') },
  { key: 'briefGet', test: (u, m) => m === 'GET' && u.includes('/pre-rp-brief') },
  { key: 'briefPost', test: (u, m) => m === 'POST' && u.includes('/pre-rp-brief') },
  { key: 'presiteGet', test: (u, m) => m === 'GET' && u.includes('/pre-site-visit') },
  { key: 'presitePost', test: (u, m) => m === 'POST' && u.includes('/pre-site-visit') },
];
let queues;

function queueRoute(key, resp) {
  queues[key].push(resp);
}

const defaultFor = {
  briefLock: () => response({ success: true, artifact: briefArtifact(REVIEW), reused: false }),
  briefReopen: () => response({ success: true, artifact: briefArtifact(DRAFT), reused: false }),
  startSiteVisit: () => response({ success: true, artifact: preSiteArtifact(REVIEW) }),
  reopen: () => response({ success: true, artifact: preSiteArtifact(DRAFT), reused: false }),
  // NEW-5 (Opus round 2): the default brief GET reports no brief rows at
  // all, so Pre-Site-only tests exercise the production
  // no-brief-rows-at-all branch (H1/§3.5) rather than an ambiguous
  // "briefGet defaults were never queued" state.
  briefGet: () => statusResponse({ hasBriefRows: false }),
  briefPost: () => response({ success: true, artifact: briefArtifact(DRAFT) }),
  presiteGet: () => statusResponse(),
  presitePost: () => response({ success: true, artifact: preSiteArtifact(DRAFT) }),
};

function calls(key) {
  return global.fetch.mock.calls.filter(([url, options = {}]) => {
    const route = ROUTE_DEFS.find((r) => r.test(url, options.method || 'GET'));
    return route?.key === key;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  distributionHistoryFeed = null;
  lastDistributionProps = null;
  mountedSourceArtifactIds = [];
  siteVisitContextFeed = null;
  visitExpectedFeed = true;
  queues = Object.fromEntries(ROUTE_DEFS.map((r) => [r.key, []]));
  global.fetch = jest.fn(async (url, options = {}) => {
    const method = options.method || 'GET';
    const route = ROUTE_DEFS.find((r) => r.test(url, method));
    if (!route) throw new Error(`Unmocked fetch: ${method} ${url}`);
    const queue = queues[route.key];
    if (queue.length) return queue.shift();
    return defaultFor[route.key]();
  });
});
afterEach(() => {
  jest.restoreAllMocks();
});

// ── Pre-Site Visit Writeup card (generate/regenerate/download; independent
// of the brief) ──────────────────────────────────────────────────────────

test('M2: loads existing Ready actions without another generation request', async () => {
  queueRoute('presiteGet', statusResponse({ currentArtifact: preSiteArtifact(DRAFT) }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);

  const link = await screen.findByRole('link', { name: 'Edit in Word' });
  expect(link).toHaveAttribute('href', 'https://sharepoint.test/pre-site.docx');
  fireEvent.click(screen.getByRole('button', { name: 'More writeup actions' }));
  expect(screen.getByRole('menuitem', { name: 'Download' })).toBeInTheDocument();
  expect(screen.getByRole('menuitem', { name: 'Regenerate Word Draft' })).toBeInTheDocument();
  expect(calls('presitePost')).toHaveLength(0);
  expect(calls('presiteGet')).toHaveLength(1);
});

test('Pre-Site card: Generate, then Edit in Word plus Start Site Visit; Download/Regenerate under More', async () => {
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);

  expect(await screen.findByTestId('deliberations-stage-sentence'))
    .toHaveTextContent('Generate the AI draft in Word to start staff deliberations for this proposal.');
  fireEvent.click(screen.getByRole('button', { name: 'Generate Word Draft' }));

  await waitFor(() => expect(calls('presitePost')).toHaveLength(1));
  expect(JSON.parse(calls('presitePost')[0][1].body)).toEqual({ requestId: REQUEST_ID });

  const edit = await screen.findByRole('link', { name: 'Edit in Word' });
  expect(edit).toHaveAttribute('href', 'https://sharepoint.test/pre-site.docx');
  expect(screen.getByRole('button', { name: 'Start Site Visit' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'More writeup actions' }));
  expect(screen.getByRole('menuitem', { name: 'Download' }))
    .toHaveAttribute('href', 'https://sharepoint.test/pre-site.docx?download=1');
  expect(screen.getByRole('menuitem', { name: 'Regenerate Word Draft' })).toBeEnabled();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
});

test('Pre-Site card: Start Site Visit calls start-site-visit and moves the Pre-Site row to Review', async () => {
  queueRoute('presiteGet', statusResponse({ currentArtifact: preSiteArtifact(DRAFT) }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Start Site Visit' }));

  await waitFor(() => expect(calls('startSiteVisit')).toHaveLength(1));
  expect(JSON.parse(calls('startSiteVisit')[0][1].body)).toEqual({
    requestId: REQUEST_ID,
    expectedArtifactId: PRESITE_ARTIFACT_ID,
  });
  expect(await screen.findByRole('link', { name: 'Open working document' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Start Site Visit' })).not.toBeInTheDocument();
  // Share never calls start-site-visit and is not on this card at all.
  expect(screen.queryByRole('button', { name: 'Share…' })).not.toBeInTheDocument();
});

test('M4: Start Site Visit requires the Pre-Site row to be Draft (not offered once shared)', async () => {
  queueRoute('presiteGet', statusResponse({ currentArtifact: preSiteArtifact(REVIEW) }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);

  await screen.findByRole('link', { name: 'Open working document' });
  expect(screen.queryByRole('button', { name: 'Start Site Visit' })).not.toBeInTheDocument();
  expect(calls('startSiteVisit')).toHaveLength(0);
});

test('NEW-2: Start Site Visit is disabled while a Pre-Site regeneration is in flight', async () => {
  let resolvePost;
  queueRoute('presiteGet', statusResponse({ currentArtifact: preSiteArtifact(DRAFT) }));
  global.fetch = jest.fn(async (url, options = {}) => {
    const method = options.method || 'GET';
    const route = ROUTE_DEFS.find((r) => r.test(url, method));
    if (route?.key === 'presitePost') return new Promise((resolve) => { resolvePost = resolve; });
    const queue = queues[route.key];
    if (queue.length) return queue.shift();
    return defaultFor[route.key]();
  });
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);

  expect(await screen.findByRole('button', { name: 'Start Site Visit' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'More writeup actions' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Regenerate Word Draft' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Regenerate' }));

  await waitFor(() => expect(screen.getByRole('button', { name: 'Start Site Visit' })).toBeDisabled());

  await act(async () => { resolvePost(response({ success: true, artifact: preSiteArtifact(DRAFT) })); });
});

test('Pre-Site card: regenerate opens a confirmation dialog scoped to the writeup', async () => {
  queueRoute('presiteGet', statusResponse({ currentArtifact: preSiteArtifact(DRAFT) }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);

  fireEvent.click(await screen.findByRole('button', { name: 'More writeup actions' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Regenerate Word Draft' }));
  const dialog = screen.getByRole('dialog', { name: 'Regenerate this draft?' });
  expect(dialog).toHaveTextContent('will not be carried into the new draft');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(calls('presitePost')).toHaveLength(0);

  fireEvent.click(screen.getByRole('button', { name: 'More writeup actions' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Regenerate Word Draft' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Regenerate' }));
  await waitFor(() => expect(calls('presitePost')).toHaveLength(1));
});

test('Pre-Site card: a server error on generate shows an alert without creating a Word link', async () => {
  queueRoute('presitePost', response({ error: 'No usable AI proposal narrative was found.' }, 409));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);

  fireEvent.click(screen.getByRole('button', { name: 'Generate Word Draft' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('No usable AI proposal narrative was found.');
});

test('M2: recovers a Ready Word link after the generation connection is interrupted', async () => {
  let getCount = 0;
  global.fetch = jest.fn(async (url, options = {}) => {
    const method = options.method || 'GET';
    const route = ROUTE_DEFS.find((r) => r.test(url, method));
    if (route?.key === 'presitePost') throw new TypeError('Failed to fetch');
    if (route?.key === 'presiteGet') {
      getCount += 1;
      return getCount === 1 ? statusResponse() : statusResponse({ currentArtifact: preSiteArtifact(DRAFT) });
    }
    const queue = queues[route.key];
    if (queue.length) return queue.shift();
    return defaultFor[route.key]();
  });
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);
  await waitFor(() => expect(calls('presiteGet')).toHaveLength(1));

  fireEvent.click(screen.getByRole('button', { name: 'Generate Word Draft' }));

  const link = await screen.findByRole('link', { name: 'Edit in Word' });
  expect(link).toHaveAttribute('href', 'https://sharepoint.test/pre-site.docx');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(calls('presitePost')).toHaveLength(1);
  expect(calls('presiteGet')).toHaveLength(2);
});

test('M2: unmounting mid-generate aborts the in-flight request and publishes nothing', async () => {
  let resolveFirst;
  let capturedSignal = null;
  global.fetch = jest.fn(async (url, options = {}) => {
    const method = options.method || 'GET';
    const route = ROUTE_DEFS.find((r) => r.test(url, method));
    if (route?.key === 'presitePost') {
      capturedSignal = options.signal;
      return new Promise((resolve) => { resolveFirst = resolve; });
    }
    const queue = queues[route.key];
    if (queue.length) return queue.shift();
    return defaultFor[route.key]();
  });
  const { unmount } = render(<StaffDeliberationsTab key={REQUEST_ID} requestId={REQUEST_ID} />);

  await waitFor(() => expect(calls('presiteGet')).toHaveLength(1));
  fireEvent.click(screen.getByRole('button', { name: 'Generate Word Draft' }));
  await waitFor(() => expect(capturedSignal).not.toBeNull());
  expect(capturedSignal.aborted).toBe(false);

  unmount();
  // The effect cleanup bumps `generationSequence` and aborts the controller,
  // so the late response is dropped rather than applied to a dead tree.
  expect(capturedSignal.aborted).toBe(true);
  await act(async () => { resolveFirst(response({ success: true, artifact: preSiteArtifact(DRAFT) })); });
  expect(calls('presiteGet')).toHaveLength(1);
});

test('M2: a late response after switching to another request (remount) cannot publish a stale Word link', async () => {
  let resolveFirst;
  global.fetch = jest.fn(async (url, options = {}) => {
    const method = options.method || 'GET';
    const route = ROUTE_DEFS.find((r) => r.test(url, method));
    if (route?.key === 'presitePost') return new Promise((resolve) => { resolveFirst = resolve; });
    const queue = queues[route.key];
    if (queue.length) return queue.shift();
    return defaultFor[route.key]();
  });
  const { rerender } = render(<StaffDeliberationsTab key={REQUEST_ID} requestId={REQUEST_ID} />);

  await waitFor(() => expect(calls('presiteGet')).toHaveLength(1));
  fireEvent.click(screen.getByRole('button', { name: 'Generate Word Draft' }));
  // The workbench keys the tab by requestId; mirror that so the switch remounts.
  rerender(<StaffDeliberationsTab key={OTHER_REQUEST_ID} requestId={OTHER_REQUEST_ID} />);
  await act(async () => { resolveFirst(response({ success: true, artifact: preSiteArtifact(DRAFT) })); });

  await waitFor(() => expect(screen.getByRole('button', { name: 'Generate Word Draft' })).toBeEnabled());
  expect(screen.queryByRole('link', { name: 'Edit in Word' })).not.toBeInTheDocument();
});

test('M2: refreshes durable failure state once and shows its support reference', async () => {
  let getCount = 0;
  global.fetch = jest.fn(async (url, options = {}) => {
    const method = options.method || 'GET';
    const route = ROUTE_DEFS.find((r) => r.test(url, method));
    if (route?.key === 'presitePost') {
      return response({ error: 'Pre-Site Visit generation did not complete.', runId: 'run-from-post' }, 502);
    }
    if (route?.key === 'presiteGet') {
      getCount += 1;
      return getCount === 1 ? statusResponse() : statusResponse({
        pendingArtifact: {
          artifactId: 'failed-artifact',
          operationStatus: FAILED,
          retryable: false,
          lastError: { message: 'The governed output was invalid.', supportReference: 'durable-run-id' },
        },
      });
    }
    const queue = queues[route.key];
    if (queue.length) return queue.shift();
    return defaultFor[route.key]();
  });
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);
  await waitFor(() => expect(calls('presiteGet')).toHaveLength(1));

  fireEvent.click(screen.getByRole('button', { name: 'Generate Word Draft' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('The governed output was invalid.');
  expect(screen.getByRole('alert')).toHaveTextContent('Support reference: durable-run-id');
  expect(screen.getByText(/needs a prompt or application change/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Generate Word Draft' })).toBeDisabled();
  expect(calls('presitePost')).toHaveLength(1);
  expect(calls('presiteGet')).toHaveLength(2);
});

test('Pre-Site card: shows durable Ready warnings beside the Word link', async () => {
  queueRoute('presiteGet', statusResponse({
    currentArtifact: {
      ...preSiteArtifact(),
      warnings: [{ code: 'section_over_target', message: 'A generated section is longer than suggested and may need editing.' }],
    },
  }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);

  expect(await screen.findByRole('heading', { name: 'Draft needs a quick edit check' })).toBeInTheDocument();
  expect(screen.getByText(/longer than suggested/i)).toBeInTheDocument();
});

// ── Pre-Research Presentation Brief card ─────────────────────────────────

test('Brief card: Generate, then Edit in Word plus Share…; Download/Regenerate under More', async () => {
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Generate Brief' }));

  await waitFor(() => expect(calls('briefPost')).toHaveLength(1));
  const briefBody = JSON.parse(calls('briefPost')[0][1].body);
  expect(briefBody.requestId).toBe(REQUEST_ID);
  expect(briefBody.clientOperationId).toEqual(expect.any(String));

  const edit = await screen.findByRole('link', { name: 'Edit in Word' });
  expect(edit).toHaveAttribute('href', 'https://sharepoint.test/brief.docx');
  expect(screen.getByRole('button', { name: 'Share…' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'More brief actions' }));
  expect(screen.getByRole('menuitem', { name: 'Download' }))
    .toHaveAttribute('href', 'https://sharepoint.test/brief.docx?download=1');
  expect(screen.getByRole('menuitem', { name: 'Regenerate Brief' })).toBeEnabled();
});

test('H3a/B10: Share is disabled with a reason when the brief has zero received reviews', async () => {
  queueRoute('briefGet', statusResponse({
    currentArtifact: briefArtifact(DRAFT, { receivedReviewCount: 0 }),
  }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);

  const shareButton = await screen.findByRole('button', { name: 'Share…' });
  expect(shareButton).toBeDisabled();
  expect(screen.getByText(/Share is blocked until at least one review is received/)).toBeInTheDocument();
});

test('Share is disabled with a distinct reason when the brief snapshot could not be read', async () => {
  queueRoute('briefGet', statusResponse({
    currentArtifact: briefArtifact(DRAFT, { receivedReviewCount: null }),
  }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);

  const shareButton = await screen.findByRole('button', { name: 'Share…' });
  expect(shareButton).toBeDisabled();
  expect(screen.getByText(/stored input record could not be read/)).toBeInTheDocument();
  expect(screen.queryByText(/Share is blocked until at least one review is received/)).not.toBeInTheDocument();
});

test('H3a/B10: Share is enabled once at least one review is received', async () => {
  queueRoute('briefGet', statusResponse({
    currentArtifact: briefArtifact(DRAFT, { receivedReviewCount: 1 }),
  }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);

  const shareButton = await screen.findByRole('button', { name: 'Share…' });
  expect(shareButton).toBeEnabled();
  expect(screen.queryByText(/Share is blocked until at least one review is received/)).not.toBeInTheDocument();
});

test('H3b/B12/NEW-1: Regenerate Brief is offered while the brief is shared but not yet sent, with replacement copy', async () => {
  distributionHistoryFeed = { attempts: [], currentSourceEverSent: false };
  queueRoute('briefGet', statusResponse({ currentArtifact: briefArtifact(REVIEW) }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);

  fireEvent.click(await screen.findByRole('button', { name: 'More brief actions' }));
  expect(screen.getByRole('menuitem', { name: 'Regenerate Brief' })).toBeEnabled();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Regenerate Brief' }));
  const dialog = screen.getByRole('dialog', { name: 'Regenerate this brief?' });
  expect(dialog).toHaveTextContent('replaces the brief currently shared for this deliberation');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Regenerate' }));
  await waitFor(() => expect(calls('briefPost')).toHaveLength(1));
});

test('NEW-1: Regenerate Brief is not offered once the shared brief has already been sent to the Board', async () => {
  distributionHistoryFeed = { attempts: [{ operationId: 'op-1', transportAccepted: true }], currentSourceEverSent: true };
  queueRoute('briefGet', statusResponse({ currentArtifact: briefArtifact(REVIEW) }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);

  await screen.findByRole('link', { name: 'Open working document' });
  fireEvent.click(screen.getByRole('button', { name: 'More brief actions' }));
  expect(screen.queryByRole('menuitem', { name: 'Regenerate Brief' })).not.toBeInTheDocument();
});

// ── Guarded regeneration of a brief already sent to the Board (owner
// decision 2026-09-16, plan §10) ─────────────────────────────────────────

test('Regenerate sent brief… is hidden for a non-superuser even once the brief has been sent', async () => {
  distributionHistoryFeed = { attempts: [{ operationId: 'op-1', transportAccepted: true }], currentSourceEverSent: true };
  queueRoute('briefGet', statusResponse({ currentArtifact: briefArtifact(REVIEW) }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} requestNumber="1002379" isSuperuser={false} />);

  await screen.findByRole('link', { name: 'Open working document' });
  fireEvent.click(screen.getByRole('button', { name: 'More brief actions' }));
  expect(screen.queryByRole('menuitem', { name: 'Regenerate sent brief…' })).not.toBeInTheDocument();
});

test('Regenerate sent brief… is shown for a superuser once sent, and hidden while not yet sent', async () => {
  distributionHistoryFeed = { attempts: [{ operationId: 'op-1', transportAccepted: true }], currentSourceEverSent: true };
  queueRoute('briefGet', statusResponse({ currentArtifact: briefArtifact(REVIEW) }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} requestNumber="1002379" isSuperuser />);

  await screen.findByRole('link', { name: 'Open working document' });
  fireEvent.click(screen.getByRole('button', { name: 'More brief actions' }));
  expect(screen.getByRole('menuitem', { name: 'Regenerate sent brief…' })).toBeInTheDocument();
});

test('Regenerate sent brief… is hidden for a superuser while the shared brief has not yet been sent', async () => {
  distributionHistoryFeed = { attempts: [], currentSourceEverSent: false };
  queueRoute('briefGet', statusResponse({ currentArtifact: briefArtifact(REVIEW) }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} requestNumber="1002379" isSuperuser />);

  await screen.findByRole('link', { name: 'Open working document' });
  fireEvent.click(screen.getByRole('button', { name: 'More brief actions' }));
  expect(screen.queryByRole('menuitem', { name: 'Regenerate sent brief…' })).not.toBeInTheDocument();
});

test('the guarded brief-reopen dialog stays disabled until reason, a valid note, and the exact request number are given, then submits exactly six fields', async () => {
  distributionHistoryFeed = { attempts: [{ operationId: 'op-1', transportAccepted: true }], currentSourceEverSent: true };
  queueRoute('briefGet', statusResponse({ currentArtifact: briefArtifact(REVIEW) }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} requestNumber="1002379" isSuperuser />);

  await screen.findByRole('link', { name: 'Open working document' });
  fireEvent.click(screen.getByRole('button', { name: 'More brief actions' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Regenerate sent brief…' }));

  const dialog = screen.getByRole('dialog', { name: 'Regenerate a brief the Board already received?' });
  const submit = within(dialog).getByRole('button', { name: 'Regenerate Sent Brief' });
  expect(submit).toBeDisabled();

  fireEvent.change(screen.getByLabelText('Reason'), { target: { value: PRE_SITE_REOPEN_REASON.ACCIDENTAL_HANDOFF } });
  expect(submit).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Correction note'), { target: { value: 'short' } });
  expect(submit).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Correction note'), { target: { value: 'The Board received an incomplete draft.' } });
  expect(submit).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Type request number 1002379 to confirm'), { target: { value: 'wrong-number' } });
  expect(submit).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Type request number 1002379 to confirm'), { target: { value: '1002379' } });
  expect(submit).toBeEnabled();

  fireEvent.click(submit);

  await waitFor(() => expect(calls('briefReopen')).toHaveLength(1));
  const sentBody = JSON.parse(calls('briefReopen')[0][1].body);
  expect(Object.keys(sentBody).sort()).toEqual([
    'clientOperationId',
    'expectedArtifactId',
    'reasonCode',
    'reasonNote',
    'requestId',
    'requestNumber',
  ]);
  expect(sentBody).toMatchObject({
    requestId: REQUEST_ID,
    expectedArtifactId: BRIEF_ARTIFACT_ID,
    requestNumber: '1002379',
    reasonCode: PRE_SITE_REOPEN_REASON.ACCIDENTAL_HANDOFF,
    reasonNote: 'The Board received an incomplete draft.',
  });
});

test('a successful guarded brief regeneration remounts distribution history for the new artifact id, so a later Share never reads the predecessor\'s "already sent" state', async () => {
  // Codex adversarial review finding 3 (2026-09-16 round 2): the mocked
  // panel's history-load effect only fires on a genuine mount (empty deps),
  // mirroring the real PreSiteDistributionPanel's own effect, which only
  // re-runs on a `requestId` change, never on `sourceArtifact` alone. So
  // `mountedSourceArtifactIds` below only grows if the tab's `key` on
  // <PreSiteDistributionPanel> actually changed, proving a real remount
  // (and therefore a fresh history load) happened for the new artifact id.
  distributionHistoryFeed = { attempts: [{ operationId: 'op-1', transportAccepted: true }], currentSourceEverSent: true };
  queueRoute('briefGet', statusResponse({ currentArtifact: briefArtifact(REVIEW) }));
  queueRoute('briefReopen', response({
    success: true,
    artifact: briefArtifact(DRAFT, { artifactId: REOPENED_BRIEF_ARTIFACT_ID }),
    reused: false,
  }));
  queueRoute('briefGet', statusResponse({ currentArtifact: briefArtifact(DRAFT, { artifactId: REOPENED_BRIEF_ARTIFACT_ID }) }));
  queueRoute('briefLock', response({
    success: true,
    artifact: briefArtifact(REVIEW, { artifactId: REOPENED_BRIEF_ARTIFACT_ID }),
    reused: false,
  }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} requestNumber="1002379" isSuperuser />);

  await screen.findByRole('link', { name: 'Open working document' });
  expect(mountedSourceArtifactIds).toEqual([BRIEF_ARTIFACT_ID]);
  fireEvent.click(screen.getByRole('button', { name: 'More brief actions' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Regenerate sent brief…' }));
  fireEvent.change(screen.getByLabelText('Reason'), { target: { value: PRE_SITE_REOPEN_REASON.ACCIDENTAL_HANDOFF } });
  fireEvent.change(screen.getByLabelText('Correction note'), { target: { value: 'The Board received an incomplete draft.' } });
  fireEvent.change(screen.getByLabelText('Type request number 1002379 to confirm'), { target: { value: '1002379' } });
  // The predecessor's history feed stays "sent" here; the successor's fresh
  // (post-remount) history load must report never-sent instead.
  distributionHistoryFeed = { attempts: [], currentSourceEverSent: false };
  fireEvent.click(screen.getByRole('button', { name: 'Regenerate Sent Brief' }));

  await waitFor(() => expect(calls('briefReopen')).toHaveLength(1));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Regenerate a brief the Board already received?' })).not.toBeInTheDocument());
  expect(await screen.findByRole('link', { name: 'Edit in Word' })).toBeInTheDocument();
  // Proves an actual remount happened for the new artifact id (a second,
  // fresh history load) rather than the mock merely re-rendering with
  // updated props under a stale, already-mounted history load.
  await waitFor(() => expect(mountedSourceArtifactIds).toEqual([BRIEF_ARTIFACT_ID, REOPENED_BRIEF_ARTIFACT_ID]));

  // Share the new Draft again, reaching the exact state where a stale
  // "already sent" signal from the superseded source would previously have
  // hidden Regenerate Brief and wrongly offered Send again.
  fireEvent.click(screen.getByRole('button', { name: 'Share…' }));
  fireEvent.click(screen.getByRole('button', { name: 'mock-prepare' }));
  await waitFor(() => expect(calls('briefLock')).toHaveLength(1));

  fireEvent.click(screen.getByRole('button', { name: 'More brief actions' }));
  expect(screen.getByRole('menuitem', { name: 'Regenerate Brief' })).toBeInTheDocument();
  expect(screen.queryByRole('menuitem', { name: 'Send the deliberation email again…' })).not.toBeInTheDocument();
});

test('Brief card: regenerate opens a brief-scoped confirmation dialog', async () => {
  queueRoute('briefGet', statusResponse({ currentArtifact: briefArtifact(DRAFT) }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);

  fireEvent.click(await screen.findByRole('button', { name: 'More brief actions' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Regenerate Brief' }));
  const dialog = screen.getByRole('dialog', { name: 'Regenerate this brief?' });
  expect(dialog).toHaveTextContent('prior file remains in SharePoint');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Regenerate' }));
  await waitFor(() => expect(calls('briefPost')).toHaveLength(1));
});

test('Brief card: a registry fault on the brief GET (e.g. an invalid pointer) does not crash the Pre-Site card', async () => {
  queueRoute('briefGet', response({ error: 'The current Pre-RP Brief request pointer requires reconciliation.', code: 'brief_pointer_invalid' }, 409));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);

  expect(await screen.findByRole('alert')).toHaveTextContent('requires reconciliation');
  // The Pre-Site card is unaffected and still offers Generate.
  expect(screen.getByRole('button', { name: 'Generate Word Draft' })).toBeInTheDocument();
});

// ── Share hand-off: locks the BRIEF, never start-site-visit (B11) ────────

test('Share… opens the composer bound to the brief as the source artifact', async () => {
  queueRoute('briefGet', statusResponse({ currentArtifact: briefArtifact(DRAFT) }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Share…' }));
  expect(screen.getByText('Distribution panel: dialog (lock required)')).toBeInTheDocument();
  expect(screen.getByTestId('mock-source-artifact-id')).toHaveTextContent(BRIEF_ARTIFACT_ID);

  fireEvent.click(screen.getByRole('button', { name: 'mock-close' }));
  expect(screen.getByText('Distribution panel: hidden (lock required)')).toBeInTheDocument();
});

test('the composer locks the BRIEF through lock-for-share (never start-site-visit) and enters Shared', async () => {
  queueRoute('briefGet', statusResponse({ currentArtifact: briefArtifact(DRAFT) }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} requestNumber="1002379" />);

  fireEvent.click(await screen.findByRole('button', { name: 'Share…' }));
  fireEvent.click(screen.getByRole('button', { name: 'mock-prepare' }));

  await waitFor(() => expect(calls('briefLock')).toHaveLength(1));
  expect(JSON.parse(calls('briefLock')[0][1].body)).toEqual({
    requestId: REQUEST_ID,
    expectedArtifactId: BRIEF_ARTIFACT_ID,
  });
  // The mutation-table item: this hand-off never calls start-site-visit.
  expect(calls('startSiteVisit')).toHaveLength(0);

  expect(await screen.findByText('Working document:')).toBeInTheDocument();
  expect(screen.getByTestId('stage-rail')).toHaveTextContent('● Shared');
  expect(screen.getByText('Distribution panel: dialog (record)')).toBeInTheDocument();
});

test('a lock failure is thrown to the composer and the brief stays at the draft stage for retry', async () => {
  queueRoute('briefGet', statusResponse({ currentArtifact: briefArtifact(DRAFT) }));
  queueRoute('briefLock', response({ error: 'The brief changed. Reload and retry.' }, 409));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Share…' }));
  fireEvent.click(screen.getByRole('button', { name: 'mock-prepare' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('mock-error: The brief changed. Reload and retry.');
  expect(screen.getByText('Distribution panel: dialog (lock required)')).toBeInTheDocument();
  expect(screen.getByTestId('stage-rail')).toHaveTextContent('● AI draft ready');
});

test('a late lock response cannot publish workspace state after the request changes', async () => {
  let resolveLock;
  // Every GET for either request returns a Draft-ready brief: the point of
  // this test is that the LOCK response for the abandoned request cannot
  // leak into the new request's (independently Draft-ready) workspace.
  global.fetch = jest.fn(async (url, options = {}) => {
    const method = options.method || 'GET';
    if (method === 'POST' && url.includes('/pre-rp-brief/lock-for-share')) {
      return new Promise((resolve) => { resolveLock = resolve; });
    }
    if (method === 'GET' && url.includes('/pre-rp-brief')) {
      return statusResponse({ currentArtifact: briefArtifact(DRAFT) });
    }
    return statusResponse();
  });
  const { rerender } = render(<StaffDeliberationsTab key={REQUEST_ID} requestId={REQUEST_ID} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Share…' }));
  fireEvent.click(screen.getByRole('button', { name: 'mock-prepare' }));
  rerender(<StaffDeliberationsTab key={OTHER_REQUEST_ID} requestId={OTHER_REQUEST_ID} />);
  await act(async () => {
    resolveLock(response({ success: true, artifact: briefArtifact(REVIEW), reused: false }));
  });

  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Share…' })[0]).toBeEnabled());
  expect(screen.queryByText('Working document:')).not.toBeInTheDocument();
});

// ── Composite stage (brief drives stage; finalReached from the Pre-Site row) ─

test('a shared brief shows the working workspace and distribution history', async () => {
  queueRoute('briefGet', statusResponse({
    currentArtifact: {
      ...briefArtifact(REVIEW),
      warnings: [{ code: 'section_over_target', message: 'A generated section is longer than suggested and may need editing.' }],
    },
  }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} requestNumber="1002379" />);

  expect(await screen.findByText('Working document:')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Share…' })).toBeInTheDocument();
  expect(screen.getByTestId('deliberations-stage-sentence'))
    .toHaveTextContent(`Shared on ${new Date('2026-09-01T15:00:00Z').toLocaleDateString()}.`);
  expect(screen.getByRole('heading', { name: 'Working document needs a quick edit check' })).toBeInTheDocument();
  expect(screen.getByTestId('stage-rail')).toHaveTextContent('✓ AI draft ready');
  expect(screen.getByTestId('stage-rail')).toHaveTextContent('● Shared');
  expect(screen.getByText('Distribution panel: hidden (record)')).toBeInTheDocument();
});

test('everSent is keyed to the brief source (not the Pre-Site source): a sent brief reads sent', async () => {
  distributionHistoryFeed = { attempts: [{ operationId: 'op-1', transportAccepted: true }], currentSourceEverSent: true };
  queueRoute('briefGet', statusResponse({ currentArtifact: briefArtifact(REVIEW) }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} requestNumber="1002379" />);

  await waitFor(() => expect(screen.getByTestId('deliberations-stage-sentence'))
    .toHaveTextContent('The deliberation email has gone out; keep editing the working document in Word.'));
  expect(screen.getByTestId('stage-rail')).toHaveTextContent('● Shared');
});

test('sends recorded against a superseded brief document do not set the current document to sent', async () => {
  distributionHistoryFeed = { attempts: [{ operationId: 'op-old', transportAccepted: true }], currentSourceEverSent: false };
  queueRoute('briefGet', statusResponse({ currentArtifact: briefArtifact(REVIEW) }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} requestNumber="1002379" />);

  await screen.findByText('Working document:');
  expect(screen.getByTestId('deliberations-stage-sentence')).toHaveTextContent('Send the deliberation email when you are ready.');
});

test('M2: a Final document offers one action, Open Final Writeup, and no More menu', async () => {
  const onSelectTab = jest.fn();
  queueRoute('presiteGet', statusResponse({ currentArtifact: preSiteArtifact(FINAL) }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} onSelectTab={onSelectTab} />);

  await waitFor(() => expect(screen.getByTestId('deliberations-stage-sentence')).toHaveTextContent('This proposal moved to Final Writeup.'));
  fireEvent.click(screen.getByRole('button', { name: 'Open Final Writeup' }));
  expect(onSelectTab).toHaveBeenCalledWith('final-writeup');
  expect(screen.queryByRole('button', { name: 'More brief actions' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'More writeup actions' })).not.toBeInTheDocument();
  expect(screen.queryByTestId('deliberations-session-line')).not.toBeInTheDocument();
});

test('M2: a failed latest send shows a red line and a Resend action that opens the composer', async () => {
  distributionHistoryFeed = {
    attempts: [{ operationId: 'op-2', transportAccepted: false, lastError: 'Dynamics refused the send.' }],
    currentSourceEverSent: true,
    latestSendFailure: { operationId: 'op-2', message: 'Dynamics refused the send.' },
  };
  queueRoute('briefGet', statusResponse({ currentArtifact: briefArtifact(REVIEW) }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} requestNumber="1002379" />);

  expect(await screen.findByTestId('deliberations-send-failure'))
    .toHaveTextContent('The last send failed: Dynamics refused the send.');
  fireEvent.click(screen.getByRole('button', { name: 'Resend' }));
  expect(screen.getByText(/Distribution panel: dialog \(record\)/)).toBeInTheDocument();
});

test('M2: a failed generation with no current draft reads Draft failed on the first stop', async () => {
  queueRoute('briefGet', statusResponse({
    currentArtifact: null,
    pendingArtifact: { artifactId: 'failed-artifact', operationStatus: FAILED, retryable: true },
  }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);

  await waitFor(() => expect(screen.getByTestId('stage-rail')).toHaveTextContent('● Draft failed'));
});

test('Final Writeup activation marks the Pre-Site row FINAL while the brief stays Review: the rail reads Final', async () => {
  const onSelectTab = jest.fn();
  queueRoute('presiteGet', statusResponse({ currentArtifact: preSiteArtifact(FINAL) }));
  queueRoute('briefGet', statusResponse({ currentArtifact: briefArtifact(REVIEW) }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} onSelectTab={onSelectTab} />);

  await waitFor(() => expect(screen.getByTestId('deliberations-stage-sentence')).toHaveTextContent('This proposal moved to Final Writeup.'));
  fireEvent.click(screen.getByRole('button', { name: 'Open Final Writeup' }));
  expect(onSelectTab).toHaveBeenCalledWith('final-writeup');
});

test('at the visit stage, Pre-Site still Draft: the card names the Site Visit prerequisite instead of Continue in Final Writeup', async () => {
  siteVisitContextFeed = { siteVisit: { startIso: '2020-01-01T00:00:00Z' } };
  queueRoute('briefGet', statusResponse({ currentArtifact: briefArtifact(REVIEW) }));
  queueRoute('presiteGet', statusResponse({ currentArtifact: preSiteArtifact(DRAFT) }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} onSelectTab={jest.fn()} />);

  await screen.findByText('Working document:');
  expect(screen.getByTestId('stage-rail')).toHaveTextContent('● Visit');
  expect(screen.getByTestId('final-writeup-prerequisite'))
    .toHaveTextContent('Start the Site Visit on this writeup before continuing to Final Writeup.');
  expect(screen.queryByRole('button', { name: 'Continue in Final Writeup' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Start Site Visit' })).toBeInTheDocument();
});

test('at the visit stage with the Pre-Site row already Review, Continue in Final Writeup is offered', async () => {
  const onSelectTab = jest.fn();
  siteVisitContextFeed = { siteVisit: { startIso: '2020-01-01T00:00:00Z' } };
  queueRoute('briefGet', statusResponse({ currentArtifact: briefArtifact(REVIEW) }));
  queueRoute('presiteGet', statusResponse({ currentArtifact: preSiteArtifact(REVIEW) }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} onSelectTab={onSelectTab} />);

  await waitFor(() => expect(screen.getAllByText('Working document:').length).toBeGreaterThan(0));
  expect(screen.getByTestId('stage-rail')).toHaveTextContent('● Visit');
  fireEvent.click(screen.getByRole('button', { name: 'Continue in Final Writeup' }));
  expect(onSelectTab).toHaveBeenCalledWith('final-writeup');
});

test('H1/§3.5: no brief rows at all falls back to the legacy Pre-Site rail (past visit, Review row reads Visit stage)', async () => {
  const onSelectTab = jest.fn();
  siteVisitContextFeed = { siteVisit: { startIso: '2020-01-01T00:00:00Z' } };
  queueRoute('briefGet', statusResponse({ currentArtifact: null, pendingArtifact: null, hasBriefRows: false }));
  queueRoute('presiteGet', statusResponse({ currentArtifact: preSiteArtifact(REVIEW) }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} onSelectTab={onSelectTab} />);

  await waitFor(() => expect(screen.getAllByText('Working document:').length).toBeGreaterThan(0));
  expect(screen.getByTestId('stage-rail')).toHaveTextContent('● Visit');
  fireEvent.click(screen.getByRole('button', { name: 'Continue in Final Writeup' }));
  expect(onSelectTab).toHaveBeenCalledWith('final-writeup');
});

test('H1: a brief status fetch error never falls back to the legacy rail (renders an error state instead)', async () => {
  queueRoute('briefGet', response({ error: 'Brief status check failed.' }, 500));
  queueRoute('presiteGet', statusResponse({ currentArtifact: preSiteArtifact(REVIEW) }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);

  expect(await screen.findByTestId('deliberations-stage-error'))
    .toHaveTextContent('Brief status check failed.');
  expect(screen.queryByTestId('stage-rail')).not.toBeInTheDocument();
});

// ── Fail-closed states ────────────────────────────────────────────────────

test.each([
  ['Board Ready', 100000002],
  ['Superseded', 100000003],
  ['unknown', 999999999],
])('a %s brief lifecycle fails closed as read-only at the rail', async (_label, lifecycleState) => {
  queueRoute('briefGet', statusResponse({ currentArtifact: { ...briefArtifact(), lifecycleState } }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);

  expect(await screen.findByRole('heading', { name: 'Staff Deliberations is read-only' })).toBeInTheDocument();
  expect(screen.getByText(/cannot be downloaded or regenerated from this tab/i)).toBeInTheDocument();
  // The banner speaks for the brief only; the Site Visit writeup card keeps
  // its own affordances, so the copy must not claim editing is locked.
  expect(screen.queryByText(/cannot be edited/i)).not.toBeInTheDocument();
  // L3: no Edit/Download/Regenerate affordances render alongside the read-only panel.
  expect(screen.queryByRole('link', { name: 'Edit in Word' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Open working document' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'More brief actions' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Download' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Regenerate/ })).not.toBeInTheDocument();
});

test('M1: a shared brief without a current Word URL fails closed with an explanation', async () => {
  queueRoute('briefGet', statusResponse({
    currentArtifact: { ...briefArtifact(REVIEW), file: { name: '1002379 Pre-RP Brief.docx', webUrl: null } },
  }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);

  expect(await screen.findByRole('heading', { name: 'Pre-Research Presentation Brief is read-only' }))
    .toBeInTheDocument();
  expect(screen.getByText(/No current Word link was returned/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Share…' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Open working document' })).not.toBeInTheDocument();
});

test('M1: a shared Pre-Site writeup without a current Word URL fails closed with an explanation', async () => {
  queueRoute('presiteGet', statusResponse({
    currentArtifact: { ...preSiteArtifact(REVIEW), file: { name: '1002379 Pre-Site Visit.docx', webUrl: null } },
  }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);

  expect(await screen.findByRole('heading', { name: 'Pre-Site Visit Writeup is read-only' }))
    .toBeInTheDocument();
  expect(screen.getByText(/No current Word link was returned/i)).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Open working document' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Start Site Visit' })).not.toBeInTheDocument();
});

// ── Guarded reopen (Pre-Site scoped; unaffected by the brief) ────────────

test('only superusers can see the administration section and reopen control', async () => {
  queueRoute('presiteGet', statusResponse({ currentArtifact: preSiteArtifact(REVIEW) }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} requestNumber="1002379" isSuperuser={false} />);
  await screen.findByRole('link', { name: 'Open working document' });
  expect(screen.queryByRole('button', { name: 'Reopen Pre-Site Draft' })).not.toBeInTheDocument();
  expect(screen.queryByText(/Administration — guarded reopen/)).not.toBeInTheDocument();
});

test('validates confirmation and submits one guarded reopen, returning the writeup to Draft', async () => {
  queueRoute('presiteGet', statusResponse({ currentArtifact: preSiteArtifact(REVIEW) }));
  queueRoute('reopen', response({ success: true, artifact: preSiteArtifact(DRAFT), reused: false, recovered: false, inProgress: false }));
  queueRoute('presiteGet', statusResponse({
    currentArtifact: preSiteArtifact(DRAFT),
    reopenHistory: [{
      artifactId: PRESITE_ARTIFACT_ID,
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
  render(<StaffDeliberationsTab requestId={REQUEST_ID} requestNumber="1002379" isSuperuser />);

  await screen.findByRole('link', { name: 'Open working document' });
  fireEvent.click(screen.getByText(/Administration — guarded reopen/));
  fireEvent.click(screen.getByRole('button', { name: 'Reopen Pre-Site Draft' }));
  const submit = screen.getByRole('button', { name: 'Create Draft Successor' });
  expect(submit).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Reason'), { target: { value: PRE_SITE_REOPEN_REASON.ACCIDENTAL_HANDOFF } });
  fireEvent.change(screen.getByLabelText('Correction note'), { target: { value: 'The handoff was started too early.' } });
  fireEvent.change(screen.getByLabelText('Type request number 1002379 to confirm'), { target: { value: '1002379' } });
  expect(submit).toBeEnabled();
  fireEvent.click(submit);

  await waitFor(() => expect(calls('reopen')).toHaveLength(1));
  expect(JSON.parse(calls('reopen')[0][1].body)).toMatchObject({
    requestId: REQUEST_ID,
    expectedArtifactId: PRESITE_ARTIFACT_ID,
    requestNumber: '1002379',
    reasonCode: PRE_SITE_REOPEN_REASON.ACCIDENTAL_HANDOFF,
    reasonNote: 'The handoff was started too early.',
  });
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Guarded reopen' })).not.toBeInTheDocument());
  expect(await screen.findByRole('button', { name: 'Start Site Visit' })).toBeInTheDocument();
  expect(screen.getByTestId('stage-rail')).toHaveTextContent('reopened');
});

test('M2: a failed submit keeps one operation id and immutable audit inputs for safe retry', async () => {
  queueRoute('presiteGet', statusResponse({ currentArtifact: preSiteArtifact(REVIEW) }));
  queueRoute('reopen', response({ error: 'The first attempt failed.', code: 'pre_site_reopen_copy_verification_failed' }, 409));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} requestNumber="1002379" isSuperuser />);

  await screen.findByRole('link', { name: 'Open working document' });
  fireEvent.click(screen.getByText(/Administration — guarded reopen/));
  fireEvent.click(screen.getByRole('button', { name: 'Reopen Pre-Site Draft' }));
  fireEvent.change(screen.getByLabelText('Reason'), { target: { value: PRE_SITE_REOPEN_REASON.ACCIDENTAL_HANDOFF } });
  fireEvent.change(screen.getByLabelText('Correction note'), { target: { value: 'The handoff was started too early.' } });
  fireEvent.change(screen.getByLabelText('Type request number 1002379 to confirm'), { target: { value: '1002379' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create Draft Successor' }));
  expect(await screen.findByText('The first attempt failed.')).toBeInTheDocument();

  const firstCall = calls('reopen')[0];
  const firstOperationId = JSON.parse(firstCall[1].body).clientOperationId;
  expect(screen.getByLabelText('Reason')).toBeDisabled();
  expect(screen.getByLabelText('Correction note')).toBeDisabled();
  expect(screen.getByLabelText('Type request number 1002379 to confirm')).toBeDisabled();
  expect(screen.getByText(/keeps its original reason and confirmation/i)).toBeInTheDocument();

  queueRoute('reopen', response({ success: true, artifact: preSiteArtifact(DRAFT), reused: false, recovered: false, inProgress: false }));
  fireEvent.click(screen.getByRole('button', { name: 'Create Draft Successor' }));

  await waitFor(() => expect(calls('reopen')).toHaveLength(2));
  const secondCall = calls('reopen')[1];
  expect(JSON.parse(secondCall[1].body).clientOperationId).toBe(firstOperationId);
});

test('renders append-only guarded reopen history from the status contract', async () => {
  queueRoute('presiteGet', statusResponse({
    currentArtifact: preSiteArtifact(REVIEW),
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
      cleanupRequired: [{ driveId: 'retained-drive', itemId: 'retained-item', reason: 'abandoned_failed_reopen_copy_retained' }],
    }],
  }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} requestNumber="1002379" isSuperuser />);

  await screen.findByRole('link', { name: 'Open working document' });
  fireEvent.click(screen.getByText(/Administration — guarded reopen/));
  expect(screen.getByText('Guarded reopen attempts')).toBeInTheDocument();
  expect(screen.getByText('Needs reconciliation')).toBeInTheDocument();
  expect(screen.getByText('A retained SharePoint copy requires reconciliation.')).toBeInTheDocument();
});

// ── PC Meeting Tracker slice 3: the visit stop and admin-editable labels ─────

test('a draft-stage request with no scheduled visit shows "Visit not scheduled"', async () => {
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);
  expect(await screen.findByText('Visit not scheduled.')).toBeInTheDocument();
});

test('when visitExpected() is false, the visit line is not rendered at the draft stage', async () => {
  visitExpectedFeed = false;
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);
  await screen.findByTestId('stage-rail');
  expect(screen.queryByTestId('deliberations-visit-line')).not.toBeInTheDocument();
});

test('admin-editable stageLabels override the code-owned defaults on the rail', async () => {
  queueRoute('briefGet', statusResponse({
    currentArtifact: briefArtifact(),
  }));
  queueRoute('presiteGet', statusResponse({
    stageLabels: { draft: 'Draft in progress', shared: 'Shared', visit: 'Visit', final: 'Final' },
  }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);
  await waitFor(() => expect(screen.getByTestId('stage-rail')).toHaveTextContent('● Draft in progress'));
});

test('with no brief at all the first stop reads "No draft yet", not the admin label (S503)', async () => {
  queueRoute('presiteGet', statusResponse({
    stageLabels: { draft: 'Draft in progress', shared: 'Shared', visit: 'Visit', final: 'Final' },
  }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);
  await waitFor(() => expect(screen.getByTestId('stage-rail')).toHaveTextContent('● No draft yet'));
  expect(screen.getByTestId('stage-rail')).not.toHaveTextContent('Draft in progress');
});

test('a pending brief generation with no current brief reads "Generating draft" on the first stop', async () => {
  queueRoute('briefGet', statusResponse({ pendingArtifact: { artifactId: 'pending-brief', operationStatus: GENERATING } }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);
  await waitFor(() => expect(screen.getByTestId('stage-rail')).toHaveTextContent('● Generating draft'));
});

test('a ready brief keeps "AI draft ready" even while a regeneration is pending', async () => {
  queueRoute('briefGet', statusResponse({
    currentArtifact: briefArtifact(),
    pendingArtifact: { artifactId: 'pending-brief', operationStatus: GENERATING },
  }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);
  await waitFor(() => expect(screen.getByTestId('stage-rail')).toHaveTextContent('● AI draft ready'));
});

test('the session\'s attendees become the composer\'s default To; without a session the site-visit party stays the default', async () => {
  siteVisitContextFeed = { siteVisit: { startIso: null }, suggestedTo: ['visit-organizer@example.org'], suggestedCc: ['visit-optional@example.org'] };
  queueRoute('briefGet', statusResponse({ currentArtifact: briefArtifact(REVIEW) }));
  queueRoute('presiteGet', statusResponse({
    session: { scheduledStartIso: '2026-12-01T18:00:00Z', scheduledEndIso: null, ianaTimeZone: 'America/Los_Angeles', meetingLink: null, location: null },
    sessionAttendees: [{ name: 'A', email: 'a@example.org' }, { name: 'B', email: 'b@example.org' }],
  }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);
  await waitFor(() => expect(screen.getByTestId('mock-suggested-to')).toHaveTextContent('a@example.org,b@example.org'));
  expect(screen.getByTestId('mock-suggested-cc')).toHaveTextContent('');
});

test('the applicant-materials line renders from the status payload at draft and shared stages', async () => {
  const materials = { state: 'missing', receivedCount: 1, requiredCount: 3, otherCount: 0, dueAt: '2026-10-05T19:00:00Z', closesAt: '2026-10-14T19:00:00Z', overdue: false, invited: true };
  queueRoute('briefGet', statusResponse({ currentArtifact: briefArtifact(REVIEW) }));
  queueRoute('presiteGet', statusResponse({ materials }));
  render(<StaffDeliberationsTab requestId={REQUEST_ID} />);
  await screen.findByText('Working document:');
  expect(screen.getByTestId('deliberations-materials-line')).toHaveTextContent(/^Materials: 1 of 3 received · due /);
});
