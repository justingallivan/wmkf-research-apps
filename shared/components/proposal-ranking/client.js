import { v4 as uuidv4 } from 'uuid';
import { requestEnvelope } from '../../utils/api-request';

export const PROPOSAL_RANKING_API = '/api/proposal-ranking';

export function createOperationId() {
  return uuidv4();
}

export async function loadProposalRanking({ cycleCode, roundId, signal }) {
  const query = roundId
    ? new URLSearchParams({ roundId })
    : new URLSearchParams({ cycleCode });
  const { ok, status, data } = await requestEnvelope(`${PROPOSAL_RANKING_API}?${query}`, { signal });
  if (!ok) throw requestFailure(data, status);
  return data;
}

export async function sendProposalRankingAction(action, { signal } = {}) {
  const { ok, status, data } = await requestEnvelope(PROPOSAL_RANKING_API, {
    method: 'POST',
    body: action,
    signal,
  });
  if (!ok) {
    const error = requestFailure(data, status);
    error.current = data?.error?.current || null;
    error.code = data?.error?.code || null;
    error.retryable = data?.error?.retryable === true;
    throw error;
  }
  return data;
}

function requestFailure(data, status) {
  const details = data?.error;
  const error = new Error(
    (typeof details === 'object' && details?.message)
      || (typeof details === 'string' && details)
      || data?.message
      || `Proposal Ranking request failed (${status}).`,
  );
  error.status = status;
  error.code = typeof details === 'object' ? details?.code || null : null;
  error.current = typeof details === 'object' ? details?.current || null : null;
  error.retryable = typeof details === 'object' && details?.retryable === true;
  return error;
}
