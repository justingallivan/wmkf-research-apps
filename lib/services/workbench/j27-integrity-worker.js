import { withDalContext } from '../../dataverse/core/context';
import { loadModelOverrides } from '../model-override-loader';
import { j27IntegrityTarget } from '../../utils/j27-integrity-readiness';
import { runWorkbenchIntegrityScreen } from './integrity-service';
import {
  claimJ27IntegrityScreen, confirmJ27IntegrityEligibility, expireJ27IntegrityClaim,
  finishJ27IntegrityClaim, saveJ27IntegrityRun, readJ27IntegrityAttempt,
} from './j27-integrity-jobs';

export async function runJ27IntegrityJob(target, requestId, version) {
  if (j27IntegrityTarget() !== target) return 'done';
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
      await loadModelOverrides();
      await runWorkbenchIntegrityScreen({
        requestId: job.request_id,
        actorProfileId: job.actor_profile_id,
        claudeApiKey: process.env.CLAUDE_API_KEY,
        serpApiKey: process.env.SERP_API_KEY || null,
      }, { saveRun: result => saveJ27IntegrityRun(job, result) });
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
