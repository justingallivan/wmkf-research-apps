/**
 * @jest-environment jsdom
 *
 * Step E: the request page shows the J27 stage strip from the resolve DTO and
 * recomputes it as the tabs report their reads; a navigation never carries one
 * request's facts into another's stage.
 */
import { act, render, screen, waitFor } from '@testing-library/react';

let routeId = 'request-a';
const pending = new Map();
let overviewFacts = null;

jest.mock('next/router', () => ({ useRouter: () => ({ query: { requestId: routeId, tab: 'overview' }, push: jest.fn() }) }));
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
import { SEMI_FINALIST_STATUS } from '../../shared/config/j27FirstCut';

const RESEARCH = '94cab30b-958f-ee11-8179-000d3a341e8f';
const NL = { status: 'not-loaded' };
const input = {
  request: { status: 'present', requestStatus: 'Phase I Pending', statusClass: 'IN_FLIGHT', phaseIStatus: SEMI_FINALIST_STATUS.yes, phaseIStatusLabel: null, phaseIIStatus: null, readyForReview: true, cycleCode: 'J27', grantProgramId: RESEARCH, triageStatus: null, isTestRequest: false },
  rationale: { status: 'present' }, reviewSummary: { status: 'absent' }, visitAssessment: { status: 'absent' }, rosterMemo: { status: 'absent' },
  reviewers: { status: 'present', anySuggestion: false, counts: NL }, integrity: { status: 'present', latest: null },
  calendar: { status: 'present', offrampMeetingDate: '2027-03-15', reviewsDueDate: '2027-03-01', today: '2026-11-09' },
  capabilities: { status: 'present', readOnly: false }, features: { status: 'present', semiFinalistEnabled: true },
  presentation: NL, roster: NL, boardDraft: NL, transition: NL,
};
const resolved = (id, j27 = true) => ({ ok: true, json: async () => ({ success: true, requestId: id, requestNumber: '1000384', cycleCode: 'J27', ...(j27 ? { j27: { phase: 'initial-assessment', input } } : {}) }) });

beforeEach(() => {
  routeId = 'request-a'; pending.clear(); overviewFacts = null;
  global.fetch = jest.fn((url) => new Promise((resolve) => pending.set(String(url), resolve)));
});

test('the strip renders from the resolve DTO and recomputes when the Overview reports its reads', async () => {
  render(<WorkbenchRequest />);
  await act(async () => { pending.get('/api/workbench/resolve-request?requestId=request-a')(resolved('request-a')); });
  const strip = await screen.findByLabelText('Where this request stands');
  expect(strip).toHaveTextContent('Initial Assessment');
  expect(strip).toHaveTextContent('Next: Record an offramp decision');
  // The Chairs blocker touches a Peer Review task, so it is not yet news in Initial Assessment.
  expect(strip).not.toHaveTextContent('Chairs’ outcome');
  await act(async () => { overviewFacts({ progress: { status: 'ready', data: { counts: { candidates: 2, received: 0 } } } }); });
  expect(screen.getByLabelText('Where this request stands')).toHaveTextContent('Next: Identify reviewers');
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
  expect(stripB).toHaveTextContent('Next: Record an offramp decision');
  expect(stripB).not.toHaveTextContent('Identify reviewers');
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
  expect(screen.getByLabelText('Where this request stands')).toHaveTextContent('Next: Identify reviewers');
  await act(async () => { reportForA({ progress: { status: 'error', data: null } }); });
  expect(screen.getByLabelText('Where this request stands')).toHaveTextContent('Next: Identify reviewers');
  expect(screen.getByLabelText('Where this request stands')).not.toHaveTextContent('could not be read');
});

test('A → B → A starts A again from the server stage; nothing from the first visit is reused', async () => {
  const view = render(<WorkbenchRequest />);
  await act(async () => { pending.get('/api/workbench/resolve-request?requestId=request-a')(resolved('request-a')); });
  await screen.findByLabelText('Where this request stands');
  await act(async () => { overviewFacts({ progress: { status: 'ready', data: { counts: { candidates: 2 } } } }); });
  expect(screen.getByLabelText('Where this request stands')).toHaveTextContent('Next: Identify reviewers');
  routeId = 'request-b'; view.rerender(<WorkbenchRequest />);
  pending.clear();
  routeId = 'request-a'; view.rerender(<WorkbenchRequest />);
  await act(async () => { pending.get('/api/workbench/resolve-request?requestId=request-a')(resolved('request-a')); });
  const strip = await screen.findByLabelText('Where this request stands');
  expect(strip).toHaveTextContent('Next: Record an offramp decision');
});
