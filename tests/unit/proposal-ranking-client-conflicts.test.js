jest.mock('../../shared/utils/api-request', () => ({ requestEnvelope: jest.fn() }));
import { requestEnvelope } from '../../shared/utils/api-request';
import { sendProposalRankingAction } from '../../shared/components/proposal-ranking/client';
const copy = (value) => JSON.parse(JSON.stringify(value));
const base = () => ({
  roundId: 'round', viewer: { systemUserId: 'bob' },
  round: { etag: 'round-1', state: 'active', policyRevision: 1 },
  workflow: { stage: 'private', preparationVersion: 1, revealId: null },
  own: { mr: { version: 1, confidence: {} }, se: { version: 1 }, co: null, ready: null },
  confirmations: { resetProgram: {}, 'resetProgram:mr': { fingerprint: 'old-confirmation' } },
});
const body = (action = 'saveAssessment') => ({ action, roundId: 'round', operationId: 'original', roundEtag: 'round-1', programKey: 'mr', listVersion: 1, assessment: { confidence: { proposal: 'confident' } } });
const ok = data => ({ ok: true, status: 200, data });
const conflict = (code = 'stale_scope') => ({ ok: false, status: 409, data: { error: { code, message: 'Changed' } } });
beforeEach(() => jest.resetAllMocks());
test.each(['saveAssessment','buildCombined','confirmCombined','ready','reopenOwn','resetProgram'])('peer-only change retries %s with fresh round scope', async action => {
  const initial = base(), current = copy(initial);
  current.round.etag = 'round-2';
  current.confirmations['resetProgram:mr'].fingerprint = 'new-confirmation';
  const request = { ...body(action), ...(action === 'resetProgram' ? { confirmationFingerprint: 'old-confirmation' } : {}) };
  requestEnvelope.mockResolvedValueOnce(conflict()).mockResolvedValueOnce(ok(current)).mockResolvedValueOnce(ok({ saved: true }));
  expect(await sendProposalRankingAction(request, { baseView: initial })).toEqual({ saved: true });
  const retry = requestEnvelope.mock.calls[2][1].body;
  expect(retry).toMatchObject({ ...request, operationId: expect.any(String), roundEtag: 'round-2', ...(action === 'resetProgram' ? { confirmationFingerprint: 'new-confirmation' } : {}) });
  expect(retry.operationId).not.toBe(request.operationId);
});
test.each(['own', 'actor', 'round', 'policy', 'stage', 'version', 'closed'])('does not rebase over changed %s', async change => {
  const initial = base(), current = copy(initial);
  current.round.etag = 'round-2';
  if (change === 'own') current.own.mr.confidence.proposal = 'not-sure';
  if (change === 'actor') current.viewer.systemUserId = 'alice';
  if (change === 'round') current.roundId = 'replacement';
  if (change === 'policy') current.round.policyRevision++;
  if (change === 'stage') current.workflow.stage = 'revealed';
  if (change === 'version') current.workflow.preparationVersion++;
  if (change === 'closed') current.round.state = 'canceled';
  requestEnvelope.mockResolvedValueOnce(conflict()).mockResolvedValueOnce(ok(current));
  await expect(sendProposalRankingAction(body(), { baseView: initial })).rejects.toMatchObject({ code: 'stale_scope', pendingAction: body() });
  expect(requestEnvelope).toHaveBeenCalledTimes(2);
});
test.each(['uncertain_outcome', 'stale_list', 'access_denied', 'operation_id_reused'])('does not automatically retry %s', async code => {
  requestEnvelope.mockResolvedValueOnce(conflict(code));
  await expect(sendProposalRankingAction(body(), { baseView: base() })).rejects.toMatchObject({ code });
  expect(requestEnvelope).toHaveBeenCalledTimes(1);
});
test.each(['reveal', 'editCollective', 'restartWalkthrough', 'reopenPreparation', 'resetCollective'])('does not rebase shared action %s', async action => {
  requestEnvelope.mockResolvedValueOnce(conflict());
  await expect(sendProposalRankingAction(body(action), { baseView: base() })).rejects.toMatchObject({ code: 'stale_scope' });
  expect(requestEnvelope).toHaveBeenCalledTimes(1);
});
test('uncertain retry retains the exact rebased operation for later receipt recovery', async () => {
  const current = base(); current.round.etag = 'round-2';
  requestEnvelope.mockResolvedValueOnce(conflict()).mockResolvedValueOnce(ok(current)).mockResolvedValueOnce(conflict('uncertain_outcome'));
  let failure;
  try { await sendProposalRankingAction(body(), { baseView: base() }); } catch (error) { failure = error; }
  expect(failure.pendingAction).toEqual(requestEnvelope.mock.calls[2][1].body);
  expect(failure.pendingAction.operationId).not.toBe('original');
});
test('repeated peer contention is bounded and preserves the last request', async () => {
  requestEnvelope.mockImplementation(async (_url, options) => options.body ? conflict('conflict') : ok(base()));
  await expect(sendProposalRankingAction(body(), { baseView: base() })).rejects.toMatchObject({ code: 'conflict', pendingAction: expect.objectContaining({ assessment: body().assessment }) });
  expect(requestEnvelope.mock.calls.filter(([, options]) => options.body)).toHaveLength(4);
});
