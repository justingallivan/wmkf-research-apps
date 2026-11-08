import { withDalContext } from '../../dataverse/core/context';
import { loadModelOverrides } from '../model-override-loader';
import { j27IntegrityTarget, j27IntegritySimulationRequestIds, isJ27IntegritySimulationRequest } from '../../utils/j27-integrity-readiness';
import { getJ27IntegritySimulationSql, simulatedIntegrityEngine } from './j27-integrity-simulation';
import { runWorkbenchIntegrityScreen } from './integrity-service';
import {
  claimJ27IntegrityScreen, confirmJ27IntegrityEligibility, expireJ27IntegrityClaim,
  finishJ27IntegrityClaim, saveJ27IntegrityRun, readJ27IntegrityAttempt,
} from './j27-integrity-jobs';

export async function runJ27IntegrityJob(target, requestId, version) {
  if (j27IntegrityTarget() !== target) return 'done';
  const simulation = j27IntegritySimulationRequestIds().length > 0;
  if (simulation && !isJ27IntegritySimulationRequest(requestId)) return 'done';
  const job = await claimJ27IntegrityScreen(target, requestId, version);
  if (!job) {
    const state = await readJ27IntegrityAttempt(target, requestId, version);
    return state === 'queued' ? 'waiting' : state === 'running' ? 'recover' : 'done';
  }

  return withDalContext('workbench-j27-automatic-integrity', async () => {
    try {
      if (!await confirmJ27IntegrityEligibility(job)) {
        await finishJ27IntegrityClaim(job, 'skipped');
        return 'done';
      }
      if (!simulation) await loadModelOverrides();
      await runWorkbenchIntegrityScreen({
        requestId: job.request_id,
        actorProfileId: job.actor_profile_id,
        claudeApiKey: simulation ? 'simulated' : process.env.CLAUDE_API_KEY,
        serpApiKey: simulation ? null : process.env.SERP_API_KEY || null,
      }, {
        ...(simulation && { sql: getJ27IntegritySimulationSql(), IntegrityService: simulatedIntegrityEngine }),
        saveRun: result => saveJ27IntegrityRun(job, result),
      });
    } catch (error) {
      console.error('J27 automatic integrity job failed', { requestId, code: error?.body?.code || 'screen_failed' });
      await finishJ27IntegrityClaim(job, 'failed', error?.body?.code || 'screen_failed');
    }
    return 'done';
  });
}

export async function recoverJ27IntegrityJob(target, requestId, version) {
  if (j27IntegrityTarget() === target) await expireJ27IntegrityClaim(target, requestId, version);
}
