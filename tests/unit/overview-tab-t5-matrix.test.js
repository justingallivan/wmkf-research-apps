/**
 * @jest-environment jsdom
 *
 * OverviewTab — T5 gap-fill (Stage 5a). tests/unit/workbench-overview-
 * status.test.js pins 2xx success only for the reviewer-rollup GET (body
 * `.success` flag + HTTP status combined check, migrated to requestEnvelope
 * with tolerantBody: true). This file adds non-2xx, network-rejection, and
 * axis-(e) coverage — all three funnel into the same fixed "Couldn't load
 * reviewer progress." copy today (the raw message is swallowed by the final
 * `.catch(() => setState({status:'error'...}))`), so this is a no-op
 * behavior change, pinned as never-silent (the fixed copy IS the signal).
 */
import { render, screen } from '@testing-library/react';
import OverviewTab from '../../shared/components/workbench/OverviewTab';

const baseCtx = {
  requestId: 'r1',
  requestStatus: 'Phase II Pending',
  statusClass: 'IN_FLIGHT',
  institution: 'Example University',
  grantProgram: 'Medical Research',
  meetingDate: '2026-07-01T00:00:00Z',
  proposalInfo: { pi: 'Dr. Jane Smith', coPIs: [], requestedAmount: 100000, totalProjectBudget: 250000 },
  aiContent: { fitRationale: 'x', summary: null, dataExtract: null, fieldPrimer: null },
};

const unparseable = () => Promise.reject(new SyntaxError('Unexpected token <'));

afterEach(() => jest.restoreAllMocks());

test('non-2xx {error} is never silent (shows the fixed failure copy)', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: 'Forbidden' }) });
  render(<OverviewTab context={baseCtx} requestId="r1" />);
  expect(await screen.findByText('Couldn’t load reviewer progress.')).toBeInTheDocument();
});

test('network rejection is never silent (shows the fixed failure copy)', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
  render(<OverviewTab context={baseCtx} requestId="r1" />);
  expect(await screen.findByText('Couldn’t load reviewer progress.')).toBeInTheDocument();
});

test('axis (e): non-2xx unparseable body is never silent (shows the fixed failure copy)', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 502, json: unparseable });
  render(<OverviewTab context={baseCtx} requestId="r1" />);
  expect(await screen.findByText('Couldn’t load reviewer progress.')).toBeInTheDocument();
});
