/**
 * @jest-environment jsdom
 *
 * Outside the J27 phase layout (Production before release), a 2027-or-later
 * request's Scoring card keeps the explicit Save button; the J27 layout saves on
 * change (rollout plan, "Admission to implement").
 */
import { act, render, screen } from '@testing-library/react';

let routeQuery = {};
const pending = new Map();

jest.mock('next/router', () => ({ useRouter: () => ({ query: routeQuery, push: jest.fn(), asPath: '' }) }));
jest.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { profileName: 'Test User', dynamicsSystemuserId: 'user-1' } } }) }));
jest.mock('next/link', () => function LinkStub({ children }) { return <a href="#">{children}</a>; });
jest.mock('../../shared/components/Layout', () => ({ __esModule: true, default: ({ children }) => <div>{children}</div>, Card: ({ children }) => <div>{children}</div>, Button: ({ children }) => <button type="button">{children}</button> }));
jest.mock('../../shared/components/RequireAppAccess', () => function RequireAppAccessStub({ children }) { return children; });
jest.mock('../../shared/context/AppAccessContext', () => ({ useAppAccess: () => ({ isSuperuser: false, hasAccess: () => true }) }));
jest.mock('../../shared/context/ProfileContext', () => ({ useProfile: () => ({ preferences: {} }) }));
jest.mock('../../shared/config/reviewerFinderPreferences', () => ({ readEmailSignaturePreference: () => ({}) }));
jest.mock('../../shared/components/reviewers/reviewer-modes', () => ({ computeCanManage: () => true }));
jest.mock('../../lib/dataverse/core/interlock', () => ({ classifyTarget: () => 'sandbox' }));
jest.mock('../../shared/components/workbench/ScoringCard', () => function ScoringStub({ explicitSave, chairsRecommendation }) {
  return chairsRecommendation ? null : <div data-testid="scoring" data-explicit-save={String(explicitSave)} />;
});
jest.mock('../../shared/components/reviewers/ReviewersTab', () => function TabStub() { return <div />; });
for (const name of ['OverviewTab', 'ReviewsTab', 'ProposalTab', 'StatusTab', 'AwardeeTab', 'InitialAssessmentTab', 'StaffDeliberationsTab', 'ReviewPanelTab', 'FinalWriteupTab', 'InitialAssessmentRationale']) {
  jest.mock(`../../shared/components/workbench/${name}`, () => function TabStub() { return <div />; });
}

import { WorkbenchRequest } from '../../pages/workbench/[requestId]';

const resolved = { ok: true, json: async () => ({ success: true, requestId: 'request-a', requestNumber: '1000384', cycleCode: 'J27', requestVersion: 'W/"1"' }) };

beforeEach(() => {
  pending.clear();
  global.fetch = jest.fn((url) => new Promise((resolve) => pending.set(String(url), resolve)));
});

async function renderAndResolve(props) {
  render(<WorkbenchRequest {...props} />);
  await act(async () => { pending.get('/api/workbench/resolve-request?requestId=request-a')(resolved); });
  return screen.findByTestId('scoring');
}

test('the legacy layout keeps the explicit Save button for a 2027-or-later request', async () => {
  routeQuery = { requestId: 'request-a', tab: 'proposal' };
  const card = await renderAndResolve({ staffReviewSummary: false });
  expect(card).toHaveAttribute('data-explicit-save', 'true');
});

test('the J27 phase layout saves on change', async () => {
  routeQuery = { requestId: 'request-a', tab: 'initial-assessment', section: 'proposal' };
  const card = await renderAndResolve({ staffReviewSummary: true });
  expect(card).toHaveAttribute('data-explicit-save', 'false');
});
