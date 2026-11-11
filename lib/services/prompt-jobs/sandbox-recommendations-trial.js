/** Local, server-owned single recommendation trial. No route, scheduler or Request writer. */
import { db } from '@vercel/postgres';
import { getExecutorPromptById } from '../../dataverse/adapters/ai-prompt.js';
import { readRecommendationsRosterProjection } from '../../dataverse/adapters/expertise-recommendations-read.js';
import { withDalContext } from '../../dataverse/core/context.js';
import { getPromptProfiles } from '../admin/prompt-profiles-service.js';
import { executePrompt } from '../execute-prompt.js';
import { buildRecommendationsSnapshot, compareRecommendationsRosterFreshness } from '../expertise-finder/recommendations-contract.js';
import { ServiceHttpError } from '../service-http-error.js';
import { EXPERTISE_TASK_KEY, validateTaskCapability } from './capabilities.js';
import { composeProfileTask, prepareContextSnapshot, recommendationSnapshotSourceProof, SANDBOX_RECOMMENDATIONS_SOURCE_VERSION, sandboxRecommendationSourceProof } from './context.js';
import { canonical, hashProfile } from './profile.js';
import { createRecommendationsProposalSource } from './proposal-source.js';
import { matchesRecommendationsTrialDefinition, profiledInputUpperBound, readRecommendationsTrialPolicy,
  RECOMMENDATIONS_SANDBOX_ORIGIN, recommendationsTrialBudget } from './recommendations-sandbox-policy.js';
import { verifyRecommendationsStaffActor } from './staff-recommendations-service.js';
import { createPromptJobStore } from './store.js';
import { advanceJob } from './worker.js';

const HOUR_MS = 3_600_000;
const defaults = {
  store: createPromptJobStore(db), policy: readRecommendationsTrialPolicy,
  nonceSecret: () => process.env.PROMPT_JOB_NONCE_SECRET,
  authorize: verifyRecommendationsStaffActor,
  prompt: id => getExecutorPromptById(id, RECOMMENDATIONS_SANDBOX_ORIGIN),
  profiles: getPromptProfiles,
  source: createRecommendationsProposalSource(),
  roster: readRecommendationsRosterProjection,
  executePrompt,
  now: Date.now,
};
const CONFIRMED_SOURCE_CHANGE = new Set(['proposal_source_changed','proposal_source_missing',
  'proposal_source_ambiguous','proposal_source_invalid_file']);

function fail(code, httpStatus = 409) {
  throw new ServiceHttpError(code, { code, httpStatus });
}
function scopeFor(policy) {
  const { environment, authorizationScope, requestId } = policy;
  return { environment, authorizationScope, requestId };
}
function ownerFor(policy) {
  return { ...scopeFor(policy), principalKey: policy.principalKey };
}
function sourceArgs(policy) {
  return { requestId: policy.requestId, version: SANDBOX_RECOMMENDATIONS_SOURCE_VERSION,
    siteId: policy.sourceSiteId, driveId: policy.sourceDriveId };
}
function trialContext(deps) {
  const policy = deps.policy();
  if (!policy) fail('recommendations_trial_disabled', 404);
  const nonceSecret = deps.nonceSecret();
  if (typeof nonceSecret !== 'string' || Buffer.byteLength(nonceSecret) < 32) fail('recommendations_trial_secret_missing', 503);
  const current = () => canonical(deps.policy()) === canonical(policy);
  const authorize = async () => current() && Boolean(await deps.authorize({
    profileId: policy.profileId, systemUserId: policy.systemUserId, azureId: policy.azureId,
  }, current)) && current();
  return { policy, nonceSecret, current, authorize };
}

function sourceProof(policy, profile, observation) {
  if (observation?.targetHost !== policy.targetHost || observation.requestId !== policy.requestId
    || observation.version !== SANDBOX_RECOMMENDATIONS_SOURCE_VERSION || observation.complete !== true) {
    fail('proposal_source_unavailable', 503);
  }
  return sandboxRecommendationSourceProof(policy.targetHost, profile.documentRoles, observation.documents);
}
async function prepareInputs(deps, trial, profile) {
  const { policy } = trial;
  if (!trial.current()) fail('recommendations_trial_disabled', 404);
  const [source, roster] = await Promise.all([deps.source.prepare(sourceArgs(policy)), deps.roster()]);
  const proof = sourceProof(policy, profile, source?.observation);
  if (proof.hash !== policy.sourceHash || roster?.targetHost !== policy.targetHost) fail('trial_inputs_changed');
  const built = buildRecommendationsSnapshot(roster.projection);
  const snapshot = prepareContextSnapshot({
    scope: scopeFor(policy), profile, documents: [source.document], records: [built.rosterRecord],
    rosterSnapshot: built.snapshot, nonceSecret: trial.nonceSecret,
  });
  if (canonical(recommendationSnapshotSourceProof(profile.documentRoles, snapshot.documents, policy.targetHost)) !== canonical(proof)) {
    fail('trial_inputs_changed');
  }
  return { proof, rosterHash: built.snapshot.manifest.rosterHash, snapshot };
}

async function exactDefinition(deps, trial) {
  const { policy } = trial;
  const live = await deps.prompt(policy.promptId);
  if (!live || !trial.current()) fail('recommendations_trial_prompt_unavailable');
  const promptRow = { ...live, wmkf_ai_systemprompt: live.wmkf_ai_systemprompt ?? '' };
  if (promptRow.wmkf_ai_promptname !== EXPERTISE_TASK_KEY || !Number.isSafeInteger(promptRow.wmkf_promptversion)
    || promptRow.wmkf_promptversion < 1) fail('recommendations_trial_prompt_unavailable');
  const { spec } = validateTaskCapability(promptRow, scopeFor(policy), { definitionOnly: true });
  const { profiles } = await deps.profiles();
  const matches = profiles.filter(({ profile, sha256 }) => profile.key === spec.profile.key
    && profile.revision === spec.profile.revision && sha256 === spec.profile.sha256);
  if (matches.length !== 1 || !matchesRecommendationsTrialDefinition(promptRow, matches[0].profile, policy)) {
    fail('recommendations_trial_prompt_unavailable');
  }
  return { promptRow, profile: matches[0].profile, spec };
}

async function preflight(deps, trial) {
  if (!await trial.authorize()) fail('recommendations_trial_access_denied', 403);
  const { promptRow, profile, spec } = await exactDefinition(deps, trial);
  const { proof, rosterHash, snapshot } = await prepareInputs(deps, trial, profile);
  const scope = scopeFor(trial.policy);
  const composed = composeProfileTask({ promptRow, profile, snapshot, scope, nonceSecret: trial.nonceSecret });
  const budget = recommendationsTrialBudget(profiledInputUpperBound(composed, spec.outputSchema), promptRow.wmkf_ai_maxtokens);
  if (!await trial.authorize()) fail('recommendations_trial_access_denied', 403);
  return { configuration: { promptRow, profile, scope, runSource: 'Vercel Test', rosterHash, sourceProof: proof }, budget };
}

/** Read-only preflight returns only cost bounds. */
export async function preflightSandboxRecommendationTrial(overrides = {}) {
  const deps = { ...defaults, ...overrides };
  return withDalContext('expertise-recommendations-trial-preflight', async () => {
    const trial = trialContext(deps);
    await deps.store.verifySandboxRecommendationDatabase();
    return (await preflight(deps, trial)).budget;
  });
}

async function getReceipt(deps, policy) {
  const [view] = await deps.store.listJobs({ ...ownerFor(policy), limit: 1 });
  if (!view) return null;
  if (view.job.idempotency_key !== policy.idempotencyKey || view.job.operation !== 'generate-draft'
    || view.tasks.length !== 1 || view.tasks[0].task_key !== EXPERTISE_TASK_KEY
    || view.tasks[0].writeback_state !== 'not_requested') fail('recommendations_trial_receipt_mismatch');
  return view;
}

export async function admitSandboxRecommendationTrial(overrides = {}) {
  const deps = { ...defaults, ...overrides };
  return withDalContext('expertise-recommendations-trial-admission', async () => {
    const trial = trialContext(deps);
    const { policy } = trial;
    await deps.store.verifySandboxRecommendationDatabase();
    if (!await trial.authorize()) fail('recommendations_trial_access_denied', 403);
    const previous = await getReceipt(deps, policy);
    if (previous) {
      if (!await trial.authorize()) fail('recommendations_trial_access_denied', 403);
      return { jobId: previous.job.id, replayed: true };
    }
    const { configuration, budget } = await preflight(deps, trial);
    const now = deps.now();
    const { job, replayed } = await deps.store.admitSandboxRecommendation({
      ...ownerFor(policy), idempotencyKey: policy.idempotencyKey, operation: 'generate-draft',
      sourceExpiresAt: new Date(now + 24 * HOUR_MS), resultExpiresAt: new Date(now + 7 * 24 * HOUR_MS),
      tasks: [{ taskKey: EXPERTISE_TASK_KEY, configuration }],
    });
    return { jobId: job.id, replayed, budget };
  });
}

async function isCurrent(deps, trial, configuration) {
  const { policy } = trial;
  if (!trial.current() || configuration?.sourceProof?.hash !== policy.sourceHash) return false;
  const [source, roster] = await Promise.allSettled([
    deps.source.observe(sourceArgs(policy)),
    deps.roster(),
  ]);
  if (!trial.current()) return false;
  let sourceCurrent;
  if (source.status === 'fulfilled') {
    try { sourceCurrent = canonical(sourceProof(policy, configuration.profile, source.value)) === canonical(configuration.sourceProof); }
    catch { /* Incomplete observation. */ }
  } else if (CONFIRMED_SOURCE_CHANGE.has(source.reason?.code)) sourceCurrent = false;
  const freshness = roster.status === 'fulfilled' && roster.value?.targetHost === policy.targetHost
    ? compareRecommendationsRosterFreshness({ expectedRosterHash: configuration.rosterHash, current: roster.value.projection }).freshness
    : 'unknown';
  if (sourceCurrent === false || freshness === 'stale') return false;
  if (sourceCurrent !== true || freshness !== 'current') fail('recommendations_trial_freshness_unavailable', 503);
  return true;
}

/** An operator advances one stage. Response recovery is an explicit, zero-call action. */
export async function advanceSandboxRecommendationTrial({ recoverResponse = false } = {}, overrides = {}) {
  if (typeof recoverResponse !== 'boolean') fail('recommendations_trial_invalid_stage', 400);
  const deps = { ...defaults, ...overrides };
  return withDalContext('expertise-recommendations-trial-worker', async () => {
    const trial = trialContext(deps);
    const { policy } = trial;
    await deps.store.verifySandboxRecommendationDatabase();
    const receipt = await getReceipt(deps, policy);
    if (!receipt || !trial.current()) return { stage: 'unavailable' };
    const owner = ownerFor(policy);
    return advanceJob({
      jobId: receipt.job.id, store: deps.store, executePrompt: deps.executePrompt, nonceSecret: trial.nonceSecret,
      leaseMs: 300_000, recoverTrialResponse: recoverResponse, audit: deps.audit,
      authorize: async ({ job }) => job.id === receipt.job.id && job.idempotency_key === policy.idempotencyKey
        && job.environment === owner.environment && job.request_id === owner.requestId && job.principal_key === owner.principalKey
        && job.authorization_scope === owner.authorizationScope && await trial.authorize(),
      checkFreshness: ({ configuration }) => isCurrent(deps, trial, configuration),
      prepareSnapshot: async ({ configuration }) => {
        const inputs = await prepareInputs(deps, trial, configuration.profile);
        if (inputs.rosterHash !== configuration.rosterHash || canonical(inputs.proof) !== canonical(configuration.sourceProof)) {
          fail('trial_inputs_changed');
        }
        if (hashProfile(configuration.profile) !== policy.profileHash || !await trial.authorize()) fail('trial_inputs_changed');
        return inputs.snapshot;
      },
    });
  });
}
