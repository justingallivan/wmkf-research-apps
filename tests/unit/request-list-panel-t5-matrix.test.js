/**
 * @jest-environment jsdom
 *
 * RequestListPanel — T5 gap-fill (Stage 5a). Existing request-list-panel.test.js
 * pins 2xx success, malformed/mismatched-context bodies, and the null-body
 * 403 fallback for loadProposals (GET /api/workbench/dashboard, migrated to
 * requestEnvelope to keep the exact `Failed to load requests (${status})`
 * interpolation the existing 403 test pins verbatim). This file adds network
 * rejection for both sites and the request-bytes pin for setTriageStatus
 * (POST /api/workbench/triage, migrated to requestJson).
 */
import { fireEvent, render, screen } from '@testing-library/react';
import RequestListPanel from '../../shared/components/workbench/RequestListPanel';

jest.mock('next/router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('../../shared/components/Layout', () => ({
  Card: ({ children }) => <div>{children}</div>,
}));
jest.mock('../../shared/components/workbench/ReviewerStatusIndicator', () => ({
  __esModule: true,
  default: () => null,
}));

const CYCLE = { code: 'J26', label: 'June 2026', myCount: 1, mySetAsideCount: 0 };
const row = (overrides = {}) => ({
  requestId: 'request-a',
  requestNumber: '1001',
  cycleLabel: 'June 2026',
  grantProgram: 'Research',
  institution: 'Example University',
  workRemaining: 'find',
  reviewers: [],
  canManage: true,
  isMine: true,
  setAside: false,
  advancing: false,
  ...overrides,
});

function renderPanel(overrides = {}) {
  return render(
    <RequestListPanel
      programId="program-a"
      cycleCode="J26"
      cycles={[CYCLE]}
      cyclesGeneration={1}
      patchCycleCounts={jest.fn()}
      loadingCycles={false}
      scope="my"
      includeSetAside={false}
      onScopeChange={jest.fn()}
      onIncludeSetAsideChange={jest.fn()}
      {...overrides}
    />,
  );
}

function response(body, status = 200) {
  const payload = body && Array.isArray(body.proposals)
    ? { programId: 'program-a', cycleCode: 'J26', scope: 'my', includeSetAside: false, ...body }
    : body;
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

afterEach(() => jest.restoreAllMocks());

test('loadProposals: network rejection is never silent', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
  renderPanel();
  expect(await screen.findByText('offline')).toBeInTheDocument();
});

test('setTriageStatus: network rejection is never silent', async () => {
  global.fetch = jest.fn()
    .mockResolvedValueOnce(response({ proposals: [row()], rollup: { total: 1 } }))
    .mockRejectedValueOnce(new Error('offline'));
  renderPanel();
  await screen.findByText('#1001');
  fireEvent.change(screen.getByTitle('Set triage status'), { target: { value: 'advancing' } });
  expect(await screen.findByText('offline')).toBeInTheDocument();
});

test('setTriageStatus: request bytes (url, method, headers, exact body) unchanged', async () => {
  global.fetch = jest.fn()
    .mockResolvedValueOnce(response({ proposals: [row()], rollup: { total: 1 } }))
    .mockResolvedValueOnce(response({ success: true }))
    .mockResolvedValueOnce(response({ proposals: [row({ advancing: true })], rollup: { total: 1 } }));
  renderPanel();
  await screen.findByText('#1001');
  fireEvent.change(screen.getByTitle('Set triage status'), { target: { value: 'advancing' } });
  await screen.findByText('#1001');
  const triageCall = global.fetch.mock.calls.find(([url]) => url === '/api/workbench/triage');
  expect(triageCall).toBeDefined();
  const [, opts] = triageCall;
  expect(opts.method).toBe('POST');
  expect(opts.headers).toEqual({ 'Content-Type': 'application/json' });
  expect(opts.body).toBe(JSON.stringify({ requestId: 'request-a', triageStatus: 100000000 }));
});
