/** @jest-environment jsdom */
// Site Visit page header status chip (docs/plans/SITE_VISIT_PAGE_REDESIGN_PLAN_2026-10-10.md §10 mapping table).
import { act, render, screen, waitFor } from '@testing-library/react';
import { resolveSiteVisitHeaderStatus } from '../../shared/utils/site-visit-header-status';
import SiteVisitEditor from '../../shared/components/meeting-tracker/SiteVisitEditor';

const ready = { key: 'ready', overdue: false };
const recorded = (board) => ({ available: true, hasTranscript: true, board });

describe('resolveSiteVisitHeaderStatus', () => {
  test.each([
    ['materials load failed', { key: 'unavailable' }, recorded(['on', 'on']), 'Status unknown', 'gray'],
    ['no collection', { key: 'not_requested' }, recorded(['on', 'on']), 'Materials not requested', 'gray'],
    ['waiting', { key: 'missing', overdue: false }, recorded(['on', 'on']), 'Waiting on materials', 'gray'],
    ['waiting and overdue', { key: 'missing', overdue: true }, recorded(['on', 'on']), 'Waiting on materials', 'amber'],
    ['saving an upload', { key: 'processing' }, recorded(['on', 'on']), 'Waiting on materials', 'gray'],
    ['upload needs attention', { key: 'needs_attention' }, recorded(['on', 'on']), 'Materials need attention', 'amber'],
    ['files to check', { key: 'received' }, recorded(['on', 'on']), 'Materials need attention', 'amber'],
    ['recording card unavailable', ready, { available: false, hasTranscript: false, board: [] }, 'Status unknown', 'gray'],
    ['no transcript', ready, { available: true, hasTranscript: false, board: ['not_yet', 'not_yet'] }, 'No recording yet', 'gray'],
    ['a Board line unknown', ready, recorded(['on', 'unknown']), 'Status unknown', 'gray'],
    ['a Board line not yet', ready, recorded(['on', 'not_yet', 'on']), 'Board page incomplete', 'amber'],
    ['unknown outranks not yet', ready, recorded(['not_yet', 'unknown']), 'Status unknown', 'gray'],
    ['every shown line on (video off)', ready, recorded(['on', 'on']), 'Board page ready', 'green'],
    ['every shown line on (video on)', ready, recorded(['on', 'on', 'on']), 'Board page ready', 'green'],
    ['closed counts as finished', { key: 'closed' }, recorded(['on', 'on']), 'Board page ready', 'green'],
  ])('%s', (_label, materials, recording, label, tone) => {
    expect(resolveSiteVisitHeaderStatus(materials, recording)).toEqual({ label, tone });
  });

  test('the first unfinished stage wins in both directions', () => {
    expect(resolveSiteVisitHeaderStatus({ key: 'not_requested' }, recorded(['on', 'on'])).label).toBe('Materials not requested');
    expect(resolveSiteVisitHeaderStatus(ready, recorded(['not_yet', 'not_yet'])).label).toBe('Board page incomplete');
    expect(resolveSiteVisitHeaderStatus({ key: 'missing' }, { available: true, hasTranscript: false, board: [] }).label).toBe('Waiting on materials');
  });

  test('no chip until both cards report, or while the video line is still loading', () => {
    expect(resolveSiteVisitHeaderStatus(null, recorded(['on', 'on']))).toBeNull();
    expect(resolveSiteVisitHeaderStatus(ready, null)).toBeNull();
    expect(resolveSiteVisitHeaderStatus(ready, recorded(['on', 'on', 'pending']))).toBeNull();
  });
});

// The editor shows the chip from what the two cards report; the cards are stubbed so each report is explicit.
let routerQuery = {};
const reporters = {};
jest.mock('next/router', () => ({ useRouter: () => ({ isReady: true, query: routerQuery }) }));
jest.mock('next/link', () => function MockLink({ children, href }) {
  return <a href={typeof href === 'string' ? href : href.pathname}>{children}</a>;
});
jest.mock('../../shared/components/Layout', () => ({
  __esModule: true,
  default: ({ children }) => <div>{children}</div>,
  Button: ({ children, loading, ...props }) => <button {...props}>{children}</button>,
}));
jest.mock('../../shared/components/meeting-tracker/SiteVisitMaterialsCard', () => ({
  __esModule: true,
  default: ({ requestId, onStatusChange }) => { reporters.materials = { requestId, onStatusChange }; return null; },
}));
jest.mock('../../shared/components/meeting-tracker/RecordingAndTranscriptCard', () => ({
  __esModule: true,
  default: ({ requestId, onStatusChange }) => { reporters.recording = { requestId, onStatusChange }; return null; },
}));

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const visit = { activityId: 'a1', etag: 'W/"1"', subject: 'Site Visit', startLocal: '2026-10-01T09:00', endLocal: '2026-10-01T12:00', timeZone: 'America/Los_Angeles', format: 100000001, locationOrLink: 'Campus', organizer: { kind: 'staff', profileId: 7 }, requiredAttendees: [], optionalAttendees: [] };
function response(body, status = 200) { return { ok: status < 300, status, json: async () => body }; }

describe('SiteVisitEditor header chip', () => {
  beforeEach(() => {
    routerQuery = { requestId: REQUEST_ID, n: '1003222', cycleCode: 'D26', programId: 'p1' };
    delete reporters.materials; delete reporters.recording;
    global.fetch = jest.fn(async (url) => (String(url).includes('/recipients')
      ? response({ staff: [], board: [] }) : response({ success: true, siteVisit: visit })));
  });

  test('shows nothing until both cards report, then the resolved stage', async () => {
    render(<SiteVisitEditor />);
    await waitFor(() => expect(reporters.materials && reporters.recording).toBeTruthy());
    act(() => reporters.materials.onStatusChange(ready));
    expect(screen.queryByTestId('visit-header-status')).not.toBeInTheDocument();
    act(() => reporters.recording.onStatusChange(recorded(['on', 'not_yet'])));
    expect(screen.getByTestId('visit-header-status')).toHaveTextContent('Board page incomplete');
    act(() => reporters.recording.onStatusChange(recorded(['on', 'on'])));
    expect(screen.getByTestId('visit-header-status')).toHaveTextContent('Board page ready');
    act(() => reporters.materials.onStatusChange({ key: 'missing', overdue: true }));
    expect(screen.getByTestId('visit-header-status')).toHaveTextContent('Waiting on materials');
  });

  test('moving to another visit drops the previous visit\'s chip until the new cards report', async () => {
    const view = render(<SiteVisitEditor />);
    await waitFor(() => expect(reporters.materials && reporters.recording).toBeTruthy());
    act(() => { reporters.materials.onStatusChange(ready); reporters.recording.onStatusChange(recorded(['on', 'on'])); });
    expect(screen.getByTestId('visit-header-status')).toHaveTextContent('Board page ready');
    const OTHER = '22222222-2222-4222-8222-222222222222';
    routerQuery = { ...routerQuery, requestId: OTHER, n: '1003223' };
    view.rerender(<SiteVisitEditor />);
    await waitFor(() => expect(reporters.recording.requestId).toBe(OTHER));
    expect(screen.queryByTestId('visit-header-status')).not.toBeInTheDocument();
    act(() => reporters.materials.onStatusChange({ key: 'not_requested', overdue: false }));
    act(() => reporters.recording.onStatusChange(recorded(['on', 'on'])));
    expect(screen.getByTestId('visit-header-status')).toHaveTextContent('Materials not requested');
  });
});
