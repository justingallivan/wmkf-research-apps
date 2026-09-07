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

  expect(await screen.findByRole('heading', { name: 'Needs my review' })).toBeInTheDocument();
  expect(screen.getAllByRole('searchbox')).toHaveLength(1);
  expect(screen.getAllByRole('link', { name: 'Open review' })[0])
    .toHaveAttribute('href', `/workbench/final-writeups/${REQUEST_ID}`);
  expect(screen.getByRole('button', { name: /Reviewed by me/ })).toBeInTheDocument();
  expect(screen.getByText('Your writeups')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Edit in Word' })).toHaveAttribute('target', '_blank');
  expect(screen.queryByText(/Science and Engineering|Medical Research/i)).not.toBeInTheDocument();
});

test('dashboard search filters the active view without adding controls other than the cycle select, view selector, and Program director filter', async () => {
  global.fetch.mockResolvedValueOnce(response(dashboard()));
  render(<FinalWriteupsDashboardView />);
  const search = await screen.findByRole('searchbox');

  fireEvent.change(search, { target: { value: 'second' } });
  expect(screen.queryByText('Cellular repair after tissue injury')).not.toBeInTheDocument();
  expect(screen.queryByText('A second proposal')).not.toBeInTheDocument();
  expect(screen.getByText('0 matching writeups')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /All writeups/ }));
  expect(screen.getByText('A second proposal')).toBeInTheDocument();
  expect(screen.getByText('1 matching writeup')).toBeInTheDocument();
  expect(screen.getAllByRole('combobox')).toHaveLength(2);
  expect(screen.getByRole('group', { name: 'View' }).querySelectorAll('button')).toHaveLength(3);
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
  expect(screen.getByText(/Nothing needs your review in June 2026\./)).toBeInTheDocument();
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
  expect(screen.getByRole('option', { name: 'June 2025' })).toBeInTheDocument();
  expect(screen.getByText(/awaiting your review in June 2025/)).toBeInTheDocument();
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
  expect(await screen.findByText('No current writeups visible to you in December 2026; showing June 2026.')).toBeInTheDocument();
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
  expect(await screen.findByText('No current writeups visible to you in the most recent cycles; choose a cycle to look further back.')).toBeInTheDocument();
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

test('focused view shows the cycle label as context (with the empty focused cycle list) and never sends cycleCode', async () => {
  global.fetch.mockResolvedValueOnce(response(dashboard({
    cycles: { selected: 'D26', available: [], hasUncycled: false, defaultResolvedBy: 'explicit' },
    selected: writeup(),
    navigation: null,
  })));
  render(<FinalWriteupFocusedView requestId={REQUEST_ID} />);
  expect(await screen.findByText('December 2026')).toBeInTheDocument();
  expect(screen.queryByText('D26')).not.toBeInTheDocument();
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
  expect(screen.queryByRole('button', { name: /persona|lens/i })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Needs my review/ })).toHaveAttribute('aria-pressed', 'true');
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

test('review activity pluralizes earlier versions', async () => {
  const several = writeup({
    reviewers: [
      { reviewerId: 'reviewer-2', name: 'Sam Reviewer', initials: 'SR', state: 'updated' },
      { reviewerId: 'reviewer-3', name: 'Kim Reviewer', initials: 'KR', state: 'updated' },
      { reviewerId: 'reviewer-4', name: 'Lee Reviewer', initials: 'LR', state: 'updated' },
    ],
  });
  global.fetch.mockResolvedValueOnce(response(dashboard({
    queues: { open: [several], history: [], stewardship: [] },
  })));
  render(<FinalWriteupsDashboardView />);
  expect(await screen.findByText('3 earlier versions')).toBeInTheDocument();
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

describe('views, Program director filter, and version context (Slices 6B/6C)', () => {
  const PD_A = '33333333-3333-4333-8333-333333333331';
  const PD_B = '33333333-3333-4333-8333-333333333332';
  const PD_ABSENT = '33333333-3333-4333-8333-333333333339';
  const pdA = { id: PD_A, name: 'Program Director A' };
  const pdB = { id: PD_B, name: 'Program Director B' };

  function pressed(name) {
    return screen.getByRole('button', { name }).getAttribute('aria-pressed');
  }

  function twoPdDashboard(overrides = {}) {
    const openA = writeup({ responsibleProgramDirector: pdA, title: 'Open for A' });
    const historyB = writeup({
      requestId: '11111111-1111-4111-8111-111111111112',
      requestNumber: '1002789',
      title: 'History for B',
      responsibleProgramDirector: pdB,
      bucket: 'history',
      personalState: 'updated',
      acknowledgedAt: '2026-08-30T12:00:00.000Z',
      acknowledgedPublicationVersionId: '1.0',
    });
    const stewardshipB = writeup({
      requestId: '11111111-1111-4111-8111-111111111113',
      requestNumber: '1002790',
      title: 'Stewardship for B',
      responsibleProgramDirector: pdB,
      relationship: 'responsible-pd',
      bucket: 'stewardship',
      personalState: 'not-applicable',
      mayAcknowledge: false,
      primaryAction: { key: 'edit', label: 'Edit in Word' },
    });
    return dashboard({
      counts: { total: 3, open: 1, history: 1, stewardship: 1 },
      queues: { open: [openA], history: [historyB], stewardship: [stewardshipB] },
      ...overrides,
    });
  }

  function matrixFor(rowA, rowB) {
    return {
      mode: 'configured',
      groups: [{
        grantProgramId: 'program-1',
        grantProgramName: 'Research',
        reviewers: [{ reviewerId: 'reviewer-1', name: 'Ada Reviewer', initials: 'AR' }],
        rows: [{
          requestId: rowA.requestId,
          requestNumber: rowA.requestNumber,
          title: rowA.title,
          institution: rowA.institution,
          responsibleProgramDirector: rowA.responsibleProgramDirector,
          stage: rowA.stage,
          documentUrl: rowA.document.url,
          cells: [{ reviewerId: 'reviewer-1', state: 'unreviewed', acknowledgedAt: null }],
        }],
      }],
      unconfiguredRows: [{
        requestId: rowB.requestId,
        requestNumber: rowB.requestNumber,
        title: rowB.title,
        institution: rowB.institution,
        responsibleProgramDirector: rowB.responsibleProgramDirector,
        grantProgramId: 'program-2',
        grantProgramName: 'Southern California',
      }],
    };
  }

  test('dashboard opens on Needs my review for every persona and never sends view or pd to the API', async () => {
    setLocation(`?cycleCode=D26&view=reviewed&pd=${PD_A}`);
    global.fetch.mockResolvedValueOnce(response(twoPdDashboard()));
    const first = render(<FinalWriteupsDashboardView />);
    await screen.findByRole('heading', { name: 'Reviewed by me' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith('/api/workbench/final-writeups?cycleCode=D26');
    expect(window.location.search).toBe(`?cycleCode=D26&view=reviewed&pd=${PD_A}`);
    first.unmount();

    for (const personas of [['program-director'], ['program-coordinator'], ['leadership']]) {
      setLocation('');
      global.fetch.mockResolvedValueOnce(response(twoPdDashboard({
        viewer: { id: 'reviewer-1', name: 'Ada', personas, personaLensesEnabled: true, isSuperuser: false },
      })));
      const view = render(<FinalWriteupsDashboardView />);
      await screen.findByRole('heading', { name: 'Needs my review' });
      expect(pressed(/Needs my review/)).toBe('true');
      expect(window.location.search).toBe('');
      view.unmount();
    }
  });

  test('view selector partitions by bucket: updated rows stay in Reviewed by me, stewardship only in All', async () => {
    global.fetch.mockResolvedValueOnce(response(dashboard()));
    render(<FinalWriteupsDashboardView />);
    await screen.findByRole('heading', { name: 'Needs my review' });
    expect(screen.getByText('Cellular repair after tissue injury')).toBeInTheDocument();
    expect(screen.queryByText('A second proposal')).not.toBeInTheDocument();
    expect(screen.getByText('Your writeups')).toBeInTheDocument();
    expect(screen.getByText('My proposal')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Reviewed by me/ }));
    expect(screen.getByRole('heading', { name: 'Reviewed by me' })).toBeInTheDocument();
    expect(screen.getByText('A second proposal')).toBeInTheDocument();
    expect(screen.getByText('Updated since review')).toBeInTheDocument();
    expect(screen.queryByText('Cellular repair after tissue injury')).not.toBeInTheDocument();
    expect(window.location.search).toBe('?view=reviewed');

    fireEvent.click(screen.getByRole('button', { name: /All writeups/ }));
    expect(screen.getByRole('heading', { name: 'All writeups' })).toBeInTheDocument();
    expect(screen.getByText('Cellular repair after tissue injury')).toBeInTheDocument();
    expect(screen.getByText('A second proposal')).toBeInTheDocument();
    expect(screen.getByText('My proposal')).toBeInTheDocument();
    expect(screen.queryByText('Your writeups')).not.toBeInTheDocument();
    expect(window.location.search).toBe('?view=all');

    fireEvent.click(screen.getByRole('button', { name: /Needs my review/ }));
    expect(window.location.search).toBe('');
  });

  test('All writeups merges the buckets and sorts by request number', async () => {
    global.fetch.mockResolvedValueOnce(response(dashboard({
      queues: {
        open: [writeup({ requestNumber: '200', title: 'Two hundred' })],
        history: [writeup({ requestId: 'h', requestNumber: '100', title: 'One hundred', bucket: 'history', personalState: 'reviewed' })],
        stewardship: [writeup({ requestId: 's', requestNumber: '150', title: 'One fifty', bucket: 'stewardship', relationship: 'responsible-pd', personalState: 'not-applicable', mayAcknowledge: false, primaryAction: { key: 'edit', label: 'Edit in Word' } })],
      },
    })));
    render(<FinalWriteupsDashboardView />);
    await screen.findByRole('heading', { name: 'Needs my review' });
    fireEvent.click(screen.getByRole('button', { name: /All writeups/ }));
    const titles = screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent);
    expect(titles).toEqual(['One hundred', 'One fifty', 'Two hundred']);
  });

  test('invalid view and pd are sanitized on mount and the address bar is rewritten immediately', async () => {
    setLocation('?cycleCode=D26&view=bogus&pd=not-a-guid');
    global.fetch.mockResolvedValueOnce(response(twoPdDashboard()));
    const first = render(<FinalWriteupsDashboardView />);
    await screen.findByRole('heading', { name: 'Needs my review' });
    expect(window.location.search).toBe('?cycleCode=D26');
    expect(pressed(/Needs my review/)).toBe('true');
    expect(screen.getByRole('combobox', { name: 'Program director' })).toHaveValue('');
    expect(screen.getByText('Open for A')).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith('/api/workbench/final-writeups?cycleCode=D26');
    first.unmount();

    // The default view written explicitly is normalized away: a clean URL stays clean.
    setLocation('?view=needs-review');
    global.fetch.mockResolvedValueOnce(response(twoPdDashboard()));
    render(<FinalWriteupsDashboardView />);
    await screen.findByRole('heading', { name: 'Needs my review' });
    expect(window.location.search).toBe('');
  });

  test('Program director options derive from loaded rows and filter list, Your writeups, configured and unconfigured matrix rows', async () => {
    const data = twoPdDashboard();
    data.coordinatorMatrix = matrixFor(data.queues.open[0], data.queues.history[0]);
    global.fetch.mockResolvedValueOnce(response(data));
    render(<FinalWriteupsDashboardView />);
    const select = await screen.findByRole('combobox', { name: 'Program director' });
    expect([...select.options].map((option) => option.textContent))
      .toEqual(['All program directors', 'Program Director A', 'Program Director B']);
    expect(screen.getByText('Audience configuration needed')).toBeInTheDocument();

    fireEvent.change(select, { target: { value: PD_B } });
    expect(window.location.search).toBe(`?pd=${PD_B}`);
    expect(screen.queryByText('Open for A')).not.toBeInTheDocument();
    expect(screen.getByText(/Nothing needs your review in December 2026 for Program Director B\./)).toBeInTheDocument();
    expect(screen.getByText('Stewardship for B')).toBeInTheDocument();
    expect(screen.getByText('No matrix rows match your filters.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /History for B/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /All writeups/ }));
    expect(screen.getByText('History for B')).toBeInTheDocument();
    expect(screen.queryByText('Open for A')).not.toBeInTheDocument();

    fireEvent.change(select, { target: { value: PD_A } });
    expect(screen.getByRole('heading', { level: 3, name: 'Open for A' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 3, name: 'History for B' })).not.toBeInTheDocument();
    expect(screen.queryByText('Audience configuration needed')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open in Word' })).toBeInTheDocument();
  });

  test('a valid pd GUID with whitespace or uppercase is canonicalized, filters correctly, and the address bar is rewritten', async () => {
    setLocation(`?pd=%20${PD_B.toUpperCase()}%20`);
    global.fetch.mockResolvedValueOnce(response(twoPdDashboard()));
    render(<FinalWriteupsDashboardView />);
    const select = await screen.findByRole('combobox', { name: 'Program director' });
    expect(select).toHaveValue(PD_B);
    expect(window.location.search).toBe(`?pd=${PD_B}`);
    expect(screen.queryByRole('option', { name: 'Program director not in this cycle' })).not.toBeInTheDocument();
    expect(screen.getByText('Stewardship for B')).toBeInTheDocument();
    expect(screen.queryByText('Open for A')).not.toBeInTheDocument();
  });

  test('non-GUID pd is dropped; a GUID absent from the cycle keeps an option and shows the empty copy', async () => {
    setLocation(`?pd=${PD_ABSENT}`);
    global.fetch.mockResolvedValueOnce(response(twoPdDashboard()));
    render(<FinalWriteupsDashboardView />);
    const select = await screen.findByRole('combobox', { name: 'Program director' });
    expect(select).toHaveValue(PD_ABSENT);
    expect(screen.getByRole('option', { name: 'Program director not in this cycle' })).toBeInTheDocument();
    expect(screen.getByText(/No writeups for the selected Program Director in December 2026\. Choose All program directors to clear the filter\./)).toBeInTheDocument();
    expect(screen.queryByText('Open for A')).not.toBeInTheDocument();
    expect(window.location.search).toBe(`?pd=${PD_ABSENT}`);
  });

  test('view does not filter the coordinator matrix', async () => {
    const data = twoPdDashboard();
    data.coordinatorMatrix = matrixFor(data.queues.open[0], data.queues.history[0]);
    global.fetch.mockResolvedValueOnce(response(data));
    render(<FinalWriteupsDashboardView />);
    await screen.findByRole('heading', { name: 'Coordinator matrix' });
    const matrixLinks = () => screen.getAllByRole('link', { name: 'Open in Word' }).length
      + (screen.queryByText('Audience configuration needed') ? 1 : 0);
    expect(matrixLinks()).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: /Reviewed by me/ }));
    expect(matrixLinks()).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: /All writeups/ }));
    expect(matrixLinks()).toBe(2);
  });

  test('header count and view counts reflect the PD filter and search together', async () => {
    const openB = writeup({
      requestId: '11111111-1111-4111-8111-111111111114',
      requestNumber: '1002791',
      title: 'Open for B',
      responsibleProgramDirector: pdB,
    });
    const data = twoPdDashboard();
    data.queues.open.push(openB);
    data.counts = { total: 4, open: 42, history: 1, stewardship: 1 };
    global.fetch.mockResolvedValueOnce(response(data));
    render(<FinalWriteupsDashboardView />);
    await screen.findByRole('heading', { name: 'Needs my review' });
    expect(screen.getByText(/awaiting your review in December 2026/).textContent).toMatch(/^2 awaiting/);
    expect(screen.getByRole('button', { name: /Needs my review/ }).textContent).toContain('2');

    fireEvent.change(screen.getByRole('combobox', { name: 'Program director' }), { target: { value: PD_B } });
    expect(screen.getByText(/awaiting your review in December 2026 for Program Director B/).textContent).toMatch(/^1 awaiting/);
    expect(screen.getByRole('button', { name: /Needs my review/ }).textContent).toContain('1');
    expect(screen.getByRole('button', { name: /All writeups/ }).textContent).toContain('3');

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzz' } });
    expect(screen.getByText(/awaiting your review/).textContent).toMatch(/^0 awaiting/);
    expect(screen.getByRole('button', { name: /All writeups/ }).textContent).toContain('0');
  });

  test('cycle change preserves view and pd in the URL', async () => {
    setLocation(`?view=reviewed&pd=${PD_B}`);
    global.fetch
      .mockResolvedValueOnce(response(twoPdDashboard()))
      .mockResolvedValueOnce(response(twoPdDashboard({
        cycles: { selected: 'J26', available: [{ code: 'D26', label: 'December 2026' }, { code: 'J26', label: 'June 2026' }], hasUncycled: false, defaultResolvedBy: 'explicit' },
      })));
    render(<FinalWriteupsDashboardView />);
    const cycle = await screen.findByRole('combobox', { name: 'Cycle' });
    fireEvent.change(cycle, { target: { value: 'J26' } });
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    expect(global.fetch).toHaveBeenLastCalledWith('/api/workbench/final-writeups?cycleCode=J26');
    const params = new URLSearchParams(window.location.search);
    expect(params.get('cycleCode')).toBe('J26');
    expect(params.get('view')).toBe('reviewed');
    expect(params.get('pd')).toBe(PD_B);
    expect([...params.keys()]).toHaveLength(3);
  });

  test('Needs my review empty state offers the other views with counts', async () => {
    const data = twoPdDashboard();
    data.queues.open = [];
    global.fetch.mockResolvedValueOnce(response(data));
    render(<FinalWriteupsDashboardView />);
    await screen.findByText(/Nothing needs your review in December 2026\./);
    fireEvent.click(screen.getByRole('button', { name: '1 reviewed by you' }));
    expect(pressed(/Reviewed by me/)).toBe('true');
    expect(screen.getByText('History for B')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Needs my review/ }));
    fireEvent.click(screen.getByRole('button', { name: '2 writeups in all' }));
    expect(pressed(/All writeups/)).toBe('true');
  });

  test('rows render the exact publicationVersionId verbatim and the exact acknowledgedPublicationVersionId when updated', async () => {
    const data = twoPdDashboard();
    data.queues.open[0].document.publicationVersionId = 'abc';
    data.queues.history[0].document.publicationVersionId = '2.0';
    data.queues.stewardship[0].document.publicationVersionId = '5.0';
    global.fetch.mockResolvedValueOnce(response(data));
    render(<FinalWriteupsDashboardView />);
    await screen.findByText('Open for A');
    expect(screen.getByText(/Version abc/)).toBeInTheDocument();
    expect(screen.queryByText(/You reviewed version/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Reviewed by me/ }));
    expect(screen.getByText(/Version 2\.0/)).toBeInTheDocument();
    expect(screen.getByText('· You reviewed version 1.0')).toBeInTheDocument();
  });

  test('focused panel states name the exact reviewed and current versions', async () => {
    const updated = writeup({
      bucket: 'history',
      personalState: 'updated',
      acknowledgedAt: '2026-08-30T12:00:00.000Z',
      acknowledgedPublicationVersionId: '1.0',
      document: { url: 'https://example.sharepoint.com/final.docx', publicationVersionId: '2.0', lastModified: '2026-08-31T12:00:00.000Z' },
    });
    global.fetch.mockResolvedValueOnce(response(dashboard({ selected: updated, navigation: null })));
    const first = render(<FinalWriteupFocusedView requestId={REQUEST_ID} />);
    expect(await screen.findByText(/^You reviewed version 1\.0 on .+\. The current version is 2\.0\.$/)).toBeInTheDocument();
    expect(screen.getByText('Version 2.0')).toBeInTheDocument();
    first.unmount();

    global.fetch.mockResolvedValueOnce(response(dashboard({
      selected: writeup({
        bucket: 'history',
        personalState: 'reviewed',
        acknowledgedAt: '2026-08-31T12:05:00.000Z',
        acknowledgedPublicationVersionId: '2.0',
      }),
      navigation: null,
    })));
    render(<FinalWriteupFocusedView requestId={REQUEST_ID} />);
    expect(await screen.findByText(/^You reviewed version 2\.0 on .+\.$/)).toBeInTheDocument();
  });
});
