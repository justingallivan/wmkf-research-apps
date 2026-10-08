import { testRequestIsolationEnabled, syntheticReviewerIsolationEnabled } from '../test-requests/isolation.js';

/** Missing flags are unavailable. The feature remains inert until explicit per-environment setup. */
export function getProposalRankingReadinessProblems(env = process.env) {
  const problems = [];
  if (env.PROPOSAL_RANKING_ENABLED !== 'on') problems.push('Proposal Ranking is not enabled for this environment.');
  if (env.PROPOSAL_RANKING_SCHEMA_READY !== 'on') problems.push('Proposal Ranking storage has not been provisioned for this environment.');
  if (!testRequestIsolationEnabled(env)) problems.push('Test request isolation is not ready for this environment.');
  if (!syntheticReviewerIsolationEnabled(env)) problems.push('Synthetic reviewer isolation is not ready for this environment.');
  return problems;
}

export function assertProposalRankingReady(env = process.env) {
  const problems = getProposalRankingReadinessProblems(env);
  if (problems.length) {
    const error = new Error(problems.join(' '));
    error.code = 'proposal_ranking_unavailable';
    error.status = 503;
    throw error;
  }
}
