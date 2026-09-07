/** @jest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  FinalWriteupFocusedView,
  FinalWriteupsDashboardView,
} from '../../shared/components/final-writeups/FinalWriteupsViews';

jest.mock('../../shared/components/Layout', () => ({
  __esModule: true,
  default: ({ children }) => <main>{children}</main>,
}));

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const FINAL_ID = '22222222-2222-4222-8222-222222222222';

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function writeup(overrides = {}) {
  return {
    requestId: REQUEST_ID,
    requestNumber: '1002788',
    title: 'Cellular repair after tissue injury',
    institution: 'Example University',
    projectLeader: 'Dr. Principal Investigator',
    responsibleProgramDirector: { id: 'pd-1', name: 'Program Director A' },
    cycleCode: 'D26',
    cycleLabel: 'December 2026',
    relationship: 'reviewer',
    bucket: 'open',
    stage: { key: 'group-review', label: 'Group review' },
    finalArtifactId: FINAL_ID,
    document: {
      url: 'https://example.sharepoint.com/final.docx',
      publicationVersionId: '2.0',
      lastModified: '2026-08-31T12:00:00.000Z',
    },
    personalState: 'unreviewed',
    acknowledgedAt: null,
    mayAcknowledge: true,
    reviewers: [],
    primaryAction: { key: 'review', label: 'Open review' },
    fullRequestHref: `/workbench/${REQUEST_ID}?tab=final-writeup`,
    supportingMaterials: [
      { key: 'proposal', label: 'Proposal', href: `/workbench/${REQUEST_ID}?tab=proposal` },
      { key: 'initial-assessment', label: 'Initial Assessment', href: `/workbench/${REQUEST_ID}?tab=initial-writeup` },
      { key: 'reviews', label: 'Reviews', href: `/workbench/${REQUEST_ID}?tab=reviews` },
    ],
    ...overrides,
  };
}

function dashboard(overrides = {}) {
  const open = writeup();
  const history = writeup({
    requestId: '11111111-1111-4111-8111-111111111112',
    requestNumber: '1002789',
    title: 'A second proposal',
    bucket: 'history',
    personalState: 'updated',
    acknowledgedAt: '2026-08-30T12:00:00.000Z',
  });
  const stewardship = writeup({
    requestId: '11111111-1111-4111-8111-111111111113',
    requestNumber: '1002790',
    title: 'My proposal',
    relationship: 'responsible-pd',
    bucket: 'stewardship',
    personalState: 'not-applicable',
    mayAcknowledge: false,
    primaryAction: { key: 'edit', label: 'Edit in Word' },
  });
  return {
    success: true,
    viewer: {
      id: 'reviewer-1',
      name: 'Ada Reviewer',
      personas: [],
      personaLensesEnabled: false,
      isSuperuser: false,
    },
    cycles: {
      selected: 'D26',
      available: [{ code: 'D26', label: 'December 2026' }, { code: 'J26', label: 'June 2026' }],
      hasUncycled: false,
      defaultResolvedBy: 'visible',
    },
    limits: { maximumRows: 100, scope: 'cycle' },
    counts: { total: 3, open: 1, history: 1, stewardship: 1 },
    queues: { open: [open], history: [history], stewardship: [stewardship] },
    coordinatorMatrix: null,
    selected: null,
    navigation: null,
    ...overrides,
  };
}

function setLocation(search) {
  window.history.replaceState(null, '', `/workbench/final-writeups${search}`);
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
  setLocation('');
});

afterEach(() => jest.restoreAllMocks());

test('dashboard leads with one search field and server-derived task queues', async () => {
  global.fetch.mockResolvedValueOnce(response(dashboard()));
  render(<FinalWriteupsDashboardView />);

  expect(await screen.findByRole('heading', { name: 'Awaiting your review' })).toBeInTheDocument();
  expect(screen.getAllByRole('searchbox')).toHaveLength(1);
  expect(screen.getAllByRole('link', { name: 'Open review' })[0])
    .toHaveAttribute('href', `/workbench/final-writeups/${REQUEST_ID}`);
  expect(screen.getByText('Reviewed history')).toBeInTheDocument();
  expect(screen.getByText('Your writeups')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Edit in Word' })).toHaveAttribute('target', '_blank');
  expect(screen.queryByText(/Science and Engineering|Medical Research/i)).not.toBeInTheDocument();
});

test('dashboard search filters all queues without adding filter controls other than the cycle selector', async () => {
  global.fetch.mockResolvedValueOnce(response(dashboard()));
  render(<FinalWriteupsDashboardView />);
  const search = await screen.findByRole('searchbox');

  fireEvent.change(search, { target: { value: 'second' } });
  expect(screen.queryByText('Cellular repair after tissue injury')).not.toBeInTheDocument();
  expect(screen.getByText('A second proposal')).toBeInTheDocument();
  expect(screen.getByText('1 matching writeup')).toBeInTheDocument();
  expect(screen.getAllByRole('combobox')).toHaveLength(1);
});

test('cycle selector reflects the server list, defaults to the selected cycle, and reloads with the chosen code', async () => {
  global.fetch
    .mockResolvedValueOnce(response(dashboard()))
    .mockResolvedValueOnce(response(dashboard({
      cycles: {
        selected: 'J26',
        available: [{ code: 'D26', label: 'December 2026' }, { code: 'J26', label: 'June 2026' }],
        hasUncycled: false,
        defaultResolvedBy: 'explicit',
      },
      counts: { total: 0, open: 0, history: 0, stewardship: 0 },
      queues: { open: [], history: [], stewardship: [] },
    })));
  render(<FinalWriteupsDashboardView />);

  const select = await screen.findByRole('combobox', { name: 'Cycle' });
  expect(global.fetch).toHaveBeenCalledWith('/api/workbench/final-writeups');
  expect(select).toHaveValue('D26');
  expect(screen.getByText(/awaiting your review in December 2026/)).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: 'No cycle' })).not.toBeInTheDocument();

  fireEvent.change(select, { target: { value: 'J26' } });
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
  expect(global.fetch).toHaveBeenLastCalledWith('/api/workbench/final-writeups?cycleCode=J26');
  expect(window.location.search).toBe('?cycleCode=J26');
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Cycle' })).toHaveValue('J26'));
  expect(screen.getByText('You have no writeups waiting for review.')).toBeInTheDocument();
});

test('dashboard reads cycleCode from the URL on mount and passes it as the only query parameter', async () => {
  setLocation('?cycleCode=J26');
  global.fetch.mockResolvedValueOnce(response(dashboard()));
  render(<FinalWriteupsDashboardView />);
  await screen.findByRole('combobox', { name: 'Cycle' });
  expect(global.fetch).toHaveBeenCalledWith('/api/workbench/final-writeups?cycleCode=J26');
});

test('No cycle option renders only when uncycled rows exist and round-trips to the URL', async () => {
  global.fetch
    .mockResolvedValueOnce(response(dashboard({
      cycles: {
        selected: 'D26',
        available: [{ code: 'D26', label: 'December 2026' }],
        hasUncycled: true,
        defaultResolvedBy: 'visible',
      },
    })))
    .mockResolvedValueOnce(response(dashboard({
      cycles: {
        selected: 'none',
        available: [{ code: 'D26', label: 'December 2026' }],
        hasUncycled: true,
        defaultResolvedBy: 'explicit',
      },
    })));
  render(<FinalWriteupsDashboardView />);
  const select = await screen.findByRole('combobox', { name: 'Cycle' });
  expect(screen.getByRole('option', { name: 'No cycle' })).toBeInTheDocument();

  fireEvent.change(select, { target: { value: 'none' } });
  await waitFor(() => expect(global.fetch).toHaveBeenLastCalledWith('/api/workbench/final-writeups?cycleCode=none'));
  expect(window.location.search).toBe('?cycleCode=none');
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Cycle' })).toHaveValue('none'));
  expect(screen.getByText(/awaiting your review in No cycle/)).toBeInTheDocument();
});

test('the controlled cycle value always has an option: bookmarked none without uncycled rows, and a cycle absent from the list', async () => {
  global.fetch.mockResolvedValueOnce(response(dashboard({
    cycles: {
      selected: 'none',
      available: [{ code: 'D26', label: 'December 2026' }],
      hasUncycled: false,
      defaultResolvedBy: 'explicit',
    },
    counts: { total: 0, open: 0, history: 0, stewardship: 0 },
    queues: { open: [], history: [], stewardship: [] },
  })));
  const { unmount } = render(<FinalWriteupsDashboardView />);
  const select = await screen.findByRole('combobox', { name: 'Cycle' });
  expect(select).toHaveValue('none');
  expect(screen.getByRole('option', { name: 'No cycle' })).toBeInTheDocument();
  unmount();

  global.fetch.mockResolvedValueOnce(response(dashboard({
    cycles: {
      selected: 'J25',
      available: [{ code: 'D26', label: 'December 2026' }],
      hasUncycled: false,
      defaultResolvedBy: 'explicit',
    },
    counts: { total: 0, open: 0, history: 0, stewardship: 0 },
    queues: { open: [], history: [], stewardship: [] },
  })));
  render(<FinalWriteupsDashboardView />);
  const absent = await screen.findByRole('combobox', { name: 'Cycle' });
  expect(absent).toHaveValue('J25');
  expect(screen.getByRole('option', { name: 'J25' })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: 'No cycle' })).not.toBeInTheDocument();
});

test('walk-back outcomes are rendered from response fields only', async () => {
  global.fetch.mockResolvedValueOnce(response(dashboard({
    cycles: {
      selected: 'J26',
      available: [{ code: 'D26', label: 'December 2026' }, { code: 'J26', label: 'June 2026' }],
      hasUncycled: false,
      defaultResolvedBy: 'visible',
    },
  })));
  const { unmount } = render(<FinalWriteupsDashboardView />);
  expect(await screen.findByText('Nothing awaits your review in December 2026; showing June 2026.')).toBeInTheDocument();
  unmount();

  global.fetch.mockResolvedValueOnce(response(dashboard({
    cycles: {
      selected: 'D26',
      available: [{ code: 'D26', label: 'December 2026' }],
      hasUncycled: false,
      defaultResolvedBy: 'exhausted',
    },
    counts: { total: 0, open: 0, history: 0, stewardship: 0 },
    queues: { open: [], history: [], stewardship: [] },
  })));
  render(<FinalWriteupsDashboardView />);
  expect(await screen.findByText('Nothing awaits your review in the most recent cycles; choose a cycle to look further back.')).toBeInTheDocument();
});

test('dashboard ignores a late response after the cycle changes', async () => {
  let resolveSecond;
  global.fetch
    .mockResolvedValueOnce(response(dashboard()))
    .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }))
    .mockResolvedValueOnce(response(dashboard({
      cycles: {
        selected: 'D26',
        available: [{ code: 'D26', label: 'December 2026' }, { code: 'J26', label: 'June 2026' }],
        hasUncycled: false,
        defaultResolvedBy: 'explicit',
      },
      queues: { open: [writeup({ title: 'Back on December' })], history: [], stewardship: [] },
    })));
  render(<FinalWriteupsDashboardView />);
  const select = await screen.findByRole('combobox', { name: 'Cycle' });

  fireEvent.change(select, { target: { value: 'J26' } });
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
  fireEvent.change(select, { target: { value: 'D26' } });
  expect(await screen.findByText('Back on December')).toBeInTheDocument();

  resolveSecond(response(dashboard({
    cycles: { selected: 'J26', available: [{ code: 'J26', label: 'June 2026' }], hasUncycled: false, defaultResolvedBy: 'explicit' },
    queues: { open: [writeup({ title: 'Stale June response' })], history: [], stewardship: [] },
  })));
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(3));
  expect(screen.queryByText('Stale June response')).not.toBeInTheDocument();
  expect(screen.getByText('Back on December')).toBeInTheDocument();
});

test('a PD acknowledging a leadership-stage writeup is warned, not locked; Leadership viewers are not warned', async () => {
  const movedOn = writeup({ stage: { key: 'leadership-review', label: 'Leadership review' } });
  const pdViewer = { id: 'reviewer-1', name: 'Ada Reviewer', personas: ['program-director'], personaLensesEnabled: true, isSuperuser: false };
  const warningCopy = 'This writeup has moved on to leadership review. You can still record your review, but group review has closed.';

  global.fetch.mockResolvedValueOnce(response(dashboard({ viewer: pdViewer, selected: movedOn, navigation: null })));
  const { unmount } = render(<FinalWriteupFocusedView requestId={REQUEST_ID} />);
  expect(await screen.findByText(warningCopy)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Mark reviewed' })).toBeEnabled();
  unmount();

  global.fetch.mockResolvedValueOnce(response(dashboard({
    viewer: { ...pdViewer, personas: ['leadership'] }, selected: movedOn, navigation: null,
  })));
  const leadership = render(<FinalWriteupFocusedView requestId={REQUEST_ID} />);
  expect(await screen.findByRole('button', { name: 'Mark reviewed' })).toBeEnabled();
  expect(screen.queryByText(warningCopy)).not.toBeInTheDocument();
  leadership.unmount();

  global.fetch.mockResolvedValueOnce(response(dashboard({ viewer: pdViewer, selected: writeup(), navigation: null })));
  render(<FinalWriteupFocusedView requestId={REQUEST_ID} />);
  expect(await screen.findByRole('button', { name: 'Mark reviewed' })).toBeInTheDocument();
  expect(screen.queryByText(warningCopy)).not.toBeInTheDocument();
});

test('focused view shows the cycle as context and never sends cycleCode', async () => {
  global.fetch.mockResolvedValueOnce(response(dashboard({ selected: writeup(), navigation: null })));
  render(<FinalWriteupFocusedView requestId={REQUEST_ID} />);
  expect(await screen.findByText('December 2026')).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledWith(`/api/workbench/final-writeups?requestId=${REQUEST_ID}`);
  expect(global.fetch.mock.calls[0][0]).not.toContain('cycleCode');
});

test('enabled overlapping persona lenses are named without adding another control panel', async () => {
  global.fetch.mockResolvedValueOnce(response(dashboard({
    viewer: {
      id: 'reviewer-1',
      name: 'Ada Reviewer',
      personas: ['program-director', 'leadership'],
      personaLensesEnabled: true,
      isSuperuser: false,
    },
  })));
  render(<FinalWriteupsDashboardView />);

  expect(await screen.findByText('Program Director + Leadership view')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /view/i })).not.toBeInTheDocument();
});

test('superuser dashboard renders a complete neutral coordinator matrix with direct Word links', async () => {
  const row = writeup();
  global.fetch.mockResolvedValueOnce(response(dashboard({
    coordinatorMatrix: {
      mode: 'configured',
      groups: [{
        grantProgramId: 'program-1',
        grantProgramName: 'Research',
        reviewers: [
          { reviewerId: 'reviewer-1', name: 'Ada Reviewer', initials: 'AR' },
          { reviewerId: 'pd-1', name: 'Program Director A', initials: 'PA' },
        ],
        rows: [{
          requestId: row.requestId,
          requestNumber: row.requestNumber,
          title: row.title,
          institution: row.institution,
          responsibleProgramDirector: row.responsibleProgramDirector,
          stage: row.stage,
          documentUrl: row.document.url,
          cells: [
            { reviewerId: 'reviewer-1', state: 'updated', acknowledgedAt: '2026-08-30T12:00:00.000Z' },
            { reviewerId: 'pd-1', state: 'not-applicable', acknowledgedAt: null },
          ],
        }],
      }],
      unconfiguredRows: [],
    },
  })));
  render(<FinalWriteupsDashboardView />);

  expect(await screen.findByRole('heading', { name: 'Coordinator matrix' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Research' })).toBeInTheDocument();
  expect(screen.getByText(/not approval or compliance tracking/i)).toBeInTheDocument();
  expect(screen.getByLabelText('Ada Reviewer: Updated for request 1002788')).toBeInTheDocument();
  expect(screen.getByLabelText('Program Director A: Responsible PD for request 1002788')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open in Word' })).toHaveAttribute('href', row.document.url);
});

test('reviewer initials expose current and earlier-version meaning without color alone', async () => {
  const mixed = writeup({
    reviewers: [
      { reviewerId: 'reviewer-1', name: 'Ada Reviewer', initials: 'AR', state: 'reviewed' },
      { reviewerId: 'reviewer-2', name: 'Sam Reviewer', initials: 'SR', state: 'updated' },
    ],
  });
  global.fetch.mockResolvedValueOnce(response(dashboard({
    queues: { open: [mixed], history: [], stewardship: [] },
  })));
  render(<FinalWriteupsDashboardView />);

  expect(await screen.findByText('1 current · 1 earlier version')).toBeInTheDocument();
  expect(screen.getByLabelText('Review activity: 1 current · 1 earlier version')).toBeInTheDocument();
});

test('focused review keeps Word external, exposes collapsed context, and records exact-current review', async () => {
  const initial = dashboard({
    counts: { total: 1, open: 1, history: 0, stewardship: 0 },
    queues: { open: [writeup()], history: [], stewardship: [] },
    selected: writeup(),
    navigation: { previous: null, next: null },
  });
  const reviewed = dashboard({
    counts: { total: 1, open: 0, history: 1, stewardship: 0 },
    queues: { open: [], history: [writeup({ bucket: 'history', personalState: 'reviewed' })], stewardship: [] },
    selected: writeup({
      bucket: 'history',
      personalState: 'reviewed',
      acknowledgedAt: '2026-08-31T12:05:00.000Z',
      reviewers: [{ reviewerId: 'reviewer-1', name: 'Ada Reviewer', initials: 'AR', state: 'reviewed' }],
    }),
    navigation: { previous: null, next: null },
  });
  global.fetch
    .mockResolvedValueOnce(response(initial))
    .mockResolvedValueOnce(response({ success: true, personalState: 'reviewed' }))
    .mockResolvedValueOnce(response(reviewed));

  render(<FinalWriteupFocusedView requestId={REQUEST_ID} />);

  const documentLink = await screen.findByRole('link', { name: 'Open in Word' });
  expect(documentLink).toHaveAttribute('href', 'https://example.sharepoint.com/final.docx');
  expect(documentLink).toHaveAttribute('target', '_blank');
  expect(screen.getByText('Supporting materials')).toBeInTheDocument();
  expect(screen.queryByRole('navigation', { name: 'Request sections' })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Mark reviewed' }));
  await waitFor(() => expect(global.fetch).toHaveBeenNthCalledWith(
    2,
    '/api/workbench/final-writeup/acknowledgement',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        requestId: REQUEST_ID,
        expectedFinalArtifactId: FINAL_ID,
      }),
    }),
  ));
  expect(await screen.findByRole('heading', { name: 'You reviewed this version' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Mark reviewed' })).not.toBeInTheDocument();
});

test('focused review ignores a late response after its request changes', async () => {
  let resolveFirst;
  global.fetch
    .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
    .mockResolvedValueOnce(response(dashboard({
      selected: writeup({ requestId: '11111111-1111-4111-8111-111111111199', requestNumber: '1002999', title: 'New request' }),
      navigation: null,
    })));
  const { rerender } = render(<FinalWriteupFocusedView requestId={REQUEST_ID} />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
  rerender(<FinalWriteupFocusedView requestId="11111111-1111-4111-8111-111111111199" />);
  expect(await screen.findByText('New request')).toBeInTheDocument();

  resolveFirst(response(dashboard({ selected: writeup({ title: 'Old request' }) })));
  await waitFor(() => expect(screen.queryByText('Old request')).not.toBeInTheDocument());
  expect(screen.getByText('New request')).toBeInTheDocument();
});

test('responsible PD focused view offers editing but never self-acknowledgement', async () => {
  const owner = writeup({
    relationship: 'responsible-pd',
    bucket: 'stewardship',
    personalState: 'not-applicable',
    mayAcknowledge: false,
    primaryAction: { key: 'edit', label: 'Edit in Word' },
  });
  global.fetch.mockResolvedValueOnce(response(dashboard({ selected: owner, navigation: null })));
  render(<FinalWriteupFocusedView requestId={REQUEST_ID} />);
  expect(await screen.findByRole('link', { name: 'Edit in Word' })).toHaveAttribute('target', '_blank');
  expect(screen.queryByRole('button', { name: /Mark .*reviewed/i })).not.toBeInTheDocument();
});
