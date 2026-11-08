/** @jest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react';
import OverviewTab from '../../shared/components/workbench/OverviewTab';
import { FIRST_CUT_STATUS, SEMI_FINALIST_STATUS } from '../../shared/config/j27FirstCut';

const context = {
  requestId: 'request-a', requestStatus: 'Phase I Pending', statusClass: 'IN_FLIGHT',
  phaseIStatus: FIRST_CUT_STATUS.yes,
};
const base = {
  'reviewer-rollup': { success: true, counts: { received: 1, completed: 0 }, needed: 3 },
  'initial-assessment-rationale': { rationale: 'Saved rationale' },
  'staff-review-summary': { summary: 'Saved interpretation' },
  'staff-visit-assessment': { assessment: '' },
  'meeting-roster': { presentation: null },
};

function renderOverview({ reads = {}, status = {}, onSelectTab } = {}) {
  global.fetch = jest.fn(async (url, options) => {
    const endpoint = String(url).split('?')[0].split('/').at(-1);
    if (options?.method && options.method !== 'GET') throw new Error('Overview must be read-only');
    const body = { ...base, ...reads }[endpoint];
    return { ok: body != null, json: async () => body };
  });
  render(<OverviewTab context={{ ...context, ...status }} requestId={context.requestId}
    j27Handoffs initialRationaleEnabled meetingRosterEnabled onSelectTab={onSelectTab} />);
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
  expect(screen.queryByText(/Visit assessment ·/)).toBeNull();
  expect(screen.getByText('Request details')).toBeVisible();
});

test('a saved visit points to the Board recommendation and preserves handoff evidence', async () => {
  renderOverview({ reads: {
    'staff-visit-assessment': { assessment: 'Saved visit assessment' },
    'meeting-roster': { presentation: { id: 'visit' }, stale: false, roster: {} },
  } });
  expect(await screen.findByRole('heading', { name: 'Visit assessment saved' })).toBeVisible();
  expect(screen.getByText(/Final Assessment shows the Board draft status/)).toBeVisible();
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
  expect(screen.queryByText(/Visit assessment ·/)).toBeNull();
});

test('First Cut Not Scored points to Initial Assessment without treating it as a formal outcome', async () => {
  renderOverview({ status: { phaseIStatus: FIRST_CUT_STATUS.no } });
  expect(await screen.findByRole('heading', { name: 'First Cut marked Not Scored' })).toBeVisible();
  expect(screen.getByText('The decision and staff rationale are in Initial Assessment.')).toBeVisible();
  expect(screen.queryByText('Request outcome recorded')).toBeNull();
});

test('a recorded outcome takes priority over the suggested handoff', async () => {
  renderOverview({
    status: { requestStatus: 'Phase II Declined', statusClass: 'DECIDED_NO_AWARD' },
    reads: { 'staff-visit-assessment': { assessment: 'Saved visit assessment' } },
  });
  expect(await screen.findByText('Visit assessment · Saved')).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Phase II Declined' })).toBeVisible();
  expect(screen.queryByText(/prepare the Board recommendation/)).toBeNull();
});

test('a failed read stays unknown once that stage has relevant evidence', async () => {
  renderOverview({ reads: {
    'staff-visit-assessment': null, 'staff-review-summary': null,
    'meeting-roster': { presentation: { id: 'visit' }, stale: false, roster: {} },
  } });
  expect(await screen.findByText('Visit assessment · Couldn’t check')).toBeVisible();
  expect(screen.getByText('Staff review summary · Couldn’t check')).toBeVisible();
  expect(screen.getByText(/staff assessment in Deliberations/)).toBeVisible();
});


test.each([
  [null, 'No decision recorded', '', 'No saved text'],
  [FIRST_CUT_STATUS.yes, 'First Cut · Scored', 'Saved rationale', 'Saved'],
  [SEMI_FINALIST_STATUS.yes, 'Semi-finalist · Yes', 'Saved rationale', 'Saved'],
])('keeps the Initial Assessment checkpoint after peer review (%s)', async (phaseIStatus, decision, rationale, rationaleStatus) => {
  renderOverview({ status: { phaseIStatus }, reads: { 'initial-assessment-rationale': { rationale } } });
  expect(await screen.findByRole('heading', { name: 'Staff review summary saved' })).toBeVisible();
  const checkpoint = screen.getByText('Initial Assessment', { exact: true }).closest('div');
  expect(checkpoint).toHaveTextContent(decision);
  expect(checkpoint).toHaveTextContent(`Staff rationale · ${rationaleStatus}`);
  if (phaseIStatus === SEMI_FINALIST_STATUS.yes) expect(checkpoint).not.toHaveTextContent('First Cut');
});
