/**
 * @jest-environment jsdom
 */

import { render, screen, waitFor } from '@testing-library/react';

let findPanelProps = null;
let invitePanelProps = null;
const existingKey = 'akoya_request::REQ/Phase I::ProjectDescription.pdf';
const mockReplacementKey = 'akoya_request::REQ/Reviewer Materials::Proposal_1003010.pdf';
jest.mock('../../shared/components/reviewers/ReviewerFindPanel', () => function FindPanelStub(props) {
  findPanelProps = props;
  return (
    <button
      data-testid="persist-proposal"
      data-file-key={props.proposalFileKey || ''}
      onClick={() => props.onProposalFileKeyChange(mockReplacementKey)}
    >persist</button>
  );
});
jest.mock('../../shared/components/reviewers/ReviewerManagePanel', () => function ManagePanelStub() {
  return null;
});
jest.mock('../../shared/components/reviewers/ReviewerInvitePanel', () => function InvitePanelStub(props) {
  invitePanelProps = props;
  return null;
});
jest.mock('../../shared/components/reviewers/EmailTemplatesModal', () => function EmailTemplatesModalStub() {
  return null;
});
jest.mock('../../shared/components/reviewers/CampaignConfigModal', () => function CampaignConfigModalStub() {
  return null;
});

const mockReplace = jest.fn();
const router = {
  isReady: true,
  pathname: '/workbench/[requestId]',
  query: {
    requestId: 'aaaaaaaa-1111-1111-1111-111111111111',
    tab: 'reviewers',
    sub: 'find',
    proposalFile: existingKey,
  },
  push: jest.fn(),
  replace: mockReplace,
};
jest.mock('next/router', () => ({ useRouter: () => router }));

import ReviewersTab from '../../shared/components/reviewers/ReviewersTab';

const REQ = 'aaaaaaaa-1111-1111-1111-111111111111';

beforeEach(() => {
  findPanelProps = null;
  invitePanelProps = null;
  mockReplace.mockClear();
  router.query = {
    requestId: REQ,
    tab: 'reviewers',
    sub: 'find',
    proposalFile: existingKey,
  };
  global.fetch = jest.fn((url) => {
    const target = String(url);
    if (target.includes('/api/review-manager/reviewers')) {
      return Promise.resolve({ ok: true, json: async () => ({ success: true, proposals: [] }) });
    }
    if (target.includes('/api/reviewer-finder/my-candidates')) {
      return Promise.resolve({ ok: true, json: async () => ({ proposals: [] }) });
    }
    if (target.includes('/api/workbench/decline-referrals')) {
      return Promise.resolve({ ok: true, json: async () => ({ referrals: [] }) });
    }
    throw new Error(`unexpected fetch ${target}`);
  });
});

afterEach(() => {
  jest.clearAllMocks();
});

test('passes the URL-backed proposal file key into Find and replaces it without dropping other navigation state', async () => {
  render(<ReviewersTab requestId={REQ} />);

  const persist = await screen.findByTestId('persist-proposal');
  expect(persist).toHaveAttribute('data-file-key', existingKey);
  expect(findPanelProps.proposalBindingReady).toBe(true);

  persist.click();

  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(
    {
      pathname: '/workbench/[requestId]',
      query: expect.objectContaining({
        requestId: REQ,
        tab: 'reviewers',
        sub: 'find',
        proposalFile: mockReplacementKey,
      }),
    },
    undefined,
    { shallow: true },
  ));
});

test('ignores a repeated/malformed proposalFile query instead of granting it file authority', async () => {
  router.query = {
    requestId: REQ,
    tab: 'reviewers',
    sub: 'find',
    proposalFile: [existingKey, 'other-key'],
  };

  render(<ReviewersTab requestId={REQ} />);

  expect(await screen.findByTestId('persist-proposal')).toHaveAttribute('data-file-key', '');
  expect(findPanelProps.proposalFileKey).toBeNull();
});

test('passes a repair deep-link candidate key into the Find panel', async () => {
  router.query = {
    requestId: REQ,
    tab: 'reviewers',
    sub: 'find',
    repairCandidate: 'candidate:reviewer-name|email:-',
  };

  render(<ReviewersTab requestId={REQ} />);

  await screen.findByTestId('persist-proposal');
  expect(findPanelProps.repairCandidateKey).toBe('candidate:reviewer-name|email:-');
});

test('passes an Invite-origin repair suggestion into the Invite panel', async () => {
  router.query = {
    requestId: REQ,
    tab: 'reviewers',
    sub: 'candidates',
    repairSuggestion: 'suggestion-guid',
  };

  render(<ReviewersTab requestId={REQ} />);

  await waitFor(() => expect(invitePanelProps).not.toBeNull());
  expect(invitePanelProps.repairSuggestionId).toBe('suggestion-guid');
});
