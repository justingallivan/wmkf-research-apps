/** Server-only, fixture-scoped recommendation reads with injected identity and freshness readers. */
import { isGuid } from '../../utils/guid.js';
import { compareRecommendationsRosterFreshness } from '../expertise-finder/recommendations-contract.js';
import { EXPERTISE_RESULT_CONTRACT, EXPERTISE_TASK_KEY, isExpertiseMachineScope, isExpertiseSandboxReadScope, validateTaskResult } from './capabilities.js';
import { recommendationSourceProof, sandboxRecommendationSourceProof } from './context.js';
import { canonical, exact } from './profile.js';

const PENDING = new Set(['queued', 'dispatching', 'response_saved']);
const STATES = new Set([...PENDING, 'validated', 'failed_pre_dispatch', 'failed_validation', 'unknown', 'expired']);

function selectors(input) {
  try { exact(input, ['requestId', 'jobId'], 'recommendation selectors'); }
  catch { return null; }
  if (!isGuid(input.requestId) || !isGuid(input.jobId)) return null;
  return Object.freeze({ requestId: input.requestId.trim().toLowerCase(), jobId: input.jobId.trim().toLowerCase(), taskKey: EXPERTISE_TASK_KEY });
}

function sameReceipt(before, after) {
  return ['jobId', 'requestId', 'taskId', 'state', 'version', 'expiresAt', 'resultExpiresAt', 'configurationExpiresAt',
    'configurationHash', 'resultHash'].every(key => before[key] === after[key]);
}

function retainedStatus(receipt) {
  if (Date.parse(receipt.expiresAt) <= receipt.observedAt) return 'expired';
  if (PENDING.has(receipt.state)) return 'not-ready';
  if (receipt.state !== 'validated') return 'unavailable';
  return receipt.resultExpiresAt === null || receipt.resultExpiresAt <= receipt.observedAt ? 'expired' : 'retained';
}

function envelope(receipt) {
  return { jobId: receipt.jobId, requestId: receipt.requestId, taskKey: EXPERTISE_TASK_KEY,
    contractVersion: EXPERTISE_RESULT_CONTRACT, expiresAt: receipt.expiresAt };
}

export function createRecommendationsReader({ store, authorizeStaffRead, resolveJobOwner, readSourceObservation,
  readRosterProjection, now = () => performance.now(), sandbox = false }) {
  const validOwnerScope = sandbox ? isExpertiseSandboxReadScope : isExpertiseMachineScope;
  const readState = sandbox ? store.readSandboxRecommendationState : store.readRecommendationState;
  const readValue = sandbox ? store.readValidatedSandboxRecommendations : store.readValidatedRecommendations;
  async function staffSubject(args) {
    try {
      const subject = await authorizeStaffRead(args);
      exact(subject, ['profileId', 'systemUserId'], 'staff subject');
      if (!Number.isSafeInteger(subject.profileId) || subject.profileId < 1 || !isGuid(subject.systemUserId)) return null;
      return { profileId: subject.profileId, systemUserId: subject.systemUserId.trim().toLowerCase() };
    } catch { return null; }
  }

  async function ownerScope(args) {
    try {
      const owner = await resolveJobOwner(args);
      exact(owner, ['environment', 'principalKey', 'authorizationScope'], 'recommendation owner');
      if (!validOwnerScope(owner)) return null;
      return Object.freeze({ ...owner, requestId: args.requestId, jobId: args.jobId });
    } catch { return null; }
  }

  async function begin(input) {
    const args = selectors(input);
    if (!args) return null;
    const subject = await staffSubject(args);
    if (!subject) return null;
    const scope = await ownerScope(args);
    return scope ? { args, subject, scope } : null;
  }

  async function sameOwner(access) {
    const scope = await ownerScope(access.args);
    return scope !== null && canonical(scope) === canonical(access.scope);
  }

  async function stillAuthorized(access) {
    const subject = await staffSubject(access.args);
    return subject?.profileId === access.subject.profileId && subject.systemUserId === access.subject.systemUserId;
  }

  async function capture(scope, includeProof = false) {
    try {
      const startedAt = now();
      const receipt = await readState(scope, { includeProof });
      if (!receipt || receipt.jobId !== scope.jobId || receipt.requestId !== scope.requestId || !isGuid(receipt.taskId)
        || !STATES.has(receipt.state) || !Number.isSafeInteger(receipt.version) || receipt.version < 1
        || ![startedAt, receipt.observedAt, Date.parse(receipt.expiresAt)].every(Number.isFinite)
        || ![receipt.resultExpiresAt, receipt.configurationExpiresAt].every(value => value === null || Number.isFinite(value))) return null;
      return { startedAt, receipt };
    } catch { return null; }
  }

  async function sourceFreshness({ requestId }, proof) {
    try {
      const observed = await readSourceObservation({ requestId, version: proof.source.version });
      exact(observed, ['requestId', 'version', 'complete', 'documents', ...(sandbox ? ['targetHost'] : [])], 'current recommendation source');
      if (observed.requestId !== requestId || observed.version !== proof.source.version || observed.complete !== true
        || (sandbox && observed.targetHost !== proof.source.targetHost)) return 'unknown';
      const current = sandbox
        ? sandboxRecommendationSourceProof(observed.targetHost, proof.documentRoles, observed.documents)
        : recommendationSourceProof(proof.documentRoles, observed.documents);
      return current.hash === proof.source.hash ? 'current' : 'stale';
    } catch { return 'unknown'; }
  }

  async function rosterFreshness({ requestId }, proof) {
    try {
      const observed = await readRosterProjection({ requestId });
      if (sandbox) {
        exact(observed, ['targetHost', 'projection'], 'current recommendations roster');
        if (observed.targetHost !== proof.source.targetHost) return 'unknown';
      }
      const current = sandbox ? observed.projection : observed;
      return compareRecommendationsRosterFreshness({ expectedRosterHash: proof.rosterHash, current }).freshness;
    } catch { return 'unknown'; }
  }

  async function inputFreshness(args, proof) {
    const outcomes = await Promise.all([sourceFreshness(args, proof), rosterFreshness(args, proof)]);
    if (outcomes.every(value => value === 'current')) return 'current';
    return outcomes.every(value => value === 'current' || value === 'stale') ? 'stale' : 'unknown';
  }

  async function validatedValue(scope, receipt) {
    try {
      const view = await readValue(scope);
      if (!view || view.jobId !== receipt.jobId || view.version !== receipt.version
        || new Date(view.expiresAt).toISOString() !== receipt.expiresAt || view.results.length !== 1) return { status: 'unavailable' };
      const result = view.results[0];
      if (result.taskId !== receipt.taskId || result.taskKey !== EXPERTISE_TASK_KEY) return { status: 'unavailable' };
      if (result.status === 'expired') return { status: 'expired' };
      if (result.status !== 'available') return { status: 'unavailable' };
      validateTaskResult(EXPERTISE_TASK_KEY, { contractVersion: result.contractVersion, result: result.result });
      return { status: 'available', result: JSON.parse(canonical(result.result)) };
    } catch { return { status: 'unavailable' }; }
  }

  async function readStatus(input) {
    const access = await begin(input);
    if (!access) return null;
    const observed = await capture(access.scope);
    if (!observed || !await sameOwner(access) || !await stillAuthorized(access)) return null;
    return { ...envelope(observed.receipt), state: observed.receipt.state };
  }

  async function readResult(input) {
    const access = await begin(input);
    if (!access) return null;
    const before = await capture(access.scope, true);
    if (!before) return null;
    let freshness = retainedStatus(before.receipt) === 'retained' && before.receipt.proof
      ? await inputFreshness(access.args, before.receipt.proof) : 'unknown';
    if (!await sameOwner(access)) return null;
    const after = await capture(access.scope);
    if (!after) return null;
    const { receipt, startedAt } = after;
    if (!sameReceipt(before.receipt, receipt)) freshness = 'unknown';
    const retained = retainedStatus(receipt);
    const value = retained === 'retained'
      ? (freshness === 'current' ? await validatedValue(access.scope, receipt) : { status: 'unavailable' })
      : { status: retained };
    if (!await sameOwner(access) || !await stillAuthorized(access)) return null;

    // Use a DB clock sample plus a conservative monotonic elapsed bound. The
    // sample was taken after startedAt; rounding a DB timestamp loses <1 ms.
    let elapsed;
    try { elapsed = now() - startedAt; } catch { elapsed = NaN; }
    if (!Number.isFinite(elapsed) || elapsed < 0) return { ...envelope(receipt), status: 'unavailable', freshness: 'unknown' };
    const jobRemaining = Date.parse(receipt.expiresAt) - receipt.observedAt;
    const resultRemaining = value.status === 'available'
      ? Math.min(receipt.resultExpiresAt, receipt.configurationExpiresAt) - receipt.observedAt : jobRemaining;
    if (elapsed + 1 >= Math.min(jobRemaining, resultRemaining)) {
      return { ...envelope(receipt), status: 'expired', freshness: 'unknown' };
    }
    if (value.status === 'available' && freshness === 'current') return { ...envelope(receipt), ...value, freshness };
    return { ...envelope(receipt), status: value.status, freshness: value.status === 'unavailable' && freshness === 'stale' ? 'stale' : 'unknown' };
  }

  return { readStatus, readResult };
}
