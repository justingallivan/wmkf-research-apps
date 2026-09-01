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
    counts: { total: 3, open: 1, history: 1, stewardship: 1 },
    queues: { open: [open], history: [history], stewardship: [stewardship] },
    coordinatorMatrix: null,
    selected: null,
    navigation: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
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

test('dashboard search filters all queues without adding filter controls', async () => {
  global.fetch.mockResolvedValueOnce(response(dashboard()));
  render(<FinalWriteupsDashboardView />);
  const search = await screen.findByRole('searchbox');

  fireEvent.change(search, { target: { value: 'second' } });
  expect(screen.queryByText('Cellular repair after tissue injury')).not.toBeInTheDocument();
  expect(screen.getByText('A second proposal')).toBeInTheDocument();
  expect(screen.getByText('1 matching writeup')).toBeInTheDocument();
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
