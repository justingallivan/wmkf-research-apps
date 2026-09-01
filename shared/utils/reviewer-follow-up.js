import { MODE_STATUSES, MODE_WORK_REMAINING } from '../components/reviewers/reviewer-modes';

const TRACK_STATUSES = new Set(MODE_STATUSES.track);
const OPEN_STATUSES = new Set(MODE_WORK_REMAINING.track);

function dateOnly(value) {
  const match = String(value || '').match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

export function isOpenReviewer(reviewer) {
  return OPEN_STATUSES.has(reviewer?.reviewStatus) && !reviewer?.reviewReceivedAt;
}

export function isReviewerOverdue(reviewer, today = new Date().toISOString().slice(0, 10)) {
  const dueDate = dateOnly(reviewer?.effectiveReviewDeadline);
  const todayDate = dateOnly(today);
  return Boolean(isOpenReviewer(reviewer) && dueDate && todayDate && dueDate < todayDate);
}

export function mergeReviewerFollowUpProposals(dashboardProposals = [], reviewerProposals = []) {
  const reviewerByRequest = new Map(
    reviewerProposals.map((proposal) => [proposal.proposalId, proposal]),
  );

  return dashboardProposals.map((dashboardProposal) => {
    const tracked = reviewerByRequest.get(dashboardProposal.requestId);
    return {
      ...(tracked || {}),
      proposalId: dashboardProposal.requestId,
      proposalTitle: tracked?.proposalTitle || dashboardProposal.title || `Request ${dashboardProposal.requestNumber || ''}`.trim(),
      proposalAuthors: tracked?.proposalAuthors || dashboardProposal.projectLeader || null,
      proposalInstitution: tracked?.proposalInstitution || dashboardProposal.institution || null,
      requestNumber: tracked?.requestNumber || dashboardProposal.requestNumber || null,
      grantCycleCode: tracked?.grantCycleCode || dashboardProposal.cycleCode || null,
      cycleLabel: tracked?.cycleLabel || dashboardProposal.cycleLabel || null,
      reviewDeadline: tracked?.reviewDeadline || null,
      reviewers: (tracked?.reviewers || []).filter((reviewer) => TRACK_STATUSES.has(reviewer.reviewStatus)),
      workbench: dashboardProposal,
    };
  });
}

export function proposalNeedsAttention(proposal) {
  return (proposal?.reviewers || []).some(isOpenReviewer);
}

function matchesSearch(proposal, search) {
  const needle = String(search || '').trim().toLowerCase();
  if (!needle) return true;
  const values = [
    proposal.requestNumber,
    proposal.proposalTitle,
    proposal.proposalInstitution,
    proposal.proposalAuthors,
    proposal.workbench?.programDirector,
    ...(proposal.reviewers || []).flatMap((reviewer) => [
      reviewer.name,
      reviewer.affiliation,
      reviewer.email,
      reviewer.reviewStatus,
    ]),
  ];
  return values.some((value) => String(value || '').toLowerCase().includes(needle));
}

export function filterReviewerFollowUpProposals(
  proposals = [],
  { view = 'attention', search = '', includeSetAside = false } = {},
) {
  return proposals.filter((proposal) => {
    if (!includeSetAside && proposal.workbench?.setAside) return false;
    if (view === 'attention' && !proposalNeedsAttention(proposal)) return false;
    return matchesSearch(proposal, search);
  });
}

export function summarizeReviewerFollowUp(proposals = [], today) {
  const reviewers = proposals.flatMap((proposal) => proposal.reviewers || []);
  return {
    assignedRequests: proposals.length,
    activeReviewers: reviewers.filter(isOpenReviewer).length,
    overdueReviewers: reviewers.filter((reviewer) => isReviewerOverdue(reviewer, today)).length,
    reviewsReceived: reviewers.filter((reviewer) => Boolean(
      reviewer.reviewReceivedAt
      || reviewer.submitted
      || ['review_received', 'complete'].includes(reviewer.reviewStatus),
    )).length,
    attentionRequests: proposals.filter(proposalNeedsAttention).length,
  };
}

