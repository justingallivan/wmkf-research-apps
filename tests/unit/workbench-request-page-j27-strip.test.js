/**
 * @jest-environment jsdom
 *
 * Step E: the request page shows the J27 stage strip from the resolve DTO and
 * recomputes it as the tabs report their reads; a navigation never carries one
 * request's facts into another's stage.
 */
import { act, render, screen, waitFor } from '@testing-library/react';

let routeId = 'request-a';
let routeTab = 'overview';
let routeSection;
const pending = new Map();
let overviewFacts = null;

// The phase rollout setting (phase-admission.js): absent, which outside Production means on.
jest.mock('../../lib/services/settings-service', () => ({ getSettingStrict: jest.fn(async () => ({ found: false, value: null, revision: null })) }));
jest.mock('next/router', () => ({ useRouter: () => ({ query: { requestId: routeId, tab: routeTab, ...(routeSection ? { section: routeSection } : {}) }, push: jest.fn() }) }));
jest.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { profileName: 'Test User', dynamicsSystemuserId: 'user-1' } } }) }));
jest.mock('next/link', () => function LinkStub({ children }) { return <a href="#">{children}</a>; });
jest.mock('../../shared/components/Layout', () => ({ __esModule: true, default: ({ children }) => <div>{children}</div>, Card: ({ children }) => <div>{children}</div>, Button: ({ children }) => <button type="button">{children}</button> }));
jest.mock('../../shared/components/RequireAppAccess', () => function RequireAppAccessStub({ children }) { return children; });
jest.mock('../../shared/context/AppAccessContext', () => ({ useAppAccess: () => ({ isSuperuser: false, hasAccess: () => true }) }));
jest.mock('../../shared/context/ProfileContext', () => ({ useProfile: () => ({ preferences: {} }) }));
jest.mock('../../shared/config/reviewerFinderPreferences', () => ({ readEmailSignaturePreference: () => ({}) }));
jest.mock('../../shared/components/reviewers/reviewer-modes', () => ({ computeCanManage: () => false }));
jest.mock('../../lib/dataverse/core/interlock', () => ({ classifyTarget: () => 'sandbox' }));
jest.mock('../../shared/components/workbench/OverviewTab', () => function OverviewStub({ requestId, onJ27Facts }) {
  overviewFacts = onJ27Facts ? (patch) => onJ27Facts(requestId, patch) : null;
  return <div data-testid="overview" />;
});
for (const name of ['ReviewersTab']) jest.mock(`../../shared/components/reviewers/${name}`, () => function TabStub() { return <div />; });
for (const name of ['ReviewsTab', 'ProposalTab', 'StatusTab', 'AwardeeTab', 'InitialAssessmentTab', 'StaffDeliberationsTab', 'ReviewPanelTab', 'FinalWriteupTab']) {
  jest.mock(`../../shared/components/workbench/${name}`, () => function TabStub() { return <div />; });
}

import { WorkbenchRequest } from '../../pages/workbench/[requestId]';
import { CHAIRS_RECOMMENDATION_STATUS } from '../../shared/config/j27Scoring';
import { PHASE_I_CHAIRS } from '../../lib/services/workbench/j27-read-model';

const RESEARCH = '94cab30b-958f-ee11-8179-000d3a341e8f';
const NL = { status: 'not-loaded' };
const input = {
  request: { status: 'present', requestStatus: 'Phase I Pending', statusClass: 'IN_FLIGHT', phaseIStatus: CHAIRS_RECOMMENDATION_STATUS.yes, phaseIStatusLabel: null, phaseIIStatus: null, readyForReview: true, cycleCode: 'J27', grantProgramId: RESEARCH, triageStatus: null, isTestRequest: false },
  rationale: { status: 'present' }, reviewSummary: { status: 'absent' }, visitAssessment: { status: 'absent' }, rosterMemo: { status: 'absent' },
  reviewers: { status: 'present', anySuggestion: false, counts: NL }, integrity: { status: 'present', latest: null },
  calendar: { status: 'present', offrampMeetingDate: '2027-03-15', reviewsDueDate: '2027-03-01', today: '2026-11-09' },
  capabilities: { status: 'present', readOnly: false }, features: { status: 'present', chairsRecommendationEnabled: true },
  presentation: NL, roster: NL, boardDraft: NL, transition: NL,
};
// An invited request with invitations open: no line until reviewer counts load, then "Send reviewer invitations".
// The recommended request above reads "Awaiting the Chairs' outcome" either way, so it cannot show a facts change.
const invitedInput = { ...input, request: { ...input.request, requestStatus: 'Phase II Pending', phaseIStatus: PHASE_I_CHAIRS.invited } };
const resolved = (id, j27 = true, stageInput = invitedInput) => ({ ok: true, json: async () => ({ success: true, requestId: id, requestNumber: '1000384', cycleCode: 'J27', phaseLayout: true, ...(j27 ? { j27: { phase: 'initial-assessment', input: stageInput } } : {}) }) });

beforeEach(() => {
  routeId = 'request-a'; routeTab = 'overview'; routeSection = undefined; pending.clear(); overviewFacts = null;
  global.fetch = jest.fn((url) => new Promise((resolve) => pending.set(String(url), resolve)));
});

test('the strip renders from the resolve DTO and recomputes when the Overview reports its reads', async () => {
  render(<WorkbenchRequest />);
  await act(async () => { pending.get('/api/workbench/resolve-request?requestId=request-a')(resolved('request-a')); });
  const strip = await screen.findByLabelText('Where this request stands');
  expect(strip).toHaveTextContent('Peer Review');
  // Reviewer counts are not loaded yet, so the strip does not claim that nothing is waiting.
  expect(strip).not.toHaveTextContent('Nothing is waiting');
  expect(strip).not.toHaveTextContent('Next:');
  expect(strip).toHaveTextContent('Some facts load as you open tabs.');
  await act(async () => { overviewFacts({ progress: { status: 'ready', data: { counts: { candidates: 2, received: 0 } } } }); });
  expect(screen.getByLabelText('Where this request stands')).toHaveTextContent('Next: Send reviewer invitations');
});

test('a request recommended to the Chairs reads as a wait, before and after its reviewer counts load', async () => {
  render(<WorkbenchRequest />);
  await act(async () => { pending.get('/api/workbench/resolve-request?requestId=request-a')(resolved('request-a', true, input)); });
  const strip = await screen.findByLabelText('Where this request stands');
  expect(strip).toHaveTextContent('Initial Assessment');
  expect(strip).toHaveTextContent('Awaiting the Chairs’ outcome');
  expect(strip).not.toHaveTextContent('Next:');
  await act(async () => { overviewFacts({ progress: { status: 'ready', data: { counts: { candidates: 2, received: 0 } } } }); });
  expect(screen.getByLabelText('Where this request stands')).toHaveTextContent('Awaiting the Chairs’ outcome');
  expect(screen.getByLabelText('Where this request stands')).not.toHaveTextContent('Identify reviewers');
});

// Preview walk-through, 2026-11-12: a Peer Review list row opens the request on its
// Peer Review tab, where no Overview mounts. The page loads the reviewer counts
// itself so the strip names the same next step as the row.
test('opened on Peer Review, the page loads the reviewer counts itself and the strip matches the list row', async () => {
  routeTab = 'peer-review'; routeSection = 'reports';
  const awaitingPhaseII = { ...invitedInput, request: { ...invitedInput.request, requestStatus: 'Proposal Invited' } };
  render(<WorkbenchRequest staffReviewSummary />);
  await act(async () => { pending.get('/api/workbench/resolve-request?requestId=request-a')(resolved('request-a', true, awaitingPhaseII)); });
  const strip = await screen.findByLabelText('Where this request stands');
  expect(screen.queryByTestId('overview')).toBeNull();
  const rollupUrl = '/api/workbench/reviewer-rollup?requestId=request-a';
  await waitFor(() => expect(pending.has(rollupUrl)).toBe(true));
  const body = { success: true, counts: { candidates: 2, invited: 0, accepted: 0, completed: 0, received: 0 }, needed: 3 };
  await act(async () => { pending.get(rollupUrl)({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }); });
  await waitFor(() => expect(screen.getByLabelText('Where this request stands')).toHaveTextContent('Next: Identify reviewers'));
  // Only the counts moved; the other facts still load as their tabs open (C7).
  expect(strip).toHaveTextContent('Some facts load as you open tabs.');
  expect(global.fetch.mock.calls.filter(([url]) => String(url).startsWith('/api/workbench/reviewer-rollup'))).toHaveLength(1);
});

// Codex review of cc603be5e: the Overview used to fetch fresh counts on every visit, so
// returning to it after invitations or reports showed current guidance. The page-owned
// rollup must keep that: opening the Overview again reads the counts again.
test('returning to the Overview reads the reviewer counts again and the strip follows the new counts', async () => {
  routeTab = 'peer-review'; routeSection = 'reports';
  const view = render(<WorkbenchRequest staffReviewSummary />);
  await act(async () => { pending.get('/api/workbench/resolve-request?requestId=request-a')(resolved('request-a')); });
  await screen.findByLabelText('Where this request stands');
  const rollupUrl = '/api/workbench/reviewer-rollup?requestId=request-a';
  const answer = (counts) => { const body = { success: true, counts, needed: 3 }; return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }; };
  await waitFor(() => expect(pending.has(rollupUrl)).toBe(true));
  await act(async () => { pending.get(rollupUrl)(answer({ candidates: 2, invited: 0, accepted: 0, completed: 0, received: 0 })); });
  await waitFor(() => expect(screen.getByLabelText('Where this request stands')).toHaveTextContent('Next: Send reviewer invitations'));
  pending.delete(rollupUrl);
  routeTab = 'overview'; routeSection = undefined;
  view.rerender(<WorkbenchRequest staffReviewSummary />);
  await waitFor(() => expect(pending.has(rollupUrl)).toBe(true));
  await act(async () => { pending.get(rollupUrl)(answer({ candidates: 3, invited: 3, accepted: 3, completed: 0, received: 3 })); });
  await waitFor(() => expect(screen.getByLabelText('Where this request stands')).toHaveTextContent('Next: Read the reviewer reports'));
  expect(global.fetch.mock.calls.filter(([url]) => String(url) === rollupUrl)).toHaveLength(2);
});

test('a request opened on the Overview reads the reviewer counts once', async () => {
  render(<WorkbenchRequest staffReviewSummary />);
  await act(async () => { pending.get('/api/workbench/resolve-request?requestId=request-a')(resolved('request-a')); });
  await screen.findByLabelText('Where this request stands');
  await waitFor(() => expect(pending.has('/api/workbench/reviewer-rollup?requestId=request-a')).toBe(true));
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  expect(global.fetch.mock.calls.filter(([url]) => String(url).startsWith('/api/workbench/reviewer-rollup'))).toHaveLength(1);
});

test('a pre-2027 request makes no page-level reviewer counts read', async () => {
  render(<WorkbenchRequest />);
  await act(async () => { pending.get('/api/workbench/resolve-request?requestId=request-a')(resolved('request-a', false)); });
  await waitFor(() => expect(screen.getByTestId('overview')).toBeInTheDocument());
  expect(global.fetch.mock.calls.filter(([url]) => String(url).startsWith('/api/workbench/reviewer-rollup'))).toHaveLength(0);
});

test('facts reported for one request never shape another request\'s strip', async () => {
  const view = render(<WorkbenchRequest />);
  await act(async () => { pending.get('/api/workbench/resolve-request?requestId=request-a')(resolved('request-a')); });
  await screen.findByLabelText('Where this request stands');
  const reportForA = overviewFacts;
  routeId = 'request-b';
  view.rerender(<WorkbenchRequest />);
  expect(screen.queryByLabelText('Where this request stands')).toBeNull();
  await act(async () => { pending.get('/api/workbench/resolve-request?requestId=request-b')(resolved('request-b')); });
  const stripB = await screen.findByLabelText('Where this request stands');
  await act(async () => { reportForA({ progress: { status: 'ready', data: { counts: { candidates: 2 } } } }); });
  expect(stripB).not.toHaveTextContent('Nothing is waiting');
  expect(stripB).not.toHaveTextContent('Next:');
});

test('a pre-2027 request renders no strip and passes no callback', async () => {
  render(<WorkbenchRequest />);
  await act(async () => { pending.get('/api/workbench/resolve-request?requestId=request-a')(resolved('request-a', false)); });
  await waitFor(() => expect(screen.getByTestId('overview')).toBeInTheDocument());
  expect(screen.queryByLabelText('Where this request stands')).toBeNull();
  expect(overviewFacts).toBeNull();
});

test('a late callback from request A cannot erase request B\'s facts once B has them', async () => {
  const view = render(<WorkbenchRequest />);
  await act(async () => { pending.get('/api/workbench/resolve-request?requestId=request-a')(resolved('request-a')); });
  await screen.findByLabelText('Where this request stands');
  const reportForA = overviewFacts;
  routeId = 'request-b';
  view.rerender(<WorkbenchRequest />);
  await act(async () => { pending.get('/api/workbench/resolve-request?requestId=request-b')(resolved('request-b')); });
  await screen.findByLabelText('Where this request stands');
  await act(async () => { overviewFacts({ progress: { status: 'ready', data: { counts: { candidates: 2 } } } }); });
  expect(screen.getByLabelText('Where this request stands')).toHaveTextContent('Next: Send reviewer invitations');
  await act(async () => { reportForA({ progress: { status: 'error', data: null } }); });
  expect(screen.getByLabelText('Where this request stands')).toHaveTextContent('Next: Send reviewer invitations');
  expect(screen.getByLabelText('Where this request stands')).not.toHaveTextContent('could not be read');
});

test('A → B → A starts A again from the server stage; nothing from the first visit is reused', async () => {
  const view = render(<WorkbenchRequest />);
  await act(async () => { pending.get('/api/workbench/resolve-request?requestId=request-a')(resolved('request-a')); });
  await screen.findByLabelText('Where this request stands');
  await act(async () => { overviewFacts({ progress: { status: 'ready', data: { counts: { candidates: 2 } } } }); });
  expect(screen.getByLabelText('Where this request stands')).toHaveTextContent('Next: Send reviewer invitations');
  routeId = 'request-b'; view.rerender(<WorkbenchRequest />);
  pending.clear();
  routeId = 'request-a'; view.rerender(<WorkbenchRequest />);
  await act(async () => { pending.get('/api/workbench/resolve-request?requestId=request-a')(resolved('request-a')); });
  const strip = await screen.findByLabelText('Where this request stands');
  expect(strip).not.toHaveTextContent('Nothing is waiting');
  expect(strip).not.toHaveTextContent('Next:');
});

test('a later unknown freshness result replaces an earlier known one on the same page (true → unknown, false → unknown)', async () => {
  render(<WorkbenchRequest />);
  const peerReview = { ...input, request: { ...input.request, requestStatus: 'Phase II Pending', phaseIStatus: 100000003, phaseIIStatus: 100000002 }, reviewSummary: { status: 'present' } };
  await act(async () => {
    pending.get('/api/workbench/resolve-request?requestId=request-a')({ ok: true, json: async () => ({ success: true, requestId: 'request-a', cycleCode: 'J27', phaseLayout: true, j27: { phase: 'peer-review', input: peerReview } }) });
  });
  await screen.findByLabelText('Where this request stands');
  await act(async () => { overviewFacts({ progress: { status: 'ready', data: { counts: { candidates: 3, invited: 3, accepted: 3, received: 1, completed: 0 } } }, summaryStale: true }); });
  expect(screen.getByLabelText('Where this request stands')).toHaveTextContent('Reviewer reports changed');
  await act(async () => { overviewFacts({ summaryStale: null }); });
  expect(screen.getByLabelText('Where this request stands')).not.toHaveTextContent('Reviewer reports changed');
  await act(async () => { overviewFacts({ summaryStale: false }); });
  expect(screen.getByLabelText('Where this request stands')).not.toHaveTextContent('Reviewer reports changed');
  await act(async () => { overviewFacts({ summaryStale: null }); });
  expect(screen.getByLabelText('Where this request stands')).not.toHaveTextContent('Reviewer reports changed');
});

// The page stamps each report with the order it landed in, and the newer report of the
// presentation wins (Codex build review 3). Both orders, so the test fails if the stamp
// is ignored and either reporter is applied last regardless.
test.each([
  ['Final Writeup then a newer Overview', ['finalWriteup', 'overview'], true],
  ['Overview then a newer Final Writeup', ['overview', 'finalWriteup'], false],
])('%s: the newer presentation report decides the strip', async (_label, order, offersStart) => {
  const present = { status: 'present' };
  const server = {
    ...invitedInput,
    reviewSummary: present, visitAssessment: present,
    reviewers: { status: 'present', anySuggestion: true, counts: { status: 'present', candidates: 3, invited: 3, accepted: 3, received: 3, completed: 3 } },
    presentation: { status: 'present', exists: true, id: 'v1', ended: true, legacyException: false },
    roster: { status: 'present', stale: false },
    boardDraft: { status: 'present', exists: true },
    transition: { status: 'present', phase: null },
  };
  render(<WorkbenchRequest />);
  await act(async () => { pending.get('/api/workbench/resolve-request?requestId=request-a')(resolved('request-a', true, server)); });
  await screen.findByLabelText('Where this request stands');
  const notEnded = { status: 'present', exists: true, id: 'v1', ended: false, legacyException: false };
  const ended = { ...notEnded, ended: true };
  const reports = {
    finalWriteup: { finalWriteup: { available: true, phase: 'ready', sourceArtifactId: 'a', stageFacts: {
      presentation: notEnded, boardDraft: { status: 'present', exists: true }, transition: { status: 'present', phase: null } } } },
    overview: { overview: { meeting: { presentation: true, stageFacts: { presentation: ended, roster: { status: 'present', stale: false } } } } },
  };
  for (const name of order) await act(async () => { overviewFacts(reports[name]); });
  const strip = screen.getByLabelText('Where this request stands');
  if (offersStart) expect(strip).toHaveTextContent('Next: Start group review');
  else expect(strip).not.toHaveTextContent('Start group review');
});
