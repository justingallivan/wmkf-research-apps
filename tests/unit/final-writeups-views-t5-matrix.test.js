/**
 * @jest-environment jsdom
 *
 * FinalWriteupsViews — T5 gap-fill (Stage 5a). tests/unit/final-writeups-
 * views.test.js already pins 2xx success and exact request bytes for the
 * file's 3 fetch sites (dashboard cycleCode GET, focused requestId GET,
 * acknowledgement POST). All 3 now use requestEnvelope with an explicit
 * body.error || `... (${status})` throw (Stage 5a review finding 1),
 * restoring the old code's status-interpolated fallback text. This file
 * adds network-rejection and axis (e).
 */
import { fireEvent, render, screen } from '@testing-library/react';
import {
  FinalWriteupFocusedView,
  FinalWriteupsPanel,
} from '../../shared/components/final-writeups/FinalWriteupsViews';

jest.mock('../../shared/components/Layout', () => ({
  __esModule: true,
  default: ({ children }) => <main>{children}</main>,
}));

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const FINAL_ID = '22222222-2222-4222-8222-222222222222';
const unparseable = () => Promise.reject(new SyntaxError('Unexpected token <'));

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
    supportingMaterials: [],
    ...overrides,
  };
}

function dashboard(overrides = {}) {
  return {
    counts: { total: 1, open: 1, history: 0, stewardship: 0 },
    queues: { open: [writeup()], history: [], stewardship: [] },
    selected: writeup(),
    cycles: { selected: 'D26', available: [{ code: 'D26', label: 'December 2026' }], hasUncycled: true, defaultResolvedBy: 'explicit' },
    navigation: { previous: null, next: null },
    viewer: { id: 'pd-1', personas: [] },
    ...overrides,
  };
}

afterEach(() => jest.restoreAllMocks());

test('dashboard load: network rejection is never silent', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
  render(<FinalWriteupsPanel cycleCode="D26" />);
  expect(await screen.findByRole('alert')).toHaveTextContent('offline');
});

test('dashboard load axis (e): non-2xx unparseable body falls to the fallback text with status suffix, never silent', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 502, json: unparseable });
  render(<FinalWriteupsPanel cycleCode="D26" />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load Final Writeups (502)');
});

test('dashboard load: non-2xx empty body ({}) falls to the fallback text with status suffix (finding 1 parity)', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
  render(<FinalWriteupsPanel cycleCode="D26" />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load Final Writeups (500)');
});

test('focused load: network rejection is never silent', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
  render(<FinalWriteupFocusedView requestId={REQUEST_ID} />);
  expect(await screen.findByText('offline')).toBeInTheDocument();
});

test('focused load axis (e): non-2xx unparseable body falls to the fallback text with status suffix, never silent', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 502, json: unparseable });
  render(<FinalWriteupFocusedView requestId={REQUEST_ID} />);
  expect(await screen.findByText('Failed to load Final Writeup (502)')).toBeInTheDocument();
});

test('focused load: non-2xx empty body ({}) falls to the fallback text with status suffix (finding 1 parity)', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
  render(<FinalWriteupFocusedView requestId={REQUEST_ID} />);
  expect(await screen.findByText('Failed to load Final Writeup (500)')).toBeInTheDocument();
});

test('acknowledge axis (e): non-2xx unparseable body falls to the fallback text with status suffix, never silent', async () => {
  global.fetch = jest.fn()
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => dashboard() })
    .mockResolvedValue({ ok: false, status: 502, json: unparseable });
  render(<FinalWriteupFocusedView requestId={REQUEST_ID} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Mark reviewed' }));
  expect(await screen.findByText('Failed to record review (502)')).toBeInTheDocument();
});

test('acknowledge: non-2xx empty body ({}) falls to the fallback text with status suffix (finding 1 parity)', async () => {
  global.fetch = jest.fn()
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => dashboard() })
    .mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
  render(<FinalWriteupFocusedView requestId={REQUEST_ID} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Mark reviewed' }));
  expect(await screen.findByText('Failed to record review (500)')).toBeInTheDocument();
});
