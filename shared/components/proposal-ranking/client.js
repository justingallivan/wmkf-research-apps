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

const PRIVATE_ACTIONS = new Set([
  'saveAssessment', 'buildCombined', 'confirmCombined', 'ready', 'reopenOwn', 'resetProgram',
]);
const DEFINITE_CONFLICTS = new Set(['stale_scope', 'conflict', 'confirmation_stale']);

// A peer save advances the shared round ETag without changing this PD's work.
// Rebase only proven rejections, only over identical private state, and retain
// the exact final request if its outcome becomes uncertain.
async function sendWithPrivateConflictRecovery(action, baseView, signal, onAttempt) {
  let pendingAction = action;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await sendProposalRankingAction(pendingAction, { signal, onAttempt });
    } catch (error) {
      error.pendingAction = pendingAction;
      if (attempt >= 3 || error.status !== 409 || !DEFINITE_CONFLICTS.has(error.code)) throw error;
      let current;
      try {
        current = await loadProposalRanking({ roundId: action.roundId, signal });
      } catch (readError) {
        readError.pendingAction = pendingAction;
        throw readError;
      }
      const sameScope = current.roundId === baseView.roundId
        && current.viewer?.systemUserId === baseView.viewer?.systemUserId
        && current.round?.state === 'active'
        && current.round.policyRevision === baseView.round.policyRevision
        && current.workflow?.stage === 'private'
        && JSON.stringify(current.workflow) === JSON.stringify(baseView.workflow)
        && current.own && JSON.stringify(current.own) === JSON.stringify(baseView.own);
      if (!sameScope) throw error;
      const key = action.action === 'resetProgram' ? `resetProgram:${action.programKey}` : action.action;
      const confirmation = current.confirmations?.[key];
      if (action.confirmationFingerprint && !confirmation?.fingerprint) throw error;
      pendingAction = {
        ...pendingAction,
        operationId: createOperationId(),
        roundEtag: current.round.etag,
        ...(action.confirmationFingerprint ? { confirmationFingerprint: confirmation.fingerprint } : {}),
      };
    }
  }
}

export async function sendProposalRankingAction(action, { signal, baseView, onAttempt } = {}) {
  if (baseView?.own && baseView.workflow?.stage === 'private' && PRIVATE_ACTIONS.has(action.action)) {
    return sendWithPrivateConflictRecovery(action, baseView, signal, onAttempt);
  }
  signal?.throwIfAborted();
  onAttempt?.(action);
  const { ok, status, data } = await requestEnvelope(PROPOSAL_RANKING_API, {
    method: 'POST',
    body: action,
    signal,
  });
  if (!ok) {
    const error = requestFailure(data, status);
    error.requestMethod = 'POST';
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
