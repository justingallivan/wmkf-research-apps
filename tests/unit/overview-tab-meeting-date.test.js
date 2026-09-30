/**
 * @jest-environment jsdom
 *
 * OverviewTab — Board Meeting renders the DateOnly wmkf_meetingdate on its own
 * calendar day. The value parses as UTC midnight, so formatting in the
 * viewer's zone showed the day before for anyone west of UTC (Request 1003302:
 * 12/11/2026 displayed as Dec 10). TZ is pinned to Pacific so the test
 * discriminates in a UTC CI process.
 */
import { render, screen } from '@testing-library/react';
import OverviewTab from '../../shared/components/workbench/OverviewTab';

const originalTz = process.env.TZ;
beforeAll(() => { process.env.TZ = 'America/Los_Angeles'; });
afterAll(() => { process.env.TZ = originalTz; });
afterEach(() => jest.restoreAllMocks());

const ctx = (meetingDate) => ({
  requestId: 'r1',
  requestStatus: 'Phase II Pending',
  statusClass: 'IN_FLIGHT',
  institution: 'Example University',
  grantProgram: 'Medical Research',
  meetingDate,
  proposalInfo: { pi: 'Dr. Jane Smith', coPIs: [], requestedAmount: 100000, totalProjectBudget: 250000 },
  aiContent: { fitRationale: 'x', summary: null, dataExtract: null, fieldPrimer: null },
});

test.each([
  ['2026-12-11', 'Dec 11, 2026'],
  ['2026-12-11T00:00:00Z', 'Dec 11, 2026'],
])('meeting date %s renders as %s in a Pacific browser', async (value, expected) => {
  global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
  render(<OverviewTab context={ctx(value)} requestId="r1" />);
  expect(await screen.findByText(expected)).toBeInTheDocument();
});
