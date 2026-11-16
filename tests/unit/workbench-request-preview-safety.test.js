/**
 * @jest-environment jsdom
 */

import { render, screen } from '@testing-library/react';

let mockQuery = { requestId: 'request-1', tab: 'reviewers' };

jest.mock('next/router', () => ({
  useRouter: () => ({
    query: mockQuery,
    pathname: '/workbench/[requestId]',
    push: jest.fn(),
  }),
}));
jest.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { dynamicsSystemuserId: 'user-1', profileName: 'Test User' } } }),
}));
jest.mock('next/link', () => function LinkStub({ href, children, ...props }) {
  return <a href={typeof href === 'string' ? href : '#'} {...props}>{children}</a>;
});
jest.mock('../../shared/components/Layout', () => ({
  __esModule: true,
  default: ({ children }) => <div>{children}</div>,
  Card: ({ children }) => <div>{children}</div>,
}));
jest.mock('../../shared/components/RequireAppAccess', () => function RequireAppAccessStub({ children }) {
  return children;
});
jest.mock('../../shared/context/AppAccessContext', () => ({ useAppAccess: () => ({ isSuperuser: true, hasAccess: () => false }) }));
jest.mock('../../shared/context/ProfileContext', () => ({ useProfile: () => ({ preferences: {} }) }));
jest.mock('../../shared/config/reviewerFinderPreferences', () => ({
  readEmailSignaturePreference: () => ({}),
}));
jest.mock('../../shared/components/reviewers/reviewer-modes', () => ({ computeCanManage: () => true }));
jest.mock('../../shared/components/reviewers/ReviewersTab', () => function ReviewersTabStub(props) {
  return <div data-testid="reviewers-tab" data-preview-read-only={String(props.previewReadOnly)} />;
});
jest.mock('../../shared/components/workbench/ReviewsTab', () => function ReviewsTabStub(props) {
  return <div data-testid="reviews-tab" data-preview-read-only={String(props.previewReadOnly)} />;
});

jest.mock('../../shared/components/workbench/ProposalTab', () => function ProposalTabStub() { return <div />; });
jest.mock('../../shared/components/workbench/OverviewTab', () => function OverviewTabStub() { return <div />; });
jest.mock('../../shared/components/workbench/StatusTab', () => function StatusTabStub() { return <div />; });
jest.mock('../../shared/components/workbench/AwardeeTab', () => function AwardeeTabStub() { return <div />; });
jest.mock('../../shared/components/workbench/InitialAssessmentTab', () => function InitialAssessmentTabStub() { return <div />; });
jest.mock('../../shared/components/workbench/StaffDeliberationsTab', () => function StaffDeliberationsTabStub() { return <div />; });
jest.mock('../../shared/components/workbench/FinalWriteupTab', () => function FinalWriteupTabStub() { return <div />; });

import {
  WorkbenchRequest,
  getServerSideProps,
} from '../../pages/workbench/[requestId]';
import { PRODUCTION_HOSTS, SANDBOX_HOSTS } from '../../lib/dataverse/core/target-registry';

const originalVercelEnv = process.env.VERCEL_ENV;
const originalDynamicsUrl = process.env.DYNAMICS_URL;

beforeEach(() => {
  mockQuery = { requestId: 'request-1', tab: 'reviewers' };
  global.fetch = jest.fn(() => new Promise(() => {}));
});

afterEach(() => {
  if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = originalVercelEnv;
  if (originalDynamicsUrl === undefined) delete process.env.DYNAMICS_URL;
  else process.env.DYNAMICS_URL = originalDynamicsUrl;
  jest.clearAllMocks();
});

test('keeps sandbox Preview editable and makes production or unknown Preview targets read-only', async () => {
  process.env.VERCEL_ENV = 'preview';
  process.env.DYNAMICS_URL = `https://${PRODUCTION_HOSTS[0]}`;
  await expect(getServerSideProps()).resolves.toMatchObject({ props: { previewReadOnly: true, staffReviewSummary: false } });

  process.env.DYNAMICS_URL = `https://${SANDBOX_HOSTS[0]}`;
  await expect(getServerSideProps()).resolves.toMatchObject({ props: { previewReadOnly: false, staffReviewSummary: true } });

  process.env.DYNAMICS_URL = 'https://unregistered-target.example';
  await expect(getServerSideProps()).resolves.toMatchObject({ props: { previewReadOnly: true, staffReviewSummary: false } });

  process.env.VERCEL_ENV = 'production';
  process.env.DYNAMICS_URL = `https://${PRODUCTION_HOSTS[0]}`;
  await expect(getServerSideProps()).resolves.toMatchObject({ props: { previewReadOnly: false, staffReviewSummary: false } });
});

test('shows the read-only contract and passes it through both reviewer request surfaces', () => {
  const { rerender } = render(<WorkbenchRequest previewReadOnly />);

  expect(screen.getByRole('status')).toHaveTextContent('Preview is read-only for reviewer work.');
  expect(screen.getByTestId('reviewers-tab')).toHaveAttribute('data-preview-read-only', 'true');

  mockQuery = { requestId: 'request-1', tab: 'reviews' };
  rerender(<WorkbenchRequest previewReadOnly />);

  expect(screen.getByRole('status')).toHaveTextContent('Reviewer changes are disabled here.');
  expect(screen.getByTestId('reviews-tab')).toHaveAttribute('data-preview-read-only', 'true');
});

test('leaves reviewer controls enabled when the server does not classify the deployment as read-only', () => {
  render(<WorkbenchRequest previewReadOnly={false} />);

  expect(screen.queryByText('Preview is read-only for reviewer work.')).not.toBeInTheDocument();
  expect(screen.getByTestId('reviewers-tab')).toHaveAttribute('data-preview-read-only', 'false');
});

test('the exact dropdown rehearsal is admitted only in sandbox Preview with screening explicitly off', async () => {
  const id = '1a651d20-4a8a-471d-a6c8-f165ec112ccc';
  const env = jest.replaceProperty(process, 'env', {
    ...process.env,
    VERCEL_ENV: 'preview',
    DYNAMICS_URL: `https://${SANDBOX_HOSTS[0]}`,
    CHAIRS_RECOMMENDATION_ENABLED: 'on',
    INITIAL_RATIONALE_SCHEMA_READY: 'on',
    TEST_REQUEST_ISOLATION: 'on',
    AUTOMATIC_INTEGRITY_SCREENING: 'off',
    CHAIRS_RECOMMENDATION_REHEARSAL_REQUEST_ID: id.toUpperCase(),
  });
  try {
    await expect(getServerSideProps()).resolves.toMatchObject({ props: {
      chairsRecommendationEnabled: true, chairsRecommendationRehearsalRequestId: id, automaticIntegrityEnabled: false,
    } });
    process.env.AUTOMATIC_INTEGRITY_SCREENING = 'on';
    await expect(getServerSideProps()).resolves.toMatchObject({ props: {
      chairsRecommendationRehearsalRequestId: null, automaticIntegrityEnabled: true,
    } });
    process.env.AUTOMATIC_INTEGRITY_SCREENING = 'off';
    process.env.VERCEL_ENV = 'production';
    await expect(getServerSideProps()).resolves.toMatchObject({ props: {
      chairsRecommendationEnabled: false, chairsRecommendationRehearsalRequestId: null, automaticIntegrityEnabled: false,
    } });
  } finally {
    env.restore();
  }
});
