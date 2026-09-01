import {
  filterReviewerFollowUpProposals,
  isReviewerOverdue,
  mergeReviewerFollowUpProposals,
  proposalNeedsAttention,
  summarizeReviewerFollowUp,
} from '../../shared/utils/reviewer-follow-up';
import { getServerSideProps } from '../../pages/workbench/reviewer-follow-up';
import { PRODUCTION_HOSTS, SANDBOX_HOSTS } from '../../lib/dataverse/core/target-registry';

const dashboardProposals = [
  {
    requestId: 'request-a',
    requestNumber: '1001',
    title: 'Active proposal',
    institution: 'North University',
    projectLeader: 'Alex North',
    programDirector: 'Pat Director',
    cycleCode: 'D26',
    canManage: true,
    setAside: false,
  },
  {
    requestId: 'request-b',
    requestNumber: '1002',
    title: 'No accepted reviewers yet',
    institution: 'South University',
    cycleCode: 'D26',
    canManage: true,
    setAside: false,
  },
  {
    requestId: 'request-c',
    requestNumber: '1003',
    title: 'Set aside proposal',
    institution: 'West University',
    cycleCode: 'D26',
    canManage: true,
    setAside: true,
  },
];

const reviewerProposals = [
  {
    proposalId: 'request-a',
    proposalTitle: 'Active proposal',
    reviewDeadline: '2026-09-09',
    reviewers: [
      {
        suggestionId: 'reviewer-1',
        name: 'Ada Reviewer',
        reviewStatus: 'materials_sent',
        effectiveReviewDeadline: '2026-08-31',
      },
      {
        suggestionId: 'reviewer-2',
        name: 'Bea Reviewer',
        reviewStatus: 'review_received',
        reviewReceivedAt: '2026-08-30T10:00:00Z',
        submitted: true,
      },
    ],
  },
  {
    proposalId: 'request-c',
    proposalTitle: 'Set aside proposal',
    reviewers: [
      {
        suggestionId: 'reviewer-3',
        name: 'Casey Reviewer',
        reviewStatus: 'accepted',
      },
    ],
  },
];

describe('reviewer follow-up projection', () => {
  const merged = mergeReviewerFollowUpProposals(dashboardProposals, reviewerProposals);

  test('keeps every assigned request, including one with no accepted reviewers', () => {
    expect(merged).toHaveLength(3);
    expect(merged.find((proposal) => proposal.proposalId === 'request-b')).toMatchObject({
      proposalTitle: 'No accepted reviewers yet',
      reviewers: [],
      proposalInstitution: 'South University',
    });
  });

  test('defines attention from open reviewer engagements, not completed or empty requests', () => {
    expect(proposalNeedsAttention(merged[0])).toBe(true);
    expect(proposalNeedsAttention(merged[1])).toBe(false);
    expect(proposalNeedsAttention({ reviewers: [{ reviewStatus: 'complete' }] })).toBe(false);
  });

  test('filters set-aside requests and searches proposal or reviewer content', () => {
    expect(filterReviewerFollowUpProposals(merged, { view: 'all' })).toHaveLength(2);
    expect(filterReviewerFollowUpProposals(merged, {
      view: 'all',
      includeSetAside: true,
      search: 'casey',
    }).map((proposal) => proposal.proposalId)).toEqual(['request-c']);
    expect(filterReviewerFollowUpProposals(merged, {
      view: 'all',
      search: 'south university',
    }).map((proposal) => proposal.proposalId)).toEqual(['request-b']);
  });

  test('summarizes the visible request population without double-counting status categories', () => {
    expect(summarizeReviewerFollowUp(merged.slice(0, 2), '2026-09-01')).toEqual({
      assignedRequests: 2,
      activeReviewers: 1,
      overdueReviewers: 1,
      reviewsReceived: 1,
      attentionRequests: 1,
    });
  });

  test('only calls an open reviewer overdue when the effective deadline is before today', () => {
    expect(isReviewerOverdue(reviewerProposals[0].reviewers[0], '2026-09-01')).toBe(true);
    expect(isReviewerOverdue({
      reviewStatus: 'materials_sent',
      effectiveReviewDeadline: '2026-09-01',
    }, '2026-09-01')).toBe(false);
    expect(isReviewerOverdue({
      reviewStatus: 'review_received',
      effectiveReviewDeadline: '2026-08-01',
      reviewReceivedAt: '2026-08-02',
    }, '2026-09-01')).toBe(false);
  });
});

describe('reviewer follow-up preview safety', () => {
  const originalVercelEnv = process.env.VERCEL_ENV;
  const originalDynamicsUrl = process.env.DYNAMICS_URL;

  afterEach(() => {
    if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = originalVercelEnv;
    if (originalDynamicsUrl === undefined) delete process.env.DYNAMICS_URL;
    else process.env.DYNAMICS_URL = originalDynamicsUrl;
  });

  test('makes a Preview backed by production Dataverse read-only', async () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.DYNAMICS_URL = `https://${PRODUCTION_HOSTS[0]}`;

    await expect(getServerSideProps()).resolves.toEqual({
      props: { previewReadOnly: true },
    });
  });

  test('does not suppress controls for sandbox Preview or production deployment', async () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.DYNAMICS_URL = `https://${SANDBOX_HOSTS[0]}`;
    await expect(getServerSideProps()).resolves.toEqual({
      props: { previewReadOnly: false },
    });

    process.env.VERCEL_ENV = 'production';
    process.env.DYNAMICS_URL = `https://${PRODUCTION_HOSTS[0]}`;
    await expect(getServerSideProps()).resolves.toEqual({
      props: { previewReadOnly: false },
    });
  });
});
