/** @jest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import OverviewTab from '../../shared/components/workbench/OverviewTab';
import { SCORING_STATUS, CHAIRS_RECOMMENDATION_STATUS } from '../../shared/config/j27Scoring';

const context = {
  requestId: 'request-a', requestStatus: 'Phase I Pending', statusClass: 'IN_FLIGHT',
  phaseIStatus: SCORING_STATUS.yes,
};
const base = {
  'reviewer-rollup': { success: true, counts: { received: 1, completed: 0 }, needed: 3 },
  'initial-assessment-rationale': { rationale: 'Saved rationale' },
  'staff-review-summary': { summary: 'Saved interpretation' },
  'staff-visit-assessment': { assessment: '' },
  'meeting-roster': { presentation: null },
};

function renderOverview({ reads = {}, status = {}, onSelectTab, onJ27Facts } = {}) {
  global.fetch = jest.fn(async (url, options) => {
    const endpoint = String(url).split('?')[0].split('/').at(-1);
    if (options?.method && options.method !== 'GET') throw new Error('Overview must be read-only');
    const body = { ...base, ...reads }[endpoint];
    return { ok: body != null, json: async () => body };
  });
  render(<OverviewTab context={{ ...context, ...status }} requestId={context.requestId}
    j27Handoffs initialRationaleEnabled meetingRosterEnabled onSelectTab={onSelectTab} onJ27Facts={onJ27Facts} />);
}

test('intake shows one instruction and keeps later-stage empty states out of the summary', async () => {
  renderOverview({
    status: { phaseIStatus: null, requestStatus: null },
    reads: {
      'reviewer-rollup': { success: true, counts: { received: 0 } },
      'initial-assessment-rationale': { rationale: '' },
      'staff-review-summary': { summary: '' },
      'staff-visit-assessment': null,
    },
  });
  expect(await screen.findByRole('heading', { name: 'Initial assessment pending' })).toBeVisible();
  expect(screen.getByText('Read the proposal and record the staff rationale in Initial Assessment.')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Open Initial Assessment' })).toBeNull();
  expect(screen.queryByText('0 reports received')).toBeNull();
  expect(screen.queryByText(/Presentation assessment ·/)).toBeNull();
  expect(screen.getByText('Request details')).toBeVisible();
});

test('a saved presentation assessment points to the Draft Writeup and preserves handoff evidence', async () => {
  renderOverview({ reads: {
    'staff-visit-assessment': { assessment: 'Saved visit assessment' },
    'meeting-roster': { presentation: { id: 'visit' }, stale: false, roster: {} },
  } });
  expect(await screen.findByRole('heading', { name: 'Presentation assessment saved' })).toBeVisible();
  expect(screen.getByText(/Final Assessment shows the Draft Writeup status/)).toBeVisible();
  expect(screen.getByText('Recorded request status').closest('dl')).toHaveTextContent('Phase I Pending');
  expect(screen.getByText('1 report received')).toBeVisible();
  expect(screen.getByText('Attendance · Confirmed')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Open Final Assessment' })).toBeNull();
  expect(global.fetch.mock.calls.filter(([url]) => url.includes('reviewer-rollup'))).toHaveLength(1);
});

test('saved review prose without a presentation opens Reports directly', async () => {
  const onSelectTab = jest.fn();
  renderOverview({ onSelectTab });
  expect(await screen.findByRole('heading', { name: 'Staff review summary saved' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Open Reports' }));
  expect(onSelectTab).toHaveBeenCalledWith('reviews');
  expect(screen.queryByText(/Presentation assessment ·/)).toBeNull();
});

test('Not Scored points to Initial Assessment without treating it as a formal outcome', async () => {
  renderOverview({ status: { phaseIStatus: SCORING_STATUS.no } });
  expect(await screen.findByRole('heading', { name: 'Marked Not Scored' })).toBeVisible();
  expect(screen.getByText('The decision and staff rationale are in Initial Assessment.')).toBeVisible();
  expect(screen.queryByText('Request outcome recorded')).toBeNull();
});

test('a recorded outcome takes priority over the suggested handoff', async () => {
  renderOverview({
    status: { requestStatus: 'Phase II Declined', statusClass: 'DECIDED_NO_AWARD' },
    reads: { 'staff-visit-assessment': { assessment: 'Saved visit assessment' } },
  });
  expect(await screen.findByText('Presentation assessment · Saved')).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Phase II Declined' })).toBeVisible();
  expect(screen.queryByText(/prepare the Board recommendation/)).toBeNull();
});

test('a failed read stays unknown once that stage has relevant evidence', async () => {
  renderOverview({ reads: {
    'staff-visit-assessment': null, 'staff-review-summary': null,
    'meeting-roster': { presentation: { id: 'visit' }, stale: false, roster: {} },
  } });
  expect(await screen.findByText('Presentation assessment · Couldn’t check')).toBeVisible();
  expect(screen.getByText('Staff review summary · Couldn’t check')).toBeVisible();
  expect(screen.getByText(/staff assessment in Deliberations/)).toBeVisible();
});


test.each([
  [null, 'No decision recorded', '', 'No saved text'],
  [SCORING_STATUS.yes, 'Scored', 'Saved rationale', 'Saved'],
  [CHAIRS_RECOMMENDATION_STATUS.yes, 'Recommended to Chairs', 'Saved rationale', 'Saved'],
])('keeps the Initial Assessment checkpoint after peer review (%s)', async (phaseIStatus, decision, rationale, rationaleStatus) => {
  renderOverview({ status: { phaseIStatus }, reads: { 'initial-assessment-rationale': { rationale } } });
  expect(await screen.findByRole('heading', { name: 'Staff review summary saved' })).toBeVisible();
  const checkpoint = screen.getByText('Initial Assessment', { exact: true }).closest('div');
  expect(checkpoint).toHaveTextContent(decision);
  expect(checkpoint).toHaveTextContent(`Staff rationale · ${rationaleStatus}`);
  if (phaseIStatus === CHAIRS_RECOMMENDATION_STATUS.yes) expect(checkpoint).not.toHaveTextContent('Scored');
});

test('step E: reports the reviewer rollup and the handoff reads to the page with the meeting-roster projection', async () => {
  const onJ27Facts = jest.fn();
  renderOverview({ onJ27Facts, reads: { 'meeting-roster': { presentation: { id: 'visit' }, stale: true, roster: { wmkf: [] } }, 'staff-visit-assessment': { assessment: null } } });
  await waitFor(() => expect(onJ27Facts.mock.calls.some(([, patch]) => patch.overview)).toBe(true));
  await waitFor(() => expect(onJ27Facts.mock.calls.some(([, patch]) => patch.progress)).toBe(true));
  const calls = onJ27Facts.mock.calls.filter(([id]) => id === context.requestId);
  const progress = calls.find(([, patch]) => patch.progress)?.[1].progress;
  const overview = calls.find(([, patch]) => patch.overview)?.[1].overview;
  expect(progress).toMatchObject({ status: 'ready', data: { counts: { received: 1 } } });
  expect(overview).toEqual({ rationale: true, review: true, visit: null, meeting: { presentation: true, presentationId: 'visit', roster: true, rosterStale: true } });
});
