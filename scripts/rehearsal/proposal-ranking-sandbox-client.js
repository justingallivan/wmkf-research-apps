/** Loopback-only rehearsal transport; no deployment or real-login route. */
const prefix = window.location.pathname.replace(/\/$/, '');
export const createOperationId = () => crypto.randomUUID();
async function request(path, body) {
  const response = await fetch(`${prefix}/${path}`, body ? {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Ranking-Rehearsal': 'sandbox'
    },
    body: JSON.stringify(body)
  } : undefined);
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error.message);
    error.status = response.status;
    error.code = result.error.code;
    throw error;
  }
  return result;
}
export const loadProposalRanking = ({
  roundId
} = {}) => request(`state${roundId ? '?roundId=' + encodeURIComponent(roundId) : ''}`);
export const sendProposalRankingAction = body => request('action', body);
