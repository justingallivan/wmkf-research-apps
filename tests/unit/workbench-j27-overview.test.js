/** @jest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react';
import OverviewTab from '../../shared/components/workbench/OverviewTab';
import { FIRST_CUT_STATUS } from '../../shared/config/j27FirstCut';

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

function renderOverview({ reads = {}, status = {} } = {}) {
  global.fetch = jest.fn(async (url, options) => {
    const endpoint = String(url).split('?')[0].split('/').at(-1);
    if (options?.method && options.method !== 'GET') throw new Error('Overview must be read-only');
    const body = { ...base, ...reads }[endpoint];
    return { ok: body != null, json: async () => body };
  });
  const onSelectTab = jest.fn();
  render(<OverviewTab context={{ ...context, ...status }} requestId={context.requestId}
    onSelectTab={onSelectTab} j27Handoffs initialRationaleEnabled meetingRosterEnabled />);
  return onSelectTab;
}

test('a saved visit assessment opens the Final Assessment handoff while displaying recorded status', async () => {
  const onSelectTab = renderOverview({ reads: {
    'staff-visit-assessment': { assessment: 'Saved visit assessment' },
    'meeting-roster': { presentation: { id: 'visit' }, stale: false, roster: {} },
  } });
  expect(await screen.findByRole('heading', { name: 'Review the material for Final Assessment' })).toBeVisible();
  expect(screen.getByText('Suggested next step')).toBeVisible();
  expect(screen.getByText(/The visit assessment is saved/)).toBeVisible();
  const recordedStatus = screen.getByText('Recorded status in Dataverse').closest('dl');
  expect(recordedStatus).toHaveTextContent('Phase I Pending');
  expect(recordedStatus).not.toHaveTextContent('Final Assessment');
  expect(screen.getByText('1 report received')).toBeVisible();
  expect(screen.getByText('Attendance · Confirmed')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Open Final Assessment' }));
  expect(onSelectTab).toHaveBeenCalledWith('final-assessment');
  expect(global.fetch.mock.calls.filter(([url]) => url.includes('reviewer-rollup'))).toHaveLength(1);
});

test('saved review prose without a presentation points staff to Reports for the next decision', async () => {
  const onSelectTab = renderOverview();
  expect(await screen.findByRole('heading', { name: 'Staff review summary saved' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Open Reports' }));
  expect(onSelectTab).toHaveBeenCalledWith('reviews');
  expect(screen.queryByRole('button', { name: 'Open Final Assessment' })).toBeNull();
});

test('First Cut Not Scored links to the decision without treating it as a formal outcome', async () => {
  const onSelectTab = renderOverview({ status: { phaseIStatus: FIRST_CUT_STATUS.no } });
  expect(await screen.findByRole('heading', { name: 'First Cut marked Not Scored' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Open Initial Assessment' }));
  expect(onSelectTab).toHaveBeenCalledWith('initial-assessment');
  expect(screen.queryByText('Request outcome recorded')).toBeNull();
});

test('a recorded outcome takes priority over the suggested handoff', async () => {
  renderOverview({
    status: { requestStatus: 'Phase II Declined', statusClass: 'DECIDED_NO_AWARD' },
    reads: { 'staff-visit-assessment': { assessment: 'Saved visit assessment' } },
  });
  expect(await screen.findByText('Visit assessment · Saved')).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Request outcome recorded' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Open Final Assessment' })).toBeNull();
});

test('a failed staff record read stays unknown while available evidence remains actionable', async () => {
  renderOverview({ reads: { 'staff-visit-assessment': null, 'staff-review-summary': null } });
  expect(await screen.findByText('Visit assessment · Couldn’t check')).toBeVisible();
  expect(screen.getByText('Staff review summary · Couldn’t check')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Open Reports' })).toBeVisible();
});
